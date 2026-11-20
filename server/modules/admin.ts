import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { all, get, json, now, parseJson, run } from '../lib/db.ts';
import { audit } from '../lib/auth.ts';
import { HttpError, requireInt, requireString } from '../lib/http.ts';
import { parseNumeric } from '../lib/judge.ts';
import type { AuthUser } from '../lib/http.ts';
import type { Localized, QuestionAnswer, QuestionContent, QuestionType } from '../lib/types.ts';

export const QUESTION_TYPES: QuestionType[] = ['SINGLE', 'JUDGE', 'NUMBER', 'FRACTION', 'MULTI', 'TEXT'];
const STATUSES = ['DRAFT', 'PENDING_REVIEW', 'PUBLISHED', 'REJECTED', 'ARCHIVED'];

function id(prefix = '') {
  return `${prefix}${randomBytes(10).toString('hex')}`;
}

export function localized(value: unknown, field: string): Localized {
  if (!value || typeof value !== 'object') throw new HttpError(400, 'VALIDATION_ERROR', `${field} must contain zh and en text`, { field });
  const zh = String((value as any).zh ?? '').trim();
  const en = String((value as any).en ?? '').trim();
  if (!zh) throw new HttpError(400, 'VALIDATION_ERROR', `${field}.zh is required`, { field });
  return { zh, en: en || zh };
}

function localizedArray(value: unknown, field: string, max = 2): Localized[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be an array`, { field });
  if (value.length > max) throw new HttpError(400, 'VALIDATION_ERROR', `${field} can have at most ${max} items`, { field });
  return value.map((item, index) => localized(item, `${field}[${index}]`)).filter((item) => item.zh);
}

export function validateQuestionInput(db: DatabaseSync, body: any) {
  const knowledgeCode = requireString(body.knowledgeCode, 'knowledgeCode', { max: 80 });
  if (!get<any>(db, 'SELECT 1 AS ok FROM knowledge_points WHERE code = ?', knowledgeCode)) {
    throw new HttpError(400, 'UNKNOWN_KNOWLEDGE', 'The selected knowledge point does not exist', { knowledgeCode });
  }
  const type = String(body.type || '').toUpperCase() as QuestionType;
  if (!QUESTION_TYPES.includes(type)) throw new HttpError(400, 'INVALID_TYPE', 'Unsupported question type', { type });
  const difficulty = requireInt(body.difficulty ?? 1, 'difficulty', { min: 1, max: 5 });
  const stem = localized(body.stem, 'stem');
  const skillInput = body.skill ? localized(body.skill, 'skill') : { zh: '', en: '' };
  const explanation = localized(body.explanation ?? { zh: stem.zh, en: stem.en }, 'explanation');
  const hints = localizedArray(body.hints, 'hints', 2);
  const unit = body.unit ? localized(body.unit, 'unit') : undefined;
  const optionsInput = Array.isArray(body.options) ? body.options : [];
  const options = optionsInput.map((option: any, index: number) => {
    const key = String(option.key || String.fromCharCode(65 + index)).trim().toUpperCase();
    if (!/^[A-Z]$/.test(key)) throw new HttpError(400, 'INVALID_OPTION_KEY', 'Option keys must be A–Z');
    return { key, text: localized(option.text, `options[${index}].text`) };
  });
  if (new Set(options.map((option: any) => option.key)).size !== options.length) {
    throw new HttpError(400, 'DUPLICATE_OPTION_KEY', 'Option keys must be unique');
  }

  let answer: QuestionAnswer;
  if (type === 'SINGLE') {
    if (options.length < 2) throw new HttpError(400, 'OPTIONS_REQUIRED', 'Single-choice questions need at least two options');
    const value = String(body.answer?.value ?? body.answer?.optionKey ?? '').toUpperCase();
    if (!options.some((option: any) => option.key === value)) throw new HttpError(400, 'INVALID_ANSWER', 'The answer key must match an option');
    answer = { kind: type, value };
  } else if (type === 'MULTI') {
    if (options.length < 2) throw new HttpError(400, 'OPTIONS_REQUIRED', 'Multiple-choice questions need at least two options');
    const values = Array.isArray(body.answer?.value) ? body.answer.value.map((item: unknown) => String(item).toUpperCase()) : [];
    if (!values.length) throw new HttpError(400, 'INVALID_ANSWER', 'Choose at least one correct option');
    for (const value of values) {
      if (!options.some((option: any) => option.key === value)) throw new HttpError(400, 'INVALID_ANSWER', 'Every answer key must match an option');
    }
    answer = { kind: type, value: [...new Set(values)] };
  } else if (type === 'JUDGE') {
    const raw = body.answer?.value;
    if (typeof raw !== 'boolean') throw new HttpError(400, 'INVALID_ANSWER', 'Judge answers must be true or false');
    answer = { kind: type, value: raw };
    return {
      knowledgeCode,
      type,
      difficulty,
      source: String(body.source || 'MANUAL').slice(0, 40),
      content: {
        stem,
        options: [
          { key: 'T', text: { zh: '正确', en: 'True' } },
          { key: 'F', text: { zh: '错误', en: 'False' } },
        ],
        hints,
        explanation,
        skill: skillInput.zh ? skillInput : { zh: '自定义题目', en: 'Custom question' },
        unit,
        media: [],
      } as QuestionContent,
      answer,
    };
  } else {
    if (type === 'NUMBER' || type === 'FRACTION') {
      const raw = body.answer?.value;
      const expected = type === 'FRACTION' && typeof raw === 'object' && raw?.numerator !== undefined
        ? `${raw.numerator}/${raw.denominator}`
        : String(raw ?? '');
      if (parseNumeric(expected) === null) throw new HttpError(400, 'INVALID_ANSWER', 'Numeric answers must be a number, fraction or decimal');
      if (type === 'FRACTION' && !/^[-+]?\d+\/\d+$/.test(expected.trim())) {
        throw new HttpError(400, 'INVALID_ANSWER', 'Fraction answers must use the form a/b');
      }
      const tolerance = Math.max(0, Math.min(1, Number(body.answer?.tolerance) || 0));
      const equivalent = Array.isArray(body.answer?.equivalent) ? body.answer.equivalent.map(String) : [];
      answer = { kind: type, value: expected.trim(), tolerance, equivalent };
    } else {
      const expected = String(body.answer?.value ?? '').trim();
      if (!expected) throw new HttpError(400, 'INVALID_ANSWER', 'A text answer is required');
      answer = { kind: 'TEXT', value: expected, equivalent: Array.isArray(body.answer?.equivalent) ? body.answer.equivalent.map(String) : [] };
    }
    return {
      knowledgeCode,
      type,
      difficulty,
      source: String(body.source || 'MANUAL').slice(0, 40),
      content: {
        stem,
        options: [],
        hints,
        explanation,
        skill: skillInput.zh ? skillInput : { zh: '自定义题目', en: 'Custom question' },
        unit,
        media: [],
      } as QuestionContent,
      answer,
    };
  }

  return {
    knowledgeCode,
    type,
    difficulty,
    source: String(body.source || 'MANUAL').slice(0, 40),
    content: {
      stem,
      options,
      hints,
      explanation,
      skill: skillInput.zh ? skillInput : { zh: '自定义题目', en: 'Custom question' },
      unit,
      media: [],
    } as QuestionContent,
    answer,
  };
}

export function createQuestionRecord(
  db: DatabaseSync,
  actor: AuthUser,
  input: { knowledgeCode: string; type: string; difficulty: number; source: string; content: QuestionContent; answer: QuestionAnswer },
  options: { status?: string; batchId?: string | null; code?: string; createdBy?: string } = {},
) {
  const questionId = id('q_');
  const code = options.code || `Q-${Date.now().toString(36).toUpperCase()}-${randomBytes(2).toString('hex').toUpperCase()}`;
  if (get<any>(db, 'SELECT 1 AS ok FROM questions WHERE code = ?', code)) {
    throw new HttpError(409, 'DUPLICATE_CODE', 'A question with that code already exists', { code });
  }
  const status = options.status || 'DRAFT';
  const createdAt = now();
  run(
    db,
    `INSERT INTO questions (id, code, knowledge_code, type, difficulty, status, source, batch_id, created_by, created_at, updated_at, published_at, current_version)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    questionId,
    code,
    input.knowledgeCode,
    input.type,
    input.difficulty,
    status,
    input.source,
    options.batchId || null,
    options.createdBy || actor.id,
    createdAt,
    createdAt,
    status === 'PUBLISHED' ? createdAt : null,
    1,
  );
  run(
    db,
    `INSERT INTO question_versions (id, question_id, version, content_json, answer_json, review_json, created_by, created_at, note)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id('qv_'),
    questionId,
    1,
    json(input.content),
    json(input.answer),
    json({ source: input.source }),
    options.createdBy || actor.id,
    createdAt,
    'initial version',
  );
  run(db, 'INSERT INTO question_stats (question_id) VALUES (?)', questionId);
  return { id: questionId, code, status };
}

export function listQuestions(db: DatabaseSync, query: URLSearchParams) {
  const where: string[] = ['1=1'];
  const params: any[] = [];
  const status = query.get('status');
  if (status && STATUSES.includes(status)) {
    where.push('q.status = ?');
    params.push(status);
  }
  const type = query.get('type');
  if (type) {
    where.push('q.type = ?');
    params.push(type);
  }
  const knowledge = query.get('knowledgeCode');
  if (knowledge) {
    where.push('q.knowledge_code = ?');
    params.push(knowledge);
  }
  const source = query.get('source');
  if (source) {
    where.push('q.source = ?');
    params.push(source);
  }
  const search = String(query.get('search') || '').trim();
  if (search) {
    where.push('(qv.content_json LIKE ? OR q.code LIKE ?)');
    params.push(`%${search}%`, `%${search}%`);
  }
  const grade = query.get('grade');
  if (grade) {
    where.push('k.grade = ?');
    params.push(Number(grade));
  }
  const limit = Math.min(100, Math.max(1, Number(query.get('limit')) || 20));
  const offset = Math.max(0, Number(query.get('offset')) || 0);
  const rows = all<any>(
    db,
    `SELECT q.*, qv.content_json, qv.answer_json, k.name_zh AS kp_name_zh, k.name_en AS kp_name_en, k.grade,
            COALESCE(s.exposures,0) AS exposures, COALESCE(s.correct,0) AS correct_count, COALESCE(s.total_ms,0) AS total_ms,
            COALESCE(s.hints,0) AS hints
     FROM questions q
     LEFT JOIN question_versions qv ON qv.question_id = q.id AND qv.version = q.current_version
     LEFT JOIN knowledge_points k ON k.code = q.knowledge_code
     LEFT JOIN question_stats s ON s.question_id = q.id
     WHERE ${where.join(' AND ')}
     ORDER BY q.updated_at DESC LIMIT ? OFFSET ?`,
    ...params,
    limit,
    offset,
  );
  const total = get<any>(
    db,
    `SELECT COUNT(*) AS count FROM questions q
     LEFT JOIN question_versions qv ON qv.question_id = q.id AND qv.version = q.current_version
     LEFT JOIN knowledge_points k ON k.code = q.knowledge_code
     WHERE ${where.join(' AND ')}`,
    ...params,
  )?.count || 0;
  return {
    total,
    limit,
    offset,
    items: rows.map((row) => {
      const content = parseJson<any>(row.content_json, {});
      return {
        id: row.id,
        code: row.code,
        knowledgeCode: row.knowledge_code,
        knowledgeName: { zh: row.kp_name_zh, en: row.kp_name_en },
        grade: row.grade,
        type: row.type,
        difficulty: row.difficulty,
        status: row.status,
        source: row.source,
        batchId: row.batch_id,
        currentVersion: row.current_version,
        stem: content.stem,
        options: content.options || [],
        updatedAt: row.updated_at,
        publishedAt: row.published_at,
        stats: {
          exposures: row.exposures,
          correct: row.correct_count,
          accuracy: row.exposures ? Math.round((row.correct_count / row.exposures) * 100) : 0,
          avgMs: row.exposures ? Math.round(row.total_ms / row.exposures) : 0,
          hints: row.hints,
        },
      };
    }),
  };
}

export function getQuestion(db: DatabaseSync, questionId: string) {
  const row = get<any>(db, 'SELECT * FROM questions WHERE id = ?', questionId);
  if (!row) throw new HttpError(404, 'QUESTION_NOT_FOUND', 'Question not found');
  const version = get<any>(db, 'SELECT * FROM question_versions WHERE question_id = ? AND version = ?', questionId, row.current_version);
  const versions = all<any>(
    db,
    'SELECT id, version, created_at, created_by, note FROM question_versions WHERE question_id = ? ORDER BY version DESC',
    questionId,
  );
  return {
    id: row.id,
    code: row.code,
    knowledgeCode: row.knowledge_code,
    type: row.type,
    difficulty: row.difficulty,
    status: row.status,
    source: row.source,
    batchId: row.batch_id,
    currentVersion: row.current_version,
    content: parseJson(version?.content_json, {}),
    answer: parseJson(version?.answer_json, {}),
    versions,
    history: versions.map((item) => ({ ...item })),
  };
}

export function updateQuestion(db: DatabaseSync, actor: AuthUser, questionId: string, body: any) {
  const row = get<any>(db, 'SELECT * FROM questions WHERE id = ?', questionId);
  if (!row) throw new HttpError(404, 'QUESTION_NOT_FOUND', 'Question not found');
  const input = validateQuestionInput(db, { ...body, knowledgeCode: body.knowledgeCode || row.knowledge_code });
  const version = Number(row.current_version) + 1;
  const nextStatus = row.status === 'PUBLISHED' ? 'PUBLISHED' : 'DRAFT';
  run(
    db,
    'UPDATE questions SET knowledge_code = ?, type = ?, difficulty = ?, status = ?, source = ?, updated_at = ?, current_version = ?, published_at = CASE WHEN ? = \'PUBLISHED\' THEN published_at ELSE NULL END WHERE id = ?',
    input.knowledgeCode,
    input.type,
    input.difficulty,
    nextStatus,
    input.source,
    now(),
    version,
    nextStatus,
    questionId,
  );
  run(
    db,
    `INSERT INTO question_versions (id, question_id, version, content_json, answer_json, review_json, created_by, created_at, note)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    id('qv_'),
    questionId,
    version,
    json(input.content),
    json(input.answer),
    json({ edited: true }),
    actor.id,
    now(),
    'edited version',
  );
  audit(db, actor, 'QUESTION_UPDATE', 'question', questionId, { version: row.current_version, status: row.status }, { version, status: nextStatus });
  return { id: questionId, version, status: nextStatus };
}

export function changeQuestionStatus(db: DatabaseSync, actor: AuthUser, questionId: string, body: any) {
  const row = get<any>(db, 'SELECT * FROM questions WHERE id = ?', questionId);
  if (!row) throw new HttpError(404, 'QUESTION_NOT_FOUND', 'Question not found');
  const action = String(body.action || 'publish');
  let status = 'PUBLISHED';
  if (action === 'unpublish') status = 'ARCHIVED';
  else if (action === 'review') status = 'PENDING_REVIEW';
  else if (action === 'reject') status = 'REJECTED';
  else if (action !== 'publish') throw new HttpError(400, 'INVALID_ACTION', 'Unsupported action');
  if (status === 'PUBLISHED') {
    const version = get<any>(db, 'SELECT * FROM question_versions WHERE question_id = ? AND version = ?', questionId, row.current_version);
    if (!version) throw new HttpError(409, 'NO_VERSION', 'Question has no content version to publish');
  }
  run(
    db,
    'UPDATE questions SET status = ?, updated_at = ?, published_at = CASE WHEN ? = \'PUBLISHED\' THEN COALESCE(published_at, ?) ELSE published_at END WHERE id = ?',
    status,
    now(),
    status,
    now(),
    questionId,
  );
  audit(db, actor, 'QUESTION_STATUS', 'question', questionId, { status: row.status }, { status });
  return { id: questionId, status };
}

export function listKnowledge(db: DatabaseSync, query: URLSearchParams) {
  const grade = Number(query.get('grade') || 4);
  return all<any>(
    db,
    `SELECT * FROM knowledge_points WHERE grade = ? ORDER BY sort`,
    grade,
  ).map((row) => ({
    code: row.code,
    grade: row.grade,
    term: row.term,
    domain: row.domain,
    unitCode: row.unit_code,
    name: { zh: row.name_zh, en: row.name_en },
    unitName: { zh: row.unit_name_zh, en: row.unit_name_en },
    parentCode: row.parent_code,
    prerequisites: parseJson(row.prerequisite_codes, []),
    difficulty: row.difficulty,
    status: row.status,
    sort: row.sort,
  }));
}

export function createKnowledge(db: DatabaseSync, actor: AuthUser, body: any) {
  const code = requireString(body.code, 'code', { max: 80, pattern: /^[A-Z0-9-]+$/ });
  if (get<any>(db, 'SELECT 1 AS ok FROM knowledge_points WHERE code = ?', code)) {
    throw new HttpError(409, 'DUPLICATE_CODE', 'Knowledge point code already exists');
  }
  const grade = requireInt(body.grade, 'grade', { min: 1, max: 6 });
  const domain = requireString(body.domain, 'domain', { max: 20 });
  const name = localized(body.name, 'name');
  const unitName = body.unitName ? localized(body.unitName, 'unitName') : { zh: '自定义单元', en: 'Custom unit' };
  const nowValue = now();
  run(
    db,
    `INSERT INTO knowledge_points (id, code, subject_code, grade, term, textbook, domain, unit_code, unit_name_zh, unit_name_en,
      name_zh, name_en, parent_code, prerequisite_codes, difficulty, status, sort, created_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    id('kp_'),
    code,
    'MATH',
    grade,
    String(body.term || 'T1'),
    String(body.textbook || 'RJ'),
    domain,
    String(body.unitCode || `G${grade}-${domain.slice(0, 4).toUpperCase()}`),
    unitName.zh,
    unitName.en,
    name.zh,
    name.en,
    body.parentCode ? String(body.parentCode) : null,
    json(Array.isArray(body.prerequisites) ? body.prerequisites.map(String) : []),
    requireInt(body.difficulty ?? 1, 'difficulty', { min: 1, max: 5 }),
    'active',
    Number(body.sort) || 999,
    nowValue,
    nowValue,
  );
  audit(db, actor, 'KNOWLEDGE_CREATE', 'knowledge_point', code, null, { grade, domain, name });
  return { code };
}

export function updateKnowledge(db: DatabaseSync, actor: AuthUser, code: string, body: any) {
  const row = get<any>(db, 'SELECT * FROM knowledge_points WHERE code = ?', code);
  if (!row) throw new HttpError(404, 'KNOWLEDGE_NOT_FOUND', 'Knowledge point not found');
  const name = body.name ? localized(body.name, 'name') : { zh: row.name_zh, en: row.name_en };
  const unitName = body.unitName ? localized(body.unitName, 'unitName') : { zh: row.unit_name_zh, en: row.unit_name_en };
  const status = ['active', 'inactive'].includes(body.status) ? body.status : row.status;
  run(
    db,
    'UPDATE knowledge_points SET name_zh = ?, name_en = ?, unit_name_zh = ?, unit_name_en = ?, difficulty = ?, status = ?, updated_at = ? WHERE code = ?',
    name.zh,
    name.en,
    unitName.zh,
    unitName.en,
    requireInt(body.difficulty ?? row.difficulty, 'difficulty', { min: 1, max: 5 }),
    status,
    now(),
    code,
  );
  audit(db, actor, 'KNOWLEDGE_UPDATE', 'knowledge_point', code, { name: { zh: row.name_zh, en: row.name_en }, status: row.status }, { name, status });
  return { code };
}

export function dashboard(db: DatabaseSync) {
  const counts = {
    questions: get<any>(db, 'SELECT COUNT(*) AS n FROM questions')?.n || 0,
    published: get<any>(db, "SELECT COUNT(*) AS n FROM questions WHERE status = 'PUBLISHED'")?.n || 0,
    pendingQuestions: get<any>(db, "SELECT COUNT(*) AS n FROM questions WHERE status = 'PENDING_REVIEW'")?.n || 0,
    knowledgePoints: get<any>(db, 'SELECT COUNT(*) AS n FROM knowledge_points')?.n || 0,
    students: get<any>(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'student'")?.n || 0,
    parents: get<any>(db, "SELECT COUNT(*) AS n FROM users WHERE role = 'parent'")?.n || 0,
    sessions: get<any>(db, 'SELECT COUNT(*) AS n FROM quiz_sessions')?.n || 0,
    answers: get<any>(db, 'SELECT COUNT(*) AS n FROM session_questions WHERE answered = 1')?.n || 0,
    mistakes: get<any>(db, 'SELECT COUNT(*) AS n FROM mistakes WHERE resolved = 0')?.n || 0,
  };
  const imports = all<any>(db, 'SELECT id, filename, status, total, success, failed, created_at FROM import_batches ORDER BY created_at DESC LIMIT 5');
  const aiJobs = all<any>(db, 'SELECT id, knowledge_code, type, status, count, created_at FROM ai_jobs ORDER BY created_at DESC LIMIT 5');
  const auditLogs = all<any>(
    db,
    'SELECT a.*, u.display_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 8',
  );
  const pendingAi = get<any>(db, "SELECT COUNT(*) AS n FROM ai_items WHERE status = 'DRAFT'")?.n || 0;
  return { counts: { ...counts, pendingAi }, imports, aiJobs, auditLogs };
}

export function listUsers(db: DatabaseSync, query: URLSearchParams) {
  const role = query.get('role');
  const where = role ? 'WHERE u.role = ?' : '';
  const params = role ? [role] : [];
  const rows = all<any>(
    db,
    `SELECT u.id, u.username, u.role, u.display_name, u.status, u.created_at, u.last_login_at,
            p.nickname, p.grade, COALESCE(c.coins,0) AS coins, COALESCE(c.stars,0) AS stars
     FROM users u LEFT JOIN profiles p ON p.user_id = u.id LEFT JOIN currency_accounts c ON c.user_id = u.id
     ${where} ORDER BY u.created_at DESC LIMIT 100`,
    ...params,
  );
  return rows;
}

export function listAudit(db: DatabaseSync, query: URLSearchParams) {
  const where: string[] = ['1=1'];
  const params: any[] = [];
  const action = query.get('action');
  if (action) {
    where.push('a.action = ?');
    params.push(action);
  }
  const objectType = query.get('objectType');
  if (objectType) {
    where.push('a.object_type = ?');
    params.push(objectType);
  }
  const limit = Math.min(200, Math.max(1, Number(query.get('limit')) || 50));
  return all<any>(
    db,
    `SELECT a.*, u.display_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
     WHERE ${where.join(' AND ')} ORDER BY a.created_at DESC LIMIT ?`,
    ...params,
    limit,
  );
}

export function listConfigs(db: DatabaseSync) {
  return all<any>(db, 'SELECT * FROM configs ORDER BY key').map((row) => ({
    key: row.key,
    value: parseJson(row.value_json, null),
    updatedAt: row.updated_at,
  }));
}
