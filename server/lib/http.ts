import type { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'node:crypto';

export class HttpError extends Error {
  status: number;
  code: string;
  details: unknown;

  constructor(status: number, code: string, message: string, details: unknown = null) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export interface AuthUser {
  id: string;
  role: 'student' | 'parent' | 'admin';
  username: string;
  displayName: string;
}

export interface RequestContext {
  req: IncomingMessage;
  res: ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  body: any;
  user: AuthUser | null;
  requestId: string;
  ip: string;
  startedAt: number;
}

export type Handler = (ctx: RequestContext) => Promise<unknown> | unknown;

export interface Route {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  auth?: Array<AuthUser['role']>;
  handler: Handler;
}

export interface ResolvedRoute extends Route {
  regex: RegExp;
  keys: string[];
}

export function compileRoutes(routes: Route[]): ResolvedRoute[] {
  return routes.map((route) => {
    const keys: string[] = [];
    const pattern = route.path
      .split('/')
      .map((part) => {
        if (part.startsWith(':')) {
          keys.push(part.slice(1));
          return '([^/]+)';
        }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('/');
    return { ...route, keys, regex: new RegExp(`^${pattern}/?$`) };
  });
}

export function matchRoute(routes: ResolvedRoute[], method: string, pathname: string) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = route.regex.exec(pathname);
    if (!match) continue;
    const params: Record<string, string> = {};
    route.keys.forEach((key, index) => {
      params[key] = decodeURIComponent(match[index + 1]);
    });
    return { route, params };
  }
  return null;
}

export function sendJson(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(payload);
}

export function sendNoContent(res: ServerResponse, status = 204) {
  res.writeHead(status, { 'cache-control': 'no-store' });
  res.end();
}

export async function readJson(req: IncomingMessage, limit = 2_000_000): Promise<any> {
  const type = String(req.headers['content-type'] || '');
  if (!type.includes('application/json')) {
    throw new HttpError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Content-Type must be application/json');
  }
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new HttpError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
    chunks.push(Buffer.from(chunk));
  }
  if (size === 0) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body is not valid JSON');
  }
}

export function requireString(value: unknown, field: string, options: { min?: number; max?: number; pattern?: RegExp } = {}) {
  if (typeof value !== 'string') throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be a string`, { field });
  const text = value.trim();
  if (text.length < (options.min ?? 1)) throw new HttpError(400, 'VALIDATION_ERROR', `${field} is required`, { field });
  if (options.max && text.length > options.max) throw new HttpError(400, 'VALIDATION_ERROR', `${field} is too long`, { field });
  if (options.pattern && !options.pattern.test(text)) throw new HttpError(400, 'VALIDATION_ERROR', `${field} has an invalid format`, { field });
  return text;
}

export function optionalString(value: unknown, field: string, max = 500) {
  if (value === undefined || value === null || value === '') return '';
  return requireString(value, field, { max });
}

export function requireInt(value: unknown, field: string, options: { min?: number; max?: number } = {}) {
  const number = Number(value);
  if (!Number.isInteger(number)) throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be an integer`, { field });
  if (options.min !== undefined && number < options.min) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be at least ${options.min}`, { field });
  }
  if (options.max !== undefined && number > options.max) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${field} must be at most ${options.max}`, { field });
  }
  return number;
}

export function notFound(message = 'Not found'): never {
  throw new HttpError(404, 'NOT_FOUND', message);
}

export function forbidden(message = 'You do not have permission to do that'): never {
  throw new HttpError(403, 'FORBIDDEN', message);
}

export function badRequest(code: string, message: string, details: unknown = null): never {
  throw new HttpError(400, code, message, details);
}

export function newRequestId() {
  return randomUUID();
}
