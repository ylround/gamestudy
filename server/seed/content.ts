import { createQuestionFactory } from '../../src/content/questions.js';
import { localize } from '../../src/i18n/index.js';
import { createRng } from '../../src/engine/rng.js';
import { DOMAIN_META, DOMAIN_ORDER, MONSTERS, type Localized, type QuestionAnswer, type QuestionContent } from '../lib/types.ts';

export interface SeedKnowledgePoint {
  code: string;
  grade: number;
  term: string;
  textbook: string;
  domain: string;
  unitCode: string;
  unitNameZh: string;
  unitNameEn: string;
  nameZh: string;
  nameEn: string;
  parentCode: string | null;
  prerequisiteCodes: string[];
  difficulty: number;
  sort: number;
}

export interface SeedQuestion {
  code: string;
  knowledgeCode: string;
  type: QuestionContent extends never ? never : 'SINGLE' | 'JUDGE' | 'NUMBER' | 'FRACTION';
  difficulty: number;
  content: QuestionContent;
  answer: QuestionAnswer;
}

const STAGE_LABELS = [
  { zh: '基础', en: 'Foundations' },
  { zh: '进阶', en: 'Practice' },
  { zh: '挑战', en: 'Challenge' },
];

const DOMAIN_HINTS: Record<string, { zh: string[]; en: string[] }> = {
  numbers: {
    zh: ['先看清楚是加、减、乘还是除，再决定计算顺序。', '可以把大数拆成整十、整百，分开计算后再合并。'],
    en: ['First decide whether the question needs addition, subtraction, multiplication or division.', 'Split large numbers into tens or hundreds, calculate in parts, then combine.'],
  },
  fractions: {
    zh: ['先看分母是否相同；不同分母要先通分。', '分数结果记得约分成最简形式。'],
    en: ['Check the denominators first; if they differ, find a common denominator.', 'Remember to simplify the final fraction.'],
  },
  geometry: {
    zh: ['先判断题目求的是周长、面积还是体积。', '把组合图形拆成熟悉的长方形、三角形或圆再计算。'],
    en: ['Decide whether the question asks for perimeter, area or volume.', 'Split a composite shape into rectangles, triangles or circles you already know.'],
  },
  data: {
    zh: ['先把数据按顺序排列，再找平均数、中位数或众数。', '注意单位是否一致，换算后再比较或计算。'],
    en: ['Put the data in order before finding the mean, median or mode.', 'Check that all units match before comparing or calculating.'],
  },
};

function numberAbbreviation(domain: string) {
  return DOMAIN_META[domain as keyof typeof DOMAIN_META]?.abbr || 'MATH';
}

export function knowledgeCode(grade: number, domain: string, stage: number) {
  return `MATH-RJ-G${grade}-T1-${numberAbbreviation(domain)}-0${stage}`;
}

export function buildKnowledgePoints(grades: number[] = [1, 2, 3, 4, 5, 6]): SeedKnowledgePoint[] {
  const rows: SeedKnowledgePoint[] = [];
  for (const grade of grades) {
    for (const [domainIndex, domain] of DOMAIN_ORDER.entries()) {
      const meta = DOMAIN_META[domain];
      for (let stage = 1; stage <= 3; stage += 1) {
        const baseZh = localize({ key: `skill.${grade}.${domain}` }, 'zh');
        const baseEn = localize({ key: `skill.${grade}.${domain}` }, 'en');
        const label = STAGE_LABELS[stage - 1];
        const code = knowledgeCode(grade, domain, stage);
        rows.push({
          code,
          grade,
          term: 'T1',
          textbook: 'RJ',
          domain,
          unitCode: `G${grade}-${meta.abbr}`,
          unitNameZh: meta.unitZh,
          unitNameEn: meta.unitEn,
          nameZh: `${baseZh} · ${label.zh}`,
          nameEn: `${baseEn} · ${label.en}`,
          parentCode: stage > 1 ? knowledgeCode(grade, domain, stage - 1) : null,
          prerequisiteCodes: stage > 1 ? [knowledgeCode(grade, domain, stage - 1)] : [],
          difficulty: stage,
          sort: grade * 1000 + domainIndex * 10 + stage,
        });
      }
    }
  }
  return rows;
}

function localized(value: unknown): Localized {
  return { zh: localize(value, 'zh'), en: localize(value, 'en') };
}

function cleanText(value: string): string {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function choiceKey(index: number): string {
  return String.fromCharCode(65 + index);
}

function hintsFor(domain: string, kp: SeedKnowledgePoint): Localized[] {
  const hints = DOMAIN_HINTS[domain] || DOMAIN_HINTS.numbers;
  return [
    { zh: hints.zh[0], en: hints.en[0] },
    { zh: `本关考点：${kp.nameZh}。${hints.zh[1]}`, en: `Focus skill: ${kp.nameEn}. ${hints.en[1]}` },
  ];
}

function isFractionChoice(value: string): boolean {
  return /^[-+]?\d+\/\d+$/.test(cleanText(value));
}

function isNumericChoice(value: string): boolean {
  return /^[-+]?\d+(?:\.\d+)?$/.test(cleanText(value));
}

function judgeStem(questionZh: string, questionEn: string, choiceZh: string, choiceEn: string): Localized {
  return {
    zh: `题目：${questionZh} 答案是 「${choiceZh}」。这个答案正确吗？`,
    en: `Question: ${questionEn} Is the answer "${choiceEn}"?`,
  };
}

function explanationFor(question: any): Localized {
  const text = localized(question.explanation);
  if (text.zh || text.en) return text;
  return {
    zh: `正确答案是 ${localize(question.choices[question.answerIndex], 'zh')}。`,
    en: `The correct answer is ${localize(question.choices[question.answerIndex], 'en')}.`,
  };
}

function singleContent(kp: SeedKnowledgePoint, question: any): { content: QuestionContent; answer: QuestionAnswer } {
  const options = question.choices.map((choice: unknown, index: number) => ({
    key: choiceKey(index),
    text: localized(choice),
  }));
  const correctKey = choiceKey(question.answerIndex);
  return {
    content: {
      stem: localized(question.prompt),
      options,
      hints: hintsFor(kp.domain, kp),
      explanation: explanationFor(question),
      skill: { zh: kp.nameZh, en: kp.nameEn },
      media: [],
    },
    answer: { kind: 'SINGLE', value: correctKey },
  };
}

function numberContent(kp: SeedKnowledgePoint, question: any): { content: QuestionContent; answer: QuestionAnswer } {
  const correct = cleanText(localize(question.choices[question.answerIndex], 'zh'));
  return {
    content: {
      stem: localized(question.prompt),
      options: [],
      hints: hintsFor(kp.domain, kp),
      explanation: explanationFor(question),
      skill: { zh: kp.nameZh, en: kp.nameEn },
      media: [],
    },
    answer: { kind: 'NUMBER', value: correct, tolerance: 0 },
  };
}

function fractionContent(kp: SeedKnowledgePoint, question: any): { content: QuestionContent; answer: QuestionAnswer } {
  const correct = cleanText(localize(question.choices[question.answerIndex], 'zh'));
  return {
    content: {
      stem: localized(question.prompt),
      options: [],
      hints: hintsFor(kp.domain, kp),
      explanation: explanationFor(question),
      skill: { zh: kp.nameZh, en: kp.nameEn },
      media: [],
    },
    answer: { kind: 'FRACTION', value: correct, tolerance: 0 },
  };
}

function judgeContent(kp: SeedKnowledgePoint, question: any, truthful: boolean): { content: QuestionContent; answer: QuestionAnswer } {
  const correctIndex = question.answerIndex;
  const displayedIndex = truthful ? correctIndex : (correctIndex + 1) % question.choices.length;
  const displayed = question.choices[displayedIndex];
  const correct = localized(question.choices[correctIndex]);
  return {
    content: {
      stem: judgeStem(
        localize(question.prompt, 'zh'),
        localize(question.prompt, 'en'),
        localize(displayed, 'zh'),
        localize(displayed, 'en'),
      ),
      options: [
        { key: 'T', text: { zh: '正确', en: 'True' } },
        { key: 'F', text: { zh: '错误', en: 'False' } },
      ],
      hints: hintsFor(kp.domain, kp),
      explanation: {
        zh: `${explanationFor(question).zh} 正确答案应为 ${correct.zh}。`,
        en: `${explanationFor(question).en} The correct answer should be ${correct.en}.`,
      },
      skill: { zh: kp.nameZh, en: kp.nameEn },
      media: [],
    },
    answer: { kind: 'JUDGE', value: truthful },
  };
}

/**
 * Build a deterministic seed bank for one knowledge point.
 *
 * Every question stores both Chinese and English text plus the answer key, so
 * the game can serve an answer-free payload while the server keeps the judge
 * keys private.
 */
export function generateSeedQuestions(kp: SeedKnowledgePoint, perPoint = 20, variant = 0): SeedQuestion[] {
  const seed = kp.grade * 100000 + DOMAIN_ORDER.indexOf(kp.domain as any) * 10000 + Number(kp.code.slice(-1)) * 100 + variant * 7919;
  const factory = createQuestionFactory(kp.grade, kp.domain, Number(kp.code.slice(-1)), createRng(seed));
  const pool: any[] = [];
  const seen = new Set<string>();
  for (let attempt = 0; attempt < 160 && pool.length < 48; attempt += 1) {
    const question = factory();
    const signature = `${localize(question.prompt, 'zh')}::${localize(question.prompt, 'en')}`;
    if (seen.has(signature)) continue;
    seen.add(signature);
    pool.push(question);
  }

  const classic = pool.filter((item: any) => !isFractionChoice(localize(item.choices[item.answerIndex], 'zh')));
  const numeric = pool.filter((item: any) => isNumericChoice(localize(item.choices[item.answerIndex], 'zh')));
  const fractions = pool.filter((item: any) => isFractionChoice(localize(item.choices[item.answerIndex], 'zh')));

  const selected: SeedQuestion[] = [];
  const used = new Set<string>();
  const push = (question: any, builder: () => { content: QuestionContent; answer: QuestionAnswer }) => {
    const built = builder();
    const signature = `${built.content.stem.zh}::${built.content.stem.en}`;
    if (!built.content.stem.zh || !built.content.stem.en) return false;
    if (used.has(signature)) return false;
    used.add(signature);
    selected.push({
      code: '',
      knowledgeCode: kp.code,
      type: built.answer.kind as SeedQuestion['type'],
      difficulty: kp.difficulty,
      content: built.content,
      answer: built.answer,
    });
    return true;
  };

  // Mix question formats deliberately: numeric input, fraction input, judge and
  // multiple choice. A knowledge point may not have every source shape, so the
  // remaining slots are filled with choice questions.
  for (const question of numeric.slice(0, 6)) push(question, () => numberContent(kp, question));
  for (const question of fractions.slice(0, 3)) push(question, () => fractionContent(kp, question));
  for (const question of pool) {
    if (selected.filter((item) => item.type === 'JUDGE').length >= 4) break;
    push(question, () => judgeContent(kp, question, true));
    if (selected.filter((item) => item.type === 'JUDGE').length >= 4) break;
    push(question, () => judgeContent(kp, question, false));
  }
  const remaining = [...classic, ...pool].filter((question) => {
    const prompt = `${localize(question.prompt, 'zh')}::${localize(question.prompt, 'en')}`;
    return ![...used].some((signature) => signature === prompt);
  });
  for (const question of remaining) {
    if (selected.length >= perPoint) break;
    push(question, () => singleContent(kp, question));
  }
  for (const question of pool) {
    if (selected.length >= perPoint) break;
    push(question, () => singleContent(kp, question));
  }

  return selected.slice(0, perPoint).map((question, index) => ({
    ...question,
    code: `SEED-${kp.code}-${String(index + 1).padStart(2, '0')}`,
  }));
}

export { MONSTERS };
