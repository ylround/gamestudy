import type { DatabaseSync } from 'node:sqlite';
import { all, get, json, now, parseJson, run } from '../lib/db.ts';
import { HttpError, optionalString, requireInt } from '../lib/http.ts';
import { levelForXp } from '../lib/types.ts';
import {
  activeSessionFor,
  DEFAULT_SETTINGS,
  ensureBalances,
  ensureGameSave,
  familyBundle,
  getProfile,
  publicProfile,
  publicUser,
  readConfig,
  stageStates,
} from './common.ts';

export function curriculumTree(db: DatabaseSync, grade: number) {
  const points = all<any>(
    db,
    `SELECT code, grade, term, textbook, domain, unit_code, unit_name_zh, unit_name_en,
            name_zh, name_en, parent_code, prerequisite_codes, difficulty, status, sort
     FROM knowledge_points WHERE grade = ? AND status = 'active' ORDER BY sort`,
    grade,
  );
  const units = new Map<string, any>();
  for (const point of points) {
    if (!units.has(point.unit_code)) {
      units.set(point.unit_code, {
        code: point.unit_code,
        domain: point.domain,
        name: { zh: point.unit_name_zh, en: point.unit_name_en },
        knowledgePoints: [],
      });
    }
    units.get(point.unit_code).knowledgePoints.push({
      code: point.code,
      name: { zh: point.name_zh, en: point.name_en },
      domain: point.domain,
      grade: point.grade,
      term: point.term,
      textbook: point.textbook,
      parentCode: point.parent_code,
      prerequisites: parseJson<string[]>(point.prerequisite_codes, []),
      difficulty: point.difficulty,
      status: point.status,
    });
  }
  return {
    subject: { code: 'MATH', name: { zh: '数学', en: 'Mathematics' } },
    grades: [1, 2, 3, 4, 5, 6],
    grade,
    units: [...units.values()],
  };
}

export function saveState(db: DatabaseSync, userId: string) {
  const row = get<any>(db, 'SELECT * FROM users WHERE id = ?', userId);
  if (!row) throw new HttpError(401, 'UNAUTHORIZED', 'Please sign in first');
  const profile = getProfile(db, userId);
  const save = ensureGameSave(db, userId);
  const balances = ensureBalances(db, userId);
  const progress = levelForXp(Number(save.xp) || 0);
  const grade = Number(profile?.grade) || 4;
  return {
    user: publicUser(db, row),
    profile: publicProfile(profile),
    family: familyBundle(db, row),
    save: {
      xp: Number(save.xp) || 0,
      level: progress.level,
      levelProgress: progress,
      coins: balances.coins,
      stars: balances.stars,
      settings: { ...DEFAULT_SETTINGS, ...parseJson(save.settings_json, {}) },
      updatedAt: save.updated_at,
    },
    map: row.role === 'student' ? stageStates(db, userId, grade) : null,
    activeSession: row.role === 'student' ? activeSessionFor(db, userId) : null,
    announcement: readConfig<any>(db, 'announcement', { zh: '', en: '' }),
  };
}

export function updateSettings(db: DatabaseSync, userId: string, body: any) {
  const save = ensureGameSave(db, userId);
  const current = { ...DEFAULT_SETTINGS, ...parseJson(save.settings_json, {}) };
  const next: any = { ...current };
  if (body.lang === 'zh' || body.lang === 'en') next.lang = body.lang;
  for (const key of ['sound', 'reducedMotion', 'highContrast', 'countdown']) {
    if (typeof body[key] === 'boolean') next[key] = body[key];
  }
  if (body.fontScale !== undefined) {
    const scale = Number(body.fontScale);
    if (![1, 1.15, 1.3].includes(scale)) throw new HttpError(400, 'VALIDATION_ERROR', 'fontScale must be 1, 1.15 or 1.3');
    next.fontScale = scale;
  }
  run(db, 'UPDATE game_saves SET settings_json = ?, updated_at = ? WHERE user_id = ?', json(next), now(), userId);
  return { settings: next };
}

export function updateGrade(db: DatabaseSync, userId: string, body: any) {
  const grade = requireInt(body.grade, 'grade', { min: 1, max: 6 });
  const profile = getProfile(db, userId);
  if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
  run(db, 'UPDATE profiles SET grade = ? WHERE user_id = ?', grade, userId);
  return { grade };
}

export function inventory(db: DatabaseSync, userId: string) {
  const balances = ensureBalances(db, userId);
  const stats = get<any>(
    db,
    `SELECT COUNT(*) AS answers, COALESCE(SUM(sq.correct),0) AS correct, COALESCE(SUM(sq.time_ms),0) AS time_ms
     FROM session_questions sq JOIN quiz_sessions qs ON qs.id = sq.session_id
     WHERE qs.student_id = ? AND sq.answered = 1`,
    userId,
  ) || { answers: 0, correct: 0, time_ms: 0 };
  const stage = get<any>(db, 'SELECT COUNT(*) AS cleared, COALESCE(SUM(best_stars),0) AS stars FROM stage_results WHERE student_id = ? AND best_stars > 0', userId);
  const sessions = get<any>(db, "SELECT COUNT(*) AS total FROM quiz_sessions WHERE student_id = ? AND status = 'FINISHED'", userId);
  const achievements = [
    { id: 'first-battle', name: { zh: '初次施法', en: 'First Spell' }, unlocked: Number(stats.answers) > 0 },
    { id: 'ten-answers', name: { zh: '小小练习家', en: 'Getting Started' }, unlocked: Number(stats.answers) >= 10 },
    { id: 'hundred-answers', name: { zh: '百题勇者', en: 'Century Hero' }, unlocked: Number(stats.answers) >= 100 },
    { id: 'three-stars', name: { zh: '完美通关', en: 'Perfect Clear' }, unlocked: Number(stage?.stars || 0) >= 9 },
    { id: 'ten-battles', name: { zh: '身经百战', en: 'Battle Tested' }, unlocked: Number(sessions?.total || 0) >= 10 },
    { id: 'seven-day-streak', name: { zh: '七日坚持', en: 'Seven-Day Streak' }, unlocked: false },
  ];
  const mastery = all<any>(
    db,
    `SELECT m.score, m.attempts, m.correct, m.last_practiced_at, k.name_zh, k.name_en, k.domain
     FROM mastery_records m LEFT JOIN knowledge_points k ON k.code = m.knowledge_code
     WHERE m.student_id = ? ORDER BY m.score ASC`,
    userId,
  ).map((row) => ({
    name: { zh: row.name_zh || '', en: row.name_en || '' },
    domain: row.domain,
    score: Math.round(Number(row.score) || 0),
    attempts: Number(row.attempts) || 0,
    correct: Number(row.correct) || 0,
    lastPracticedAt: row.last_practiced_at,
  }));
  return {
    coins: balances.coins,
    stars: balances.stars,
    mastery,
    answers: Number(stats.answers) || 0,
    correct: Number(stats.correct) || 0,
    studyMs: Number(stats.time_ms) || 0,
    clearedStages: Number(stage?.cleared) || 0,
    achievements,
    items: [
      { id: 'potion-focus', name: { zh: '专注药水', en: 'Focus Potion' }, count: 1, icon: 'potion' },
    ],
  };
}

export function announcement(db: DatabaseSync) {
  return readConfig<any>(db, 'announcement', { zh: '', en: '' });
}
