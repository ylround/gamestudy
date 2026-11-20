import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DOMAINS,
  GRADES,
  MAX_STARS,
  MAX_STARS_PER_GRADE,
  STAGES,
  SUBJECTS,
  getDomain,
  getStage,
  skillKey,
} from '../src/content/config.js';
import zh from '../src/i18n/zh.js';
import en from '../src/i18n/en.js';

test('config has six grades, four domains and three stages', () => {
  assert.deepEqual(GRADES, [1, 2, 3, 4, 5, 6]);
  assert.equal(DOMAINS.length, 4);
  assert.equal(STAGES.length, 3);
  assert.equal(MAX_STARS_PER_GRADE, 36);
  assert.equal(MAX_STARS, 216);
  assert.equal(new Set(DOMAINS.map((domain) => domain.id)).size, DOMAINS.length);
});

test('every curriculum label exists in both languages', () => {
  for (const [lang, dict] of [
    ['zh', zh],
    ['en', en],
  ]) {
    for (const grade of GRADES) {
      for (const domain of DOMAINS) {
        const key = skillKey(grade, domain.id);
        assert.ok(dict[key], `${lang}: missing ${key}`);
      }
    }
    for (const domain of DOMAINS) {
      for (const key of [domain.nameKey, domain.descKey, domain.spellKey]) {
        assert.ok(dict[key], `${lang}: missing ${key}`);
      }
    }
    for (const stage of STAGES) {
      for (const key of [stage.nameKey, stage.shortKey, stage.monsterKey]) {
        assert.ok(dict[key], `${lang}: missing ${key}`);
      }
    }
    for (const subject of SUBJECTS) {
      assert.ok(dict[subject.nameKey], `${lang}: missing ${subject.nameKey}`);
      if (subject.descKey) assert.ok(dict[subject.descKey], `${lang}: missing ${subject.descKey}`);
    }
  }
});

test('lookup helpers fall back safely', () => {
  assert.equal(getDomain('numbers').id, 'numbers');
  assert.equal(getDomain('nope'), null);
  assert.equal(getStage(2).id, 2);
  assert.equal(getStage('3').id, 3);
  assert.equal(getStage(9), null);
});

test('only math is available in the first release', () => {
  const available = SUBJECTS.filter((subject) => subject.available);
  assert.deepEqual(available.map((subject) => subject.id), ['math']);
});
