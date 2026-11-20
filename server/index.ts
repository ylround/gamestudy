import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import { openDatabase, REPO_ROOT } from './lib/db.ts';
import { authenticate, requestIp } from './lib/auth.ts';
import {
  HttpError,
  compileRoutes,
  matchRoute,
  newRequestId,
  readJson,
  sendJson,
  type RequestContext,
  type Route,
} from './lib/http.ts';
import { seedDatabase } from './seed/index.ts';
import {
  bindChild,
  consent,
  createChild,
  login,
  me,
  refresh,
  register,
  unbindChild,
} from './modules/auth.ts';
import {
  announcement,
  curriculumTree,
  inventory,
  saveState,
  updateGrade,
  updateSettings,
} from './modules/curriculum.ts';
import {
  abandon,
  createSession,
  getSession,
  listMistakes,
  nextQuestion,
  requestHint,
  resolveMistake,
  result,
  submitAnswer,
} from './modules/quiz.ts';
import { exportChild, reportForChild, requestDeletion, updateControls } from './modules/family.ts';
import {
  changeQuestionStatus,
  createKnowledge,
  createQuestionRecord,
  dashboard,
  getQuestion,
  listAudit,
  listConfigs,
  listKnowledge,
  listQuestions,
  listUsers,
  updateKnowledge,
  updateQuestion,
  validateQuestionInput,
} from './modules/admin.ts';
import {
  commitBatch,
  createBatch,
  createTemplateCsv,
  createTemplateXlsx,
  listBatches,
  parseImportPayload,
  previewResponse,
  rollbackBatch,
  validateImport,
} from './modules/imports.ts';
import { createJob, getJob, listJobs, processJob, resumePendingJobs, reviewItem } from './modules/ai.ts';
import { familyBundle, readConfig, stageStates, writeConfig } from './modules/common.ts';
import { audit } from './lib/auth.ts';

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = REPO_ROOT;
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || '0.0.0.0';

const db = openDatabase();
const seedInfo = seedDatabase(db);
resumePendingJobs(db, (jobId) => {
  setImmediate(() => processJob(db, jobId));
});

function requireRole(ctx: RequestContext, roles: string[]) {
  if (!ctx.user) throw new HttpError(401, 'UNAUTHORIZED', 'Please sign in first');
  if (!roles.includes(ctx.user.role)) throw new HttpError(403, 'FORBIDDEN', 'You do not have permission to do that');
  return ctx.user;
}

function studentId(ctx: RequestContext) {
  return requireRole(ctx, ['student']).id;
}

async function bodyOf(ctx: RequestContext) {
  if (!ctx.body) ctx.body = await readJson(ctx.req, 12 * 1024 * 1024);
  return ctx.body;
}

const routes: Route[] = [
  { method: 'GET', path: '/api/v1/health', handler: () => ({ ok: true, version: '0.2.0', questions: seedInfo.questions, seeded: seedInfo.seeded }) },
  {
    method: 'GET',
    path: '/api/v1/auth/demo',
    handler: () => {
      const hints = readConfig<any>(db, 'login_hint', {});
      return {
        accounts: [
          { role: 'student', username: 'xiaoyu', password: 'demo1234', label: '学生 · 小雨（四年级）' },
          { role: 'student', username: 'lele', password: 'demo1234', label: '学生 · 乐乐（三年级）' },
          { role: 'parent', username: 'mama', password: 'demo1234', label: '家长 · 小雨妈妈' },
          { role: 'admin', username: 'admin', password: 'admin1234', label: '教研管理员' },
        ],
        hints,
      };
    },
  },
  {
    method: 'POST',
    path: '/api/v1/auth/register',
    handler: async (ctx) => register(db, await bodyOf(ctx), ctx.ip, ctx.requestId),
  },
  {
    method: 'POST',
    path: '/api/v1/auth/login',
    handler: async (ctx) => login(db, await bodyOf(ctx), ctx.ip, ctx.requestId),
  },
  { method: 'POST', path: '/api/v1/auth/refresh', auth: ['student', 'parent', 'admin'], handler: (ctx) => refresh(db, ctx.user!.id) },
  { method: 'POST', path: '/api/v1/auth/logout', auth: ['student', 'parent', 'admin'], handler: (ctx) => { ctx.res.writeHead(204).end(); return undefined; } },
  { method: 'GET', path: '/api/v1/me', auth: ['student', 'parent', 'admin'], handler: (ctx) => me(db, ctx.user!.id) },
  {
    method: 'POST',
    path: '/api/v1/me/consent',
    auth: ['student'],
    handler: (ctx) => consent(db, ctx.user!.id, ctx.ip, ctx.requestId),
  },
  {
    method: 'GET',
    path: '/api/v1/curriculum/tree',
    auth: ['student', 'parent', 'admin'],
    handler: (ctx) => curriculumTree(db, Number(ctx.query.get('grade') || 4)),
  },
  {
    method: 'GET',
    path: '/api/v1/game/save',
    auth: ['student'],
    handler: (ctx) => saveState(db, ctx.user!.id),
  },
  {
    method: 'PUT',
    path: '/api/v1/game/save',
    auth: ['student'],
    handler: async (ctx) => updateSettings(db, ctx.user!.id, await bodyOf(ctx)),
  },
  {
    method: 'PUT',
    path: '/api/v1/game/grade',
    auth: ['student'],
    handler: async (ctx) => updateGrade(db, ctx.user!.id, await bodyOf(ctx)),
  },
  {
    method: 'GET',
    path: '/api/v1/game/map',
    auth: ['student'],
    handler: (ctx) => {
      const grade = Number(ctx.query.get('grade') || 4);
      return stageStates(db, ctx.user!.id, grade);
    },
  },
  { method: 'GET', path: '/api/v1/inventory', auth: ['student'], handler: (ctx) => inventory(db, ctx.user!.id) },
  {
    method: 'GET',
    path: '/api/v1/announcement',
    handler: () => announcement(db),
  },
  { method: 'GET', path: '/api/v1/family', auth: ['student', 'parent', 'admin'], handler: (ctx) => familyBundle(db, ctx.user!) },
  {
    method: 'POST',
    path: '/api/v1/family/bind',
    auth: ['parent'],
    handler: async (ctx) => bindChild(db, ctx.user!.id, await bodyOf(ctx), ctx.ip, ctx.requestId),
  },
  {
    method: 'POST',
    path: '/api/v1/family/children',
    auth: ['parent'],
    handler: async (ctx) => createChild(db, ctx.user!.id, await bodyOf(ctx), ctx.ip, ctx.requestId),
  },
  {
    method: 'POST',
    path: '/api/v1/family/unbind',
    auth: ['parent'],
    handler: async (ctx) => unbindChild(db, ctx.user!.id, String((await bodyOf(ctx)).childId || ''), ctx.ip, ctx.requestId),
  },
  {
    method: 'GET',
    path: '/api/v1/parent/children/:id/report',
    auth: ['parent'],
    handler: (ctx) => reportForChild(db, ctx.user!.id, ctx.params.id, Number(ctx.query.get('days') || 30)),
  },
  {
    method: 'PUT',
    path: '/api/v1/parent/children/:id/controls',
    auth: ['parent'],
    handler: async (ctx) => updateControls(db, ctx.user!.id, ctx.params.id, await bodyOf(ctx), ctx.ip, ctx.requestId),
  },
  {
    method: 'GET',
    path: '/api/v1/parent/children/:id/export',
    auth: ['parent'],
    handler: (ctx) => exportChild(db, ctx.user!.id, ctx.params.id, ctx.ip, ctx.requestId),
  },
  {
    method: 'POST',
    path: '/api/v1/parent/children/:id/deletion-request',
    auth: ['parent'],
    handler: (ctx) => requestDeletion(db, ctx.user!.id, ctx.params.id, ctx.ip, ctx.requestId),
  },
  {
    method: 'POST',
    path: '/api/v1/quiz-sessions',
    auth: ['student'],
    handler: async (ctx) => createSession(db, ctx.user!.id, await bodyOf(ctx)),
  },
  {
    method: 'GET',
    path: '/api/v1/quiz-sessions/:id',
    auth: ['student'],
    handler: (ctx) => getSession(db, ctx.user!.id, ctx.params.id),
  },
  {
    method: 'GET',
    path: '/api/v1/quiz-sessions/:id/next-question',
    auth: ['student'],
    handler: (ctx) => nextQuestion(db, ctx.user!.id, ctx.params.id),
  },
  {
    method: 'POST',
    path: '/api/v1/quiz-sessions/:id/answers',
    auth: ['student'],
    handler: async (ctx) => submitAnswer(db, ctx.user!.id, ctx.params.id, await bodyOf(ctx)),
  },
  {
    method: 'POST',
    path: '/api/v1/quiz-sessions/:id/hints',
    auth: ['student'],
    handler: async (ctx) => requestHint(db, ctx.user!.id, ctx.params.id, await bodyOf(ctx)),
  },
  {
    method: 'GET',
    path: '/api/v1/quiz-sessions/:id/result',
    auth: ['student'],
    handler: (ctx) => result(db, ctx.user!.id, ctx.params.id),
  },
  {
    method: 'POST',
    path: '/api/v1/quiz-sessions/:id/abandon',
    auth: ['student'],
    handler: (ctx) => abandon(db, ctx.user!.id, ctx.params.id),
  },
  {
    method: 'GET',
    path: '/api/v1/mistakes',
    auth: ['student'],
    handler: (ctx) => listMistakes(db, ctx.user!.id, ctx.query),
  },
  {
    method: 'POST',
    path: '/api/v1/mistakes/:id/review',
    auth: ['student'],
    handler: (ctx) => createSession(db, ctx.user!.id, { kind: 'REVIEW', mistakeId: ctx.params.id }),
  },
  {
    method: 'POST',
    path: '/api/v1/mistakes/:id/resolve',
    auth: ['student'],
    handler: (ctx) => resolveMistake(db, ctx.user!.id, ctx.params.id),
  },
  { method: 'GET', path: '/api/v1/admin/dashboard', auth: ['admin'], handler: () => dashboard(db) },
  {
    method: 'GET',
    path: '/api/v1/admin/questions',
    auth: ['admin'],
    handler: (ctx) => listQuestions(db, ctx.query),
  },
  {
    method: 'GET',
    path: '/api/v1/admin/questions/:id',
    auth: ['admin'],
    handler: (ctx) => getQuestion(db, ctx.params.id),
  },
  {
    method: 'POST',
    path: '/api/v1/admin/questions',
    auth: ['admin'],
    handler: async (ctx) => {
      const input = validateQuestionInput(db, await bodyOf(ctx));
      const question = createQuestionRecord(db, ctx.user!, input, { status: 'DRAFT' });
      audit(db, ctx.user!, 'QUESTION_CREATE', 'question', question.id, null, { code: question.code }, ctx.ip, ctx.requestId);
      return question;
    },
  },
  {
    method: 'PUT',
    path: '/api/v1/admin/questions/:id',
    auth: ['admin'],
    handler: async (ctx) => updateQuestion(db, ctx.user!, ctx.params.id, await bodyOf(ctx)),
  },
  {
    method: 'POST',
    path: '/api/v1/admin/questions/:id/status',
    auth: ['admin'],
    handler: async (ctx) => changeQuestionStatus(db, ctx.user!, ctx.params.id, await bodyOf(ctx)),
  },
  {
    method: 'GET',
    path: '/api/v1/admin/knowledge-points',
    auth: ['admin'],
    handler: (ctx) => listKnowledge(db, ctx.query),
  },
  {
    method: 'POST',
    path: '/api/v1/admin/knowledge-points',
    auth: ['admin'],
    handler: async (ctx) => createKnowledge(db, ctx.user!, await bodyOf(ctx)),
  },
  {
    method: 'PUT',
    path: '/api/v1/admin/knowledge-points/:code',
    auth: ['admin'],
    handler: async (ctx) => updateKnowledge(db, ctx.user!, ctx.params.code, await bodyOf(ctx)),
  },
  { method: 'GET', path: '/api/v1/admin/imports', auth: ['admin'], handler: () => listBatches(db) },
  {
    method: 'GET',
    path: '/api/v1/admin/imports/template.xlsx',
    auth: ['admin'],
    handler: async (ctx) => {
      const buffer = await createTemplateXlsx();
      ctx.res.writeHead(200, {
        'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'content-disposition': 'attachment; filename="mathrealms-question-template.xlsx"',
        'content-length': buffer.length,
        'cache-control': 'no-store',
      });
      ctx.res.end(buffer);
    },
  },
  {
    method: 'GET',
    path: '/api/v1/admin/imports/template.csv',
    auth: ['admin'],
    handler: (ctx) => {
      const text = `\uFEFF${createTemplateCsv()}`;
      ctx.res.writeHead(200, {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': 'attachment; filename="mathrealms-questions-template.csv"',
        'content-length': Buffer.byteLength(text),
        'cache-control': 'no-store',
      });
      ctx.res.end(text);
    },
  },
  {
    method: 'POST',
    path: '/api/v1/admin/imports/preview',
    auth: ['admin'],
    handler: async (ctx) => {
      const body = await bodyOf(ctx);
      const parsed = await parseImportPayload(body);
      const preview = validateImport(db, parsed.sheets);
      const batchId = createBatch(db, ctx.user!, parsed.filename, parsed.hash, preview);
      audit(db, ctx.user!, 'IMPORT_PREVIEW', 'import_batch', batchId, null, preview.stats, ctx.ip, ctx.requestId);
      return previewResponse(db, batchId);
    },
  },
  {
    method: 'GET',
    path: '/api/v1/admin/imports/:id',
    auth: ['admin'],
    handler: (ctx) => previewResponse(db, ctx.params.id),
  },
  {
    method: 'POST',
    path: '/api/v1/admin/imports/:id/commit',
    auth: ['admin'],
    handler: (ctx) => commitBatch(db, ctx.user!, ctx.params.id, ctx.ip, ctx.requestId),
  },
  {
    method: 'POST',
    path: '/api/v1/admin/imports/:id/rollback',
    auth: ['admin'],
    handler: (ctx) => rollbackBatch(db, ctx.user!, ctx.params.id, ctx.ip, ctx.requestId),
  },
  { method: 'GET', path: '/api/v1/admin/ai/jobs', auth: ['admin'], handler: () => listJobs(db) },
  {
    method: 'POST',
    path: '/api/v1/admin/ai/jobs',
    auth: ['admin'],
    handler: async (ctx) =>
      createJob(db, ctx.user!, await bodyOf(ctx), ctx.ip, ctx.requestId, (jobId) => {
        setImmediate(() => processJob(db, jobId));
      }),
  },
  {
    method: 'GET',
    path: '/api/v1/admin/ai/jobs/:id',
    auth: ['admin'],
    handler: (ctx) => getJob(db, ctx.params.id),
  },
  {
    method: 'POST',
    path: '/api/v1/admin/ai/items/:id/review',
    auth: ['admin'],
    handler: async (ctx) => reviewItem(db, ctx.user!, ctx.params.id, await bodyOf(ctx), ctx.ip, ctx.requestId),
  },
  { method: 'GET', path: '/api/v1/admin/users', auth: ['admin'], handler: (ctx) => listUsers(db, ctx.query) },
  { method: 'GET', path: '/api/v1/admin/audit-logs', auth: ['admin'], handler: (ctx) => listAudit(db, ctx.query) },
  { method: 'GET', path: '/api/v1/admin/configs', auth: ['admin'], handler: () => listConfigs(db) },
  {
    method: 'PUT',
    path: '/api/v1/admin/configs/:key',
    auth: ['admin'],
    handler: async (ctx) => {
      const body = await bodyOf(ctx);
      writeConfig(db, ctx.params.key, body.value, ctx.user!.id);
      audit(db, ctx.user!, 'CONFIG_UPDATE', 'config', ctx.params.key, null, body.value, ctx.ip, ctx.requestId);
      return { key: ctx.params.key, value: body.value };
    },
  },
];

const compiled = compileRoutes(routes);
const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};
const ALLOWED_PREFIXES = ['/src/', '/assets/', '/docs/screenshots/'];
const ALLOWED_FILES = new Set(['/index.html', '/admin.html', '/favicon.ico']);

function serveStatic(req: IncomingMessage, res: ServerResponse, pathname: string) {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (decoded.includes('..') || decoded.includes('\\')) {
    res.writeHead(400).end('Bad request');
    return;
  }
  let filePath = decoded === '/' ? '/index.html' : decoded;
  if (filePath === '/admin' || filePath.startsWith('/admin/')) filePath = '/admin.html';
  const isAllowed = ALLOWED_FILES.has(filePath) || ALLOWED_PREFIXES.some((prefix) => filePath.startsWith(prefix));
  if (!isAllowed) {
    if (!extname(filePath)) {
      filePath = '/index.html';
    } else {
      res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
      return;
    }
  }
  const absolute = resolve(ROOT, `.${filePath}`);
  if (!absolute.startsWith(ROOT + sep) && absolute !== resolve(ROOT, 'index.html')) {
    res.writeHead(403).end('Forbidden');
    return;
  }
  if (!existsSync(absolute) || !statSync(absolute).isFile()) {
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
    return;
  }
  const ext = extname(absolute).toLowerCase();
  res.writeHead(200, {
    'content-type': MIME[ext] || 'application/octet-stream',
    'content-length': statSync(absolute).size,
    'cache-control': 'no-cache',
    'x-content-type-options': 'nosniff',
    'x-frame-options': 'DENY',
    'referrer-policy': 'same-origin',
    'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'self'",
  });
  createReadStream(absolute).pipe(res);
}

const server = createServer(async (req, res) => {
  const requestId = newRequestId();
  const startedAt = Date.now();
  const url = new URL(req.url || '/', `http://${req.headers.host || '127.0.0.1'}`);
  res.setHeader('x-request-id', requestId);
  const ip = requestIp(req);

  if (!url.pathname.startsWith('/api/v1/')) {
    try {
      serveStatic(req, res, url.pathname);
    } catch (error) {
      if (!res.headersSent) res.writeHead(500).end('Internal server error');
    }
    return;
  }

  const matched = matchRoute(compiled, req.method || 'GET', url.pathname);
  if (!matched) {
    sendJson(res, 404, { code: 'NOT_FOUND', message: 'API route not found', details: null, requestId });
    return;
  }
  const ctx: RequestContext = {
    req,
    res,
    params: matched.params,
    query: url.searchParams,
    body: null,
    user: null,
    requestId,
    ip,
    startedAt,
  };
  try {
    if (matched.route.auth) {
      ctx.user = authenticate(req, db);
      requireRole(ctx, matched.route.auth);
    }
    const resultValue = await matched.route.handler(ctx);
    if (!res.writableEnded) {
      if (resultValue === undefined) {
        res.writeHead(204).end();
      } else {
        sendJson(res, 200, resultValue);
      }
    }
  } catch (error) {
    if (!res.writableEnded) {
      if (error instanceof HttpError) {
        sendJson(res, error.status, {
          code: error.code,
          message: error.message,
          details: error.details,
          requestId,
        });
      } else {
        console.error('request_failed', requestId, error);
        sendJson(res, 500, {
          code: 'INTERNAL_ERROR',
          message: 'Something went wrong. Please try again.',
          details: null,
          requestId,
        });
      }
    }
  } finally {
    const duration = Date.now() - startedAt;
    if (duration > 500) {
      console.log(JSON.stringify({ requestId, method: req.method, path: url.pathname, status: res.statusCode, ms: duration }));
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log(JSON.stringify({ message: 'Math Realms server ready', port: PORT, db: process.env.MATHREALMS_DB || 'data/mathrealms.sqlite', questions: seedInfo.questions, seeded: seedInfo.seeded }));
});

process.on('SIGINT', () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
});
process.on('SIGTERM', () => {
  server.close(() => {
    db.close();
    process.exit(0);
  });
});

export { server, db };
