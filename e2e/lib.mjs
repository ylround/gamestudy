import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { chromium } from 'playwright';

export const root = resolve(import.meta.dirname, '..');

export async function startServer(port = 8791) {
  const dir = mkdtempSync(join(tmpdir(), 'mathrealms-e2e-'));
  const dbPath = join(dir, 'e2e.sqlite');
  const child = spawn(process.execPath, ['server/index.ts'], {
    cwd: root,
    env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', MATHREALMS_DB: dbPath, MATHREALMS_SECRET: 'e2e-secret' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  child.stdout.on('data', (chunk) => { log += chunk; });
  child.stderr.on('data', (chunk) => { log += chunk; });
  const baseUrl = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/v1/health`);
      if (response.ok) return { child, baseUrl, dbPath, dir, log: () => log };
    } catch {
      // server still booting
    }
    await new Promise((done) => setTimeout(done, 150));
  }
  child.kill('SIGTERM');
  throw new Error(`Server did not start:\n${log}`);
}

export async function stopServer(server) {
  if (server.child && !server.child.killed) server.child.kill('SIGTERM');
  await new Promise((done) => setTimeout(done, 200));
  rmSync(server.dir, { recursive: true, force: true });
}

export async function launchBrowser() {
  const executablePath = process.env.CHROME_PATH || '/usr/bin/google-chrome';
  const options = { headless: true };
  if (existsSync(executablePath)) options.executablePath = executablePath;
  return chromium.launch(options);
}

export async function login(page, baseUrl, username, password) {
  await page.goto(`${baseUrl}/?debug`, { waitUntil: 'networkidle' });
  if (await page.locator('#auth-username').isVisible().catch(() => false)) {
    await page.fill('#auth-username', username);
    await page.fill('#auth-password', password);
    await page.click('[data-action="auth-submit"]');
    await page.waitForTimeout(1100);
  }
  await closeTutorial(page);
}

export async function closeTutorial(page) {
  if (await page.locator('dialog[open]').count()) {
    await page.locator('[data-action="dialog-confirm"]').click().catch(() => {});
    await page.waitForTimeout(350);
  }
}

export async function openScreen(page, screen) {
  await page.evaluate((value) => window.__mathrealms.goScreen(value), screen);
  await page.waitForTimeout(450);
}

export async function startStage(page, stageKey) {
  await openScreen(page, 'map');
  const selector = stageKey ? `[data-stage-key="${stageKey}"]` : '.stage-row:not([disabled])';
  const stage = page.locator(selector).first();
  if (!(await stage.count())) throw new Error(`No stage ${stageKey || 'unlocked'}`);
  await stage.click();
  await page.waitForTimeout(700);
}

export async function answerCurrentCorrectly(page, db) {
  const state = await page.evaluate(() => ({
    screen: window.__mathrealms.app.screen,
    session: window.__mathrealms.app.session?.id,
    seq: window.__mathrealms.app.question?.seq,
    type: window.__mathrealms.app.question?.type,
    feedback: Boolean(window.__mathrealms.app.feedback),
    final: window.__mathrealms.app.feedback?.isFinal,
  }));
  if (state.screen === 'result') return { done: true };
  if (state.feedback) {
    if (state.final) await page.locator('[data-action="finish-battle"]').click();
    else await page.locator('[data-action="next-question"]').click();
    await page.waitForTimeout(450);
    return { advanced: true };
  }
  const row = db.prepare('SELECT answer_json FROM session_questions WHERE session_id = ? AND seq = ?').get(state.session, state.seq);
  if (!row) throw new Error('No answer row for current question');
  const answer = JSON.parse(row.answer_json);
  if (state.type === 'SINGLE' || state.type === 'MULTI' || state.type === 'JUDGE') {
    const key = state.type === 'MULTI' ? answer.value[0] : state.type === 'JUDGE' ? (answer.value ? 'T' : 'F') : answer.value;
    await page.locator(`[data-action="choose-answer"][data-key="${key}"]`).click();
    if (state.type === 'MULTI') {
      await page.waitForTimeout(150);
      await page.locator('[data-action="submit-answer"]').click();
    }
  } else {
    await page.locator('#answer-input').fill(String(answer.value));
    await page.locator('[data-action="submit-answer"]').click();
  }
  await page.waitForTimeout(500);
  return { answered: true };
}

export async function playStageToResult(page, db) {
  for (let step = 0; step < 30; step += 1) {
    const outcome = await answerCurrentCorrectly(page, db);
    if (outcome.done) return;
    if (await page.evaluate(() => window.__mathrealms.app.screen === 'result')) return;
  }
  throw new Error('Battle did not reach result');
}

export async function shoot(page, file) {
  mkdirSync(resolve(root, 'docs/screenshots/p0'), { recursive: true });
  await page.screenshot({ path: resolve(root, file), fullPage: false });
}

export function openDb(dbPath) {
  return new DatabaseSync(dbPath);
}
