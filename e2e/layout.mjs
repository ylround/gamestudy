import assert from 'node:assert/strict';
import { launchBrowser, login, openScreen, startStage, startServer, stopServer } from './lib.mjs';

const server = await startServer(8793);
const browser = await launchBrowser();
const sizes = [
  [1440, 900],
  [1024, 768],
  [768, 900],
  [390, 844],
  [320, 700],
];
const failures = [];

try {
  for (const [width, height] of sizes) {
    console.log('audit', width, height);
    const context = await browser.newContext({ viewport: { width, height } });
    const page = await context.newPage();
    await login(page, server.baseUrl, 'xiaoyu', 'demo1234');
    for (const screen of ['home', 'map', 'mistakes', 'growth', 'settings']) {
      await openScreen(page, screen);
      const dims = await page.evaluate(() => ({
        scroll: document.documentElement.scrollWidth,
        body: document.body.scrollWidth,
        viewport: window.innerWidth,
      }));
      if (dims.scroll > dims.viewport + 1 || dims.body > dims.viewport + 1) {
        failures.push({ width, height, screen, dims });
      }
      if (screen === 'map' && width <= 900) {
        const mapScroll = await page.evaluate(() => {
          const shell = document.querySelector('.worldmap-shell');
          return { scroll: shell?.scrollWidth || 0, client: shell?.clientWidth || 0, nodes: document.querySelectorAll('.map-node').length };
        });
        if (mapScroll.nodes !== 12 || mapScroll.scroll <= mapScroll.client) {
          failures.push({ width, height, screen: 'map-scroll', dims: mapScroll });
        }
      }
    }
    console.log('audit battle', width, height);
    await startStage(page, 'g4-numbers-2');
    const battle = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      viewport: window.innerWidth,
      viewportHeight: window.innerHeight,
      scrollY: window.scrollY,
      arena: document.querySelector('.arena')?.getBoundingClientRect().toJSON(),
      panel: document.querySelector('.question-panel')?.getBoundingClientRect().toJSON(),
    }));
    if (battle.scroll > battle.viewport + 1) failures.push({ width, height, screen: 'battle', dims: battle });
    if (battle.scrollY !== 0 || battle.arena.bottom > battle.viewportHeight + 1 || battle.panel.bottom > battle.viewportHeight + 1) {
      failures.push({ width, height, screen: 'battle-vertical', dims: battle });
    }
    await context.close();
  }
} finally {
  await browser.close();
  await stopServer(server);
}

assert.deepEqual(failures, []);
console.log(`Layout audit passed at ${sizes.map(([w, h]) => `${w}x${h}`).join(', ')} (no horizontal overflow; battle arena and question panel stay inside the viewport)`);
