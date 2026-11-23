import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { all, get, json, now, parseJson, run, transaction } from '../lib/db.ts';
import { HttpError, requireInt, requireString } from '../lib/http.ts';
import { judge, answerLabel } from '../lib/judge.ts';
import { levelForXp, MONSTERS, stageFromKey, type QuestionAnswer, type QuestionContent } from '../lib/types.ts';
import { CHARACTERS, castFor, characterById } from '../lib/characters.ts';
import { ensureBalances, ensureGameSave, getProfile, stageStates } from './common.ts';
import { knowledgeCode } from '../seed/content.ts';
import { awardCharacterXp, selectedCharacter } from './characters.ts';

const DEFAULT_QUESTION_COUNT = 8;

function id(prefix = '') {
  return `${prefix}${randomBytes(10).toString('hex')}`;
}

function sessionRow(db: DatabaseSync, sessionId: string, studentId: string) {
  const row = get<any>(db, 'SELECT * FROM quiz_sessions WHERE id = ? AND student_id = ?', sessionId, studentId);
  if (!row) throw new HttpError(404, 'SESSION_NOT_FOUND', 'That battle could not be found');
  return row;
}

function questionsOf(db: DatabaseSync, sessionId: string) {
  return all<any>(db, 'SELECT * FROM session_questions WHERE session_id = ? ORDER BY seq', sessionId);
}

function safeJson<T>(value: string | null | undefined, fallback: T): T {
  return parseJson<T>(value, fallback);
}

function questionPayload(row: any, state: any, total: number) {
  const content = safeJson<QuestionContent>(row.content_json, {
    stem: { zh: '', en: '' },
    options: [],
    hints: [],
    explanation: { zh: '', en: '' },
    skill: { zh: '', en: '' },
  });
  const feedback = row.answered ? safeJson<any>(row.feedback_json, null) : null;
  return {
    seq: Number(row.seq),
    total,
    type: safeJson<QuestionAnswer>(row.answer_json, { kind: 'SINGLE', value: '' }).kind,
    stem: content.stem,
    options: (content.options || []).map((option) => ({ key: option.key, text: option.text })),
    unit: content.unit || null,
    skill: content.skill,
    hintsAvailable: (content.hints || []).length,
    hintsUsed: Number(row.hints_used) || 0,
    answered: Boolean(row.answered),
    feedback,
    battle: {
      monster: state.monster,
      hero: state.hero,
      combo: Number(state.combo) || 0,
      bestStreak: Number(state.bestStreak) || 0,
      correct: Number(state.correct) || 0,
      asked: Number(state.asked) || 0,
      pending: Boolean(state.pending),
      isFinal: Boolean(state.isFinal),
    },
  };
}

function sessionMeta(session: any, state: any, total: number) {
  return {
    id: session.id,
    kind: session.kind,
    stageKey: session.stage_key,
    knowledgeCode: session.knowledge_code,
    status: session.status,
    questionCount: total,
    index: Number(state.index) || 0,
    correct: Number(state.correct) || 0,
    asked: Number(state.asked) || 0,
    pending: Boolean(state.pending),
    characterId: state.characterId || null,
    startedAt: session.started_at,
    updatedAt: session.updated_at,
  };
}

function sessionPayload(db: DatabaseSync, session: any) {
  const rows = questionsOf(db, session.id);
  const state = safeJson<any>(session.state_json, {});
  const index = Math.min(Number(state.index) || 0, Math.max(0, rows.length - 1));
  const row = rows[index];
  const payload: any = {
    session: sessionMeta(session, state, rows.length),
    finished: session.status === 'FINISHED',
    question: row ? questionPayload(row, state, rows.length) : null,
  };
  if (session.status === 'FINISHED' && session.result_json) {
    payload.result = safeJson(session.result_json, null);
  }
  return payload;
}

function pickQuestions(db: DatabaseSync, knowledge: string, count: number, includeQuestionId?: string | null) {
  const pool = all<any>(
    db,
    `SELECT q.id, q.code, q.type, qv.id AS version_id, qv.content_json, qv.answer_json
     FROM questions q
     JOIN question_versions qv ON qv.question_id = q.id AND qv.version = q.current_version
     WHERE q.knowledge_code = ? AND q.status = 'PUBLISHED'
     ORDER BY RANDOM()`,
    knowledge,
  );
  const picked: any[] = [];
  const seen = new Set<string>();
  if (includeQuestionId) {
    const included = pool.find((item) => item.id === includeQuestionId);
    if (included) {
      picked.push(included);
      seen.add(included.id);
    }
  }
  for (const item of pool) {
    if (picked.length >= count) break;
    if (seen.has(item.id)) continue;
    picked.push(item);
    seen.add(item.id);
  }
  return picked.slice(0, count);
}

function resolveStage(db: DatabaseSync, studentId: string, body: any) {
  const profile = getProfile(db, studentId);
  const stageKey = requireString(body.stageKey, 'stageKey', { max: 40 });
  const parsed = stageFromKey(stageKey);
  if (!parsed) throw new HttpError(400, 'INVALID_STAGE', 'That stage is not valid');
  if (profile && parsed.grade !== profile.grade) {
    throw new HttpError(403, 'WRONG_GRADE', 'That stage is for another grade');
  }
  const map = stageStates(db, studentId, parsed.grade);
  const domain = map.domains.find((item: any) => item.id === parsed.domain);
  const stage = domain?.stages.find((item: any) => item.stage === parsed.stage);
  if (!stage) throw new HttpError(404, 'STAGE_NOT_FOUND', 'That stage could not be found');
  if (!stage.unlocked) throw new HttpError(403, 'STAGE_LOCKED', 'Clear the previous stage first');
  return { stage, grade: parsed.grade };
}

export function createSession(db: DatabaseSync, studentId: string, body: any) {
  const kind = body.kind === 'REVIEW' ? 'REVIEW' : body.kind === 'PRACTICE' ? 'PRACTICE' : 'STAGE';
  let knowledge = '';
  let stageKeyValue: string | null = null;
  let includeQuestionId: string | null = null;
  let count = Number(body.questionCount) || DEFAULT_QUESTION_COUNT;

  if (kind === 'STAGE') {
    const resolved = resolveStage(db, studentId, body);
    knowledge = knowledgeCode(resolved.grade, resolved.stage.key.split('-')[1], resolved.stage.stage);
    // The knowledge point code is authoritative; stage metadata only selects it.
    const point = get<any>(db, 'SELECT code FROM knowledge_points WHERE code = ?', knowledge);
    if (!point) {
      knowledge = get<any>(
        db,
        'SELECT code FROM knowledge_points WHERE grade = ? AND domain = ? AND code LIKE ?',
        resolved.grade,
        resolved.stage.key.split('-')[1],
        `%0${resolved.stage.stage}`,
      )?.code || knowledge;
    }
    stageKeyValue = resolved.stage.key;
  } else if (kind === 'REVIEW') {
    if (body.mistakeId) {
      const mistake = get<any>(db, 'SELECT * FROM mistakes WHERE id = ? AND student_id = ?', body.mistakeId, studentId);
      if (!mistake) throw new HttpError(404, 'MISTAKE_NOT_FOUND', 'That mistake could not be found');
      knowledge = mistake.knowledge_code;
      includeQuestionId = mistake.question_id;
    } else {
      knowledge = requireString(body.knowledgeCode, 'knowledgeCode', { max: 80 });
    }
    count = Math.min(count, 8);
  } else {
    knowledge = requireString(body.knowledgeCode, 'knowledgeCode', { max: 80 });
  }

  const point = get<any>(db, 'SELECT * FROM knowledge_points WHERE code = ? AND status = ?', knowledge, 'active');
  if (!point) throw new HttpError(404, 'KNOWLEDGE_NOT_FOUND', 'That skill is not available');

  const existing = get<any>(
    db,
    `SELECT * FROM quiz_sessions WHERE student_id = ? AND status = 'ACTIVE'
     AND knowledge_code = ? AND kind = ? ORDER BY updated_at DESC LIMIT 1`,
    studentId,
    knowledge,
    kind,
  );
  if (existing) return sessionPayload(db, existing);

  run(db, "UPDATE quiz_sessions SET status = 'ABANDONED', updated_at = ? WHERE student_id = ? AND status = 'ACTIVE'", now(), studentId);

  const questions = pickQuestions(db, knowledge, Math.max(4, Math.min(12, count)), includeQuestionId);
  if (!questions.length) throw new HttpError(409, 'NO_QUESTIONS', 'There are no published questions for this skill yet');

  const stageNumber = Number(String(point.code).slice(-1)) || 1;
  const monster = MONSTERS[Math.min(stageNumber - 1, MONSTERS.length - 1)];
  const maxHp = kind === 'STAGE' ? monster.hp : 150;
  const chosenCharacter = selectedCharacter(db, studentId);
  const state = {
    monster: { id: monster.id, nameZh: monster.zh, nameEn: monster.en, hp: maxHp, maxHp },
    hero: { hp: 100, maxHp: 100 },
    characterId: chosenCharacter?.def.id || 'pyra',
    difficulty: Number(point.difficulty) || 1,
    index: 0,
    pending: false,
    isFinal: false,
    combo: 0,
    bestStreak: 0,
    correct: 0,
    asked: 0,
  };
  const sessionId = id('s_');
  const startedAt = now();
  run(
    db,
    `INSERT INTO quiz_sessions
     (id, student_id, kind, stage_key, knowledge_code, question_count, status, started_at, updated_at, state_json)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
    sessionId,
    studentId,
    kind,
    stageKeyValue,
    knowledge,
    questions.length,
    'ACTIVE',
    startedAt,
    startedAt,
    json(state),
  );
  const insert = db.prepare(
    `INSERT INTO session_questions (id, session_id, seq, question_id, version_id, content_json, answer_json, answered, time_ms, hints_used)
     VALUES (?,?,?,?,?,?,?,?,?,?)`,
  );
  questions.forEach((question, index) => {
    insert.run(
      id('sq_'),
      sessionId,
      index,
      question.id,
      question.version_id,
      question.content_json,
      question.answer_json,
      0,
      0,
      0,
    );
  });
  const session = get<any>(db, 'SELECT * FROM quiz_sessions WHERE id = ?', sessionId);
  return sessionPayload(db, session);
}

export function getSession(db: DatabaseSync, studentId: string, sessionId: string) {
  const session = sessionRow(db, sessionId, studentId);
  return sessionPayload(db, session);
}

export function submitAnswer(db: DatabaseSync, studentId: string, sessionId: string, body: any) {
  const session = sessionRow(db, sessionId, studentId);
  if (session.status !== 'ACTIVE') throw new HttpError(409, 'SESSION_FINISHED', 'This battle has already finished');
  const rows = questionsOf(db, sessionId);
  const state = safeJson<any>(session.state_json, {});
  const seq = requireInt(body.seq, 'seq', { min: 0, max: rows.length - 1 });
  if (seq !== Number(state.index)) {
    throw new HttpError(409, 'OUT_OF_ORDER', 'That is not the current question');
  }
  const row = rows[seq];
  if (row.answered) {
    return { ...safeJson<any>(row.feedback_json, {}), idempotent: true, session: sessionMeta(session, state, rows.length) };
  }
  const content = safeJson<QuestionContent>(row.content_json, {} as QuestionContent);
  const answer = safeJson<QuestionAnswer>(row.answer_json, {} as QuestionAnswer);
  const submitted = body.answer;
  const timeMs = Math.max(0, Math.min(3_600_000, Number(body.timeMs) || 0));
  const judged = judge(content, answer, submitted);
  const hintsUsed = Number(row.hints_used) || 0;

  const character = characterById(state.characterId) || selectedCharacter(db, studentId)?.def || CHARACTERS[0];
  const streak = Number(state.combo) || 0;
  if (judged.correct) {
    const comboSteps = Math.min(streak, 3);
    const damage = 22 + comboSteps * 6 + character.comboBonus * comboSteps + character.damageBonus;
    state.monster.hp = Math.max(0, Number(state.monster.hp) - damage);
    state.combo = streak + 1;
    state.bestStreak = Math.max(Number(state.bestStreak) || 0, state.combo);
    state.correct = (Number(state.correct) || 0) + 1;
    state.damage = damage;
  } else {
    const counter = Math.max(8, 20 - character.counterReduction);
    state.hero.hp = Math.max(0, Number(state.hero.hp) - counter);
    state.combo = 0;
    state.damage = counter;
  }
  const chosenForLevel = selectedCharacter(db, studentId);
  const characterLevel = chosenForLevel?.def.id === character.id ? chosenForLevel.summary.level : 1;
  const cast = castFor(character, Number(state.difficulty) || 1, characterLevel);
  state.asked = (Number(state.asked) || 0) + 1;
  state.pending = true;
  state.isFinal =
    Number(state.monster.hp) <= 0 ||
    Number(state.hero.hp) <= 0 ||
    seq >= rows.length - 1;

  const masteryBefore = get<any>(db, 'SELECT * FROM mastery_records WHERE student_id = ? AND knowledge_code = ?', studentId, session.knowledge_code);
  const oldScore = Number(masteryBefore?.score) || 0;
  const masteryScore = Math.max(0, Math.min(100, Math.round(oldScore * 0.7 + (judged.correct ? 100 : 0) * 0.3)));
  run(
    db,
    `INSERT INTO mastery_records (student_id, knowledge_code, score, attempts, correct, last_practiced_at)
     VALUES (?,?,?,?,?,?)
     ON CONFLICT(student_id, knowledge_code) DO UPDATE SET score = excluded.score, attempts = excluded.attempts,
       correct = excluded.correct, last_practiced_at = excluded.last_practiced_at`,
    studentId,
    session.knowledge_code,
    masteryScore,
    Number(masteryBefore?.attempts || 0) + 1,
    Number(masteryBefore?.correct || 0) + (judged.correct ? 1 : 0),
    now(),
  );

  if (judged.correct) {
    run(db, 'UPDATE mistakes SET resolved = 1, updated_at = ? WHERE student_id = ? AND question_id = ?', now(), studentId, row.question_id);
  } else {
    const existingMistake = get<any>(db, 'SELECT * FROM mistakes WHERE student_id = ? AND question_id = ?', studentId, row.question_id);
    if (existingMistake) {
      run(
        db,
        'UPDATE mistakes SET wrong_answer_json = ?, wrong_count = wrong_count + 1, resolved = 0, updated_at = ?, content_json = ?, answer_json = ? WHERE id = ?',
        json(submitted),
        now(),
        row.content_json,
        row.answer_json,
        existingMistake.id,
      );
    } else {
      run(
        db,
        `INSERT INTO mistakes (id, student_id, question_id, version_id, knowledge_code, content_json, answer_json, wrong_answer_json, wrong_count, resolved, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        id('m_'),
        studentId,
        row.question_id,
        row.version_id,
        session.knowledge_code,
        row.content_json,
        row.answer_json,
        json(submitted),
        1,
        0,
        now(),
        now(),
      );
    }
  }

  const correctText = answerLabel(content, answer);
  const feedback = {
    correct: judged.correct,
    correctAnswer: correctText,
    correctAnswerKey: answer.kind === 'SINGLE' ? String(answer.value) : answer.kind === 'JUDGE' ? (answer.value ? 'T' : 'F') : null,
    correctAnswerKeys: answer.kind === 'MULTI' ? (Array.isArray(answer.value) ? answer.value : []) : null,
    explanation: content.explanation,
    damage: state.damage,
    damageTo: judged.correct ? 'monster' : 'hero',
    monsterHp: state.monster.hp,
    monsterMaxHp: state.monster.maxHp,
    heroHp: state.hero.hp,
    heroMaxHp: state.hero.maxHp,
    combo: state.combo,
    bestStreak: state.bestStreak,
    correctCount: state.correct,
    asked: state.asked,
    isFinal: state.isFinal,
    mastery: { score: masteryScore, delta: masteryScore - oldScore },
    hintsUsed,
    character: {
      id: character.id,
      name: character.name,
      title: character.title,
      element: character.element,
      color: character.color,
      trait: character.trait,
    },
    cast,
  };

  transaction(db, () => {
    run(
      db,
      'UPDATE session_questions SET answered = 1, answer_given_json = ?, correct = ?, time_ms = ?, feedback_json = ?, answered_at = ? WHERE id = ?',
      json(submitted),
      judged.correct ? 1 : 0,
      timeMs,
      json(feedback),
      now(),
      row.id,
    );
    run(db, 'UPDATE quiz_sessions SET state_json = ?, updated_at = ? WHERE id = ?', json(state), now(), sessionId);
    run(
      db,
      `INSERT INTO question_stats (question_id, exposures, correct, total_ms, hints)
       VALUES (?,?,?,?,?)
       ON CONFLICT(question_id) DO UPDATE SET exposures = exposures + 1, correct = correct + excluded.correct,
         total_ms = total_ms + excluded.total_ms, hints = hints + excluded.hints`,
      row.question_id,
      1,
      judged.correct ? 1 : 0,
      timeMs,
      hintsUsed,
    );
  });

  const updated = get<any>(db, 'SELECT * FROM quiz_sessions WHERE id = ?', sessionId);
  return { ...feedback, session: sessionMeta(updated, state, rows.length) };
}

export function nextQuestion(db: DatabaseSync, studentId: string, sessionId: string) {
  const session = sessionRow(db, sessionId, studentId);
  const rows = questionsOf(db, sessionId);
  const state = safeJson<any>(session.state_json, {});
  if (session.status !== 'ACTIVE') return { finished: true, session: sessionMeta(session, state, rows.length) };
  if (state.pending) {
    if (state.isFinal || Number(state.monster.hp) <= 0 || Number(state.hero.hp) <= 0) {
      run(db, 'UPDATE quiz_sessions SET status = ?, updated_at = ? WHERE id = ?', 'FINISHED', now(), sessionId);
      const finished = get<any>(db, 'SELECT * FROM quiz_sessions WHERE id = ?', sessionId);
      return { finished: true, session: sessionMeta(finished, state, rows.length) };
    }
    state.index = Math.min(rows.length - 1, Number(state.index) + 1);
    state.pending = false;
  }
  run(db, 'UPDATE quiz_sessions SET state_json = ?, updated_at = ? WHERE id = ?', json(state), now(), sessionId);
  const updated = get<any>(db, 'SELECT * FROM quiz_sessions WHERE id = ?', sessionId);
  return { finished: false, ...sessionPayload(db, updated) };
}

export function requestHint(db: DatabaseSync, studentId: string, sessionId: string, body: any) {
  const session = sessionRow(db, sessionId, studentId);
  if (session.status !== 'ACTIVE') throw new HttpError(409, 'SESSION_FINISHED', 'This battle has already finished');
  const rows = questionsOf(db, sessionId);
  const state = safeJson<any>(session.state_json, {});
  const seq = requireInt(body.seq ?? state.index, 'seq', { min: 0, max: rows.length - 1 });
  const row = rows[seq];
  if (row.answered) throw new HttpError(409, 'ALREADY_ANSWERED', 'Hints are only available before answering');
  const content = safeJson<QuestionContent>(row.content_json, { hints: [] } as any);
  const hints = content.hints || [];
  const used = Number(row.hints_used) || 0;
  if (used >= hints.length) throw new HttpError(409, 'NO_MORE_HINTS', 'There are no more hints for this question');
  run(db, 'UPDATE session_questions SET hints_used = hints_used + 1 WHERE id = ?', row.id);
  return {
    hint: hints[used],
    hintsUsed: used + 1,
    hintsLeft: Math.max(0, hints.length - used - 1),
    totalHints: hints.length,
  };
}

export function result(db: DatabaseSync, studentId: string, sessionId: string) {
  const session = sessionRow(db, sessionId, studentId);
  if (session.result_json) {
    const cached = safeJson<any>(session.result_json, {});
    const cachedMap = session.kind === 'STAGE' ? stageStates(db, studentId, getProfile(db, studentId)?.grade || 4) : null;
    let cachedNext: any = null;
    if (cached.victory && session.kind === 'STAGE' && session.stage_key) {
      const parsed = stageFromKey(session.stage_key);
      if (parsed && parsed.stage < 3) cachedNext = { stageKey: `g${parsed.grade}-${parsed.domain}-${parsed.stage + 1}`, stage: parsed.stage + 1 };
    }
    return { result: cached, nextStage: cachedNext, map: cachedMap };
  }
  if (session.status !== 'FINISHED' && !safeJson<any>(session.state_json, {}).isFinal) {
    throw new HttpError(409, 'SESSION_ACTIVE', 'Finish the battle before viewing its result');
  }
  const rows = questionsOf(db, sessionId);
  const state = safeJson<any>(session.state_json, {});
  const asked = Math.max(Number(state.asked) || 0, rows.filter((row) => row.answered).length);
  const correct = Number(state.correct) || 0;
  const heroAlive = Number(state.hero?.hp ?? 100) > 0;
  const accuracy = asked ? correct / asked : 0;
  const victory = heroAlive && (Number(state.monster?.hp) <= 0 || (asked >= rows.length && accuracy >= 0.6));
  const stars = victory ? (correct === asked ? 3 : accuracy >= 0.8 ? 2 : 1) : 0;
  const xp = correct * 12 + (victory ? 20 : 0) + stars * 5;
  const coins = victory ? correct * 6 + stars * 5 : Math.floor(correct * 2);
  const durationMs = rows.reduce((sum, row) => sum + (Number(row.time_ms) || 0), 0);
  const save = ensureGameSave(db, studentId);
  const characterId = state.characterId || selectedCharacter(db, studentId)?.def.id || 'pyra';
  let characterAward: any = null;
  let afterProgress = levelForXp(Number(save.xp) || 0);
  let characterPayload: any = null;
  const balances = ensureBalances(db, studentId);
  const endedAt = now();
  const duration = Math.max(durationMs, new Date(endedAt).getTime() - new Date(session.started_at).getTime());

  const existingReward = get<any>(db, 'SELECT * FROM reward_records WHERE idempotency_key = ?', `reward:${sessionId}`);
  let coinsAfter = balances.coins;
  let starsAfter = balances.stars;
  if (!existingReward) {
    transaction(db, () => {
      characterAward = awardCharacterXp(db, studentId, characterId, xp);
      afterProgress = characterAward.after.levelProgress;
      characterPayload = {
        id: characterAward.def.id,
        name: characterAward.def.name,
        title: characterAward.def.title,
        color: characterAward.def.color,
        element: characterAward.def.element,
        level: characterAward.after.level,
        xp: characterAward.after.xp,
        levelUp: characterAward.after.level > characterAward.before.level,
        outfitTier: characterAward.after.outfitTier,
        spellTier: characterAward.after.spellTier,
        outfitName: characterAward.after.outfitName,
        spellName: characterAward.after.spells[characterAward.after.spellTier - 1]?.name || null,
        ultimate: characterAward.after.ultimate,
        unlockedOutfit: characterAward.after.outfitTier > characterAward.before.outfitTier ? characterAward.after.outfitName : null,
        unlockedSpell: characterAward.after.spellTier > characterAward.before.spellTier ? characterAward.after.spells[characterAward.after.spellTier - 1]?.name || null : null,
      };
      run(
        db,
        'UPDATE game_saves SET xp = xp + ?, level = ?, updated_at = ? WHERE user_id = ?',
        xp,
        afterProgress.level,
        endedAt,
        studentId,
      );
      run(db, 'UPDATE currency_accounts SET coins = coins + ?, stars = stars + ? WHERE user_id = ?', coins, stars, studentId);
      const account = get<any>(db, 'SELECT coins, stars FROM currency_accounts WHERE user_id = ?', studentId);
      coinsAfter = Number(account.coins);
      starsAfter = Number(account.stars);
      run(
        db,
        'INSERT INTO currency_transactions (id, user_id, currency, amount, balance_after, source, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?)',
        id('ct_'),
        studentId,
        'COINS',
        coins,
        coinsAfter,
        `SESSION:${sessionId}`,
        `tx:${sessionId}:coins`,
        endedAt,
      );
      run(
        db,
        'INSERT INTO currency_transactions (id, user_id, currency, amount, balance_after, source, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?)',
        id('ct_'),
        studentId,
        'STARS',
        stars,
        starsAfter,
        `SESSION:${sessionId}`,
        `tx:${sessionId}:stars`,
        endedAt,
      );
      run(
        db,
        'INSERT INTO reward_records (id, user_id, session_id, rewards_json, idempotency_key, created_at) VALUES (?,?,?,?,?,?)',
        id('r_'),
        studentId,
        sessionId,
        json({ xp, coins, stars }),
        `reward:${sessionId}`,
        endedAt,
      );
      if (session.kind === 'STAGE' && session.stage_key) {
        const current = get<any>(db, 'SELECT * FROM stage_results WHERE student_id = ? AND stage_key = ?', studentId, session.stage_key);
        run(
          db,
          `INSERT INTO stage_results (student_id, stage_key, stars, best_stars, correct, asked, updated_at)
           VALUES (?,?,?,?,?,?,?)
           ON CONFLICT(student_id, stage_key) DO UPDATE SET stars = excluded.stars,
             best_stars = MAX(stage_results.best_stars, excluded.best_stars), correct = excluded.correct,
             asked = excluded.asked, updated_at = excluded.updated_at`,
          studentId,
          session.stage_key,
          stars,
          Math.max(stars, Number(current?.best_stars || 0)),
          correct,
          asked,
          endedAt,
        );
      }
      const resultPayload = {
        victory,
        stars,
        correct,
        asked,
        accuracy: Math.round(accuracy * 100),
        bestStreak: Number(state.bestStreak) || 0,
        durationMs: duration,
        xp,
        coins,
        starCurrency: stars,
        level: afterProgress.level,
        levelUp: Boolean(characterAward?.after.level > characterAward?.before.level),
        levelProgress: afterProgress,
        character: characterPayload,
        balances: { coins: coinsAfter, stars: starsAfter },
        endedAt,
        kind: session.kind,
        stageKey: session.stage_key,
        knowledgeCode: session.knowledge_code,
      };
      run(
        db,
        'UPDATE quiz_sessions SET status = ?, ended_at = ?, result_json = ?, reward_json = ?, updated_at = ? WHERE id = ?',
        'FINISHED',
        endedAt,
        json(resultPayload),
        json({ xp, coins, stars }),
        endedAt,
        sessionId,
      );
      return resultPayload;
    });
  }
  const finished = get<any>(db, 'SELECT * FROM quiz_sessions WHERE id = ?', sessionId);
  const payload = safeJson<any>(finished.result_json, {}) || {};
  let nextStage: any = null;
  if (payload.victory && session.kind === 'STAGE' && session.stage_key) {
    const parsed = stageFromKey(session.stage_key);
    if (parsed && parsed.stage < 3) {
      nextStage = { stageKey: `g${parsed.grade}-${parsed.domain}-${parsed.stage + 1}`, stage: parsed.stage + 1 };
    }
  }
  const map = session.kind === 'STAGE' ? stageStates(db, studentId, getProfile(db, studentId)?.grade || 4) : null;
  return { result: payload, nextStage, map };
}

export function abandon(db: DatabaseSync, studentId: string, sessionId: string) {
  const session = sessionRow(db, sessionId, studentId);
  if (session.status === 'ACTIVE') {
    run(db, "UPDATE quiz_sessions SET status = 'ABANDONED', updated_at = ? WHERE id = ?", now(), sessionId);
  }
  return { ok: true };
}

export function listMistakes(db: DatabaseSync, studentId: string, query: URLSearchParams) {
  const resolved = query.get('resolved');
  const knowledge = query.get('knowledgeCode');
  const where = ['student_id = ?'];
  const params: any[] = [studentId];
  if (resolved === '0' || resolved === '1') {
    where.push('resolved = ?');
    params.push(Number(resolved));
  }
  if (knowledge) {
    where.push('knowledge_code = ?');
    params.push(knowledge);
  }
  const rows = all<any>(
    db,
    `SELECT * FROM mistakes WHERE ${where.join(' AND ')} ORDER BY resolved ASC, updated_at DESC LIMIT 100`,
    ...params,
  );
  return rows.map((row) => {
    let content: any = {};
    try {
      content = JSON.parse(row.content_json);
    } catch {
      // ignore malformed snapshot
    }
    return {
      id: row.id,
      knowledgeCode: row.knowledge_code,
      wrongCount: row.wrong_count,
      resolved: Boolean(row.resolved),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      stem: content.stem || { zh: '', en: '' },
      skill: content.skill || { zh: '', en: '' },
      type: content.options?.length ? 'SINGLE' : null,
      options: content.options || [],
      hints: content.hints || [],
      explanation: content.explanation || { zh: '', en: '' },
      answer: JSON.parse(row.answer_json || '{}'),
    };
  });
}

export function resolveMistake(db: DatabaseSync, studentId: string, mistakeId: string) {
  const row = get<any>(db, 'SELECT * FROM mistakes WHERE id = ? AND student_id = ?', mistakeId, studentId);
  if (!row) throw new HttpError(404, 'MISTAKE_NOT_FOUND', 'That mistake could not be found');
  run(db, 'UPDATE mistakes SET resolved = 1, updated_at = ? WHERE id = ?', now(), mistakeId);
  return { ok: true };
}
