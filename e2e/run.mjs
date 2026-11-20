import assert from 'node:assert/strict';
import { answerCurrentCorrectly, launchBrowser, login, openScreen, playStageToResult, startStage, startServer, stopServer, openDb } from './lib.mjs';

const server = await startServer(8791);
const db = openDb(server.dbPath);
const browser = await launchBrowser();
let failures = 0;

async function check(name, work) {
  try {
    await work();
    console.log(`PASS ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`FAIL ${name}`);
    console.error(error);
  }
}

try {
  await check('student: login, tutorial, map, battle, result, mistakes, growth', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await login(page, server.baseUrl, 'xiaoyu', 'demo1234');
    assert.ok(['home', 'map'].includes(await page.evaluate(() => window.__mathrealms.app.screen)));
    await openScreen(page, 'map');
    assert.ok((await page.locator('.stage-row').count()) >= 12);
    await startStage(page, 'g4-numbers-2');
    assert.equal(await page.evaluate(() => window.__mathrealms.app.screen), 'battle');
    await playStageToResult(page, db);
    assert.equal(await page.evaluate(() => window.__mathrealms.app.screen), 'result');
    const result = await page.evaluate(() => window.__mathrealms.app.result.result);
    assert.equal(result.victory, true);
    assert.ok(result.correct >= 1);
    await page.screenshot({ path: 'docs/screenshots/p0/after-result-zh-desktop.png' });
    await openScreen(page, 'mistakes');
    assert.ok((await page.locator('.mistake-card').count()) >= 1);
    await openScreen(page, 'growth');
    assert.ok((await page.locator('.achievement').count()) >= 1);
    assert.deepEqual(errors, []);
    await page.close();
  });


  await check('student: hint, resume after reload and abandon', async () => {
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    await login(page, server.baseUrl, 'xiaoyu', 'demo1234');
    await openScreen(page, 'map');
    await startStage(page, 'g4-numbers-3');
    await page.locator('[data-action="hint"]').click();
    await page.waitForTimeout(350);
    assert.ok(await page.locator('.hint-box').isVisible());
    await answerCurrentCorrectly(page, db);
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(1000);
    await openScreen(page, 'map');
    assert.ok(await page.locator('.resume-banner').isVisible());
    await page.locator('[data-action="resume-session"]').click();
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => window.__mathrealms.app.screen), 'battle');
    assert.ok(await page.locator('.feedback').isVisible());
    await page.locator('[data-action="leave-battle"]').click();
    await page.waitForTimeout(250);
    await page.locator('.modal-actions [data-action="dialog-confirm"]').click();
    await page.waitForTimeout(700);
    assert.equal(await page.evaluate(() => window.__mathrealms.app.screen), 'map');
    await page.close();
  });

  await check('parent: login, multi-child report, settings', async () => {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await login(page, server.baseUrl, 'mama', 'demo1234');
    assert.ok((await page.locator('.child-tab').count()) >= 2);
    assert.ok(await page.locator('.report-head').isVisible());
    assert.ok((await page.locator('.week-chart').count()) === 1);
    assert.ok((await page.locator('.content-section').count()) >= 4);
    await page.click('[data-action="open-create-child"]');
    await page.waitForTimeout(250);
    await page.fill('#child-nickname', '小测试');
    await page.selectOption('#child-grade', '4');
    await page.locator('[data-action="dialog-confirm"]').click();
    await page.waitForTimeout(900);
    assert.ok((await page.locator('dialog[open]').innerText()).includes('登录账号'));
    await page.locator('.modal-actions [data-action="dialog-cancel"]').click();
    await page.waitForTimeout(300);
    assert.ok((await page.locator('.child-tab').count()) >= 3);
    await page.click('[data-action="open-bind"]');
    await page.waitForTimeout(250);
    await page.fill('#bind-code', 'LL2026');
    await page.locator('[data-action="dialog-confirm"]').click();
    await page.waitForTimeout(800);
    assert.ok((await page.locator('#toast').innerText()).includes('绑定成功'));
    await page.screenshot({ path: 'docs/screenshots/p0/after-parent-zh-desktop.png' });
    await page.click('[data-action="nav"][data-screen="settings"]');
    await page.waitForTimeout(400);
    assert.equal(await page.evaluate(() => window.__mathrealms.app.screen), 'settings');
    assert.deepEqual(errors, []);
    await page.close();
  });

  await check('admin: login, question create/publish, import preview/commit, AI review', async () => {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto(`${server.baseUrl}/admin`, { waitUntil: 'networkidle' });
    await page.click('[data-action="admin-login"]');
    await page.waitForTimeout(1000);
    assert.ok((await page.locator('.stat-card').count()) >= 8);
    await page.click('[data-action="view"][data-view="questions"]');
    await page.waitForTimeout(400);
    await page.click('[data-action="new-question"]');
    await page.waitForTimeout(300);
    await page.fill('#q-stem-zh', 'E2E：18 × 5 = ?');
    await page.fill('#q-stem-en', 'E2E: 18 × 5 = ?');
    await page.fill('#q-options', 'A|90|90\nB|80|80\nC|100|100\nD|85|85');
    await page.fill('#q-answer', 'A');
    await page.fill('#q-explanation-zh', '18 × 5 = 90');
    await page.fill('#q-explanation-en', '18 × 5 = 90');
    await page.click('[data-action="modal-confirm"]');
    await page.waitForTimeout(700);
    const row = page.locator('tr', { hasText: 'E2E：18 × 5' }).first();
    assert.ok(await row.count());
    await row.locator('[data-action="question-status"]').click();
    await page.waitForTimeout(500);
    assert.ok((await page.locator('tr', { hasText: 'E2E：18 × 5' }).locator('.badge--green').count()) >= 1);

    await page.click('[data-action="view"][data-view="imports"]');
    await page.waitForTimeout(400);
    const csv = `question_code,knowledge_code,question_type,difficulty,stem,stem_en,hint_1,explanation,source,status,option_a,option_b,option_c,option_d,correct_option,answer_value
E2E-IMP-001,MATH-RJ-G4-T1-NUM-03,SINGLE,2,"7 × 8 = ?","7 × 8 = ?","先想乘法口诀。","7 × 8 = 56",IMPORT,DRAFT,56,54,64,48,A,`;
    await page.setInputFiles('#import-file', { name: 'e2e.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
    await page.waitForTimeout(1000);
    assert.ok(await page.locator('[data-action="import-commit"]').count());
    await page.locator('[data-action="import-commit"]').click();
    await page.waitForTimeout(800);
    assert.ok((await page.locator('#admin-toast').innerText()).includes('已入库'));

    await page.click('[data-action="view"][data-view="ai"]');
    await page.waitForTimeout(500);
    await page.click('[data-action="create-ai-job"]');
    await page.waitForTimeout(1800);
    assert.ok((await page.locator('.ai-item').count()) >= 1);
    await page.locator('[data-action="ai-approve"]').first().click();
    await page.waitForTimeout(700);
    assert.ok((await page.locator('.badge--green', { hasText: 'APPROVED' }).count()) >= 1);
    await page.screenshot({ path: 'docs/screenshots/p0/after-admin-ai-zh-desktop.png' });
    assert.deepEqual(errors, []);
    await context.close();
  });
} finally {
  db.close();
  await browser.close();
  await stopServer(server);
}

if (failures) {
  console.error(`${failures} E2E check(s) failed`);
  process.exit(1);
}
console.log('All E2E checks passed');
