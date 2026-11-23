export interface Localized {
  zh: string;
  en: string;
}

export type QuestionType = 'SINGLE' | 'JUDGE' | 'NUMBER' | 'FRACTION' | 'MULTI' | 'TEXT';

export interface QuestionOption {
  key: string;
  text: Localized;
}

export interface QuestionContent {
  stem: Localized;
  options: QuestionOption[];
  hints: Localized[];
  explanation: Localized;
  unit?: Localized;
  skill: Localized;
  media?: string[];
}

export interface QuestionAnswer {
  kind: QuestionType;
  value: string | string[] | boolean | number;
  tolerance?: number;
  equivalent?: string[];
}

export interface AnswerInput {
  optionKeys?: string[];
  optionKey?: string;
  value?: string | number | boolean;
  numerator?: number;
  denominator?: number;
}

export interface JudgeResult {
  correct: boolean;
  normalized: string;
  expected: string;
}

export interface StageDefinition {
  domain: 'numbers' | 'fractions' | 'geometry' | 'data';
  stage: 1 | 2 | 3;
  key: string;
  index: number;
}

export const DOMAIN_ORDER = ['numbers', 'fractions', 'geometry', 'data'] as const;

export const DOMAIN_META = {
  numbers: { unitZh: '数与运算', unitEn: 'Numbers & Operations', abbr: 'NUM', accent: '#4ade80' },
  fractions: { unitZh: '分数与小数', unitEn: 'Fractions & Decimals', abbr: 'FRAC', accent: '#c084fc' },
  geometry: { unitZh: '图形与几何', unitEn: 'Geometry', abbr: 'GEO', accent: '#f5c46b' },
  data: { unitZh: '数据与测量', unitEn: 'Data & Measurement', abbr: 'DATA', accent: '#67e8f9' },
} as const;

export const MONSTERS = [
  { id: 'mossling', zh: '苔苔怪', en: 'Mossling', hp: 130 },
  { id: 'golem', zh: '岩石傀儡', en: 'Stone Golem', hp: 150 },
  { id: 'dragon', zh: '余烬巨龙', en: 'Ember Dragon', hp: 170 },
] as const;

export function stageKey(grade: number, domain: string, stage: number) {
  return `g${grade}-${domain}-${stage}`;
}

export function stageFromKey(key: string): { grade: number; domain: string; stage: number } | null {
  const match = /^g(\d+)-([a-z]+)-(\d+)$/.exec(String(key || ''));
  if (!match) return null;
  return { grade: Number(match[1]), domain: match[2], stage: Number(match[3]) };
}

export function levelForXp(xp: number): { level: number; current: number; needed: number; percent: number } {
  let level = 1;
  let remaining = Math.max(0, Math.floor(Number(xp) || 0));
  let needed = 80;
  while (remaining >= needed && level < 99) {
    remaining -= needed;
    level += 1;
    needed = Math.round(80 * Math.pow(1.18, level - 1));
  }
  return { level, current: remaining, needed, percent: Math.min(100, Math.round((remaining / needed) * 100)) };
}
