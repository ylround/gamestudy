import test from 'node:test';
import assert from 'node:assert/strict';

import { DOMAINS, GRADES, STAGES } from '../src/content/config.js';
import { createQuestionFactory, generateQuestion } from '../src/content/questions.js';
import { createRng } from '../src/engine/rng.js';
import { hasKey, localize } from '../src/i18n/index.js';

function textOf(value, lang) {
  return localize(value, lang);
}

function assertTranslationKeys(value, context) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertTranslationKeys(item, `${context}[${index}]`));
    return;
  }
  if (!value || typeof value !== 'object' || !value.key) return;
  for (const lang of ['zh', 'en']) {
    assert.ok(hasKey(value.key, lang), `${context}: missing ${lang} translation for ${value.key}`);
  }
  for (const [name, param] of Object.entries(value.params || {})) {
    assertTranslationKeys(param, `${context}.${name}`);
  }
}

function assertCleanText(text, context, lang) {
  assert.ok(!text.includes('undefined'), `${context} contains undefined: ${text}`);
  assert.ok(!text.includes('NaN'), `${context} contains NaN: ${text}`);
  assert.ok(!text.includes('Infinity'), `${context} contains Infinity: ${text}`);
  assert.ok(!/[{}]/.test(text), `${context} has an unresolved placeholder: ${text}`);
  if (lang === 'en') {
    assert.ok(!/[\u4e00-\u9fff]/.test(text), `${context} leaks Chinese into English: ${text}`);
  }
}

test('every grade, domain and stage generates valid questions in both languages', () => {
  for (const grade of GRADES) {
    for (const domain of DOMAINS) {
      for (const stage of STAGES) {
        for (let seed = 0; seed < 120; seed += 1) {
          const question = generateQuestion(grade, domain.id, stage.id, createRng(seed * 7919 + grade));
          const context = `g${grade}.${domain.id}.s${stage.id}.seed${seed}`;

          assert.ok(question.prompt != null, `${context}: missing prompt`);
          assert.ok(Array.isArray(question.choices), `${context}: choices must be an array`);
          assert.ok(
            question.choices.length >= 2 && question.choices.length <= 4,
            `${context}: expected 2-4 choices, got ${question.choices.length}`,
          );
          assert.ok(
            Number.isInteger(question.answerIndex) &&
              question.answerIndex >= 0 &&
              question.answerIndex < question.choices.length,
            `${context}: invalid answerIndex`,
          );

          const serialized = question.choices.map((choice) => JSON.stringify(choice));
          assert.equal(new Set(serialized).size, serialized.length, `${context}: duplicate choices`);

          assertTranslationKeys(question.prompt, `${context}.prompt`);
          question.choices.forEach((choice, index) => assertTranslationKeys(choice, `${context}.choice${index}`));
          assertTranslationKeys(question.explanation, `${context}.explanation`);

          for (const lang of ['zh', 'en']) {
            assertCleanText(textOf(question.prompt, lang), `${context}.prompt.${lang}`, lang);
            for (const [index, choice] of question.choices.entries()) {
              assertCleanText(textOf(choice, lang), `${context}.choice${index}.${lang}`, lang);
            }
            if (question.explanation != null) {
              assertCleanText(textOf(question.explanation, lang), `${context}.explanation.${lang}`, lang);
            }
          }

          if (typeof question.choices[question.answerIndex] === 'object') {
            const key = question.choices[question.answerIndex].key;
            assert.ok(!textOf(question.choices[question.answerIndex], 'zh').startsWith('q.'), `${context}: missing prompt key ${key}`);
          }
        }
      }
    }
  }
});

test('question factories avoid repeating recent prompts', () => {
  for (const grade of GRADES) {
    for (const domain of DOMAINS) {
      const next = createQuestionFactory(grade, domain.id, 2, grade * 1009 + 17);
      const seen = new Set();
      for (let i = 0; i < 4; i += 1) {
        const question = next();
        const signature = JSON.stringify(question.prompt);
        assert.ok(!seen.has(signature), `g${grade}.${domain.id} repeated ${signature}`);
        seen.add(signature);
      }
    }
  }
});

test('numeric answers are always among the choices', () => {
  for (const grade of GRADES) {
    for (const domain of DOMAINS) {
      for (let seed = 0; seed < 40; seed += 1) {
        const question = generateQuestion(grade, domain.id, 3, createRng(seed + 5000));
        const answer = question.choices[question.answerIndex];
        assert.ok(answer != null, `g${grade}.${domain.id}: no answer`);
      }
    }
  }
});
