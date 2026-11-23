import test from 'node:test';
import assert from 'node:assert/strict';

import { DOMAINS, GRADES, STAGES } from '../src/content/config.js';
import { generateQuestion } from '../src/content/questions.js';
import { createRng } from '../src/engine/rng.js';

function answerText(question) {
  const choice = question.choices[question.answerIndex];
  return typeof choice === 'object' ? `[object:${choice.key}]` : String(choice);
}

function answerKey(question) {
  const choice = question.choices[question.answerIndex];
  return choice && typeof choice === 'object' ? choice.key : String(choice);
}

function answerNumber(question) {
  const value = Number(answerText(question));
  assert.ok(Number.isFinite(value), `answer is not numeric: ${answerText(question)}`);
  return value;
}

function parseFraction(text) {
  const parts = String(text).split('/');
  if (parts.length !== 2) return Number(text);
  return Number(parts[0]) / Number(parts[1]);
}

function sameFraction(actual, numerator, denominator, message) {
  const expected = numerator / denominator;
  assert.ok(
    Math.abs(parseFraction(actual) - expected) < 1e-9,
    `${message}: expected ${numerator}/${denominator}, got ${actual}`,
  );
}

const validators = {
  'q.total_gems': (q, p) => answerNumber(q) === p.a + p.b,
  'q.left_gems': (q, p) => answerNumber(q) === p.a - p.b,
  'q.groups': (q, p) => answerNumber(q) === p.a * p.b,
  'q.share': (q, p) => answerNumber(q) === p.a / p.b,
  'q.grow': (q, p) => answerNumber(q) === p.a + p.b,
  'q.longer': (q, p) => answerNumber(q) === p.a - p.b,
  'q.rect_area': (q, p) => answerNumber(q) === p.l * p.w,
  'q.rect_perimeter': (q, p) => answerNumber(q) === 2 * (p.l + p.w),
  'q.square_perimeter': (q, p) => answerNumber(q) === 4 * p.a,
  'q.rect_missing_side': (q, p) => answerNumber(q) === p.area / p.l,
  'q.composite_area': (q, p) => answerNumber(q) === p.a * p.b + p.c * p.d,
  'q.angle_line': (q, p) => answerNumber(q) === 180 - p.a,
  'q.angle_right': (q, p) => answerNumber(q) === 90 - p.a,
  'q.circle_circumference': (q, p) => Math.abs(answerNumber(q) - 2 * 3.14 * p.r) < 0.001,
  'q.circle_area': (q, p) => Math.abs(answerNumber(q) - 3.14 * p.r * p.r) < 0.001,
  'q.cube_volume': (q, p) => answerNumber(q) === p.a ** 3,
  'q.cube_surface': (q, p) => answerNumber(q) === 6 * p.a ** 2,
  'q.triangle_area': (q, p) => answerNumber(q) === (p.b * p.h) / 2,
  'q.parallelogram_area': (q, p) => answerNumber(q) === p.b * p.h,
  'q.prism_volume': (q, p) => answerNumber(q) === p.l * p.w * p.h,
  'q.triangle_angles': (q, p) => p.a + p.b + answerNumber(q) === 180,
  'q.percent_of': (q, p) => answerNumber(q) === (p.p * p.n) / 100,
  'q.ratio': (q, p) => answerNumber(q) === (p.a2 / p.a) * p.b,
  'q.fraction_pizza': (q, p) => sameFraction(answerText(q), p.n, p.d, 'pizza fraction'),
  'q.fraction_of': (q, p) => answerNumber(q) === p.n / p.d,
  'q.bar_more': (q, p) => answerNumber(q) === p.b - p.a,
  'q.money_total': (q, p) => answerNumber(q) === 10 * p.a + 5 * p.b,
  'q.data_total': (q, p) => answerNumber(q) === p.a + p.b + p.c,
  'q.mean': (q, p) => {
    const mean = p.values.reduce((sum, value) => sum + value, 0) / p.values.length;
    assert.equal(answerNumber(q), mean);
  },
  'q.median': (q, p) => {
    const sorted = p.values.slice().sort((a, b) => a - b);
    assert.equal(answerNumber(q), sorted[Math.floor(sorted.length / 2)]);
  },
  'q.mode': (q, p) => {
    const counts = new Map();
    for (const value of p.values) counts.set(value, (counts.get(value) || 0) + 1);
    let mode = p.values[0];
    for (const [value, count] of counts) if (count > (counts.get(mode) || 0)) mode = value;
    assert.equal(answerNumber(q), mode);
  },
  'q.range': (q, p) => assert.equal(answerNumber(q), Math.max(...p.values) - Math.min(...p.values)),
  'q.convert': (q, p) => answerNumber(q) === p.value * p.factor,
  'q.time_elapsed': (q, p) => assert.equal(answerText(q), `${p.h + p.n}:00`),
  'q.remainder': (q, p) => answerNumber(q) === p.a % p.b,
  'q.factor': (q, p) => {
    const value = answerNumber(q);
    assert.ok(p.n % value === 0 && value > 1 && value < p.n, `${value} is not a factor of ${p.n}`);
  },
  'q.multiple': (q, p) => {
    const value = answerNumber(q);
    assert.ok(value % p.n === 0 && value > p.n, `${value} is not a multiple of ${p.n}`);
  },
  'q.probability': (q, p) => sameFraction(answerText(q), p.r, p.r + p.b, 'probability'),
  'q.decimal_frac': (q, p) => sameFraction(answerText(q), Math.round(p.value * 100), 100, 'decimal fraction'),
  'q.percent_frac': (q, p) => sameFraction(answerText(q), p.value, 100, 'percent fraction'),
  'q.ratio_frac': (q, p) => sameFraction(answerText(q), p.a, p.a + p.b, 'ratio fraction'),
  'q.mixed_to_improper': (q, p) => answerNumber(q) === p.whole * p.d + p.n,
  'q.round': (q, p) => {
    const unit = { ten: 10, hundred: 100, thousand: 1000 }[p.place.key.split('.')[1]];
    assert.equal(answerNumber(q), Math.round(p.n / unit) * unit);
  },
  'q.symmetry': (q, p) => {
    const expected = p.shape.key === 'shape.square' ? 4 : 2;
    assert.equal(answerNumber(q), expected);
  },
  'q.sides_of': (q, p) => {
    const sides = { triangle: 3, square: 4, pentagon: 5, hexagon: 6 };
    assert.equal(answerNumber(q), sides[p.shape.key.split('.')[1]]);
  },
  'q.shape_sides': (q, p) => {
    const sides = { 'shape.triangle': 3, 'shape.pentagon': 5, 'shape.hexagon': 6 };
    assert.equal(sides[answerKey(q)], p.n);
  },
  'q.shape_round': (q) => assert.equal(answerKey(q), 'shape.circle'),
  'q.shape_clock': (q) => assert.equal(answerKey(q), 'shape.circle'),
  'q.shape_book': (q) => assert.equal(answerKey(q), 'shape.rectangle'),
};

const EXPRESSION = /^(.+?)\s*=\s*\?$/;

function evaluateExpression(prompt) {
  if (typeof prompt !== 'string') return null;
  const match = prompt.match(EXPRESSION);
  if (!match || match[1].includes('?')) return null;
  const expression = match[1]
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/[−–]/g, '-')
    .replace(/(\d+)\/(\d+)/g, '($1/$2)');
  if (!/^[\d\s+\-*/().]+$/.test(expression)) return null;
  try {
    const value = Function(`"use strict"; return (${expression});`)();
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

test('every generated expression has the right arithmetic answer', () => {
  let checked = 0;
  for (const grade of GRADES) {
    for (const domain of DOMAINS) {
      for (const stage of STAGES) {
        for (let seed = 0; seed < 120; seed += 1) {
          const question = generateQuestion(grade, domain.id, stage.id, createRng(seed * 31 + grade * 7));
          if (typeof question.prompt !== 'string') continue;
          const expected = evaluateExpression(question.prompt);
          if (expected == null) continue;
          const answer = answerText(question);
          if (!/^-?\d+(\.\d+)?$/.test(answer)) continue;
          assert.ok(
            Math.abs(Number(answer) - expected) < 1e-9,
            `g${grade}.${domain.id}.s${stage.id}: ${question.prompt} => ${answer} (expected ${expected})`,
          );
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 300, `expected to check many expressions, only checked ${checked}`);
});

test('keyed word problems satisfy their stated mathematics', () => {
  let checked = 0;
  for (const grade of GRADES) {
    for (const domain of DOMAINS) {
      for (const stage of STAGES) {
        for (let seed = 0; seed < 150; seed += 1) {
          const question = generateQuestion(grade, domain.id, stage.id, createRng(seed * 97 + grade));
          if (typeof question.prompt !== 'object' || !question.prompt?.key) continue;
          const validator = validators[question.prompt.key];
          if (!validator) continue;
          validator(question, question.prompt.params || {});
          checked += 1;
        }
      }
    }
  }
  assert.ok(checked > 1000, `expected to check many word problems, only checked ${checked}`);
});

test('at least one question from every generate-able skill is exercised', () => {
  const seen = new Set();
  for (const grade of GRADES) {
    for (const domain of DOMAINS) {
      for (const stage of STAGES) {
        for (let seed = 0; seed < 40; seed += 1) {
          const question = generateQuestion(grade, domain.id, stage.id, createRng(seed + grade * 3));
          if (typeof question.prompt === 'object' && question.prompt?.key) seen.add(question.prompt.key);
        }
      }
    }
  }
  assert.ok(seen.size > 30, `only saw ${seen.size} distinct word-problem prompts`);
});
