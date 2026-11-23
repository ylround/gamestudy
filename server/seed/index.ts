import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { get, json, now, run, transaction } from '../lib/db.ts';
import { hashPassword } from '../lib/auth.ts';
import { buildKnowledgePoints, generateSeedQuestions, knowledgeCode, MONSTERS, type SeedKnowledgePoint } from './content.ts';
import { levelForXp, stageKey } from '../lib/types.ts';
import { ensureCharacters } from '../modules/characters.ts';

function id(prefix = '') {
  return `${prefix}${randomBytes(10).toString('hex')}`;
}

const DEFAULT_SETTINGS = {
  lang: 'zh',
  sound: true,
  reducedMotion: false,
  highContrast: false,
  fontScale: 1,
  countdown: false,
};

function insertUser(
  db: DatabaseSync,
  options: {
    username: string;
    password: string;
    role: 'student' | 'parent' | 'admin';
    displayName: string;
    nickname: string;
    grade?: number;
    inviteCode?: string;
    createdAt?: string;
  },
) {
  const userId = id('u_');
  const createdAt = options.createdAt || now();
  run(
    db,
    'INSERT INTO users (id, username, password_hash, role, display_name, status, created_at) VALUES (?,?,?,?,?,?,?)',
    userId,
    options.username,
    hashPassword(options.password),
    options.role,
    options.displayName,
    'active',
    createdAt,
  );
  run(
    db,
    `INSERT INTO profiles (user_id, nickname, grade, textbook, avatar, invite_code, consent_at, controls_json, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    userId,
    options.nickname,
    options.grade ?? 4,
    'RJ',
    options.role === 'parent' ? 'parent' : 'wizard',
    options.inviteCode || null,
    options.role === 'student' ? createdAt : null,
    options.role === 'parent'
      ? json({ dailyMinutes: 40, allowedFrom: '17:00', allowedTo: '21:00', notifications: true, purchaseApproval: true })
      : null,
    createdAt,
  );
  if (options.role !== 'parent') {
    run(
      db,
      'INSERT INTO game_saves (user_id, xp, level, settings_json, map_json, updated_at) VALUES (?,?,?,?,?,?)',
      userId,
      0,
      1,
      json(DEFAULT_SETTINGS),
      json({}),
      createdAt,
    );
    run(db, 'INSERT INTO currency_accounts (user_id, coins, stars) VALUES (?,?,?)', userId, 0, 0);
  }
  return userId;
}

function seedKnowledge(db: DatabaseSync, points: SeedKnowledgePoint[]) {
  const insert = db.prepare(
    `INSERT OR IGNORE INTO knowledge_points
     (id, code, subject_code, grade, term, textbook, domain, unit_code, unit_name_zh, unit_name_en,
      name_zh, name_en, parent_code, prerequisite_codes, difficulty, status, sort, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  for (const point of points) {
    insert.run(
      id('kp_'),
      point.code,
      'MATH',
      point.grade,
      point.term,
      point.textbook,
      point.domain,
      point.unitCode,
      point.unitNameZh,
      point.unitNameEn,
      point.nameZh,
      point.nameEn,
      point.parentCode,
      json(point.prerequisiteCodes),
      point.difficulty,
      'active',
      point.sort,
      now(),
      now(),
    );
  }
}

function seedQuestionBank(db: DatabaseSync, points: SeedKnowledgePoint[], authorId: string) {
  const existingCount = get<{ count: number }>(db, 'SELECT COUNT(*) AS count FROM questions')?.count || 0;
  if (existingCount > 0) return 0;
  const insertQuestion = db.prepare(
    `INSERT OR IGNORE INTO questions
     (id, code, knowledge_code, type, difficulty, status, source, batch_id, created_by, created_at, updated_at, published_at, current_version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  );
  const insertVersion = db.prepare(
    `INSERT INTO question_versions (id, question_id, version, content_json, answer_json, review_json, created_by, created_at, note)
     VALUES (?,?,?,?,?,?,?,?,?)`,
  );
  const insertStats = db.prepare('INSERT OR IGNORE INTO question_stats (question_id) VALUES (?)');

  let total = 0;
  for (const point of points) {
    const questions = generateSeedQuestions(point);
    for (const question of questions) {
      const existing = get<any>(db, 'SELECT id FROM questions WHERE code = ?', question.code);
      if (existing) continue;
      const questionId = id('q_');
      const createdAt = now();
      insertQuestion.run(
        questionId,
        question.code,
        question.knowledgeCode,
        question.type,
        question.difficulty,
        'PUBLISHED',
        'SEED',
        null,
        authorId,
        createdAt,
        createdAt,
        createdAt,
        1,
      );
      insertVersion.run(
        id('qv_'),
        questionId,
        1,
        json(question.content),
        json(question.answer),
        json({ validated: true, source: 'seed' }),
        authorId,
        createdAt,
        'seed content',
      );
      insertStats.run(questionId);
      total += 1;
    }
  }
  return total;
}

function seedDemoProgress(db: DatabaseSync, xiaoyuId: string, leleId: string) {
  const stageOne = stageKey(4, 'numbers', 1);
  const stageTwo = stageKey(4, 'fractions', 1);
  const sessions = [
    { id: 'demo-session-1', student: xiaoyuId, stage: stageOne, domain: 'numbers', stars: 2, correct: 7, asked: 8, hoursAgo: 2 },
    { id: 'demo-session-2', student: xiaoyuId, stage: stageTwo, domain: 'fractions', stars: 1, correct: 6, asked: 8, hoursAgo: 20 },
    { id: 'demo-session-3', student: leleId, stage: stageOne, domain: 'numbers', stars: 3, correct: 8, asked: 8, hoursAgo: 5 },
  ];

  for (const session of sessions) {
    const kpCode = get<any>(
      db,
      'SELECT code FROM knowledge_points WHERE code = ?',
      knowledgeCode(4, session.domain, 1),
    )?.code || (session.domain === 'numbers' ? 'MATH-RJ-G4-T1-NUM-01' : 'MATH-RJ-G4-T1-FRAC-01');
    const questions = db
      .prepare(
        `SELECT q.id AS question_id, qv.id AS version_id, qv.content_json, qv.answer_json
         FROM questions q JOIN question_versions qv ON qv.question_id = q.id AND qv.version = q.current_version
         WHERE q.knowledge_code = ? AND q.status = 'PUBLISHED' ORDER BY q.code LIMIT 8`,
      )
      .all(kpCode) as any[];
    if (!questions.length) continue;
    const endedAt = new Date(Date.now() - session.hoursAgo * 3600_000).toISOString();
    const startedAt = new Date(new Date(endedAt).getTime() - 9 * 60_000).toISOString();
    const state = {
      monster: { ...MONSTERS[0], maxHp: MONSTERS[0].hp, hp: Math.max(1, MONSTERS[0].hp - session.correct * 30) },
      hero: { hp: Math.max(1, 100 - (session.asked - session.correct) * 20), maxHp: 100 },
      index: session.asked - 1,
      pending: false,
      combo: 0,
      bestStreak: Math.min(3, session.correct),
      correct: session.correct,
      asked: session.asked,
    };
    run(
      db,
      `INSERT OR REPLACE INTO quiz_sessions
       (id, student_id, kind, stage_key, knowledge_code, question_count, status, started_at, ended_at, state_json, result_json, reward_json, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      session.id,
      session.student,
      'STAGE',
      session.stage,
      kpCode,
      8,
      'FINISHED',
      startedAt,
      endedAt,
      json(state),
      json({ victory: true, stars: session.stars, correct: session.correct, asked: session.asked, durationMs: 9 * 60_000 }),
      json({ xp: session.correct * 12 + 20, coins: session.correct * 6 + session.stars * 5, stars: session.stars }),
      endedAt,
    );

    questions.forEach((question: any, index: number) => {
      const wrong = index === session.asked - 1 && session.correct < session.asked;
      const content = JSON.parse(question.content_json);
      const answer = JSON.parse(question.answer_json);
      const given = wrong
        ? (answer.kind === 'SINGLE' ? { optionKey: content.options.find((option: any) => option.key !== answer.value)?.key } : { value: '0' })
        : (answer.kind === 'SINGLE' ? { optionKey: answer.value } : answer.kind === 'JUDGE' ? { value: answer.value } : { value: answer.value });
      run(
        db,
        `INSERT OR REPLACE INTO session_questions
         (id, session_id, seq, question_id, version_id, content_json, answer_json, answered, answer_given_json, correct, time_ms, hints_used, feedback_json, answered_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id('sq_'),
        session.id,
        index,
        question.question_id,
        question.version_id,
        question.content_json,
        question.answer_json,
        1,
        json(given),
        wrong ? 0 : 1,
        6_000 + index * 700,
        index % 3 === 0 ? 1 : 0,
        json({ correct: !wrong }),
        new Date(new Date(startedAt).getTime() + (index + 1) * 40_000).toISOString(),
      );
      if (wrong) {
        run(
          db,
          `INSERT OR REPLACE INTO mistakes
           (id, student_id, question_id, version_id, knowledge_code, content_json, answer_json, wrong_answer_json, wrong_count, resolved, created_at, updated_at)
           VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
          id('m_'),
          session.student,
          question.question_id,
          question.version_id,
          kpCode,
          question.content_json,
          question.answer_json,
          json(given),
          1,
          0,
          endedAt,
          endedAt,
        );
      }
    });

    const score = Math.round((session.correct / session.asked) * 100);
    run(
      db,
      `INSERT INTO mastery_records (student_id, knowledge_code, score, attempts, correct, last_practiced_at)
       VALUES (?,?,?,?,?,?)
       ON CONFLICT(student_id, knowledge_code) DO UPDATE SET score = excluded.score, attempts = excluded.attempts,
         correct = excluded.correct, last_practiced_at = excluded.last_practiced_at`,
      session.student,
      kpCode,
      score,
      session.asked,
      session.correct,
      endedAt,
    );
    run(
      db,
      `INSERT INTO stage_results (student_id, stage_key, stars, best_stars, correct, asked, updated_at)
       VALUES (?,?,?,?,?,?,?)
       ON CONFLICT(student_id, stage_key) DO UPDATE SET stars = excluded.stars, best_stars = MAX(stage_results.best_stars, excluded.best_stars),
         correct = excluded.correct, asked = excluded.asked, updated_at = excluded.updated_at`,
      session.student,
      session.stage,
      session.stars,
      session.stars,
      session.correct,
      session.asked,
      endedAt,
    );

    const coins = session.correct * 6 + session.stars * 5;
    const xp = session.correct * 12 + 20;
    run(
      db,
      'UPDATE currency_accounts SET coins = coins + ?, stars = stars + ? WHERE user_id = ?',
      coins,
      session.stars,
      session.student,
    );
    const account = get<any>(db, 'SELECT coins, stars FROM currency_accounts WHERE user_id = ?', session.student);
    run(
      db,
      'INSERT INTO currency_transactions (id, user_id, currency, amount, balance_after, source, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?)',
      id('ct_'),
      session.student,
      'COINS',
      coins,
      account.coins,
      `SESSION:${session.id}`,
      `tx:session:${session.id}:coins`,
      endedAt,
    );
    run(
      db,
      'INSERT INTO currency_transactions (id, user_id, currency, amount, balance_after, source, idempotency_key, created_at) VALUES (?,?,?,?,?,?,?,?)',
      id('ct_'),
      session.student,
      'STARS',
      session.stars,
      account.stars,
      `SESSION:${session.id}`,
      `tx:session:${session.id}:stars`,
      endedAt,
    );
    run(
      db,
      'INSERT INTO reward_records (id, user_id, session_id, rewards_json, idempotency_key, created_at) VALUES (?,?,?,?,?,?)',
      id('r_'),
      session.student,
      session.id,
      json({ xp, coins, stars: session.stars }),
      `reward:${session.id}`,
      endedAt,
    );
    run(
      db,
      'UPDATE game_saves SET xp = xp + ?, level = ?, updated_at = ? WHERE user_id = ?',
      xp,
      levelForXp(get<any>(db, 'SELECT xp FROM game_saves WHERE user_id = ?', session.student)?.xp + xp || xp).level,
      endedAt,
      session.student,
    );
  }
}

export function seedDatabase(db: DatabaseSync) {
  const admin = get<any>(db, "SELECT id FROM users WHERE role = 'admin' LIMIT 1");
  const seeded = Boolean(admin);
  let usersCreated = 0;
  let questions = 0;

  transaction(db, () => {
    let adminId = admin?.id;
    if (!adminId) {
      adminId = insertUser(db, {
        username: 'admin',
        password: 'admin1234',
        role: 'admin',
        displayName: '管理员',
        nickname: '管理员',
      });
      usersCreated += 1;
    }
    let xiaoyu = get<any>(db, "SELECT id FROM users WHERE username = 'xiaoyu'")?.id;
    if (!xiaoyu) {
      xiaoyu = insertUser(db, { username: 'xiaoyu', password: 'demo1234', role: 'student', displayName: '小雨', nickname: '小雨', grade: 4, inviteCode: 'XY2026' });
      usersCreated += 1;
    }
    let lele = get<any>(db, "SELECT id FROM users WHERE username = 'lele'")?.id;
    if (!lele) {
      lele = insertUser(db, { username: 'lele', password: 'demo1234', role: 'student', displayName: '乐乐', nickname: '乐乐', grade: 3, inviteCode: 'LL2026' });
      usersCreated += 1;
    }
    let mama = get<any>(db, "SELECT id FROM users WHERE username = 'mama'")?.id;
    if (!mama) {
      mama = insertUser(db, { username: 'mama', password: 'demo1234', role: 'parent', displayName: '小雨妈妈', nickname: '小雨妈妈' });
      usersCreated += 1;
    }

    for (const childId of [xiaoyu, lele]) {
      run(
        db,
        'INSERT OR IGNORE INTO family_links (id, parent_id, child_id, status, created_at) VALUES (?,?,?,?,?)',
        id('f_'),
        mama,
        childId,
        'active',
        now(),
      );
    }

    const points = buildKnowledgePoints();
    seedKnowledge(db, points);
    questions = seedQuestionBank(db, points, adminId);

    if (!get<any>(db, "SELECT id FROM quiz_sessions WHERE id = 'demo-session-1'")) {
      seedDemoProgress(db, xiaoyu, lele);
    }
    ensureCharacters(db, xiaoyu);
    ensureCharacters(db, lele);
    run(db, "UPDATE character_saves SET xp = 520 WHERE user_id = ? AND character_id = 'frost' AND xp = 0", xiaoyu);
    run(db, "UPDATE character_saves SET xp = 100 WHERE user_id = ? AND character_id = 'volt' AND xp = 0", xiaoyu);

    const configs = [
      ['announcement', { zh: '欢迎来到数境勇者！答对题目就能施法，连续答对伤害更高。', en: 'Welcome to Math Realms! Answer correctly to cast spells — streaks deal more damage.' }],
      ['feature_flags', { aiDrafts: true, csvImport: true, parentReports: true, countdownTimer: false }],
      ['game_config', { questionCount: 8, stageHp: [130, 150, 170], hintsPerQuestion: 2, xpPerCorrect: 12, coinsPerCorrect: 6 }],
      ['login_hint', { student: 'xiaoyu / demo1234', parent: 'mama / demo1234', admin: 'admin / admin1234' }],
    ];
    for (const [key, value] of configs) {
      run(
        db,
        `INSERT INTO configs (key, value_json, updated_by, updated_at) VALUES (?,?,?,?)
         ON CONFLICT(key) DO NOTHING`,
        key,
        JSON.stringify(value),
        adminId,
        now(),
      );
    }
  });

  return { seeded: seeded || usersCreated > 0 || questions > 0, usersCreated, questions, knowledgePoints: buildKnowledgePoints().length };
}
