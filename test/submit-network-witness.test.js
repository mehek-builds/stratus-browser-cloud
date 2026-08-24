/* THE NETWORK WITNESS AROUND THE FINAL PRESS RECORDS WHAT THE PAGE WOULD NOT SAY.
 *
 * Measured on the live Easy Dynamics Rippling form, twice (2026-08-20): Send pressed, the page
 * rendered neither confirmation nor rejection, and nothing recorded what the submit request
 * returned. These cases run the REAL watch (extracted from the shipped runner, never copied)
 * against pages whose write-shaped requests succeed, fail with a status, and never return at all.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

function watchSource() {
  const start = SANDBOX_RUNNER.indexOf('let submitNetwork = null;');
  const end = SANDBOX_RUNNER.indexOf('let requiredFieldConfirmation', start);
  assert.ok(start > 0 && end > start, 'the submit network watch must exist in the sandbox runner');
  return SANDBOX_RUNNER.slice(start, end);
}

let browser;
let page;
test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

function armedWatch() {
  const reader = new Function('page', watchSource()
    + '\narmSubmitNetworkWatch();\nreturn () => submitNetwork;');
  return reader(page);
}

// setContent leaves the page on about:blank, where a relative fetch cannot resolve, so every
// case stands the page on a routed origin first.
async function standOn(markup) {
  await page.route('https://board.test/', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><html><body>' + markup + '</body></html>',
  }));
  await page.goto('https://board.test/');
}

test('a write-shaped response is recorded with its status and without its query string', async () => {
  await page.route('**/submit*', (route) => route.fulfill({ status: 422, body: '{}' }));
  await standOn('<button id="go">Apply</button>');
  const read = armedWatch();
  await page.evaluate(() => {
    document.getElementById('go').addEventListener('click', () => {
      fetch('/submit?token=SECRET123', { method: 'POST', body: '{}' });
    });
  });
  await page.click('#go');
  await page.waitForTimeout(500);
  const entries = read();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].method, 'POST');
  assert.equal(entries[0].status, 422);
  assert.ok(entries[0].url.endsWith('/submit'), entries[0].url);
  assert.ok(!entries[0].url.includes('SECRET123'), 'query strings must never be recorded');
  await page.unroute('**/submit*');
});

test('a request that never returns is recorded as a failure, and reads are ignored', async () => {
  await page.route('**/hang', (route) => route.abort('connectionfailed'));
  await page.route('**/read', (route) => route.fulfill({ status: 200, body: '{}' }));
  await standOn('<p>form</p>');
  const read = armedWatch();
  await page.evaluate(() => {
    fetch('/hang', { method: 'POST', body: '{}' }).catch(() => {});
    fetch('/read', { method: 'GET' }).catch(() => {});
  });
  await page.waitForTimeout(500);
  const entries = read();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, null);
  assert.ok(entries[0].failure, 'a hung request carries its failure text');
  await page.unroute('**/hang');
  await page.unroute('**/read');
});

test('the record is bounded at twenty entries', async () => {
  await page.route('**/ping', (route) => route.fulfill({ status: 204, body: '' }));
  await standOn('<p>chatter</p>');
  const read = armedWatch();
  await page.evaluate(async () => {
    for (let i = 0; i < 30; i += 1) await fetch('/ping', { method: 'POST', body: '' });
  });
  await page.waitForTimeout(500);
  assert.equal(read().length, 20);
  await page.unroute('**/ping');
});

/* The wiring, pinned in source: armed before BOTH press paths (the atomic pass and the plain
 * final-submit click), and reported on the pressed outcome only. */
test('the watch is armed at both press sites and travels in submitOutcome', () => {
  const atomicArm = SANDBOX_RUNNER.indexOf('armSubmitNetworkWatch();');
  const atomicClick = SANDBOX_RUNNER.indexOf('await submitHandle.click', atomicArm);
  assert.ok(atomicArm >= 0 && atomicClick > atomicArm, 'the atomic press must arm the watch first');

  const genericArm = SANDBOX_RUNNER.indexOf(
    'if (isFinalSubmitAction(action)) armSubmitNetworkWatch();',
    atomicClick,
  );
  const genericClick = SANDBOX_RUNNER.indexOf('await locator.click();', genericArm);
  assert.ok(genericArm > atomicClick && genericClick > genericArm, 'the plain final press must arm the watch first');

  assert.match(SANDBOX_RUNNER, /\(\) => readSubmitOutcome\(\)/);
  assert.match(SANDBOX_RUNNER, /\.\.\.\(submitNetwork \? \{ network: submitNetwork \} : \{\}\)/);
});
