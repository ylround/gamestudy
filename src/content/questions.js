/*
 * Generated math questions for grades 1–6 and four domains.
 *
 * A question is { prompt, choices, answerIndex, explanation } where prompt,
 * choices and explanation are either plain strings or { key, params } objects
 * resolved through the i18n layer. Everything is generated from a seeded RNG,
 * so a battle is reproducible and unit tests can sample thousands of questions.
 */
import { createRng, int, pick, shuffle } from '../engine/rng.js';

/* ------------------------------------------------------------------ */
/* Question helpers                                                    */
/* ------------------------------------------------------------------ */

const fmt = (number, decimals = 0) => Number(number.toFixed(decimals)).toString();

function gcd(a, b) {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x || 1;
}

function simplify(numerator, denominator) {
  const divisor = gcd(numerator, denominator);
  const top = numerator / divisor;
  const bottom = denominator / divisor;
  return bottom === 1 ? String(top) : `${top}/${bottom}`;
}

function optionKey(value) {
  return typeof value === 'string' ? `s:${value}` : `k:${JSON.stringify(value)}`;
}

function makeQuestion(rng, prompt, correct, distractors, explanation = null) {
  const correctKey = optionKey(correct);
  const seen = new Set();
  const choices = [];
  for (const choice of [correct, ...distractors]) {
    const key = optionKey(choice);
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push(choice);
    if (choices.length === 4) break;
  }
  if (choices.length < 2) throw new Error('A question needs at least two distinct choices');
  const shuffled = shuffle(rng, choices);
  const answerIndex = shuffled.findIndex((choice) => optionKey(choice) === correctKey);
  if (answerIndex < 0) throw new Error('The correct answer is missing from the choices');
  return { prompt, choices: shuffled, answerIndex, explanation };
}

function nearValues(rng, answer, count = 3, { min = 0, spread = 0 } = {}) {
  const seen = new Set([fmt(answer)]);
  const out = [];
  const gap = spread || Math.max(2, Math.round(Math.abs(answer) * 0.2));
  let guard = 0;
  while (out.length < count && guard < 400) {
    guard += 1;
    const delta = int(rng, 1, Math.max(1, gap));
    const candidate = answer + (rng() < 0.5 ? -delta : delta);
    if (candidate < min) continue;
    const label = fmt(candidate);
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  let step = 1;
  while (out.length < count) {
    const label = fmt(answer + step);
    if (!seen.has(label)) {
      seen.add(label);
      out.push(label);
    }
    step += 1;
  }
  return out;
}

function numQ(rng, prompt, answer, explanation, options = {}) {
  const decimals = options.decimals || 0;
  const correct = typeof answer === 'string' ? answer : fmt(answer, decimals);
  const source = options.distractors || nearValues(rng, answer, 3, options);
  const distractors = source.map((value) => (typeof value === 'number' ? fmt(value, decimals) : value));
  return makeQuestion(rng, prompt, correct, distractors, explanation);
}

function keyQ(rng, prompt, correctKey, distractorKeys, explanationKey = null) {
  return makeQuestion(
    rng,
    prompt,
    { key: correctKey },
    distractorKeys.map((key) => ({ key })),
    explanationKey ? { key: explanationKey } : null,
  );
}

function fractionChoices(rng, numerator, denominator, count = 3) {
  const correct = simplify(numerator, denominator);
  const candidates = shuffle(rng, [
    simplify(numerator + 1, denominator),
    simplify(numerator, denominator + 1),
    simplify(Math.max(1, numerator - 1), denominator),
    simplify(numerator + 2, denominator),
    simplify(numerator + 1, denominator + 1),
    simplify(denominator, numerator + denominator),
    simplify(numerator + denominator, denominator * 2),
    simplify(numerator + 3, denominator),
  ]);
  const seen = new Set([correct]);
  const out = [];
  for (const candidate of candidates) {
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
    if (out.length === count) break;
  }
  let guard = 0;
  while (out.length < count && guard < 100) {
    guard += 1;
    const candidate = simplify(int(rng, 1, 9), int(rng, 2, 10));
    if (seen.has(candidate)) continue;
    seen.add(candidate);
    out.push(candidate);
  }
  return out;
}

function fracQ(rng, prompt, numerator, denominator, explanation, distractorValues) {
  const correct = simplify(numerator, denominator);
  const distractors = distractorValues || fractionChoices(rng, numerator, denominator);
  return makeQuestion(rng, prompt, correct, distractors, explanation);
}

function wrapNegative(value) {
  return value < 0 ? `(${value})` : `${value}`;
}

/* ------------------------------------------------------------------ */
/* Numbers                                                             */
/* ------------------------------------------------------------------ */

function numbers(grade, stage, rng) {
  switch (grade) {
    case 1:
      return numbersOne(stage, rng);
    case 2:
      return numbersTwo(stage, rng);
    case 3:
      return numbersThree(stage, rng);
    case 4:
      return numbersFour(stage, rng);
    case 5:
      return numbersFive(stage, rng);
    default:
      return numbersSix(stage, rng);
  }
}

function numbersOne(stage, rng) {
  if (stage === 1) {
    const a = int(rng, 1, 8);
    const b = int(rng, 1, 10 - a);
    return rng() < 0.5
      ? numQ(rng, `${a} + ${b} = ?`, a + b, `${a} + ${b} = ${a + b}`)
      : numQ(rng, `${a + b} - ${b} = ?`, a, `${a + b} - ${b} = ${a}`);
  }
  if (stage === 2) {
    const mode = int(rng, 0, 2);
    if (mode === 0) {
      const a = int(rng, 3, 10);
      const b = int(rng, 2, 20 - a);
      return numQ(rng, `${a} + ${b} = ?`, a + b, `${a} + ${b} = ${a + b}`);
    }
    if (mode === 1) {
      const a = int(rng, 8, 20);
      const b = int(rng, 1, a - 1);
      return numQ(rng, `${a} - ${b} = ?`, a - b, `${a} - ${b} = ${a - b}`);
    }
    const a = int(rng, 1, 9);
    const b = int(rng, 1, 9);
    return numQ(rng, `${a} + ? = ${a + b}`, b, `${a} + ${b} = ${a + b}`);
  }
  const a = int(rng, 5, 14);
  const b = int(rng, 2, Math.min(9, a - 1));
  if (rng() < 0.55) {
    return numQ(rng, { key: 'q.total_gems', params: { a, b } }, a + b, `${a} + ${b} = ${a + b}`);
  }
  const bigger = Math.max(a, b);
  const smaller = Math.min(a, b);
  return numQ(
    rng,
    { key: 'q.left_gems', params: { a: bigger, b: smaller } },
    bigger - smaller,
    `${bigger} - ${smaller} = ${bigger - smaller}`,
  );
}

function numbersTwo(stage, rng) {
  if (stage === 1) {
    if (rng() < 0.5) {
      const a = int(rng, 1, 7) * 10 + int(rng, 0, 8);
      const b = int(rng, 1, 9 - (a % 10));
      return numQ(rng, `${a} + ${b} = ?`, a + b, `${a} + ${b} = ${a + b}`);
    }
    const a = int(rng, 2, 9) * 10 + int(rng, 2, 9);
    const b = int(rng, 1, a % 10);
    return numQ(rng, `${a} - ${b} = ?`, a - b, `${a} - ${b} = ${a - b}`);
  }
  if (stage === 2) {
    if (rng() < 0.5) {
      const a = int(rng, 11, 78);
      const b = int(rng, 11, 99 - a);
      return numQ(rng, `${a} + ${b} = ?`, a + b, `${a} + ${b} = ${a + b}`);
    }
    const a = int(rng, 21, 99);
    const b = int(rng, 11, a - 1);
    return numQ(rng, `${a} - ${b} = ?`, a - b, `${a} - ${b} = ${a - b}`);
  }
  const mode = int(rng, 0, 2);
  if (mode === 0) {
    const a = pick(rng, [2, 5, 10]);
    const b = int(rng, 2, 9);
    return numQ(rng, `${a} × ${b} = ?`, a * b, `${a} × ${b} = ${a * b}`);
  }
  if (mode === 1) {
    const a = pick(rng, [2, 5, 10]);
    const b = int(rng, 2, 9);
    return numQ(rng, `${a * b} ÷ ${a} = ?`, b, `${a} × ${b} = ${a * b}`);
  }
  const a = int(rng, 2, 5);
  const b = int(rng, 2, 9);
  if (rng() < 0.5) {
    return numQ(rng, { key: 'q.groups', params: { a, b } }, a * b, `${a} × ${b} = ${a * b}`);
  }
  return numQ(
    rng,
    { key: 'q.share', params: { a: a * b, b: a } },
    b,
    `${a * b} ÷ ${a} = ${b}`,
  );
}

function numbersThree(stage, rng) {
  if (stage === 1) {
    if (rng() < 0.5) {
      const a = int(rng, 100, 700);
      const b = int(rng, 50, 299);
      return numQ(rng, `${a} + ${b} = ?`, a + b, `${a} + ${b} = ${a + b}`);
    }
    const a = int(rng, 300, 999);
    const b = int(rng, 50, 299);
    return numQ(rng, `${a} - ${b} = ?`, a - b, `${a} - ${b} = ${a - b}`);
  }
  if (stage === 2) {
    const a = int(rng, 2, 10);
    const b = int(rng, 2, 10);
    if (rng() < 0.75) {
      return numQ(rng, `${a} × ${b} = ?`, a * b, `${a} × ${b} = ${a * b}`);
    }
    return numQ(rng, `${a} × ? = ${a * b}`, b, `${a} × ${b} = ${a * b}`);
  }
  const mode = int(rng, 0, 2);
  if (mode === 0) {
    const a = int(rng, 2, 9);
    const b = int(rng, 2, 12);
    return numQ(rng, `${a * b} ÷ ${a} = ?`, b, `${a} × ${b} = ${a * b}`);
  }
  if (mode === 1) {
    const a = int(rng, 2, 6);
    const b = int(rng, 2, 9);
    return numQ(rng, { key: 'q.groups', params: { a, b } }, a * b, `${a} × ${b} = ${a * b}`);
  }
  const a = int(rng, 2, 6);
  const b = int(rng, 2, 9);
  return numQ(rng, { key: 'q.share', params: { a: a * b, b: a } }, b, `${a * b} ÷ ${a} = ${b}`);
}

function numbersFour(stage, rng) {
  if (stage === 1) {
    const a = int(rng, 11, 49);
    const b = int(rng, 2, 9);
    return numQ(rng, `${a} × ${b} = ?`, a * b, `${a} × ${b} = ${a * b}`);
  }
  if (stage === 2) {
    if (rng() < 0.4) {
      const a = int(rng, 101, 499);
      const b = int(rng, 2, 9);
      return numQ(rng, `${a} × ${b} = ?`, a * b, `${a} × ${b} = ${a * b}`);
    }
    if (rng() < 0.5) {
      const a = int(rng, 11, 29);
      const b = int(rng, 11, 29);
      return numQ(rng, `${a} × ${b} = ?`, a * b, `${a} × ${b} = ${a * b}`);
    }
    const b = int(rng, 2, 9);
    const q = int(rng, 11, 99);
    return numQ(rng, `${b * q} ÷ ${b} = ?`, q, `${b} × ${q} = ${b * q}`);
  }
  const mode = int(rng, 0, 3);
  if (mode === 0) {
    const b = int(rng, 2, 9);
    const quotient = int(rng, 3, 12);
    const remainder = int(rng, 1, b - 1);
    const a = b * quotient + remainder;
    return numQ(
      rng,
      { key: 'q.remainder', params: { a, b } },
      remainder,
      `${b} × ${quotient} + ${remainder} = ${a}`,
    );
  }
  if (mode === 1) {
    return factorQuestion(rng);
  }
  if (mode === 2) {
    return multipleQuestion(rng);
  }
  const n = int(rng, 120, 9800);
  const place = pick(rng, ['ten', 'hundred', 'thousand']);
  const unit = { ten: 10, hundred: 100, thousand: 1000 }[place];
  const answer = Math.round(n / unit) * unit;
  return numQ(
    rng,
    { key: 'q.round', params: { n, place: { key: `place.${place}` } } },
    answer,
    `${n} → ${answer}`,
    { spread: unit * 2 },
  );
}

function factorQuestion(rng) {
  const n = pick(rng, [12, 18, 20, 24, 28, 30, 36, 40, 42, 48, 54, 60]);
  const divisors = [];
  for (let i = 2; i < n; i += 1) if (n % i === 0) divisors.push(i);
  const correct = pick(rng, divisors);
  const nonDivisors = [];
  for (let i = 2; i < n && nonDivisors.length < 12; i += 1) if (n % i !== 0) nonDivisors.push(i);
  return numQ(
    rng,
    { key: 'q.factor', params: { n } },
    correct,
    { key: 'explain.factor' },
    { distractors: shuffle(rng, nonDivisors).slice(0, 3) },
  );
}

function multipleQuestion(rng) {
  const n = pick(rng, [3, 4, 5, 6, 7, 8, 9]);
  const correct = n * int(rng, 2, 12);
  const nonMultiples = [];
  for (let i = 2; i < n * 12 && nonMultiples.length < 20; i += 1) {
    if (i % n !== 0) nonMultiples.push(i);
  }
  return numQ(
    rng,
    { key: 'q.multiple', params: { n } },
    correct,
    { key: 'explain.multiple' },
    { distractors: shuffle(rng, nonMultiples).slice(0, 3) },
  );
}

function decimalQuestion(rng, operation) {
  const aTenths = int(rng, 15, 85);
  const bTenths = int(rng, 5, aTenths - 1);
  const a = fmt(aTenths / 10, 1);
  const b = fmt(bTenths / 10, 1);
  const answerTenths = operation === '+' ? aTenths + bTenths : aTenths - bTenths;
  const answer = fmt(answerTenths / 10, 1);
  const rawDistractors = [answerTenths + 1, answerTenths - 1, answerTenths + 10, answerTenths + 2, answerTenths - 2]
    .filter((value) => value > 0)
    .map((value) => fmt(value / 10, 1));
  return makeQuestion(
    rng,
    `${a} ${operation} ${b} = ?`,
    answer,
    [...new Set(rawDistractors)].slice(0, 3),
    `${a} ${operation} ${b} = ${answer}`,
  );
}

function numbersFive(stage, rng) {
  if (stage === 1) {
    if (rng() < 0.4) {
      const a = int(rng, 12, 39);
      const b = int(rng, 12, 39);
      return numQ(rng, `${a} × ${b} = ?`, a * b, `${a} × ${b} = ${a * b}`);
    }
    if (rng() < 0.5) {
      const a = int(rng, 101, 399);
      const b = int(rng, 12, 29);
      return numQ(rng, `${a} × ${b} = ?`, a * b, `${a} × ${b} = ${a * b}`);
    }
    return decimalQuestion(rng, rng() < 0.5 ? '+' : '-');
  }
  if (stage === 2) {
    const mode = int(rng, 0, 2);
    if (mode === 0) {
      const a = int(rng, 2, 12);
      const b = int(rng, 2, 9);
      const c = int(rng, 2, 9);
      const answer = (a + b) * c;
      return numQ(rng, `(${a} + ${b}) × ${c} = ?`, answer, `(${a} + ${b}) × ${c} = ${answer}`);
    }
    if (mode === 1) {
      const a = int(rng, 3, 12);
      const b = int(rng, 2, 9);
      const c = int(rng, 1, a * b - 1);
      const answer = a * b - c;
      return numQ(rng, `${a} × ${b} - ${c} = ?`, answer, `${a} × ${b} - ${c} = ${answer}`);
    }
    return decimalQuestion(rng, rng() < 0.5 ? '+' : '-');
  }
  const mode = int(rng, 0, 2);
  if (mode === 0) {
    const a = int(rng, 3, 8);
    const b = int(rng, 2, 6);
    const c = int(rng, 2, 9);
    const answer = a * (b + c);
    return numQ(rng, `${a} × (${b} + ${c}) = ?`, answer, `${a} × (${b} + ${c}) = ${answer}`);
  }
  if (mode === 1) {
    const aTenths = int(rng, 12, 80);
    const factor = pick(rng, [10, 100]);
    const a = fmt(aTenths / 10, 1);
    const answer = fmt((aTenths * factor) / 10, 1);
    return numQ(rng, `${a} × ${factor} = ?`, answer, `${a} × ${factor} = ${answer}`, {
      decimals: 1,
      distractors: [fmt((aTenths * factor) / 100, 1), fmt((aTenths * factor) / 1000, 1), fmt((aTenths * factor) / 10 + 1, 1)],
    });
  }
  return decimalQuestion(rng, rng() < 0.5 ? '+' : '-');
}

function numbersSix(stage, rng) {
  if (stage === 1) {
    const a = int(rng, -12, 12);
    const b = int(rng, -12, 12);
    const sign = rng() < 0.5 ? '+' : '-';
    const answer = sign === '+' ? a + b : a - b;
    return numQ(
      rng,
      `${wrapNegative(a)} ${sign} ${wrapNegative(b)} = ?`,
      answer,
      `${a} ${sign} ${b} = ${answer}`,
      { min: -40, spread: 6 },
    );
  }
  if (stage === 2) {
    if (rng() < 0.5) {
      const p = pick(rng, [10, 20, 25, 40, 50, 60, 75, 80]);
      const n = pick(rng, [20, 40, 60, 80, 120, 200]);
      const answer = (p * n) / 100;
      return numQ(
        rng,
        { key: 'q.percent_of', params: { p, n } },
        answer,
        `${p}% × ${n} = ${answer}`,
      );
    }
    return ratioQuestion(rng);
  }
  const mode = int(rng, 0, 2);
  if (mode === 0) {
    const a = int(rng, 2, 9);
    const b = int(rng, 2, 9);
    const c = int(rng, 2, 9);
    const answer = a * (b + c);
    return numQ(rng, `${a} × (${b} + ${c}) = ?`, answer, `${a} × (${b} + ${c}) = ${answer}`);
  }
  if (mode === 1) {
    const a = int(rng, -10, 10);
    const b = int(rng, -10, 10);
    const answer = a + b;
    return numQ(
      rng,
      `${wrapNegative(a)} + ${wrapNegative(b)} = ?`,
      answer,
      `${a} + ${b} = ${answer}`,
      { min: -25, spread: 5 },
    );
  }
  return ratioQuestion(rng);
}

function ratioQuestion(rng) {
  const a = int(rng, 2, 5);
  let b = int(rng, 2, 6);
  if (b === a) b = b === 6 ? 5 : b + 1;
  const multiplier = int(rng, 2, 5);
  const a2 = a * multiplier;
  const answer = b * multiplier;
  return numQ(
    rng,
    { key: 'q.ratio', params: { a, b, a2 } },
    answer,
    `${a2} ÷ ${a} × ${b} = ${answer}`,
  );
}

/* ------------------------------------------------------------------ */
/* Fractions & decimals                                                */
/* ------------------------------------------------------------------ */

function fractions(grade, stage, rng) {
  switch (grade) {
    case 1:
      return fractionsOne(stage, rng);
    case 2:
      return fractionsTwo(stage, rng);
    case 3:
      return fractionsThree(stage, rng);
    case 4:
      return fractionsFour(stage, rng);
    case 5:
      return fractionsFive(stage, rng);
    default:
      return fractionsSix(stage, rng);
  }
}

function fractionsOne(stage, rng) {
  if (stage === 1) {
    const whole = int(rng, 1, 6) * 2;
    return numQ(rng, `1/2 × ${whole} = ?`, whole / 2, `${whole} ÷ 2 = ${whole / 2}`);
  }
  if (stage === 2) {
    const whole = int(rng, 1, 5) * 4;
    return numQ(rng, `1/4 × ${whole} = ?`, whole / 4, `${whole} ÷ 4 = ${whole / 4}`);
  }
  const denominator = pick(rng, [2, 4, 8]);
  const numerator = int(rng, 1, denominator - 1);
  return fracQ(
    rng,
    { key: 'q.fraction_pizza', params: { d: denominator, n: numerator } },
    numerator,
    denominator,
    { key: 'explain.fraction_pizza', params: { d: denominator, n: numerator } },
  );
}

function fractionsTwo(stage, rng) {
  if (stage === 1) {
    const denominator = int(rng, 3, 10);
    const a = int(rng, 1, denominator - 1);
    let b = int(rng, 1, denominator - 1);
    if (b === a) b = (b % (denominator - 1)) + 1;
    const symbol = a < b ? '<' : '>';
    return makeQuestion(
      rng,
      `${a}/${denominator} ○ ${b}/${denominator}`,
      symbol,
      ['<', '>', '='].filter((choice) => choice !== symbol),
      `${a} ${symbol} ${b} → ${a}/${denominator} ${symbol} ${b}/${denominator}`,
    );
  }
  if (stage === 2) {
    const denominator = int(rng, 2, 5);
    const whole = denominator * int(rng, 2, 6);
    return numQ(
      rng,
      { key: 'q.fraction_of', params: { n: whole, d: denominator } },
      whole / denominator,
      `${whole} ÷ ${denominator} = ${whole / denominator}`,
    );
  }
  const denominator = int(rng, 4, 10);
  const a = int(rng, 1, denominator - 2);
  const b = int(rng, 1, denominator - 1 - a);
  if (rng() < 0.5) {
    return fracQ(
      rng,
      `${a}/${denominator} + ${b}/${denominator} = ?`,
      a + b,
      denominator,
      `${a}/${denominator} + ${b}/${denominator} = ${simplify(a + b, denominator)}`,
    );
  }
  const bigger = Math.max(a + b, a);
  const smaller = Math.min(a + b, a);
  return fracQ(
    rng,
    `${bigger}/${denominator} - ${smaller}/${denominator} = ?`,
    bigger - smaller,
    denominator,
    `${bigger}/${denominator} - ${smaller}/${denominator} = ${simplify(bigger - smaller, denominator)}`,
  );
}

function fractionsThree(stage, rng) {
  if (stage === 1) {
    const denominator = int(rng, 3, 8);
    const numerator = int(rng, 1, denominator - 1);
    const factor = int(rng, 2, 4);
    return numQ(
      rng,
      `${numerator}/${denominator} = ?/${denominator * factor}`,
      numerator * factor,
      `${numerator} × ${factor} = ${numerator * factor}`,
    );
  }
  if (stage === 2) {
    const denominator = int(rng, 5, 12);
    const a = int(rng, 1, denominator - 3);
    const b = int(rng, 1, denominator - 1 - a);
    if (rng() < 0.6) {
      return fracQ(
        rng,
        `${a}/${denominator} + ${b}/${denominator} = ?`,
        a + b,
        denominator,
        `${a}/${denominator} + ${b}/${denominator} = ${simplify(a + b, denominator)}`,
      );
    }
    const bigger = Math.max(a + b, a);
    const smaller = Math.min(a + b, a);
    return fracQ(
      rng,
      `${bigger}/${denominator} - ${smaller}/${denominator} = ?`,
      bigger - smaller,
      denominator,
      `${bigger}/${denominator} - ${smaller}/${denominator} = ${simplify(bigger - smaller, denominator)}`,
    );
  }
  return compareFractions(rng);
}

function compareFractions(rng) {
  const d1 = int(rng, 3, 8);
  let d2 = int(rng, 3, 8);
  if (d2 === d1) d2 = d2 === 8 ? 7 : d2 + 1;
  const n1 = int(rng, 1, d1 - 1);
  const n2 = int(rng, 1, d2 - 1);
  const left = n1 / d1;
  const right = n2 / d2;
  const symbol = left < right ? '<' : left > right ? '>' : '=';
  return makeQuestion(
    rng,
    `${n1}/${d1} ○ ${n2}/${d2}`,
    symbol,
    ['<', '>', '='].filter((choice) => choice !== symbol),
    `${n1}/${d1} ${symbol} ${n2}/${d2}`,
  );
}

function fractionsFour(stage, rng) {
  if (stage === 1) {
    const denominator = int(rng, 4, 12);
    const a = int(rng, 1, denominator - 2);
    const b = int(rng, 1, denominator - 1 - a);
    if (rng() < 0.6) {
      return fracQ(
        rng,
        `${a}/${denominator} + ${b}/${denominator} = ?`,
        a + b,
        denominator,
        `${a}/${denominator} + ${b}/${denominator} = ${simplify(a + b, denominator)}`,
      );
    }
    const bigger = Math.max(a + b, a);
    const smaller = Math.min(a + b, a);
    return fracQ(
      rng,
      `${bigger}/${denominator} - ${smaller}/${denominator} = ?`,
      bigger - smaller,
      denominator,
      `${bigger}/${denominator} - ${smaller}/${denominator} = ${simplify(bigger - smaller, denominator)}`,
    );
  }
  if (stage === 2) {
    const denominator = int(rng, 2, 6);
    const numerator = int(rng, 1, denominator - 1);
    const whole = int(rng, 1, 3);
    const answer = whole * denominator + numerator;
    return numQ(
      rng,
      { key: 'q.mixed_to_improper', params: { whole, n: numerator, d: denominator } },
      answer,
      `${whole} × ${denominator} + ${numerator} = ${answer}`,
    );
  }
  return compareFractions(rng);
}

function fractionsFive(stage, rng) {
  if (stage === 1) {
    const denominator = int(rng, 3, 8);
    const a = int(rng, 1, denominator - 1);
    const b = int(rng, 1, denominator - 1);
    return fracQ(
      rng,
      `${a}/${denominator} + ${b}/${denominator} = ?`,
      a + b,
      denominator,
      `${a}/${denominator} + ${b}/${denominator} = ${simplify(a + b, denominator)}`,
    );
  }
  if (stage === 2) {
    if (rng() < 0.5) {
      const denominator = int(rng, 3, 8);
      const a = int(rng, 2, denominator - 1);
      const b = int(rng, 1, a - 1);
      return fracQ(
        rng,
        `${a}/${denominator} - ${b}/${denominator} = ?`,
        a - b,
        denominator,
        `${a}/${denominator} - ${b}/${denominator} = ${simplify(a - b, denominator)}`,
      );
    }
    const denominator = pick(rng, [3, 4, 5, 6, 8]);
    const numerator = int(rng, 1, denominator - 1);
    const whole = int(rng, 2, 5);
    return fracQ(
      rng,
      `${numerator}/${denominator} × ${whole} = ?`,
      numerator * whole,
      denominator,
      `${numerator}/${denominator} × ${whole} = ${simplify(numerator * whole, denominator)}`,
    );
  }
  const decimal = pick(rng, [0.25, 0.4, 0.5, 0.6, 0.75, 0.8]);
  const numerator = Math.round(decimal * 100);
  const answer = simplify(numerator, 100);
  const distractors = ['1/2', '2/3', '3/4', '1/4', '2/5', '3/5'].filter((value) => value !== answer).slice(0, 3);
  return makeQuestion(
    rng,
    { key: 'q.decimal_frac', params: { value: decimal } },
    answer,
    shuffle(rng, distractors),
    { key: 'explain.decimal_frac' },
  );
}

function fractionsSix(stage, rng) {
  if (stage === 1) {
    const d1 = int(rng, 2, 6);
    const d2 = int(rng, 2, 6);
    const n1 = int(rng, 1, d1 - 1);
    const n2 = int(rng, 1, d2 - 1);
    return fracQ(
      rng,
      `${n1}/${d1} × ${n2}/${d2} = ?`,
      n1 * n2,
      d1 * d2,
      `${n1}/${d1} × ${n2}/${d2} = ${simplify(n1 * n2, d1 * d2)}`,
    );
  }
  if (stage === 2) {
    const d1 = int(rng, 2, 6);
    const d2 = int(rng, 2, 6);
    const n1 = int(rng, 1, d1 - 1);
    const n2 = int(rng, 1, d2 - 1);
    return fracQ(
      rng,
      `${n1}/${d1} ÷ ${n2}/${d2} = ?`,
      n1 * d2,
      d1 * n2,
      `${n1}/${d1} × ${d2}/${n2} = ${simplify(n1 * d2, d1 * n2)}`,
    );
  }
  if (rng() < 0.5) {
    const percent = pick(rng, [20, 25, 40, 50, 60, 75, 80]);
    const answer = simplify(percent, 100);
    const distractors = ['1/2', '2/3', '3/4', '1/4', '2/5', '3/5', '4/5'].filter((value) => value !== answer).slice(0, 3);
    return makeQuestion(
      rng,
      { key: 'q.percent_frac', params: { value: percent } },
      answer,
      shuffle(rng, distractors),
      { key: 'explain.percent_frac' },
    );
  }
  const a = int(rng, 2, 5);
  const b = int(rng, 2, 6);
  if (a === b) return fractionsSix(stage, rng);
  const answer = simplify(a, a + b);
  const distractors = fractionChoices(rng, a, a + b);
  return makeQuestion(
    rng,
    { key: 'q.ratio_frac', params: { a, b } },
    answer,
    distractors,
    { key: 'explain.ratio_frac', params: { a, b, sum: a + b } },
  );
}

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const SHAPE_SIDES = {
  triangle: 3,
  square: 4,
  rectangle: 4,
  pentagon: 5,
  hexagon: 6,
};

function geometry(grade, stage, rng) {
  switch (grade) {
    case 1:
      return geometryOne(stage, rng);
    case 2:
      return geometryTwo(stage, rng);
    case 3:
      return geometryThree(stage, rng);
    case 4:
      return geometryFour(stage, rng);
    case 5:
      return geometryFive(stage, rng);
    default:
      return geometrySix(stage, rng);
  }
}

function geometryOne(stage, rng) {
  if (stage === 1) {
    if (rng() < 0.5) {
      const n = pick(rng, [3, 5, 6]);
      const answer = { 3: 'shape.triangle', 5: 'shape.pentagon', 6: 'shape.hexagon' }[n];
      return keyQ(
        rng,
        { key: 'q.shape_sides', params: { n } },
        answer,
        ['shape.triangle', 'shape.square', 'shape.circle', 'shape.hexagon'].filter((key) => key !== answer),
        'explain.shape_sides',
      );
    }
    return keyQ(
      rng,
      { key: 'q.shape_round' },
      'shape.circle',
      ['shape.square', 'shape.triangle', 'shape.hexagon'],
      'explain.shape_round',
    );
  }
  if (stage === 2) {
    const shape = pick(rng, ['triangle', 'square', 'pentagon', 'hexagon']);
    return numQ(
      rng,
      { key: 'q.sides_of', params: { shape: { key: `shape.${shape}` } } },
      SHAPE_SIDES[shape],
      { key: 'explain.sides', params: { shape: { key: `shape.${shape}` }, n: SHAPE_SIDES[shape] } },
    );
  }
  if (rng() < 0.5) {
    return keyQ(
      rng,
      { key: 'q.shape_clock' },
      'shape.circle',
      ['shape.square', 'shape.triangle', 'shape.rectangle'],
      'explain.clock',
    );
  }
  return keyQ(
    rng,
    { key: 'q.shape_book' },
    'shape.rectangle',
    ['shape.circle', 'shape.triangle', 'shape.hexagon'],
    'explain.book',
  );
}

function geometryTwo(stage, rng) {
  if (stage === 1) {
    const l = int(rng, 2, 12);
    const w = int(rng, 2, 12);
    return numQ(
      rng,
      { key: 'q.rect_area', params: { l, w } },
      l * w,
      `${l} × ${w} = ${l * w}`,
    );
  }
  if (stage === 2) {
    if (rng() < 0.5) {
      const side = int(rng, 2, 12);
      return numQ(
        rng,
        { key: 'q.square_perimeter', params: { a: side } },
        side * 4,
        `${side} × 4 = ${side * 4}`,
      );
    }
    const l = int(rng, 2, 12);
    const w = int(rng, 2, 12);
    return numQ(
      rng,
      { key: 'q.rect_perimeter', params: { l, w } },
      2 * (l + w),
      `(${l} + ${w}) × 2 = ${2 * (l + w)}`,
    );
  }
  if (rng() < 0.5) {
    return numQ(
      rng,
      { key: 'q.symmetry', params: { shape: { key: 'shape.square' } } },
      4,
      { key: 'explain.symmetry' },
    );
  }
  return numQ(
    rng,
    { key: 'q.symmetry', params: { shape: { key: 'shape.rectangle' } } },
    2,
    { key: 'explain.symmetry' },
  );
}

function geometryThree(stage, rng) {
  if (stage === 1) {
    const l = int(rng, 3, 15);
    const w = int(rng, 2, 12);
    return numQ(
      rng,
      { key: 'q.rect_area', params: { l, w } },
      l * w,
      `${l} × ${w} = ${l * w}`,
    );
  }
  if (stage === 2) {
    const l = int(rng, 3, 12);
    const w = int(rng, 2, 9);
    return numQ(
      rng,
      { key: 'q.rect_missing_side', params: { area: l * w, l } },
      w,
      `${l * w} ÷ ${l} = ${w}`,
    );
  }
  const l = int(rng, 3, 15);
  const w = int(rng, 2, 12);
  return numQ(
    rng,
    { key: 'q.rect_perimeter', params: { l, w } },
    2 * (l + w),
    `(${l} + ${w}) × 2 = ${2 * (l + w)}`,
  );
}

function geometryFour(stage, rng) {
  if (stage === 1) {
    const a = int(rng, 2, 6);
    const b = int(rng, 2, 6);
    const c = int(rng, 2, 6);
    const d = int(rng, 2, 6);
    return numQ(
      rng,
      { key: 'q.composite_area', params: { a, b, c, d } },
      a * b + c * d,
      `${a}×${b} + ${c}×${d} = ${a * b + c * d}`,
    );
  }
  if (stage === 2) {
    if (rng() < 0.5) {
      const a = int(rng, 20, 160);
      return numQ(
        rng,
        { key: 'q.angle_line', params: { a } },
        180 - a,
        `180° - ${a}° = ${180 - a}°`,
      );
    }
    const a = int(rng, 20, 70);
    return numQ(
      rng,
      { key: 'q.angle_right', params: { a } },
      90 - a,
      `90° - ${a}° = ${90 - a}°`,
    );
  }
  const l = int(rng, 3, 15);
  const w = int(rng, 2, 12);
  return rng() < 0.5
    ? numQ(rng, { key: 'q.rect_area', params: { l, w } }, l * w, `${l} × ${w} = ${l * w}`)
    : numQ(rng, { key: 'q.rect_perimeter', params: { l, w } }, 2 * (l + w), `(${l} + ${w}) × 2 = ${2 * (l + w)}`);
}

function geometryFive(stage, rng) {
  if (stage === 1) {
    const b = int(rng, 2, 8) * 2;
    const h = int(rng, 3, 10);
    return numQ(
      rng,
      { key: 'q.triangle_area', params: { b, h } },
      (b * h) / 2,
      `${b} × ${h} ÷ 2 = ${(b * h) / 2}`,
    );
  }
  if (stage === 2) {
    if (rng() < 0.5) {
      const b = int(rng, 3, 12);
      const h = int(rng, 3, 9);
      return numQ(
        rng,
        { key: 'q.parallelogram_area', params: { b, h } },
        b * h,
        `${b} × ${h} = ${b * h}`,
      );
    }
    const l = int(rng, 2, 8);
    const w = int(rng, 2, 8);
    const h = int(rng, 2, 8);
    return numQ(
      rng,
      { key: 'q.prism_volume', params: { l, w, h } },
      l * w * h,
      `${l} × ${w} × ${h} = ${l * w * h}`,
    );
  }
  const l = int(rng, 2, 9);
  const w = int(rng, 2, 9);
  const h = int(rng, 2, 9);
  return numQ(
    rng,
    { key: 'q.prism_volume', params: { l, w, h } },
    l * w * h,
    `${l} × ${w} × ${h} = ${l * w * h}`,
  );
}

function geometrySix(stage, rng) {
  if (stage === 1) {
    const r = int(rng, 2, 8);
    const circumference = Number((2 * 3.14 * r).toFixed(2));
    const area = Number((3.14 * r * r).toFixed(2));
    return numQ(
      rng,
      { key: 'q.circle_circumference', params: { r } },
      circumference,
      `2 × 3.14 × ${r} = ${circumference}`,
      {
        decimals: 2,
        distractors: [
          Number((3.14 * r).toFixed(2)),
          Number((2 * r).toFixed(2)),
          area,
          Number((2 * 3.14 * r + 3.14).toFixed(2)),
        ],
      },
    );
  }
  if (stage === 2) {
    const r = int(rng, 2, 8);
    const area = Number((3.14 * r * r).toFixed(2));
    const circumference = Number((2 * 3.14 * r).toFixed(2));
    return numQ(
      rng,
      { key: 'q.circle_area', params: { r } },
      area,
      `3.14 × ${r} × ${r} = ${area}`,
      {
        decimals: 2,
        distractors: [
          circumference,
          Number((3.14 * r).toFixed(2)),
          Number((2 * 3.14 * r * r).toFixed(2)),
          Number((3.14 * r * r + 3.14).toFixed(2)),
        ],
      },
    );
  }
  if (rng() < 0.5) {
    const a = int(rng, 2, 8);
    const volume = a ** 3;
    const surface = 6 * a * a;
    return numQ(
      rng,
      { key: 'q.cube_volume', params: { a } },
      volume,
      `${a} × ${a} × ${a} = ${volume}`,
      { distractors: [surface, a * a, volume + a] },
    );
  }
  const a = int(rng, 30, 80);
  const b = int(rng, 30, 140 - a);
  const third = 180 - a - b;
  return numQ(
    rng,
    { key: 'q.triangle_angles', params: { a, b } },
    third,
    `180° - ${a}° - ${b}° = ${third}°`,
  );
}

/* ------------------------------------------------------------------ */
/* Data & measurement                                                  */
/* ------------------------------------------------------------------ */

function data(grade, stage, rng) {
  switch (grade) {
    case 1:
      return dataOne(stage, rng);
    case 2:
      return dataTwo(stage, rng);
    case 3:
      return dataThree(stage, rng);
    case 4:
      return dataFour(stage, rng);
    case 5:
      return dataFive(stage, rng);
    default:
      return dataSix(stage, rng);
  }
}

function dataOne(stage, rng) {
  const a = int(rng, 3, 12);
  const b = int(rng, 3, 12);
  if (stage === 1) {
    return numQ(rng, { key: 'q.total_gems', params: { a, b } }, a + b, `${a} + ${b} = ${a + b}`);
  }
  if (stage === 2) {
    const bigger = Math.max(a, b);
    const smaller = Math.min(a, b);
    return numQ(
      rng,
      { key: 'q.longer', params: { a: bigger, b: smaller } },
      bigger - smaller,
      `${bigger} - ${smaller} = ${bigger - smaller}`,
    );
  }
  const first = int(rng, 3, 10);
  const second = first + int(rng, 1, 8);
  return numQ(
    rng,
    { key: 'q.bar_more', params: { a: first, b: second } },
    second - first,
    `${second} - ${first} = ${second - first}`,
  );
}

function dataTwo(stage, rng) {
  if (stage === 1) {
    const first = int(rng, 3, 10);
    const second = first + int(rng, 1, 8);
    return numQ(
      rng,
      { key: 'q.bar_more', params: { a: first, b: second } },
      second - first,
      `${second} - ${first} = ${second - first}`,
    );
  }
  if (stage === 2) {
    const a = int(rng, 1, 6);
    const b = int(rng, 1, 6);
    return numQ(
      rng,
      { key: 'q.money_total', params: { a, b } },
      10 * a + 5 * b,
      `${a} × 10 + ${b} × 5 = ${10 * a + 5 * b}`,
    );
  }
  const a = int(rng, 3, 20);
  const b = int(rng, 3, 20);
  const c = int(rng, 3, 20);
  return numQ(
    rng,
    { key: 'q.data_total', params: { a, b, c } },
    a + b + c,
    `${a} + ${b} + ${c} = ${a + b + c}`,
  );
}

function dataThree(stage, rng) {
  if (stage === 1) {
    const a = int(rng, 5, 25);
    const b = int(rng, 5, 25);
    const c = int(rng, 5, 25);
    return numQ(
      rng,
      { key: 'q.data_total', params: { a, b, c } },
      a + b + c,
      `${a} + ${b} + ${c} = ${a + b + c}`,
    );
  }
  if (stage === 2) {
    return meanQuestion(rng, 3);
  }
  const first = int(rng, 5, 20);
  const second = first + int(rng, 2, 10);
  return numQ(
    rng,
    { key: 'q.bar_more', params: { a: first, b: second } },
    second - first,
    `${second} - ${first} = ${second - first}`,
  );
}

function meanQuestion(rng, count) {
  const mean = int(rng, 3, 20);
  let values = [];
  if (count === 3) values = [mean - 1, mean, mean + 1];
  else if (count === 4) values = [mean - 1, mean, mean + 1, mean];
  else values = [mean - 2, mean - 1, mean, mean + 1, mean + 2];
  values = shuffle(rng, values);
  const sum = values.reduce((total, value) => total + value, 0);
  return numQ(
    rng,
    { key: 'q.mean', params: { values } },
    mean,
    `(${values.join(' + ')}) ÷ ${count} = ${mean}`,
  );
}

function medianQuestion(rng, count = 5) {
  const values = [];
  let current = int(rng, 2, 20);
  for (let i = 0; i < count; i += 1) {
    if (i > 0) current += int(rng, 1, 4);
    values.push(current);
  }
  const median = values[Math.floor(count / 2)];
  return numQ(
    rng,
    { key: 'q.median', params: { values: shuffle(rng, values) } },
    median,
    `${values.join(', ')} → ${median}`,
  );
}

function modeQuestion(rng) {
  const mode = int(rng, 2, 15);
  const pool = [mode - 3, mode - 2, mode + 2, mode + 4, mode + 5, mode - 4];
  const others = shuffle(
    rng,
    pool.filter((value) => value > 0 && value !== mode),
  ).slice(0, 3);
  const values = shuffle(rng, [mode, mode, ...others]);
  return numQ(
    rng,
    { key: 'q.mode', params: { values } },
    mode,
    `${values.join(', ')} → ${mode}`,
  );
}

function rangeQuestion(rng) {
  const values = shuffle(rng, [int(rng, 1, 10), int(rng, 11, 20), int(rng, 21, 30), int(rng, 31, 40), int(rng, 41, 50)]);
  const range = Math.max(...values) - Math.min(...values);
  return numQ(
    rng,
    { key: 'q.range', params: { values } },
    range,
    `${Math.max(...values)} - ${Math.min(...values)} = ${range}`,
  );
}

function conversionQuestion(rng) {
  const pair = pick(rng, [
    { from: 'm', to: 'cm', factor: 100 },
    { from: 'kg', to: 'g', factor: 1000 },
    { from: 'l', to: 'ml', factor: 1000 },
    { from: 'km', to: 'm', factor: 1000 },
  ]);
  const value = int(rng, 2, 9);
  return numQ(
    rng,
    {
      key: 'q.convert',
      params: {
        value,
        from: { key: `unit.${pair.from}` },
        to: { key: `unit.${pair.to}` },
        factor: pair.factor,
      },
    },
    value * pair.factor,
    `${value} × ${pair.factor} = ${value * pair.factor}`,
  );
}

function timeQuestion(rng) {
  const hour = int(rng, 1, 8);
  const length = int(rng, 1, 3);
  const answer = `${hour + length}:00`;
  const distractors = [
    ...new Set([
      `${hour}:00`,
      `${hour + length + 1}:00`,
      `${hour + Math.max(1, length - 1)}:00`,
      `${hour + length + 2}:00`,
    ]),
  ].filter((time) => time !== answer);
  return makeQuestion(
    rng,
    { key: 'q.time_elapsed', params: { h: hour, n: length } },
    answer,
    distractors.slice(0, 3),
    { key: 'explain.time_elapsed', params: { h: hour, n: length, answer } },
  );
}

function probabilityQuestion(rng) {
  const red = int(rng, 1, 4);
  const blue = int(rng, 1, 4);
  const total = red + blue;
  const answer = simplify(red, total);
  return makeQuestion(
    rng,
    { key: 'q.probability', params: { r: red, b: blue } },
    answer,
    fractionChoices(rng, red, total),
    { key: 'explain.probability' },
  );
}

function dataFour(stage, rng) {
  if (stage === 1) return meanQuestion(rng, 4);
  if (stage === 2) return rng() < 0.5 ? medianQuestion(rng, 5) : modeQuestion(rng);
  if (rng() < 0.5) return rangeQuestion(rng);
  return conversionQuestion(rng);
}

function dataFive(stage, rng) {
  if (stage === 1) return rng() < 0.5 ? meanQuestion(rng, 5) : medianQuestion(rng, 5);
  if (stage === 2) return rng() < 0.5 ? modeQuestion(rng) : rangeQuestion(rng);
  if (rng() < 0.5) return conversionQuestion(rng);
  return timeQuestion(rng);
}

function dataSix(stage, rng) {
  if (stage === 1) return rng() < 0.5 ? meanQuestion(rng, 5) : medianQuestion(rng, 5);
  if (stage === 2) return rng() < 0.5 ? rangeQuestion(rng) : probabilityQuestion(rng);
  if (rng() < 0.5) return probabilityQuestion(rng);
  const p = pick(rng, [10, 20, 25, 50, 75]);
  const n = pick(rng, [40, 60, 80, 120, 200]);
  const answer = (p * n) / 100;
  return numQ(rng, { key: 'q.percent_of', params: { p, n } }, answer, `${p}% × ${n} = ${answer}`);
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

export function generateQuestion(grade, domain, stage, rng) {
  switch (domain) {
    case 'numbers':
      return numbers(grade, stage, rng);
    case 'fractions':
      return fractions(grade, stage, rng);
    case 'geometry':
      return geometry(grade, stage, rng);
    case 'data':
      return data(grade, stage, rng);
    default:
      throw new Error(`Unknown domain: ${domain}`);
  }
}

function promptSignature(question) {
  return JSON.stringify(question.prompt);
}

/**
 * Build a question factory for one battle. Recent prompts are skipped so a
 * five-question run does not ask the same thing twice in a row.
 */
export function createQuestionFactory(grade, domain, stage, seed) {
  const rng = createRng(seed);
  const recent = [];
  return function nextQuestion() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const question = generateQuestion(grade, domain, stage, rng);
      const signature = promptSignature(question);
      if (!recent.includes(signature) || attempt === 19) {
        recent.push(signature);
        if (recent.length > 10) recent.shift();
        return question;
      }
    }
    return generateQuestion(grade, domain, stage, rng);
  };
}

export const __test = { nearValues, fractionChoices, simplify, makeQuestion };
