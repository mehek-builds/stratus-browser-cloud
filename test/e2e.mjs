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
  const sessionsDuringRun = await fetch(`${base}/v1/sessions?status=RUNNING`, { headers: { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me' } }).then((response) => response.json());
  assert.equal(sessionsDuringRun.length, 1);
  assert.match(sessionsDuringRun[0].connectUrl, /^ws:\/\//);
  const observed = await fetch(`${base}/v1/sessions/${sessionsDuringRun[0].id}/observe`, { method: 'POST', headers: { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me', 'Content-Type': 'application/json' }, body: '{}' }).then((response) => response.json());
  assert.ok(observed.some((element) => element.text.includes('Verify interaction')));
  const acted = await fetch(`${base}/v1/sessions/${sessionsDuringRun[0].id}/act`, { method: 'POST', headers: { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me', 'Content-Type': 'application/json' }, body: JSON.stringify({ instruction: 'click Verify interaction' }) }).then((response) => response.json());
  assert.equal(acted.action, 'click');
  await page.waitForTimeout(1200);
  const interactionText = await fetch(`${base}/v1/sessions/${sessionsDuringRun[0].id}/commands`, { method: 'POST', headers: { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'evaluate', expression: "document.querySelector('#proof').textContent" }) }).then((response) => response.json());
  assert.equal(interactionText, 'Interaction verified');
  const extracted = await fetch(`${base}/v1/sessions/${sessionsDuringRun[0].id}/extract`, { method: 'POST', headers: { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me', 'Content-Type': 'application/json' }, body: JSON.stringify({ selector: 'main' }) }).then((response) => response.json());
  assert.match(extracted.text, /Interaction verified/);
  await page.screenshot({ path: path.join(outputDir, '02-live-browser.png'), fullPage: true });
  evidence.steps.push('Live browser frame plus observe, act, extract, and event stream verified');

  const challengeNavigation = await fetch(`${base}/v1/sessions/${sessionsDuringRun[0].id}/commands`, {
    method: 'POST',
    headers: { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'navigate', url: 'data:text/html,<title>Human verification</title><main><h1>Verify you are human</h1><p>Security check</p></main>' })
  }).then((response) => response.json());
  assert.equal(challengeNavigation.protection.state, 'challenge_detected');
  const protection = await fetch(`${base}/v1/sessions/${sessionsDuringRun[0].id}/protection`, {
    headers: { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me' }
  }).then((response) => response.json());
  assert.equal(protection.challenge.type, 'human_verification');
  const challengeFrame = await fetch(`${base}/v1/sessions/${sessionsDuringRun[0].id}/live-frame`, {
    headers: { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me' }
  });
  fs.writeFileSync(path.join(outputDir, '06-protection-challenge.png'), Buffer.from(await challengeFrame.arrayBuffer()));
  evidence.steps.push('Protection challenge detected, recorded, and handed off without circumvention');

  const pausedSession = await fetch(`${base}/v1/sessions`, {
    method: 'POST',
    headers: { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me', 'Content-Type': 'application/json' },
    body: JSON.stringify({ browserSettings: { protectionPolicy: { challengeBehavior: 'pause' } } })
  }).then((response) => response.json());
  const pausedNavigation = await fetch(`${base}/v1/sessions/${pausedSession.id}/commands`, {
    method: 'POST',
    headers: { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me', 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'navigate', url: 'data:text/html,<title>Human verification</title><h1>Verify you are human</h1>' })
  });
  assert.equal(pausedNavigation.status, 409);
  assert.equal((await pausedNavigation.json()).error.code, 'HUMAN_REVIEW_REQUIRED');
  const pausedProtection = await fetch(`${base}/v1/sessions/${pausedSession.id}/protection`, {
    headers: { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me' }
  }).then((response) => response.json());
  assert.equal(pausedProtection.state, 'paused');
  const blockedAgent = await fetch(`${base}/v1/sessions/${pausedSession.id}/observe`, {
    method: 'POST',
    headers: { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me', 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(blockedAgent.status, 409);
  await fetch(`${base}/v1/sessions/${pausedSession.id}`, {
    method: 'POST',
    headers: { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me', 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'REQUEST_RELEASE' })
  });
  evidence.steps.push('Pause policy blocked API and agent automation pending human review');

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
  await page.locator(`[data-inspect="${sessionsDuringRun[0].id}"]`).click();
  await page.waitForTimeout(250);
  assert.match(await page.locator('#inspectorEvents').textContent(), /protection.challenge_detected/);
  await page.screenshot({ path: path.join(outputDir, '04-session-inspector.png'), fullPage: true });
  evidence.steps.push('Session Inspector replay and event timeline verified');

  await page.getByRole('button', { name: 'Functions' }).click();
  await page.getByRole('button', { name: 'Deploy example' }).click();
  await page.getByRole('button', { name: 'Invoke latest' }).click();
  await page.waitForFunction(() => document.querySelector('#functionOutput')?.textContent.includes('COMPLETED'));
  evidence.steps.push('Function deployment and invocation completed');

  await page.getByRole('button', { name: 'Identities' }).click();
  await page.getByRole('button', { name: 'Create identity' }).click();
  await page.waitForFunction(() => document.querySelector('#contextList')?.textContent.includes('Identity'));
  evidence.steps.push('Persistent browser identity created');

  await page.getByRole('button', { name: 'Model gateway' }).click();
  await page.getByRole('button', { name: 'Send through gateway' }).click();
  await page.waitForFunction(() => document.querySelector('#modelOutput')?.textContent.includes('Local gateway response'));
  evidence.steps.push('OpenAI-compatible model gateway completed');

  const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.goto(`${base}/#overview`, { waitUntil: 'networkidle' });
  assert.equal(await mobile.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), true);
  await mobile.screenshot({ path: path.join(outputDir, '05-mobile-overview.png') });
  await mobile.close();
  evidence.steps.push('Mobile layout verified without horizontal overflow');

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
