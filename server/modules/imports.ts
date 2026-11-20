import type { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes } from 'node:crypto';
import ExcelJS from 'exceljs';
import { all, get, json, now, run, transaction } from '../lib/db.ts';
import { audit } from '../lib/auth.ts';
import { HttpError } from '../lib/http.ts';
import { parseNumeric } from '../lib/judge.ts';
import type { AuthUser } from '../lib/http.ts';
import type { QuestionAnswer, QuestionContent, QuestionType } from '../lib/types.ts';
import { createQuestionRecord } from './admin.ts';

const MAX_ROWS = 1000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

interface ImportError {
  sheet: string;
  row: number;
  field: string;
  message: string;
}

interface ImportWarning {
  sheet: string;
  row: number;
  message: string;
}

interface NormalizedKnowledge {
  row: number;
  code: string;
  name: string;
  nameEn: string;
  grade: number;
  term: string;
  textbook: string;
  domain: string;
  unitCode: string;
  unitName: string;
  unitNameEn: string;
  parentCode: string | null;
  prerequisites: string[];
  difficulty: number;
  status: string;
}

interface NormalizedQuestion {
  row: number;
  code: string;
  knowledgeCode: string;
  type: QuestionType;
  difficulty: number;
  content: QuestionContent;
  answer: QuestionAnswer;
  source: string;
  status: string;
}

interface Preview {
  knowledge: NormalizedKnowledge[];
  questions: NormalizedQuestion[];
  errors: ImportError[];
  warnings: ImportWarning[];
  stats: {
    files: number;
    knowledgeRows: number;
    questionRows: number;
    validKnowledge: number;
    validQuestions: number;
    byType: Record<string, number>;
  };
}

function id(prefix = '') {
  return `${prefix}${randomBytes(10).toString('hex')}`;
}

export function parseCsv(text: string): string[][] {
  const input = String(text || '').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char === '\r') {
      if (input[index + 1] === '\n') continue;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((line) => line.some((cell) => String(cell).trim() !== ''));
}

function normalizeHeader(value: string): string {
  const key = String(value || '').trim().toLowerCase().replace(/\s+/g, '_').replace(/[（）()]/g, '');
  const aliases: Record<string, string> = {
    '题目编码': 'question_code',
    '知识点编码': 'knowledge_code',
    '题型': 'question_type',
    '难度': 'difficulty',
    '题干': 'stem',
    '解析': 'explanation',
    '提示1': 'hint_1',
    '提示2': 'hint_2',
    '选项key': 'option_key',
    '选项内容': 'content',
    '是否正确': 'is_correct',
    '标准答案': 'answer_value',
    '等价答案': 'equivalent_answers',
    '单位': 'unit',
    '容差': 'tolerance',
    '学科编码': 'subject_code',
    '教材版本': 'textbook_version',
    '年级': 'grade',
    '学期': 'term',
    '单元编码': 'unit_code',
    '名称': 'name',
    '父级编码': 'parent_code',
    '前置知识点': 'prerequisite_codes',
    '来源': 'source',
    '状态': 'status',
  };
  return aliases[key] || key;
}

function rowsToObjects(rows: string[][]): Record<string, string>[] {
  if (!rows.length) return [];
  const headers = rows[0].map(normalizeHeader);
  return rows.slice(1).map((line) => {
    const object: Record<string, string> = {};
    headers.forEach((header, index) => {
      if (!header) return;
      object[header] = String(line[index] ?? '').trim();
    });
    return object;
  });
}

function toBool(value: string): boolean {
  return ['true', 'yes', '1', '对', '正确', '是', 'y'].includes(String(value || '').trim().toLowerCase());
}

function cleanText(value: string): string {
  return String(value || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

function questionType(value: string): QuestionType {
  const type = String(value || '').trim().toUpperCase().replace(/[\s-]+/g, '_');
  const map: Record<string, QuestionType> = {
    SINGLE: 'SINGLE',
    CHOICE: 'SINGLE',
    SINGLE_CHOICE: 'SINGLE',
    MULTI: 'MULTI',
    MULTIPLE_CHOICE: 'MULTI',
    JUDGE: 'JUDGE',
    TRUE_FALSE: 'JUDGE',
    BOOLEAN: 'JUDGE',
    NUMBER: 'NUMBER',
    FRACTION: 'FRACTION',
    TEXT: 'TEXT',
    FILL: 'TEXT',
  };
  return map[type] || 'SINGLE';
}

function detectDomain(code: string): string {
  const upper = String(code || '').toUpperCase();
  if (upper.includes('FRAC')) return 'fractions';
  if (upper.includes('GEO')) return 'geometry';
  if (upper.includes('DATA')) return 'data';
  return 'numbers';
}

export async function parseImportPayload(body: any): Promise<{ sheets: Record<string, Record<string, string>[]>; filename: string; hash: string }> {
  const filename = String(body.filename || 'import.csv').slice(0, 120);
  let bytes: Buffer;
  if (body.base64) {
    try {
      bytes = Buffer.from(String(body.base64), 'base64');
    } catch {
      throw new HttpError(400, 'INVALID_FILE', 'The uploaded file could not be decoded');
    }
  } else {
    bytes = Buffer.from(String(body.text || ''), 'utf8');
  }
  if (!bytes.length) throw new HttpError(400, 'EMPTY_FILE', 'The uploaded file is empty');
  if (bytes.length > MAX_FILE_BYTES) throw new HttpError(413, 'FILE_TOO_LARGE', 'The import file must be smaller than 8 MB');
  const hash = createHash('sha256').update(bytes).digest('hex');
  const lower = filename.toLowerCase();
  const sheets: Record<string, Record<string, string>[]> = {};
  if (lower.endsWith('.xlsx')) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(bytes);
    for (const worksheet of workbook.worksheets) {
      const name = normalizeHeader(worksheet.name);
      const rows: string[][] = [];
      worksheet.eachRow({ includeEmpty: false }, (row) => {
        const values: string[] = [];
        row.eachCell({ includeEmpty: true }, (cell) => {
          const value = cell.value;
          if (value == null) values.push('');
          else if (typeof value === 'object' && 'text' in (value as any)) values.push(String((value as any).text));
          else if (typeof value === 'object' && 'result' in (value as any)) values.push(String((value as any).result));
          else values.push(String(value));
        });
        rows.push(values);
      });
      const key = name.includes('knowledge') ? 'knowledge_points'
        : name.includes('option') ? 'question_options'
          : name.includes('answer') ? 'question_answers'
            : name.includes('guide') ? 'import_guide'
              : 'questions';
      if (!sheets[key]) sheets[key] = rowsToObjects(rows);
    }
  } else if (lower.endsWith('.csv')) {
    const rows = parseCsv(bytes.toString('utf8'));
    if (!rows.length) throw new HttpError(400, 'EMPTY_FILE', 'The CSV file has no rows');
    const headers = rows[0].map(normalizeHeader);
    const objectRows = rowsToObjects(rows);
    const isKnowledge = headers.includes('subject_code') && headers.includes('unit_code') && !headers.includes('question_code');
    if (isKnowledge) sheets.knowledge_points = objectRows;
    else sheets.questions = objectRows;
    if (headers.includes('option_a') || headers.includes('correct_option')) {
      sheets.questions = sheets.questions || objectRows;
    }
  } else {
    throw new HttpError(400, 'UNSUPPORTED_FILE', 'Only .xlsx and .csv files are supported');
  }
  return { sheets, filename, hash };
}

export function validateImport(db: DatabaseSync, sheets: Record<string, Record<string, string>[]>): Preview {
  const errors: ImportError[] = [];
  const warnings: ImportWarning[] = [];
  const knowledge: NormalizedKnowledge[] = [];
  const questions: NormalizedQuestion[] = [];
  const fileKnowledgeCodes = new Set<string>();
  const questionCodes = new Set<string>();

  const knowledgeRows = sheets.knowledge_points || [];
  const questionRows = sheets.questions || [];
  const optionRows = sheets.question_options || [];
  const answerRows = sheets.question_answers || [];

  if (!questionRows.length && !knowledgeRows.length) {
    errors.push({ sheet: 'import', row: 0, field: 'file', message: 'The file has no questions or knowledge points sheet' });
  }
  if (knowledgeRows.length + questionRows.length > MAX_ROWS) {
    errors.push({ sheet: 'import', row: 0, field: 'rows', message: `A single import is limited to ${MAX_ROWS} rows` });
  }

  knowledgeRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const code = String(row.code || '').trim();
    if (!code) {
      errors.push({ sheet: 'knowledge_points', row: rowNumber, field: 'code', message: 'Knowledge point code is required' });
      return;
    }
    if (fileKnowledgeCodes.has(code)) {
      errors.push({ sheet: 'knowledge_points', row: rowNumber, field: 'code', message: `Duplicate knowledge point code in this file: ${code}` });
      return;
    }
    fileKnowledgeCodes.add(code);
    const grade = Number(row.grade || 4);
    if (!Number.isInteger(grade) || grade < 1 || grade > 6) {
      errors.push({ sheet: 'knowledge_points', row: rowNumber, field: 'grade', message: 'Grade must be 1–6' });
      return;
    }
    const name = cleanText(row.name);
    if (!name) {
      errors.push({ sheet: 'knowledge_points', row: rowNumber, field: 'name', message: 'Knowledge point name is required' });
      return;
    }
    knowledge.push({
      row: rowNumber,
      code,
      name,
      nameEn: cleanText(row.name_en) || name,
      grade,
      term: String(row.term || 'T1').trim(),
      textbook: String(row.textbook_version || row.textbook || 'RJ').trim(),
      domain: String(row.domain || detectDomain(code)),
      unitCode: String(row.unit_code || `G${grade}-${detectDomain(code).slice(0, 4).toUpperCase()}`),
      unitName: cleanText(row.unit_name) || '导入单元',
      unitNameEn: cleanText(row.unit_name_en) || 'Imported unit',
      parentCode: row.parent_code ? String(row.parent_code).trim() : null,
      prerequisites: String(row.prerequisite_codes || '').split(/[,;，；]/).map((item) => item.trim()).filter(Boolean),
      difficulty: Math.min(5, Math.max(1, Number(row.difficulty || 1))),
      status: ['active', 'inactive'].includes(String(row.status || '').toLowerCase()) ? String(row.status).toLowerCase() : 'active',
    });
  });

  const optionsByQuestion = new Map<string, Record<string, string>[]>();
  optionRows.forEach((row, index) => {
    const code = String(row.question_code || '').trim();
    if (!code) {
      errors.push({ sheet: 'question_options', row: index + 2, field: 'question_code', message: 'Option rows need a question_code' });
      return;
    }
    if (!optionsByQuestion.has(code)) optionsByQuestion.set(code, []);
    optionsByQuestion.get(code)!.push(row);
  });
  const answerByQuestion = new Map<string, Record<string, string>>();
  answerRows.forEach((row, index) => {
    const code = String(row.question_code || '').trim();
    if (!code) {
      errors.push({ sheet: 'question_answers', row: index + 2, field: 'question_code', message: 'Answer rows need a question_code' });
      return;
    }
    answerByQuestion.set(code, row);
  });

  questionRows.forEach((row, index) => {
    const rowNumber = index + 2;
    const code = String(row.question_code || '').trim();
    if (!code) {
      errors.push({ sheet: 'questions', row: rowNumber, field: 'question_code', message: 'Question code is required' });
      return;
    }
    if (questionCodes.has(code)) {
      errors.push({ sheet: 'questions', row: rowNumber, field: 'question_code', message: `Duplicate question code in this file: ${code}` });
      return;
    }
    questionCodes.add(code);
    if (get<any>(db, 'SELECT 1 AS ok FROM questions WHERE code = ?', code)) {
      errors.push({ sheet: 'questions', row: rowNumber, field: 'question_code', message: `Question code already exists in the bank: ${code}` });
      return;
    }
    const knowledgeCode = String(row.knowledge_code || '').trim();
    const knowledgeExists = Boolean(get<any>(db, 'SELECT 1 AS ok FROM knowledge_points WHERE code = ?', knowledgeCode));
    if (!knowledgeCode || (!knowledgeExists && !fileKnowledgeCodes.has(knowledgeCode))) {
      errors.push({ sheet: 'questions', row: rowNumber, field: 'knowledge_code', message: `Knowledge point does not exist: ${knowledgeCode || '(empty)'}` });
      return;
    }
    const type = questionType(row.question_type);
    const difficulty = Math.min(5, Math.max(1, Number(row.difficulty || 1)));
    const stem = cleanText(row.stem);
    if (!stem) {
      errors.push({ sheet: 'questions', row: rowNumber, field: 'stem', message: 'Question stem is required' });
      return;
    }
    const stemEn = cleanText(row.stem_en) || stem;
    const explanation = cleanText(row.explanation) || `正确答案见答案字段。`;
    const explanationEn = cleanText(row.explanation_en) || explanation;
    const hints = [cleanText(row.hint_1), cleanText(row.hint_2)].filter(Boolean).map((text) => ({ zh: text, en: text }));
    const hintsEn = [cleanText(row.hint_1_en), cleanText(row.hint_2_en)].filter(Boolean);
    hints.forEach((hint, hintIndex) => {
      if (hintsEn[hintIndex]) hint.en = hintsEn[hintIndex];
    });
    const media = String(row.media_url || row.formula || '').split(/[,;，；]/).map((item) => item.trim()).filter(Boolean);

    let options: any[] = [];
    if (type === 'SINGLE' || type === 'MULTI') {
      const fromSheet = optionsByQuestion.get(code) || [];
      if (fromSheet.length) {
        options = fromSheet
          .sort((a, b) => Number(a.sort || 0) - Number(b.sort || 0))
          .map((option, optionIndex) => ({
            key: String(option.option_key || String.fromCharCode(65 + optionIndex)).toUpperCase(),
            text: { zh: cleanText(option.content) || `选项 ${optionIndex + 1}`, en: cleanText(option.content_en) || cleanText(option.content) || `Option ${optionIndex + 1}` },
            correct: toBool(option.is_correct),
          }));
      } else {
        for (const letter of ['a', 'b', 'c', 'd', 'e', 'f']) {
          const text = cleanText(row[`option_${letter}`]);
          if (!text) continue;
          options.push({
            key: letter.toUpperCase(),
            text: { zh: text, en: cleanText(row[`option_${letter}_en`]) || text },
            correct: String(row.correct_option || '').toUpperCase().split(/[,;，；]/).map((item) => item.trim()).includes(letter.toUpperCase()),
          });
        }
      }
      if (options.length < 2) {
        errors.push({ sheet: 'questions', row: rowNumber, field: 'options', message: 'Choice questions need at least two options' });
        return;
      }
      const correctCount = options.filter((option) => option.correct).length;
      if (type === 'SINGLE' && correctCount !== 1) {
        errors.push({ sheet: 'questions', row: rowNumber, field: 'is_correct', message: 'Single-choice questions need exactly one correct option' });
        return;
      }
      if (type === 'MULTI' && correctCount < 1) {
        errors.push({ sheet: 'questions', row: rowNumber, field: 'is_correct', message: 'Multiple-choice questions need at least one correct option' });
        return;
      }
    }

    const answerRow = answerByQuestion.get(code);
    const rawAnswer = String(answerRow?.answer_value || row.answer_value || '').trim();
    const equivalent = String(answerRow?.equivalent_answers || row.equivalent_answers || '').split(/[,;，；]/).map((item) => item.trim()).filter(Boolean);
    const unit = answerRow?.unit || row.unit ? { zh: String(answerRow?.unit || row.unit), en: String(answerRow?.unit_en || answerRow?.unit || row.unit) } : undefined;
    let answer: QuestionAnswer;
    if (type === 'SINGLE') {
      const correct = options.find((option) => option.correct);
      answer = { kind: 'SINGLE', value: correct!.key };
    } else if (type === 'MULTI') {
      answer = { kind: 'MULTI', value: options.filter((option) => option.correct).map((option) => option.key) };
    } else if (type === 'JUDGE') {
      if (!rawAnswer) {
        errors.push({ sheet: 'questions', row: rowNumber, field: 'answer_value', message: 'Judge questions need TRUE or FALSE in answer_value' });
        return;
      }
      answer = { kind: 'JUDGE', value: toBool(rawAnswer) };
    } else if (type === 'NUMBER' || type === 'FRACTION') {
      if (!rawAnswer || parseNumeric(rawAnswer) === null) {
        errors.push({ sheet: 'questions', row: rowNumber, field: 'answer_value', message: 'Numeric and fraction questions need a valid answer_value' });
        return;
      }
      if (type === 'FRACTION' && !/^[-+]?\d+\/\d+$/.test(rawAnswer)) {
        errors.push({ sheet: 'questions', row: rowNumber, field: 'answer_value', message: 'Fraction answers must use the form a/b' });
        return;
      }
      answer = {
        kind: type,
        value: rawAnswer,
        tolerance: Math.max(0, Math.min(1, Number(answerRow?.tolerance || row.tolerance) || 0)),
        equivalent,
      };
    } else {
      if (!rawAnswer) {
        errors.push({ sheet: 'questions', row: rowNumber, field: 'answer_value', message: 'Text questions need an answer_value' });
        return;
      }
      answer = { kind: 'TEXT', value: rawAnswer, equivalent };
    }
    if (type === 'JUDGE') options = [{ key: 'T', text: { zh: '正确', en: 'True' } }, { key: 'F', text: { zh: '错误', en: 'False' } }];
    const kpRow = get<any>(db, 'SELECT name_zh, name_en FROM knowledge_points WHERE code = ?', knowledgeCode);
    const fileKp = knowledge.find((item) => item.code === knowledgeCode);
    const skill = kpRow
      ? { zh: kpRow.name_zh, en: kpRow.name_en }
      : fileKp
        ? { zh: fileKp.name, en: fileKp.nameEn }
        : { zh: knowledgeCode, en: knowledgeCode };
    const content: QuestionContent = {
      stem: { zh: stem, en: stemEn },
      options: options.map((option) => ({ key: option.key, text: option.text })),
      hints: hints.length ? hints : [{ zh: '先读清题目，再一步步计算。', en: 'Read carefully, then work step by step.' }],
      explanation: { zh: explanation, en: explanationEn },
      skill,
      media,
    };
    const duplicateStem = get<any>(
      db,
      'SELECT 1 AS ok FROM question_versions WHERE content_json LIKE ? LIMIT 1',
      `%${stem.slice(0, 40)}%`,
    );
    if (duplicateStem) warnings.push({ sheet: 'questions', row: rowNumber, message: 'A similar question stem already exists. Review before publishing.' });
    questions.push({
      row: rowNumber,
      code,
      knowledgeCode,
      type,
      difficulty,
      content,
      answer,
      source: String(row.source || 'IMPORT').slice(0, 40),
      status: String(row.status || 'DRAFT').toUpperCase() === 'PENDING_REVIEW' ? 'PENDING_REVIEW' : 'DRAFT',
    });
  });

  const byType: Record<string, number> = {};
  for (const question of questions) byType[question.type] = (byType[question.type] || 0) + 1;
  return {
    knowledge,
    questions,
    errors,
    warnings,
    stats: {
      files: 1,
      knowledgeRows: knowledgeRows.length,
      questionRows: questionRows.length,
      validKnowledge: knowledge.length,
      validQuestions: questions.length,
      byType,
    },
  };
}

export function createBatch(db: DatabaseSync, actor: AuthUser, filename: string, hash: string, preview: Preview) {
  const batchId = id('imp_');
  const createdAt = now();
  run(
    db,
    `INSERT INTO import_batches (id, filename, file_hash, status, total, success, failed, errors_json, warnings_json, preview_json, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
    batchId,
    filename,
    hash,
    'VALIDATED',
    preview.stats.questionRows + preview.stats.knowledgeRows,
    preview.stats.validQuestions,
    preview.errors.length,
    json(preview.errors),
    json(preview.warnings),
    json(preview),
    actor.id,
    createdAt,
  );
  return batchId;
}

export function previewResponse(db: DatabaseSync, batchId: string) {
  const row = get<any>(db, 'SELECT * FROM import_batches WHERE id = ?', batchId);
  if (!row) throw new HttpError(404, 'BATCH_NOT_FOUND', 'Import batch not found');
  const preview = JSON.parse(row.preview_json || '{}');
  return {
    id: row.id,
    filename: row.filename,
    status: row.status,
    total: row.total,
    success: row.success,
    failed: row.failed,
    createdAt: row.created_at,
    committedAt: row.committed_at,
    rolledBackAt: row.rolled_back_at,
    errors: JSON.parse(row.errors_json || '[]').slice(0, 200),
    warnings: JSON.parse(row.warnings_json || '[]').slice(0, 100),
    stats: preview.stats || {},
    sample: {
      knowledge: (preview.knowledge || []).slice(0, 5).map((item: any) => ({ code: item.code, name: item.name, grade: item.grade })),
      questions: (preview.questions || []).slice(0, 10).map((item: any) => ({
        code: item.code,
        type: item.type,
        knowledgeCode: item.knowledgeCode,
        stem: item.content?.stem,
      })),
    },
  };
}

export function commitBatch(db: DatabaseSync, actor: AuthUser, batchId: string, ip: string, requestId: string) {
  const row = get<any>(db, 'SELECT * FROM import_batches WHERE id = ?', batchId);
  if (!row) throw new HttpError(404, 'BATCH_NOT_FOUND', 'Import batch not found');
  if (row.status === 'COMPLETED') return { batchId, status: 'COMPLETED', created: JSON.parse(row.created_question_ids || '[]').length };
  if (row.status !== 'VALIDATED') throw new HttpError(409, 'BATCH_NOT_READY', 'This batch cannot be committed in its current state');
  const preview: Preview = JSON.parse(row.preview_json || '{}');
  const created: string[] = [];
  let success = 0;
  let failed = 0;

  transaction(db, () => {
    for (const item of preview.knowledge || []) {
      if (get<any>(db, 'SELECT 1 AS ok FROM knowledge_points WHERE code = ?', item.code)) continue;
      const nowValue = now();
      run(
        db,
        `INSERT INTO knowledge_points (id, code, subject_code, grade, term, textbook, domain, unit_code, unit_name_zh, unit_name_en,
          name_zh, name_en, parent_code, prerequisite_codes, difficulty, status, sort, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        id('kp_'),
        item.code,
        'MATH',
        item.grade,
        item.term,
        item.textbook,
        item.domain,
        item.unitCode,
        item.unitName,
        item.unitNameEn,
        item.name,
        item.nameEn,
        item.parentCode,
        json(item.prerequisites),
        item.difficulty,
        item.status,
        500,
        nowValue,
        nowValue,
      );
    }
    for (const item of preview.questions || []) {
      try {
        const question = createQuestionRecord(
          db,
          actor,
          {
            knowledgeCode: item.knowledgeCode,
            type: item.type,
            difficulty: item.difficulty,
            source: item.source,
            content: item.content,
            answer: item.answer,
          },
          { status: item.status, batchId, createdBy: actor.id, code: item.code },
        );
        created.push(question.id);
        success += 1;
      } catch {
        failed += 1;
      }
    }
    run(
      db,
      'UPDATE import_batches SET status = ?, success = ?, failed = ?, created_question_ids = ?, committed_at = ? WHERE id = ?',
      'COMPLETED',
      success,
      failed + (preview.errors?.length || 0),
      json(created),
      now(),
      batchId,
    );
  });
  audit(db, actor, 'IMPORT_COMMIT', 'import_batch', batchId, null, { success, failed }, ip, requestId);
  return { batchId, status: 'COMPLETED', created: created.length, success, failed };
}

export function rollbackBatch(db: DatabaseSync, actor: AuthUser, batchId: string, ip: string, requestId: string) {
  const row = get<any>(db, 'SELECT * FROM import_batches WHERE id = ?', batchId);
  if (!row) throw new HttpError(404, 'BATCH_NOT_FOUND', 'Import batch not found');
  if (row.status !== 'COMPLETED') throw new HttpError(409, 'BATCH_NOT_COMMITTED', 'Only committed batches can be rolled back');
  const ids: string[] = JSON.parse(row.created_question_ids || '[]');
  let archived = 0;
  let removed = 0;
  transaction(db, () => {
    for (const questionId of ids) {
      const referenced = get<any>(
        db,
        `SELECT 1 AS ok FROM session_questions WHERE question_id = ? LIMIT 1`,
        questionId,
      ) || get<any>(db, 'SELECT 1 AS ok FROM mistakes WHERE question_id = ? LIMIT 1', questionId);
      if (referenced) {
        run(db, "UPDATE questions SET status = 'ARCHIVED', updated_at = ? WHERE id = ?", now(), questionId);
        archived += 1;
      } else {
        run(db, 'DELETE FROM questions WHERE id = ?', questionId);
        removed += 1;
      }
    }
    run(db, 'UPDATE import_batches SET status = ?, rolled_back_at = ? WHERE id = ?', 'ROLLED_BACK', now(), batchId);
  });
  audit(db, actor, 'IMPORT_ROLLBACK', 'import_batch', batchId, null, { archived, removed }, ip, requestId);
  return { batchId, archived, removed };
}

export function listBatches(db: DatabaseSync) {
  return all<any>(db, 'SELECT id, filename, status, total, success, failed, created_by, created_at, committed_at, rolled_back_at FROM import_batches ORDER BY created_at DESC LIMIT 50');
}

export async function createTemplateXlsx(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Math Realms';
  const knowledge = workbook.addWorksheet('knowledge_points');
  knowledge.addRow(['subject_code', 'textbook_version', 'grade', 'term', 'unit_code', 'code', 'name', 'name_en', 'parent_code', 'prerequisite_codes', 'difficulty', 'status']);
  knowledge.addRow(['MATH', 'RJ', 4, 'T1', 'G4-NUM', 'MATH-RJ-G4-T1-NUM-04', '多位数乘法与因数', 'Multi-digit multiplication and factors', 'MATH-RJ-G4-T1-NUM-03', '', 2, 'active']);
  knowledge.columns.forEach((column) => { column.width = 18; });
  const questions = workbook.addWorksheet('questions');
  questions.addRow(['question_code', 'knowledge_code', 'question_type', 'difficulty', 'stem', 'stem_en', 'hint_1', 'hint_1_en', 'hint_2', 'hint_2_en', 'explanation', 'explanation_en', 'source', 'status', 'formula', 'media_url']);
  questions.addRow(['IMP-MATH-NUM-04-001', 'MATH-RJ-G4-T1-NUM-04', 'SINGLE', 2, '24 × 13 = ?', '24 × 13 = ?', '先算 24×3，再算 24×10。', 'First 24×3, then 24×10.', '把两个结果相加。', 'Add the two results.', '24 × 13 = 312', '24 × 13 = 312', 'IMPORT', 'DRAFT', '', '']);
  questions.addRow(['IMP-MATH-NUM-04-002', 'MATH-RJ-G4-T1-NUM-04', 'NUMBER', 2, '36 × 12 = ?', '36 × 12 = ?', '把 12 拆成 10 和 2。', 'Split 12 into 10 and 2.', '', '', '36 × 12 = 432', '36 × 12 = 432', 'IMPORT', 'DRAFT', '', '']);
  questions.columns.forEach((column) => { column.width = 22; });
  const options = workbook.addWorksheet('question_options');
  options.addRow(['question_code', 'option_key', 'content', 'content_en', 'is_correct', 'sort']);
  options.addRow(['IMP-MATH-NUM-04-001', 'A', '312', '312', 'TRUE', 1]);
  options.addRow(['IMP-MATH-NUM-04-001', 'B', '302', '302', 'FALSE', 2]);
  options.addRow(['IMP-MATH-NUM-04-001', 'C', '412', '412', 'FALSE', 3]);
  options.addRow(['IMP-MATH-NUM-04-001', 'D', '322', '322', 'FALSE', 4]);
  options.columns.forEach((column) => { column.width = 18; });
  const answers = workbook.addWorksheet('question_answers');
  answers.addRow(['question_code', 'answer_value', 'equivalent_answers', 'unit', 'tolerance', 'scoring_rule']);
  answers.addRow(['IMP-MATH-NUM-04-001', 'A', '', '', '0', '']);
  answers.addRow(['IMP-MATH-NUM-04-002', '432', '432.0', '', '0', '']);
  answers.columns.forEach((column) => { column.width = 18; });
  const guide = workbook.addWorksheet('import_guide');
  [
    ['Math Realms question import guide'],
    ['1. Use UTF-8 for CSV. XLSX supports all four sheets.'],
    ['2. knowledge_points creates new knowledge points or links existing ones by code.'],
    ['3. questions, question_options and question_answers are joined by question_code.'],
    ['4. Supported question_type: SINGLE, MULTI, JUDGE, NUMBER, FRACTION, TEXT.'],
    ['5. Imported rows start as DRAFT and must be published before students can see them.'],
    ['6. Do not paste formulas into cells; the importer treats every cell as plain text.'],
  ].forEach((row) => guide.addRow(row));
  guide.getColumn(1).width = 110;
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

export function createTemplateCsv(): string {
  return [
    'question_code,knowledge_code,question_type,difficulty,stem,stem_en,hint_1,explanation,source,status,option_a,option_b,option_c,option_d,correct_option,answer_value',
    'IMP-MATH-NUM-03-101,MATH-RJ-G4-T1-NUM-03,SINGLE,2,"28 × 12 = ?","28 × 12 = ?","先算 28×10 再加 28×2。","28 × 12 = 336",IMPORT,DRAFT,336,326,346,436,A,',
    'IMP-MATH-NUM-03-102,MATH-RJ-G4-T1-NUM-03,NUMBER,2,"45 × 16 = ?","45 × 16 = ?","把 16 拆成 10 和 6。","45 × 16 = 720",IMPORT,DRAFT,,,,,,720',
  ].join('\n');
}
