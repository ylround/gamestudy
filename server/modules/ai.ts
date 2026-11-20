import type { DatabaseSync } from 'node:sqlite';
import { randomBytes } from 'node:crypto';
import { all, get, json, now, parseJson, run, transaction } from '../lib/db.ts';
import { audit } from '../lib/auth.ts';
import { HttpError, requireInt, requireString } from '../lib/http.ts';
import type { AuthUser } from '../lib/http.ts';
import { generateSeedQuestions, type SeedKnowledgePoint } from '../seed/content.ts';
import { createQuestionRecord } from './admin.ts';
import { parseNumeric } from '../lib/judge.ts';

function id(prefix = '') {
  return `${prefix}${randomBytes(10).toString('hex')}`;
}

const AI_TYPES = ['SINGLE', 'MULTI', 'JUDGE', 'NUMBER', 'FRACTION', 'TEXT'];

function knowledgePoint(db: DatabaseSync, code: string): SeedKnowledgePoint {
  const row = get<any>(db, 'SELECT * FROM knowledge_points WHERE code = ? AND status = ?', code, 'active');
  if (!row) throw new HttpError(404, 'KNOWLEDGE_NOT_FOUND', 'That skill does not exist or is inactive');
  return {
    code: row.code,
    grade: row.grade,
    term: row.term,
    textbook: row.textbook,
    domain: row.domain,
    unitCode: row.unit_code,
    unitNameZh: row.unit_name_zh,
    unitNameEn: row.unit_name_en,
    nameZh: row.name_zh,
    nameEn: row.name_en,
    parentCode: row.parent_code,
    prerequisiteCodes: parseJson(row.prerequisite_codes, []),
    difficulty: row.difficulty,
    sort: row.sort,
  };
}

function stemHash(stem: any): string {
  const text = `${stem?.zh || ''}|${stem?.en || ''}`.replace(/\s+/g, ' ').trim();
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0;
  }
  return String(hash);
}

export function createJob(db: DatabaseSync, actor: AuthUser, body: any, ip: string, requestId: string, onReady?: (jobId: string) => void) {
  const knowledge = requireString(body.knowledgeCode, 'knowledgeCode', { max: 80 });
  const kp = knowledgePoint(db, knowledge);
  const type = String(body.type || 'SINGLE').toUpperCase();
  if (!AI_TYPES.includes(type)) throw new HttpError(400, 'INVALID_TYPE', 'Unsupported question type');
  const difficulty = requireInt(body.difficulty ?? 2, 'difficulty', { min: 1, max: 5 });
  const count = requireInt(body.count ?? 3, 'count', { min: 1, max: 5 });
  const active = get<any>(
    db,
    "SELECT COUNT(*) AS n FROM ai_jobs WHERE created_by = ? AND status IN ('QUEUED','RUNNING')",
    actor.id,
  )?.n || 0;
  if (active > 0) throw new HttpError(429, 'AI_BUSY', 'You already have a generation task running. Please wait for it to finish.');
  const jobId = id('ai_');
  run(
    db,
    `INSERT INTO ai_jobs (id, knowledge_code, type, difficulty, count, status, provider, model, prompt_version, created_by, created_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    jobId,
    kp.code,
    type,
    difficulty,
    count,
    'QUEUED',
    'local-template',
    'math-template-v1',
    'p0-v1',
    actor.id,
    now(),
  );
  audit(db, actor, 'AI_JOB_CREATE', 'ai_job', jobId, null, { knowledgeCode: kp.code, type, count }, ip, requestId);
  if (onReady) setTimeout(() => onReady(jobId), 80);
  return getJob(db, jobId);
}

export function processJob(db: DatabaseSync, jobId: string) {
  const job = get<any>(db, 'SELECT * FROM ai_jobs WHERE id = ?', jobId);
  if (!job || job.status === 'SUCCEEDED' || job.status === 'FAILED') return;
  run(db, "UPDATE ai_jobs SET status = 'RUNNING' WHERE id = ?", jobId);
  try {
    const kp = knowledgePoint(db, job.knowledge_code);
    const variant = Number(String(job.created_at).replace(/\D/g, '').slice(-6)) || 1;
    const generated = generateSeedQuestions(kp, 20, variant);
    let pool = generated.filter((item) => item.answer.kind === job.type);
    if (!pool.length) pool = generated;
    const items = pool.slice(0, job.count);
    let tokens = 0;
    transaction(db, () => {
      for (const question of items) {
        const content = {
          ...question.content,
          skill: { zh: kp.nameZh, en: kp.nameEn },
        };
        const validation: any = {
          schema: Boolean(content.stem?.zh && content.stem?.en && question.answer?.kind),
          mathChecked: true,
          duplicate: false,
          notes: [],
          provider: 'local-template',
          model: 'math-template-v1',
          promptVersion: 'p0-v1',
        };
        if (question.answer.kind === 'NUMBER' || question.answer.kind === 'FRACTION') {
          validation.mathChecked = parseNumeric(question.answer.value) !== null;
          if (!validation.mathChecked) validation.notes.push('Answer could not be parsed as a number');
        }
        const hash = stemHash(content.stem);
        const duplicate = get<any>(
          db,
          `SELECT 1 AS ok FROM question_versions WHERE content_json LIKE ? LIMIT 1`,
          `%${hash}%`,
        );
        // A cheap stem-prefix check is more reliable than comparing hashes that
        // are not stored; use the first 30 characters of the Chinese stem.
        const text = String(content.stem.zh || '').slice(0, 30);
        const prefixDuplicate = text
          ? get<any>(db, 'SELECT 1 AS ok FROM question_versions WHERE content_json LIKE ? LIMIT 1', `%${text}%`)
          : null;
        validation.duplicate = Boolean(duplicate || prefixDuplicate);
        if (validation.duplicate) validation.notes.push('A similar question already exists in the bank');
        if (question.answer.kind !== job.type) validation.notes.push(`Requested ${job.type}; generated ${question.answer.kind}`);
        tokens += Math.ceil((String(content.stem.zh).length + String(content.stem.en).length) / 4);
        run(
          db,
          `INSERT INTO ai_items (id, job_id, content_json, answer_json, validation_json, status, created_at)
           VALUES (?,?,?,?,?,?,?)`,
          id('aii_'),
          jobId,
          json(content),
          json(question.answer),
          json(validation),
          'DRAFT',
          now(),
        );
      }
      run(
        db,
        `UPDATE ai_jobs SET status = 'SUCCEEDED', tokens = ?, cost_cents = 0, raw_json = ?, finished_at = ? WHERE id = ?`,
        tokens,
        json({ generated: items.length, requested: job.count, note: 'Offline template provider; no external model or student data used.' }),
        now(),
        jobId,
      );
    });
  } catch (error) {
    run(
      db,
      "UPDATE ai_jobs SET status = 'FAILED', error = ?, finished_at = ? WHERE id = ?",
      error instanceof Error ? error.message : 'Generation failed',
      now(),
      jobId,
    );
  }
}

export function getJob(db: DatabaseSync, jobId: string) {
  const job = get<any>(db, 'SELECT * FROM ai_jobs WHERE id = ?', jobId);
  if (!job) throw new HttpError(404, 'AI_JOB_NOT_FOUND', 'Generation task not found');
  const items = all<any>(db, 'SELECT * FROM ai_items WHERE job_id = ? ORDER BY created_at', jobId).map((item) => ({
    id: item.id,
    status: item.status,
    content: parseJson(item.content_json, {}),
    answer: item.answer_json ? parseJson(item.answer_json, {}) : null,
    validation: parseJson(item.validation_json, {}),
    questionId: item.question_id,
    rejectReason: item.reject_reason,
    reviewedAt: item.reviewed_at,
  }));
  return {
    id: job.id,
    knowledgeCode: job.knowledge_code,
    type: job.type,
    difficulty: job.difficulty,
    count: job.count,
    status: job.status,
    provider: job.provider,
    model: job.model,
    promptVersion: job.prompt_version,
    tokens: job.tokens,
    costCents: job.cost_cents,
    error: job.error,
    createdAt: job.created_at,
    finishedAt: job.finished_at,
    items,
  };
}

export function listJobs(db: DatabaseSync) {
  return all<any>(
    db,
    `SELECT j.*, k.name_zh AS kp_name_zh, k.name_en AS kp_name_en,
            (SELECT COUNT(*) FROM ai_items i WHERE i.job_id = j.id) AS item_count,
            (SELECT COUNT(*) FROM ai_items i WHERE i.job_id = j.id AND i.status = 'DRAFT') AS pending_count
     FROM ai_jobs j LEFT JOIN knowledge_points k ON k.code = j.knowledge_code
     ORDER BY j.created_at DESC LIMIT 50`,
  );
}

export function reviewItem(db: DatabaseSync, actor: AuthUser, itemId: string, body: any, ip: string, requestId: string) {
  const item = get<any>(db, 'SELECT * FROM ai_items WHERE id = ?', itemId);
  if (!item) throw new HttpError(404, 'AI_ITEM_NOT_FOUND', 'Draft item not found');
  if (item.status !== 'DRAFT') throw new HttpError(409, 'ALREADY_REVIEWED', 'This item has already been reviewed');
  const action = String(body.action || '').toLowerCase();
  if (action === 'approve') {
    const job = get<any>(db, 'SELECT * FROM ai_jobs WHERE id = ?', item.job_id);
    const content = parseJson<any>(item.content_json, {});
    const answer = parseJson<any>(item.answer_json, {});
    const question = createQuestionRecord(
      db,
      actor,
      {
        knowledgeCode: job.knowledge_code,
        type: answer.kind,
        difficulty: job.difficulty,
        source: 'AI',
        content,
        answer,
      },
      { status: 'PUBLISHED', createdBy: actor.id },
    );
    run(
      db,
      "UPDATE ai_items SET status = 'APPROVED', question_id = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
      question.id,
      actor.id,
      now(),
      itemId,
    );
    audit(db, actor, 'AI_ITEM_APPROVE', 'ai_item', itemId, { status: 'DRAFT' }, { status: 'APPROVED', questionId: question.id }, ip, requestId);
    return { status: 'APPROVED', question };
  }
  if (action === 'reject') {
    const reason = String(body.reason || '').slice(0, 300);
    run(
      db,
      "UPDATE ai_items SET status = 'REJECTED', reject_reason = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?",
      reason,
      actor.id,
      now(),
      itemId,
    );
    audit(db, actor, 'AI_ITEM_REJECT', 'ai_item', itemId, { status: 'DRAFT' }, { status: 'REJECTED', reason }, ip, requestId);
    return { status: 'REJECTED' };
  }
  throw new HttpError(400, 'INVALID_ACTION', 'Action must be approve or reject');
}

export function resumePendingJobs(db: DatabaseSync, onReady: (jobId: string) => void) {
  const jobs = all<any>(db, "SELECT id FROM ai_jobs WHERE status IN ('QUEUED','RUNNING')");
  for (const job of jobs) onReady(job.id);
}
