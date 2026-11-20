import type { AnswerInput, JudgeResult, QuestionAnswer, QuestionContent } from './types.ts';

function normalizeText(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/[，。！？；：、]/g, (character) => ({ '，': ',', '。': '.', '！': '!', '？': '?', '；': ';', '：': ':', '、': ',' })[character] || character);
}

function parseNumeric(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  let text = String(value ?? '').trim().replace(/,/g, '');
  if (!text) return null;
  const mixed = /^([-+]?\d+)\s+(\d+)\/(\d+)$/.exec(text);
  if (mixed) {
    const whole = Number(mixed[1]);
    const numerator = Number(mixed[2]);
    const denominator = Number(mixed[3]);
    if (!denominator) return null;
    return (whole >= 0 ? 1 : -1) * (Math.abs(whole) + numerator / denominator);
  }
  text = text.replace(/\s+/g, '');
  const percent = text.endsWith('%');
  if (percent) text = text.slice(0, -1);
  const unitMatch = /^([-+]?\d+(?:\.\d+)?)\s*(元|米|厘米|毫米|千克|克|分钟|小时|个|本|人|块|度|平方厘米|平方米|立方厘米|立方分米|cm|m|kg|g|min|h)?$/i.exec(text);
  if (unitMatch) return Number(unitMatch[1]) / (percent ? 100 : 1);
  const fraction = /^([-+]?\d+)\/(\d+)$/.exec(text);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (!denominator) return null;
    return numerator / denominator;
  }
  const numeric = Number(text);
  return Number.isFinite(numeric) ? numeric : null;
}

function equivalentValues(answer: QuestionAnswer): number[] {
  const values: number[] = [];
  if (Array.isArray(answer.equivalent)) {
    for (const item of answer.equivalent) {
      const parsed = parseNumeric(item);
      if (parsed !== null) values.push(parsed);
    }
  }
  const primary = parseNumeric(answer.value as any);
  if (primary !== null) values.push(primary);
  return values;
}

function asNumber(input: AnswerInput | string | number | boolean): number | null {
  if (typeof input === 'number') return Number.isFinite(input) ? input : null;
  if (typeof input === 'string') return parseNumeric(input);
  if (input && typeof input === 'object') {
    if (input.numerator !== undefined && input.denominator !== undefined) {
      const numerator = Number(input.numerator);
      const denominator = Number(input.denominator);
      if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) return null;
      return numerator / denominator;
    }
    if (input.value !== undefined) {
      if (typeof input.value === 'number') return input.value;
      if (typeof input.value === 'string') return parseNumeric(input.value);
    }
  }
  return null;
}

function answerOptionKeys(input: AnswerInput | string | string[]): string[] {
  if (Array.isArray(input)) return input.map((item) => String(item));
  if (typeof input === 'string') return input.includes(',') ? input.split(',').map((item) => item.trim()).filter(Boolean) : [input];
  if (input && typeof input === 'object') {
    if (Array.isArray(input.optionKeys)) return input.optionKeys.map((item) => String(item));
    if (input.optionKey !== undefined) return [String(input.optionKey)];
  }
  return [];
}

export function judge(content: QuestionContent, answer: QuestionAnswer, submitted: AnswerInput | string | number | boolean): JudgeResult {
  const expected = String(Array.isArray(answer.value) ? answer.value.join(',') : answer.value);
  switch (answer.kind) {
    case 'SINGLE':
    case 'MULTI': {
      const selected = answerOptionKeys(submitted).sort();
      const correctKeys = (Array.isArray(answer.value) ? answer.value : [answer.value]).map(String).sort();
      const correct = selected.length === correctKeys.length && selected.every((key, index) => key === correctKeys[index]);
      return { correct, normalized: selected.join(','), expected: correctKeys.join(',') };
    }
    case 'JUDGE': {
      let value = submitted;
      if (value && typeof value === 'object') {
        if (Array.isArray((value as AnswerInput).optionKeys)) {
          const key = (value as AnswerInput).optionKeys![0];
          value = key === 'T' || key === 'true' ? true : key === 'F' || key === 'false' ? false : Boolean(key);
        } else if ((value as AnswerInput).value !== undefined) {
          value = (value as AnswerInput).value as any;
        } else if ((value as AnswerInput).optionKey !== undefined) {
          const key = (value as AnswerInput).optionKey;
          value = key === 'T' ? true : key === 'F' ? false : key;
        }
      }
      const normalized = value === true || value === 'true' || value === 'T' || value === 1 || value === '1' || value === '正确';
      const expectedValue = answer.value === true || answer.value === 'true';
      return { correct: normalized === expectedValue, normalized: String(normalized), expected: String(expectedValue) };
    }
    case 'NUMBER':
    case 'FRACTION': {
      const actual = asNumber(submitted as any);
      const tolerance = Math.max(0, Number(answer.tolerance) || 0);
      if (actual === null) return { correct: false, normalized: String(submitted ?? ''), expected };
      const candidates = equivalentValues(answer);
      const correct = candidates.some((candidate) => {
        if (tolerance > 0) return Math.abs(actual - candidate) <= tolerance + 1e-9;
        return Math.abs(actual - candidate) <= 1e-9;
      });
      return { correct, normalized: String(actual), expected };
    }
    case 'TEXT': {
      const raw = submitted && typeof submitted === 'object' && 'value' in (submitted as any)
        ? (submitted as any).value
        : submitted;
      const normalized = normalizeText(raw);
      const accepted = [answer.value, ...(Array.isArray(answer.equivalent) ? answer.equivalent : [])]
        .map((item) => normalizeText(item))
        .filter(Boolean);
      return { correct: accepted.includes(normalized), normalized, expected: accepted[0] || '' };
    }
    default:
      return { correct: false, normalized: String(submitted ?? ''), expected };
  }
}

export function answerLabel(content: QuestionContent, answer: QuestionAnswer): string {
  if (answer.kind === 'SINGLE' || answer.kind === 'MULTI' || answer.kind === 'JUDGE') {
    const keys = Array.isArray(answer.value) ? answer.value.map(String) : [String(answer.value)];
    const labels = keys.map((key) => {
      const option = content.options.find((item) => item.key === key);
      return option ? option.text.zh : key;
    });
    return labels.join('、');
  }
  if (answer.kind === 'NUMBER' && content.unit) return `${answer.value} ${content.unit.zh}`;
  return String(answer.value);
}

export { normalizeText, parseNumeric };
