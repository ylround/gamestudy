import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(here, '../..');
export const DEFAULT_DATA_DIR = resolve(REPO_ROOT, 'data');
export const DEFAULT_DB_PATH = resolve(DEFAULT_DATA_DIR, 'mathrealms.sqlite');

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('student','parent','admin')),
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  nickname TEXT NOT NULL,
  grade INTEGER NOT NULL DEFAULT 4,
  textbook TEXT NOT NULL DEFAULT 'RJ',
  avatar TEXT NOT NULL DEFAULT 'wizard',
  invite_code TEXT UNIQUE,
  consent_at TEXT,
  controls_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS family_links (
  id TEXT PRIMARY KEY,
  parent_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  child_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  UNIQUE (parent_id, child_id)
);

CREATE TABLE IF NOT EXISTS knowledge_points (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  subject_code TEXT NOT NULL DEFAULT 'MATH',
  grade INTEGER NOT NULL,
  term TEXT NOT NULL DEFAULT 'T1',
  textbook TEXT NOT NULL DEFAULT 'RJ',
  domain TEXT NOT NULL,
  unit_code TEXT NOT NULL,
  unit_name_zh TEXT NOT NULL,
  unit_name_en TEXT NOT NULL,
  name_zh TEXT NOT NULL,
  name_en TEXT NOT NULL,
  parent_code TEXT,
  prerequisite_codes TEXT,
  difficulty INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'active',
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL UNIQUE,
  knowledge_code TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('SINGLE','JUDGE','NUMBER','FRACTION','MULTI','TEXT')),
  difficulty INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','PENDING_REVIEW','PUBLISHED','REJECTED','ARCHIVED')),
  source TEXT NOT NULL DEFAULT 'MANUAL',
  batch_id TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  current_version INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS question_versions (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  version INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  review_json TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL,
  note TEXT,
  UNIQUE (question_id, version)
);

CREATE TABLE IF NOT EXISTS question_stats (
  question_id TEXT PRIMARY KEY REFERENCES questions(id) ON DELETE CASCADE,
  exposures INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  total_ms INTEGER NOT NULL DEFAULT 0,
  hints INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS import_batches (
  id TEXT PRIMARY KEY,
  filename TEXT NOT NULL,
  file_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'VALIDATED' CHECK (status IN ('VALIDATED','IMPORTING','COMPLETED','FAILED','ROLLED_BACK')),
  total INTEGER NOT NULL DEFAULT 0,
  success INTEGER NOT NULL DEFAULT 0,
  failed INTEGER NOT NULL DEFAULT 0,
  errors_json TEXT,
  warnings_json TEXT,
  preview_json TEXT,
  created_question_ids TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  committed_at TEXT,
  rolled_back_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_jobs (
  id TEXT PRIMARY KEY,
  knowledge_code TEXT NOT NULL,
  type TEXT NOT NULL,
  difficulty INTEGER NOT NULL,
  count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  provider TEXT NOT NULL DEFAULT 'local-template',
  model TEXT NOT NULL DEFAULT 'math-template-v1',
  prompt_version TEXT NOT NULL DEFAULT 'p0-v1',
  tokens INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  error TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  finished_at TEXT
);

CREATE TABLE IF NOT EXISTS ai_items (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES ai_jobs(id) ON DELETE CASCADE,
  content_json TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  validation_json TEXT,
  status TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','APPROVED','REJECTED')),
  question_id TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  reject_reason TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS quiz_sessions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('STAGE','REVIEW','PRACTICE')),
  stage_key TEXT,
  knowledge_code TEXT NOT NULL,
  question_count INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE','FINISHED','ABANDONED')),
  started_at TEXT NOT NULL,
  ended_at TEXT,
  state_json TEXT NOT NULL,
  result_json TEXT,
  reward_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_questions (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES quiz_sessions(id) ON DELETE CASCADE,
  seq INTEGER NOT NULL,
  question_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  content_json TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  answered INTEGER NOT NULL DEFAULT 0,
  answer_given_json TEXT,
  correct INTEGER,
  time_ms INTEGER NOT NULL DEFAULT 0,
  hints_used INTEGER NOT NULL DEFAULT 0,
  feedback_json TEXT,
  answered_at TEXT,
  UNIQUE (session_id, seq)
);

CREATE TABLE IF NOT EXISTS mastery_records (
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  knowledge_code TEXT NOT NULL,
  score REAL NOT NULL DEFAULT 0,
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  last_practiced_at TEXT,
  PRIMARY KEY (student_id, knowledge_code)
);

CREATE TABLE IF NOT EXISTS mistakes (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  question_id TEXT NOT NULL,
  version_id TEXT NOT NULL,
  knowledge_code TEXT NOT NULL,
  content_json TEXT NOT NULL,
  answer_json TEXT NOT NULL,
  wrong_answer_json TEXT NOT NULL,
  wrong_count INTEGER NOT NULL DEFAULT 1,
  resolved INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (student_id, question_id)
);

CREATE TABLE IF NOT EXISTS currency_accounts (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  coins INTEGER NOT NULL DEFAULT 0,
  stars INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS currency_transactions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  currency TEXT NOT NULL CHECK (currency IN ('COINS','STARS')),
  amount INTEGER NOT NULL,
  balance_after INTEGER NOT NULL,
  source TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS reward_records (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL,
  rewards_json TEXT NOT NULL,
  idempotency_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS game_saves (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  xp INTEGER NOT NULL DEFAULT 0,
  level INTEGER NOT NULL DEFAULT 1,
  settings_json TEXT NOT NULL,
  map_json TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS character_saves (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  character_id TEXT NOT NULL,
  xp INTEGER NOT NULL DEFAULT 0,
  selected INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  PRIMARY KEY (user_id, character_id)
);

CREATE TABLE IF NOT EXISTS stage_results (
  student_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stage_key TEXT NOT NULL,
  stars INTEGER NOT NULL DEFAULT 0,
  best_stars INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  asked INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (student_id, stage_key)
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  actor_id TEXT,
  actor_role TEXT,
  action TEXT NOT NULL,
  object_type TEXT NOT NULL,
  object_id TEXT,
  before_json TEXT,
  after_json TEXT,
  ip TEXT,
  request_id TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS configs (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_by TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_questions_knowledge ON questions(knowledge_code, status);
CREATE INDEX IF NOT EXISTS idx_questions_status ON questions(status);
CREATE INDEX IF NOT EXISTS idx_versions_question ON question_versions(question_id, version DESC);
CREATE INDEX IF NOT EXISTS idx_family_parent ON family_links(parent_id, status);
CREATE INDEX IF NOT EXISTS idx_sessions_student ON quiz_sessions(student_id, status);
CREATE INDEX IF NOT EXISTS idx_session_questions ON session_questions(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_mistakes_student ON mistakes(student_id, resolved);
CREATE INDEX IF NOT EXISTS idx_character_saves_user ON character_saves(user_id, selected);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at DESC);
`;

export function openDatabase(filePath = process.env.MATHREALMS_DB || DEFAULT_DB_PATH): DatabaseSync {
  mkdirSync(dirname(filePath), { recursive: true });
  const db = new DatabaseSync(filePath);
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec(SCHEMA);
  return db;
}

export function now(): string {
  return new Date().toISOString();
}

export function transaction<T>(db: DatabaseSync, work: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = work();
    db.exec('COMMIT');
    return result;
  } catch (error) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // ignore rollback errors; the original error is more useful
    }
    throw error;
  }
}

export function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function json(value: unknown): string {
  return JSON.stringify(value);
}

export function all<T = any>(db: DatabaseSync, sql: string, ...params: any[]): T[] {
  return db.prepare(sql).all(...params) as T[];
}

export function get<T = any>(db: DatabaseSync, sql: string, ...params: any[]): T | undefined {
  return db.prepare(sql).get(...params) as T | undefined;
}

export function run(db: DatabaseSync, sql: string, ...params: any[]) {
  return db.prepare(sql).run(...params);
}
