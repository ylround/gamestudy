import test from 'node:test';
import assert from 'node:assert/strict';

import zh from '../src/i18n/zh.js';
import en from '../src/i18n/en.js';
import { DICTS, localize, t } from '../src/i18n/index.js';

test('Chinese and English dictionaries expose the same keys', () => {
  const zhKeys = Object.keys(zh).sort();
  const enKeys = Object.keys(en).sort();
  assert.deepEqual(zhKeys, enKeys);
});

test('every translation is a non-empty string', () => {
  for (const [lang, dict] of Object.entries(DICTS)) {
    for (const [key, value] of Object.entries(dict)) {
      assert.equal(typeof value, 'string', `${lang}.${key} should be a string`);
      assert.ok(value.trim().length > 0, `${lang}.${key} should not be empty`);
    }
  }
});

test('interpolation and nested params work in both languages', () => {
  assert.equal(t('battle.turn', { n: 3 }, 'zh'), '第 3 题');
  assert.equal(t('battle.turn', { n: 3 }, 'en'), 'Question 3');
  assert.equal(
    t('q.sides_of', { shape: { key: 'shape.triangle' } }, 'zh'),
    '一个三角形有几条边？',
  );
  assert.equal(
    t('q.sides_of', { shape: { key: 'shape.triangle' } }, 'en'),
    'How many sides does a triangle have?',
  );
});

test('arrays are joined with language-specific separators', () => {
  assert.equal(localize([4, 8, 6], 'zh'), '4、8 和 6');
  assert.equal(localize([4, 8, 6], 'en'), '4, 8 and 6');
  assert.equal(localize([4, 8], 'en'), '4 and 8');
});

test('unknown keys fall back to the key instead of throwing', () => {
  assert.equal(t('missing.key', {}, 'zh'), 'missing.key');
});
