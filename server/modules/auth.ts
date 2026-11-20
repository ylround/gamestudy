import type { DatabaseSync } from 'node:sqlite';
import { randomBytes, randomInt } from 'node:crypto';
import { get, json, now, run } from '../lib/db.ts';
import { audit, checkRateLimit, hashPassword, requestIp, signToken, verifyPassword } from '../lib/auth.ts';
import { HttpError, badRequest, optionalString, requireInt, requireString } from '../lib/http.ts';
import { DEFAULT_SETTINGS, ensureBalances, ensureGameSave, familyBundle, publicUser } from './common.ts';

const USERNAME_RE = /^[a-zA-Z0-9_]{3,24}$/;

function inviteCode(db: DatabaseSync): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  for (let attempt = 0; attempt < 40; attempt += 1) {
    let code = '';
    for (let index = 0; index < 6; index += 1) code += alphabet[randomInt(0, alphabet.length)];
    if (!get<any>(db, 'SELECT 1 AS ok FROM profiles WHERE invite_code = ?', code)) return code;
  }
  return randomBytes(4).toString('hex').toUpperCase();
}

export function createUserAccount(
  db: DatabaseSync,
  options: {
    username: string;
    password: string;
    role: 'student' | 'parent' | 'admin';
    nickname: string;
    grade?: number;
    consent?: boolean;
    autoInvite?: boolean;
  },
) {
  const createdAt = now();
  const userId = `u_${randomBytes(10).toString('hex')}`;
  run(
    db,
    'INSERT INTO users (id, username, password_hash, role, display_name, status, created_at) VALUES (?,?,?,?,?,?,?)',
    userId,
    options.username,
    hashPassword(options.password),
    options.role,
    options.nickname,
    'active',
    createdAt,
  );
  run(
    db,
    `INSERT INTO profiles (user_id, nickname, grade, textbook, avatar, invite_code, consent_at, created_at)
     VALUES (?,?,?,?,?,?,?,?)`,
    userId,
    options.nickname,
    options.grade ?? 4,
    'RJ',
    options.role === 'parent' ? 'parent' : 'wizard',
    options.role === 'student' && options.autoInvite !== false ? inviteCode(db) : null,
    options.consent && options.role === 'student' ? createdAt : null,
    createdAt,
  );
  run(
    db,
    'INSERT INTO game_saves (user_id, xp, level, settings_json, map_json, updated_at) VALUES (?,?,?,?,?,?)',
    userId,
    0,
    1,
    json(DEFAULT_SETTINGS),
    json({}),
    createdAt,
  );
  run(db, 'INSERT INTO currency_accounts (user_id, coins, stars) VALUES (?,?,?)', userId, 0, 0);
  return { id: userId, username: options.username, role: options.role, displayName: options.nickname };
}

export function register(db: DatabaseSync, body: any, ip: string, requestId: string) {
  const username = requireString(body.username, 'username', { min: 3, max: 24, pattern: USERNAME_RE });
  const password = requireString(body.password, 'password', { min: 6, max: 72 });
  const role = body.role === 'parent' ? 'parent' : 'student';
  const nickname = optionalString(body.nickname, 'nickname', 24) || (role === 'student' ? '小勇者' : '家长');
  const grade = role === 'student' ? requireInt(body.grade ?? 4, 'grade', { min: 1, max: 6 }) : undefined;
  const consent = Boolean(body.consent);
  if (role === 'student' && !consent) {
    throw new HttpError(400, 'CONSENT_REQUIRED', 'Guardian consent is required before creating a student account');
  }
  if (get<any>(db, 'SELECT 1 AS ok FROM users WHERE username = ?', username)) {
    throw new HttpError(409, 'USERNAME_TAKEN', 'That username is already in use');
  }
  const account = createUserAccount(db, {
    username,
    password,
    role,
    nickname,
    grade,
    consent,
    autoInvite: true,
  });
  audit(db, account as any, 'AUTH_REGISTER', 'user', account.id, null, { role, username }, ip, requestId);
  const row = get<any>(db, 'SELECT * FROM users WHERE id = ?', account.id);
  const user = publicUser(db, row);
  return { token: signToken({ id: row.id, role: row.role, username: row.username, displayName: row.display_name }), user, family: familyBundle(db, row) };
}

export function login(db: DatabaseSync, body: any, ip: string, requestId: string) {
  const username = requireString(body.username, 'username', { max: 64 });
  const password = requireString(body.password, 'password', { max: 128 });
  checkRateLimit(`login:${ip}`, 20, 60_000);
  const row = get<any>(db, 'SELECT * FROM users WHERE username = ?', username);
  if (!row || !verifyPassword(password, row.password_hash)) {
    throw new HttpError(401, 'INVALID_CREDENTIALS', 'Username or password is incorrect');
  }
  if (row.status !== 'active') throw new HttpError(403, 'ACCOUNT_DISABLED', 'This account is disabled');
  run(db, 'UPDATE users SET last_login_at = ? WHERE id = ?', now(), row.id);
  audit(db, { id: row.id, role: row.role, username: row.username, displayName: row.display_name }, 'AUTH_LOGIN', 'user', row.id, null, null, ip, requestId);
  return {
    token: signToken({ id: row.id, role: row.role, username: row.username, displayName: row.display_name }),
    user: publicUser(db, row),
    family: familyBundle(db, row),
  };
}

export function me(db: DatabaseSync, userId: string) {
  const row = get<any>(db, 'SELECT * FROM users WHERE id = ?', userId);
  if (!row) throw new HttpError(401, 'UNAUTHORIZED', 'Please sign in first');
  return { user: publicUser(db, row), family: familyBundle(db, row) };
}

export function refresh(db: DatabaseSync, userId: string) {
  const row = get<any>(db, 'SELECT * FROM users WHERE id = ?', userId);
  if (!row) throw new HttpError(401, 'UNAUTHORIZED', 'Please sign in first');
  return { token: signToken({ id: row.id, role: row.role, username: row.username, displayName: row.display_name }) };
}

export function consent(db: DatabaseSync, userId: string, ip: string, requestId: string) {
  const profile = get<any>(db, 'SELECT * FROM profiles WHERE user_id = ?', userId);
  if (!profile) throw new HttpError(404, 'PROFILE_NOT_FOUND', 'Profile not found');
  run(db, 'UPDATE profiles SET consent_at = ? WHERE user_id = ?', now(), userId);
  audit(db, { id: userId, role: 'student', username: '', displayName: '' }, 'PRIVACY_CONSENT', 'profile', userId, { consentAt: profile.consent_at }, { consentAt: now() }, ip, requestId);
  return { consentAt: now() };
}

export function createChild(db: DatabaseSync, parentId: string, body: any, ip: string, requestId: string) {
  const nickname = requireString(body.nickname, 'nickname', { max: 24 });
  const grade = requireInt(body.grade ?? 4, 'grade', { min: 1, max: 6 });
  let username = '';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    username = `kid_${randomBytes(3).toString('hex')}`;
    if (!get<any>(db, 'SELECT 1 AS ok FROM users WHERE username = ?', username)) break;
  }
  const password = `kid${randomInt(100000, 999999)}`;
  const child = createUserAccount(db, {
    username,
    password,
    role: 'student',
    nickname,
    grade,
    consent: true,
    autoInvite: true,
  });
  run(
    db,
    'INSERT OR IGNORE INTO family_links (id, parent_id, child_id, status, created_at) VALUES (?,?,?,?,?)',
    `f_${randomBytes(10).toString('hex')}`,
    parentId,
    child.id,
    'active',
    now(),
  );
  audit(db, { id: parentId, role: 'parent', username: '', displayName: '' }, 'FAMILY_CREATE_CHILD', 'user', child.id, null, { nickname, grade }, ip, requestId);
  return {
    child: { id: child.id, username, nickname, grade, inviteCode: get<any>(db, 'SELECT invite_code FROM profiles WHERE user_id = ?', child.id)?.invite_code },
    credentials: { username, password },
  };
}

export function bindChild(db: DatabaseSync, parentId: string, body: any, ip: string, requestId: string) {
  const code = requireString(body.inviteCode, 'inviteCode', { max: 16 }).toUpperCase();
  const profile = get<any>(db, 'SELECT * FROM profiles WHERE invite_code = ?', code);
  if (!profile) throw new HttpError(404, 'INVITE_NOT_FOUND', 'That family code was not found');
  const child = get<any>(db, 'SELECT * FROM users WHERE id = ? AND role = ?', profile.user_id, 'student');
  if (!child) throw new HttpError(404, 'CHILD_NOT_FOUND', 'That family code does not belong to a student');
  run(
    db,
    `INSERT INTO family_links (id, parent_id, child_id, status, created_at) VALUES (?,?,?,?,?)
     ON CONFLICT(parent_id, child_id) DO UPDATE SET status = 'active', revoked_at = NULL`,
    `f_${randomBytes(10).toString('hex')}`,
    parentId,
    child.id,
    'active',
    now(),
  );
  audit(db, { id: parentId, role: 'parent', username: '', displayName: '' }, 'FAMILY_BIND', 'user', child.id, null, { inviteCode: code }, ip, requestId);
  return { child: { id: child.id, nickname: profile.nickname } };
}

export function unbindChild(db: DatabaseSync, parentId: string, childId: string, ip: string, requestId: string) {
  const link = get<any>(db, 'SELECT * FROM family_links WHERE parent_id = ? AND child_id = ? AND status = ?', parentId, childId, 'active');
  if (!link) throw new HttpError(404, 'LINK_NOT_FOUND', 'This child is not linked to your account');
  run(db, 'UPDATE family_links SET status = ?, revoked_at = ? WHERE id = ?', 'revoked', now(), link.id);
  audit(db, { id: parentId, role: 'parent', username: '', displayName: '' }, 'FAMILY_UNBIND', 'user', childId, { status: 'active' }, { status: 'revoked' }, ip, requestId);
  return { ok: true };
}
