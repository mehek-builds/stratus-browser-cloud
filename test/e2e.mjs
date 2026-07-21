import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import { chromium } from 'playwright-core';
import { createApp } from '../src/server.js';
import { config } from '../src/config.js';

const outputDir = path.join(process.cwd(), 'outputs', 'verification');
fs.mkdirSync(outputDir, { recursive: true });
const app = createApp({ database: ':memory:' });
await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
const port = app.server.address().port;
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ executablePath: config.chromePath, headless: true });
const page = await browser.newPage({ viewport: { width: 1512, height: 982 }, deviceScaleFactor: 1 });
const evidence = { startedAt: new Date().toISOString(), base, steps: [] };

try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(outputDir, '01-overview.png'), fullPage: true });
  evidence.steps.push('Dashboard overview rendered');
  assert.equal(await page.locator('#runningCount').textContent(), '0');

  await page.getByRole('button', { name: 'Playground' }).click();
  await page.getByRole('button', { name: 'Launch and navigate' }).click();
  await page.waitForFunction(() => document.querySelector('#playStatus')?.textContent === 'live', null, { timeout: 30_000 });
  await page.waitForFunction(() => document.querySelector('#liveFrame')?.naturalWidth > 0, null, { timeout: 30_000 });
  evidence.steps.push('Real Chromium session launched and navigated');
  await page.getByRole('button', { name: 'Click proof button' }).click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outputDir, '02-live-browser.png'), fullPage: true });
  evidence.steps.push('Live browser frame and event stream rendered');

  const sessionId = await page.evaluate(() => window.location.hash && document.querySelector('#commandLog p')?.textContent);
  assert.ok(sessionId);
  await page.getByRole('button', { name: 'Stop' }).click();
  await page.waitForFunction(() => document.querySelector('#playStatus')?.textContent === 'offline', null, { timeout: 15_000 });
  evidence.steps.push('Session released and usage recorded');

  await page.getByRole('button', { name: 'Sessions' }).click();
  await page.waitForSelector('#sessionsTable tr');
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outputDir, '03-session-history.png'), fullPage: true });
  assert.match(await page.locator('#sessionsTable').textContent(), /COMPLETED/);
  evidence.steps.push('Completed session visible in archive');

  await page.getByRole('button', { name: 'Functions' }).click();
  await page.getByRole('button', { name: 'Deploy example' }).click();
  await page.getByRole('button', { name: 'Invoke latest' }).click();
  await page.waitForFunction(() => document.querySelector('#functionOutput')?.textContent.includes('COMPLETED'));
  evidence.steps.push('Function deployment and invocation completed');

  const usage = await fetch(`${base}/v1/usage`, { headers: { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me' } }).then((response) => response.json());
  assert.equal(usage.concurrent, 0);
  assert.equal(usage.concurrentLimit, 100);
  assert.equal(usage.browserHoursAllowance, 500);
  evidence.usage = usage;
  evidence.status = 'PASS';
} catch (error) {
  evidence.status = 'FAIL'; evidence.error = error.stack;
  await page.screenshot({ path: path.join(outputDir, 'failure.png'), fullPage: true }).catch(() => {});
  throw error;
} finally {
  evidence.endedAt = new Date().toISOString();
  fs.writeFileSync(path.join(outputDir, 'e2e-report.json'), JSON.stringify(evidence, null, 2));
  await browser.close();
  await app.close();
}

console.log(JSON.stringify(evidence, null, 2));
