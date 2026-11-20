/*
 * Persistent player progress. Results are keyed by grade + domain + stage and
 * only ever move upward (a replay cannot take stars away). Settings, XP, coins
 * and results share one versioned localStorage record.
 */
import { DOMAINS, GRADES, STAGES } from '../content/config.js';

export const STORAGE_KEY = 'mathrealms.v1';
export const LEVEL_XP = 120;
export const MAX_STARS_PER_GRADE = DOMAINS.length * STAGES.length * 3;

const DOMAIN_IDS = new Set(DOMAINS.map((domain) => domain.id));
const GRADE_IDS = new Set(GRADES);

export function defaultState() {
  return {
    version: 1,
    settings: { lang: 'zh', sound: true, grade: 1 },
    player: { xp: 0, coins: 0 },
    results: {},
  };
}

function finiteInt(value, min, max, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(number)));
}

function normalizeResult(raw) {
  if (!raw || typeof raw !== 'object') return null;
  return {
    stars: finiteInt(raw.stars, 0, 3, 0),
    bestCorrect: finiteInt(raw.bestCorrect ?? raw.correct, 0, 999, 0),
    bestAsked: finiteInt(raw.bestAsked ?? raw.asked, 0, 999, 0),
    plays: finiteInt(raw.plays, 0, 9999, 0),
  };
}

export function normalizeState(raw) {
  const state = defaultState();
  if (!raw || typeof raw !== 'object') return state;

  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
  state.settings.lang = settings.lang === 'en' ? 'en' : 'zh';
  state.settings.sound = settings.sound !== false;
  state.settings.grade = GRADE_IDS.has(Number(settings.grade)) ? Number(settings.grade) : 1;

  const player = raw.player && typeof raw.player === 'object' ? raw.player : {};
  state.player.xp = finiteInt(player.xp, 0, 1e9, 0);
  state.player.coins = finiteInt(player.coins, 0, 1e9, 0);

  const results = raw.results && typeof raw.results === 'object' ? raw.results : {};
  for (const [key, value] of Object.entries(results)) {
    const parts = key.split('.');
    if (parts.length !== 3) continue;
    const grade = Number(parts[0]);
    const domain = parts[1];
    const stage = Number(parts[2]);
    if (!GRADE_IDS.has(grade) || !DOMAIN_IDS.has(domain) || !STAGES.some((entry) => entry.id === stage)) {
      continue;
    }
    const normalized = normalizeResult(value);
    if (normalized) state.results[key] = normalized;
  }

  return state;
}

export function loadState(storage = globalThis.localStorage) {
  try {
    const raw = storage?.getItem(STORAGE_KEY);
    if (!raw) return defaultState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

export function saveState(state, storage = globalThis.localStorage) {
  try {
    if (!storage) return false;
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function stageKey(grade, domain, stage) {
  return `${grade}.${domain}.${stage}`;
}

export function getStageResult(state, grade, domain, stage) {
  return state?.results?.[stageKey(grade, domain, stage)] || null;
}

/** Merge a finished battle into the record. Returns what changed. */
export function recordResult(state, { grade, domain, stage, stars, correct, asked }) {
  const key = stageKey(grade, domain, stage);
  const previous = state.results[key] || null;
  const previousStars = previous?.stars || 0;
  const earnedStars = Math.min(3, Math.max(0, Math.floor(stars)));

  state.results[key] = {
    stars: Math.max(previousStars, earnedStars),
    bestCorrect: Math.max(previous?.bestCorrect || 0, Math.max(0, Math.floor(correct))),
    bestAsked: Math.max(previous?.bestAsked || 0, Math.max(0, Math.floor(asked))),
    plays: (previous?.plays || 0) + 1,
  };

  return {
    key,
    previousStars,
    earnedStars,
    bestStars: state.results[key].stars,
    improved: state.results[key].stars > previousStars,
  };
}

export function grantRewards(state, { xp = 0, coins = 0 }) {
  const levelBefore = heroLevel(state.player.xp);
  state.player.xp += Math.max(0, Math.floor(xp));
  state.player.coins += Math.max(0, Math.floor(coins));
  const levelAfter = heroLevel(state.player.xp);
  return { levelBefore, levelAfter, leveledUp: levelAfter > levelBefore };
}

export function isStageUnlocked(state, grade, domain, stage) {
  if (stage <= 1) return true;
  const previous = getStageResult(state, grade, domain, stage - 1);
  return Boolean(previous && previous.stars >= 1);
}

export function gradeStars(state, grade) {
  let total = 0;
  for (const domain of DOMAINS) {
    for (const stage of STAGES) {
      total += getStageResult(state, grade, domain.id, stage.id)?.stars || 0;
    }
  }
  return total;
}

export function totalStars(state) {
  return GRADES.reduce((sum, grade) => sum + gradeStars(state, grade), 0);
}

export function heroLevel(xp) {
  return 1 + Math.floor(Math.max(0, xp) / LEVEL_XP);
}

export function levelProgress(xp) {
  const safe = Math.max(0, xp);
  const level = heroLevel(safe);
  const current = safe % LEVEL_XP;
  return { level, current, needed: LEVEL_XP, percent: Math.round((current / LEVEL_XP) * 100) };
}

export function resetProgress(state) {
  state.player = { xp: 0, coins: 0 };
  state.results = {};
  return state;
}
