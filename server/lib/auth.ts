import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { DatabaseSync } from 'node:sqlite';
import { all, get, now } from './db.ts';
import type { AuthUser } from './http.ts';
import { HttpError } from './http.ts';

const SECRET = process.env.MATHREALMS_SECRET || 'mathrealms-local-development-secret';
const TOKEN_TTL_SECONDS = 60 * 60 * 12;

interface TokenPayload {
  sub: string;
  role: AuthUser['role'];
  username: string;
  name: string;
  iat: number;
  exp: number;
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64url');
}

function sign(value: string): string {
  return createHmac('sha256', SECRET).update(value).digest('base64url');
}

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 64).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const [, salt, expected] = parts;
  const actual = scryptSync(password, salt, 64);
  const expectedBuffer = Buffer.from(expected, 'hex');
  if (actual.length !== expectedBuffer.length) return false;
  return timingSafeEqual(actual, expectedBuffer);
}

export function signToken(user: AuthUser): string {
  const issuedAt = Math.floor(Date.now() / 1000);
  const payload: TokenPayload = {
    sub: user.id,
    role: user.role,
    username: user.username,
    name: user.displayName,
    iat: issuedAt,
    exp: issuedAt + TOKEN_TTL_SECONDS,
  };
  const encodedHeader = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const encodedPayload = base64url(JSON.stringify(payload));
  const signature = sign(`${encodedHeader}.${encodedPayload}`);
  return `${encodedHeader}.${encodedPayload}.${signature}`;
}

export function verifyToken(token: string): TokenPayload | null {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const expected = sign(`${header}.${payload}`);
  if (expected.length !== signature.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(signature))) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as TokenPayload;
    if (!parsed.sub || !parsed.exp || parsed.exp < Math.floor(Date.now() / 1000)) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function bearerToken(req: IncomingMessage): string | null {
  const header = String(req.headers.authorization || '');
  if (!header.startsWith('Bearer ')) return null;
  return header.slice(7).trim() || null;
}

export function authenticate(req: IncomingMessage, db: DatabaseSync): AuthUser | null {
  const token = bearerToken(req);
  if (!token) return null;
  const payload = verifyToken(token);
  if (!payload) return null;
  const row = get<{ id: string; role: AuthUser['role']; username: string; display_name: string; status: string }>(
    db,
    'SELECT id, role, username, display_name, status FROM users WHERE id = ?',
    payload.sub,
  );
  if (!row || row.status !== 'active') return null;
  return { id: row.id, role: row.role, username: row.username, displayName: row.display_name };
}

export function userByUsername(db: DatabaseSync, username: string) {
  return get<{ id: string; role: AuthUser['role']; username: string; display_name: string; password_hash: string; status: string }>(
    db,
    'SELECT id, role, username, display_name, password_hash, status FROM users WHERE username = ?',
    username,
  );
}

export function authUser(row: { id: string; role: AuthUser['role']; username: string; display_name: string }): AuthUser {
  return { id: row.id, role: row.role, username: row.username, displayName: row.display_name };
}

export function audit(
  db: DatabaseSync,
  actor: AuthUser | null,
  action: string,
  objectType: string,
  objectId: string | null,
  before: unknown = null,
  after: unknown = null,
  ip = '',
  requestId = '',
) {
  db.prepare(
    `INSERT INTO audit_logs (id, actor_id, actor_role, action, object_type, object_id, before_json, after_json, ip, request_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    randomBytes(16).toString('hex'),
    actor?.id || null,
    actor?.role || null,
    action,
    objectType,
    objectId,
    before == null ? null : JSON.stringify(before),
    after == null ? null : JSON.stringify(after),
    ip,
    requestId,
    now(),
  );
}

export function recentlyIssuedTokens(db: DatabaseSync, userId: string) {
  return all<{ id: string }>(db, 'SELECT id FROM users WHERE id = ? AND status = ?', userId, 'active');
}

export function requireUser(user: AuthUser | null): AuthUser {
  if (!user) throw new HttpError(401, 'UNAUTHORIZED', 'Please sign in first');
  return user;
}

export function requestIp(req: IncomingMessage): string {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || req.socket.remoteAddress || '127.0.0.1';
}

const buckets = new Map<string, { count: number; resetAt: number }>();

export function checkRateLimit(key: string, limit: number, windowMs: number) {
  const current = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= current) {
    buckets.set(key, { count: 1, resetAt: current + windowMs });
    return;
  }
  bucket.count += 1;
  if (bucket.count > limit) {
    throw new HttpError(429, 'RATE_LIMITED', 'Too many attempts. Please try again in a moment.');
  }
}
