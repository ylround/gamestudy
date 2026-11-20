import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { launchBrowser, login, openScreen, playStageToResult, shoot, startServer, startStage, stopServer, openDb } from './lib.mjs';

const server = await startServer(8792);
const db = openDb(server.dbPath);
const browser = await launchBrowser();
mkdirSync(resolve('docs/screenshots/p0'), { recursive: true });

async function ready(page) {
  await page.waitForTimeout(500);
}

try {
  // Student desktop, Chinese
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(`${server.baseUrl}/`, { waitUntil: 'networkidle' });
  await shoot(page, 'docs/screenshots/p0/after-auth-zh-desktop.png');
  await login(page, server.baseUrl, 'xiaoyu', 'demo1234');
  await openScreen(page, 'home');
  await ready(page);
  await shoot(page, 'docs/screenshots/p0/after-home-zh-desktop.png');
  await openScreen(page, 'map');
  await shoot(page, 'docs/screenshots/p0/after-map-zh-desktop.png');
  await startStage(page, 'g4-numbers-2');
  await shoot(page, 'docs/screenshots/p0/after-battle-zh-desktop.png');
  const question = await page.evaluate(() => ({
    session: window.__mathrealms.app.session.id,
    seq: window.__mathrealms.app.question.seq,
    type: window.__mathrealms.app.question.type,
  }));
  const answer = JSON.parse(db.prepare('SELECT answer_json FROM session_questions WHERE session_id = ? AND seq = ?').get(question.session, question.seq).answer_json);
  if (question.type === 'SINGLE' || question.type === 'JUDGE') {
    const key = question.type === 'JUDGE' ? (answer.value ? 'T' : 'F') : answer.value;
    await page.locator(`[data-action="choose-answer"][data-key="${key}"]`).click();
    await page.waitForTimeout(650);
    await shoot(page, 'docs/screenshots/p0/after-battle-feedback-zh-desktop.png');
  }
  await playStageToResult(page, db);
  await shoot(page, 'docs/screenshots/p0/after-result-zh-desktop.png');
  await openScreen(page, 'mistakes');
  await shoot(page, 'docs/screenshots/p0/after-mistakes-zh-desktop.png');
  await openScreen(page, 'growth');
  await shoot(page, 'docs/screenshots/p0/after-growth-zh-desktop.png');
  await openScreen(page, 'settings');
  await shoot(page, 'docs/screenshots/p0/after-settings-zh-desktop.png');
  await page.close();

  // Parent
  const parent = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await login(parent, server.baseUrl, 'mama', 'demo1234');
  await shoot(parent, 'docs/screenshots/p0/after-parent-zh-desktop.png');

  // Admin
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const admin = await adminContext.newPage();
  await admin.goto(`${server.baseUrl}/admin`, { waitUntil: 'networkidle' });
  await shoot(admin, 'docs/screenshots/p0/after-admin-login-zh-desktop.png');
  await admin.click('[data-action="admin-login"]');
  await admin.waitForTimeout(1000);
  await shoot(admin, 'docs/screenshots/p0/after-admin-dashboard-zh-desktop.png');
  await admin.click('[data-action="view"][data-view="questions"]');
  await admin.waitForTimeout(500);
  await shoot(admin, 'docs/screenshots/p0/after-admin-questions-zh-desktop.png');
  await admin.click('[data-action="view"][data-view="imports"]');
  await admin.waitForTimeout(400);
  const csv = `question_code,knowledge_code,question_type,difficulty,stem,stem_en,hint_1,explanation,source,status,option_a,option_b,option_c,option_d,correct_option,answer_value
SHOT-IMP-001,MATH-RJ-G4-T1-NUM-03,SINGLE,2,"7 × 8 = ?","7 × 8 = ?","先想乘法口诀。","7 × 8 = 56",IMPORT,DRAFT,56,54,64,48,A,`;
  await admin.setInputFiles('#import-file', { name: 'screenshot.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
  await admin.waitForTimeout(1000);
  await shoot(admin, 'docs/screenshots/p0/after-admin-import-preview-zh-desktop.png');
  await admin.click('[data-action="view"][data-view="ai"]');
  await admin.waitForTimeout(500);
  await admin.click('[data-action="create-ai-job"]');
  await admin.waitForTimeout(1800);
  await shoot(admin, 'docs/screenshots/p0/after-admin-ai-zh-desktop.png');
  await adminContext.close();

  // Mobile
  const mobileContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const mobile = await mobileContext.newPage();
  await login(mobile, server.baseUrl, 'xiaoyu', 'demo1234');
  await openScreen(mobile, 'map');
  await shoot(mobile, 'docs/screenshots/p0/after-map-zh-mobile.png');
  await startStage(mobile, 'g4-numbers-1');
  await shoot(mobile, 'docs/screenshots/p0/after-battle-zh-mobile.png');
  await mobileContext.close();

  // English
  const enContext = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const en = await enContext.newPage();
  await login(en, server.baseUrl, 'xiaoyu', 'demo1234');
  await openScreen(en, 'home');
  await en.locator('[data-action="toggle-lang"]').first().click();
  await en.waitForTimeout(700);
  await shoot(en, 'docs/screenshots/p0/after-home-en-desktop.png');
  await openScreen(en, 'map');
  await shoot(en, 'docs/screenshots/p0/after-map-en-desktop.png');
  await enContext.close();

  for (const file of ['after-battle-zh-desktop.png', 'after-map-zh-desktop.png', 'after-parent-zh-desktop.png', 'after-admin-dashboard-zh-desktop.png']) {
    console.log('captured', file);
  }
} finally {
  db.close();
  await browser.close();
  await stopServer(server);
}
console.log('Screenshots written to docs/screenshots/p0/');
