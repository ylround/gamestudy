import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LEVEL_XP,
  STORAGE_KEY,
  defaultState,
  getStageResult,
  gradeStars,
  grantRewards,
  heroLevel,
  isStageUnlocked,
  levelProgress,
  loadState,
  normalizeState,
  recordResult,
  resetProgress,
  saveState,
  stageKey,
  totalStars,
} from '../src/engine/progress.js';

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
    removeItem: (key) => data.delete(key),
  };
}

test('a fresh state starts at grade 1 with Chinese and no results', () => {
  const state = defaultState();
  assert.equal(state.settings.lang, 'zh');
  assert.equal(state.settings.grade, 1);
  assert.deepEqual(state.player, { xp: 0, coins: 0 });
  assert.deepEqual(state.results, {});
});

test('results keep the best stars but count every play', () => {
  const state = defaultState();
  const first = recordResult(state, { grade: 3, domain: 'numbers', stage: 1, stars: 2, correct: 4, asked: 6 });
  assert.equal(first.bestStars, 2);
  assert.equal(first.improved, true);

  recordResult(state, { grade: 3, domain: 'numbers', stage: 1, stars: 1, correct: 2, asked: 6 });
  const result = getStageResult(state, 3, 'numbers', 1);
  assert.equal(result.stars, 2, 'a worse replay does not remove stars');
  assert.equal(result.plays, 2);
  assert.equal(result.bestCorrect, 4);

  recordResult(state, { grade: 3, domain: 'numbers', stage: 1, stars: 3, correct: 5, asked: 5 });
  assert.equal(getStageResult(state, 3, 'numbers', 1).stars, 3);
  assert.equal(getStageResult(state, 3, 'numbers', 1).bestCorrect, 5);
});

test('stages unlock one after another per grade and domain', () => {
  const state = defaultState();
  assert.equal(isStageUnlocked(state, 1, 'numbers', 1), true);
  assert.equal(isStageUnlocked(state, 1, 'numbers', 2), false);
  recordResult(state, { grade: 1, domain: 'numbers', stage: 1, stars: 1, correct: 1, asked: 5 });
  assert.equal(isStageUnlocked(state, 1, 'numbers', 2), true);
  assert.equal(isStageUnlocked(state, 1, 'numbers', 3), false);
  assert.equal(isStageUnlocked(state, 1, 'fractions', 2), false, 'domains are independent');
});

test('grade and total star counters sum the best results', () => {
  const state = defaultState();
  recordResult(state, { grade: 1, domain: 'numbers', stage: 1, stars: 3, correct: 4, asked: 4 });
  recordResult(state, { grade: 1, domain: 'fractions', stage: 1, stars: 2, correct: 4, asked: 5 });
  recordResult(state, { grade: 2, domain: 'geometry', stage: 1, stars: 1, correct: 3, asked: 5 });
  assert.equal(gradeStars(state, 1), 5);
  assert.equal(gradeStars(state, 2), 1);
  assert.equal(totalStars(state), 6);
});

test('XP grants levels and coins as expected', () => {
  const state = defaultState();
  assert.equal(heroLevel(0), 1);
  assert.equal(heroLevel(LEVEL_XP - 1), 1);
  assert.equal(heroLevel(LEVEL_XP), 2);

  const before = grantRewards(state, { xp: LEVEL_XP + 5, coins: 12 });
  assert.equal(before.levelBefore, 1);
  assert.equal(before.levelAfter, 2);
  assert.equal(before.leveledUp, true);
  assert.equal(state.player.xp, LEVEL_XP + 5);
  assert.equal(state.player.coins, 12);
  assert.deepEqual(levelProgress(LEVEL_XP + 5), {
    level: 2,
    current: 5,
    needed: LEVEL_XP,
    percent: 4,
  });
});

test('state is persisted and loaded through storage', () => {
  const storage = memoryStorage();
  const state = defaultState();
  state.settings.lang = 'en';
  state.settings.grade = 5;
  recordResult(state, { grade: 5, domain: 'data', stage: 2, stars: 3, correct: 6, asked: 6 });
  assert.equal(saveState(state, storage), true);

  const loaded = loadState(storage);
  assert.equal(loaded.settings.lang, 'en');
  assert.equal(loaded.settings.grade, 5);
  assert.equal(getStageResult(loaded, 5, 'data', 2).stars, 3);
});

test('corrupted or hostile stored data is normalised', () => {
  const storage = memoryStorage({ [STORAGE_KEY]: '{not json' });
  assert.deepEqual(loadState(storage), defaultState());

  const hostile = normalizeState({
    settings: { lang: 'xx', grade: 99, sound: 'no' },
    player: { xp: -50, coins: 'lots' },
    results: {
      '1.numbers.1': { stars: 99, bestCorrect: -2, plays: 3 },
      '9.hack.1': { stars: 3 },
      'bad-key': { stars: 3 },
    },
  });
  assert.equal(hostile.settings.lang, 'zh');
  assert.equal(hostile.settings.grade, 1);
  assert.equal(hostile.settings.sound, true);
  assert.equal(hostile.player.xp, 0);
  assert.equal(hostile.player.coins, 0);
  assert.equal(hostile.results['1.numbers.1'].stars, 3);
  assert.equal(hostile.results['1.numbers.1'].bestCorrect, 0);
  assert.equal('9.hack.1' in hostile.results, false);
  assert.equal('bad-key' in hostile.results, false);
});

test('unavailable storage degrades gracefully', () => {
  const broken = {
    getItem() {
      throw new Error('blocked');
    },
    setItem() {
      throw new Error('blocked');
    },
  };
  assert.deepEqual(loadState(broken), defaultState());
  assert.equal(saveState(defaultState(), broken), false);
});

test('reset clears progress but keeps settings', () => {
  const state = defaultState();
  state.settings.lang = 'en';
  state.settings.grade = 4;
  grantRewards(state, { xp: 500, coins: 30 });
  recordResult(state, { grade: 4, domain: 'numbers', stage: 1, stars: 2, correct: 3, asked: 4 });
  resetProgress(state);
  assert.deepEqual(state.player, { xp: 0, coins: 0 });
  assert.deepEqual(state.results, {});
  assert.equal(state.settings.lang, 'en');
  assert.equal(state.settings.grade, 4);
});

test('stage keys are stable', () => {
  assert.equal(stageKey(2, 'fractions', 3), '2.fractions.3');
});
