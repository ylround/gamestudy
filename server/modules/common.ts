import type { DatabaseSync } from 'node:sqlite';
import { all, get, json, now, parseJson, run } from '../lib/db.ts';
import { DOMAIN_META, MONSTERS, levelForXp, stageKey } from '../lib/types.ts';
import { selectedCharacter } from './characters.ts';

export interface ProfileRow {
  user_id: string;
  nickname: string;
  grade: number;
  textbook: string;
  avatar: string;
  invite_code: string | null;
  consent_at: string | null;
  controls_json: string | null;
  created_at: string;
}

export const DEFAULT_SETTINGS = {
  lang: 'zh',
  sound: true,
  reducedMotion: false,
  highContrast: false,
  fontScale: 1,
  countdown: false,
};

export function getProfile(db: DatabaseSync, userId: string): ProfileRow | undefined {
  return get<ProfileRow>(db, 'SELECT * FROM profiles WHERE user_id = ?', userId);
}

export function publicProfile(profile: ProfileRow | undefined) {
  if (!profile) return null;
  return {
    nickname: profile.nickname,
    grade: profile.grade,
    textbook: profile.textbook,
    avatar: profile.avatar,
    inviteCode: profile.invite_code,
    consentAt: profile.consent_at,
    controls: parseJson(profile.controls_json, {}),
  };
}

export function ensureGameSave(db: DatabaseSync, userId: string) {
  let save = get<any>(db, 'SELECT * FROM game_saves WHERE user_id = ?', userId);
  if (!save) {
    run(
      db,
      'INSERT INTO game_saves (user_id, xp, level, settings_json, map_json, updated_at) VALUES (?,?,?,?,?,?)',
      userId,
      0,
      1,
      json(DEFAULT_SETTINGS),
      json({}),
      now(),
    );
    save = get<any>(db, 'SELECT * FROM game_saves WHERE user_id = ?', userId);
  }
  return save;
}

export function ensureBalances(db: DatabaseSync, userId: string) {
  let row = get<any>(db, 'SELECT coins, stars FROM currency_accounts WHERE user_id = ?', userId);
  if (!row) {
    run(db, 'INSERT INTO currency_accounts (user_id, coins, stars) VALUES (?,?,?)', userId, 0, 0);
    row = { coins: 0, stars: 0 };
  }
  return row as { coins: number; stars: number };
}

export function publicUser(db: DatabaseSync, row: any) {
  const profile = getProfile(db, row.id);
  const balances = ensureBalances(db, row.id);
  const save = ensureGameSave(db, row.id);
  const character = selectedCharacter(db, row.id);
  const xp = character ? Number(character.row.xp) || 0 : Number(save.xp) || 0;
  const progress = levelForXp(xp);
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    displayName: row.display_name,
    profile: publicProfile(profile),
    balances,
    character: character ? character.summary : null,
    save: {
      xp,
      level: progress.level,
      levelProgress: progress,
      settings: { ...DEFAULT_SETTINGS, ...parseJson(save.settings_json, {}) },
    },
  };
}

export function activeSessionFor(db: DatabaseSync, studentId: string) {
  const row = get<any>(
    db,
    `SELECT id, kind, stage_key, knowledge_code, question_count, status, started_at, updated_at, state_json
     FROM quiz_sessions WHERE student_id = ? AND status = 'ACTIVE' ORDER BY updated_at DESC LIMIT 1`,
    studentId,
  );
  if (!row) return null;
  const state = parseJson<any>(row.state_json, {});
  return {
    id: row.id,
    kind: row.kind,
    stageKey: row.stage_key,
    knowledgeCode: row.knowledge_code,
    questionCount: row.question_count,
    status: row.status,
    startedAt: row.started_at,
    updatedAt: row.updated_at,
    index: Number(state.index) || 0,
    correct: Number(state.correct) || 0,
    asked: Number(state.asked) || 0,
    pending: Boolean(state.pending),
  };
}

export function stageStates(db: DatabaseSync, studentId: string, grade: number) {
  const points = all<any>(
    db,
    `SELECT code, domain, difficulty, name_zh, name_en, unit_name_zh, unit_name_en
     FROM knowledge_points WHERE grade = ? AND status = 'active' ORDER BY sort`,
    grade,
  );
  const results = new Map<string, any>();
  for (const row of all<any>(db, 'SELECT * FROM stage_results WHERE student_id = ?', studentId)) {
    results.set(row.stage_key, row);
  }
  const domains = new Map<string, any>();
  for (const [index, domain] of Object.entries(DOMAIN_META)) {
    domains.set(index, {
      id: index,
      nameZh: domain.unitZh,
      nameEn: domain.unitEn,
      accent: domain.accent,
      unitCode: `G${grade}-${domain.abbr}`,
      stages: [],
    });
  }
  let totalStars = 0;
  for (const point of points) {
    const stage = Number(point.code.slice(-1)) || 1;
    const key = stageKey(grade, point.domain, stage);
    const result = results.get(key);
    const previousPoints = points.filter(
      (item) => item.domain === point.domain && Number(item.code.slice(-1)) < stage,
    );
    const previousCleared = previousPoints.every((item) => {
      const previousKey = stageKey(grade, item.domain, Number(item.code.slice(-1)));
      return Number(results.get(previousKey)?.best_stars || 0) >= 1;
    });
    const stars = Number(result?.stars || 0);
    const bestStars = Number(result?.best_stars || 0);
    totalStars += bestStars;
    const stageNumber = stage;
    const monster = MONSTERS[Math.min(stageNumber - 1, MONSTERS.length - 1)];
    const domain = domains.get(point.domain);
    if (domain) {
      domain.stages.push({
        key,
        stage: stageNumber,
        knowledgeCode: point.code,
        name: { zh: point.name_zh, en: point.name_en },
        unitName: { zh: point.unit_name_zh, en: point.unit_name_en },
        monster: { id: monster.id, name: { zh: monster.zh, en: monster.en }, hp: monster.hp },
        difficulty: point.difficulty,
        unlocked: stageNumber === 1 || previousCleared,
        stars,
        bestStars,
        correct: Number(result?.correct || 0),
        asked: Number(result?.asked || 0),
        completed: bestStars > 0,
      });
    }
  }
  return {
    grade,
    domains: [...domains.values()],
    stars: { earned: totalStars, total: points.length * 3 },
  };
}

export function readConfig<T>(db: DatabaseSync, key: string, fallback: T): T {
  const row = get<any>(db, 'SELECT value_json FROM configs WHERE key = ?', key);
  return row ? parseJson<T>(row.value_json, fallback) : fallback;
}

export function writeConfig(db: DatabaseSync, key: string, value: unknown, actorId: string) {
  run(
    db,
    `INSERT INTO configs (key, value_json, updated_by, updated_at) VALUES (?,?,?,?)
     ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    key,
    json(value),
    actorId,
    now(),
  );
}

export function todayKey(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function dayKeyOffset(daysAgo: number): string {
  return todayKey(new Date(Date.now() - daysAgo * 86_400_000));
}

export function childSummary(db: DatabaseSync, childId: string) {
  const child = get<any>(db, 'SELECT id, username, display_name, status, created_at FROM users WHERE id = ?', childId);
  if (!child) return null;
  const profile = getProfile(db, child.id);
  const save = ensureGameSave(db, child.id);
  const balances = ensureBalances(db, child.id);
  const stats = get<any>(
    db,
    `SELECT COUNT(*) AS answers, COALESCE(SUM(correct),0) AS correct, COALESCE(SUM(time_ms),0) AS time_ms
     FROM session_questions sq JOIN quiz_sessions qs ON qs.id = sq.session_id
     WHERE qs.student_id = ? AND sq.answered = 1`,
    child.id,
  ) || { answers: 0, correct: 0, time_ms: 0 };
  const progress = levelForXp(Number(save.xp) || 0);
  return {
    id: child.id,
    username: child.username,
    displayName: child.display_name,
    nickname: profile?.nickname || child.display_name,
    grade: profile?.grade || 4,
    avatar: profile?.avatar || 'wizard',
    inviteCode: profile?.invite_code || null,
    level: progress.level,
    xp: Number(save.xp) || 0,
    coins: balances.coins,
    stars: balances.stars,
    answers: Number(stats.answers) || 0,
    correct: Number(stats.correct) || 0,
    accuracy: stats.answers ? Math.round((stats.correct / stats.answers) * 100) : 0,
    studyMs: Number(stats.time_ms) || 0,
  };
}

export function familyBundle(db: DatabaseSync, user: { id: string; role: string }) {
  if (user.role === 'parent') {
    const children = all<any>(
      db,
      `SELECT child_id FROM family_links WHERE parent_id = ? AND status = 'active' ORDER BY created_at`,
      user.id,
    ).map((row) => childSummary(db, row.child_id)).filter(Boolean);
    return { role: 'parent', children };
  }
  if (user.role === 'student') {
    const parents = all<any>(
      db,
      `SELECT u.id, u.username, u.display_name FROM family_links f JOIN users u ON u.id = f.parent_id
       WHERE f.child_id = ? AND f.status = 'active'`,
      user.id,
    );
    return {
      role: 'student',
      parents: parents.map((parent) => ({ id: parent.id, displayName: parent.display_name })),
      linked: parents.length > 0,
    };
  }
  return { role: 'admin', children: [] };
}
