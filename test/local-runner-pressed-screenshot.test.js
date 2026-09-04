/* A pressed run's picture is the receipt. See localScreenshotWaitMsForResult in
 * src/local-managed-runner.js for the measured Hudson River Trading send of 2026-09-04. */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  localScreenshotWaitMsForResult,
  PRESSED_SCREENSHOT_RETURN_MARGIN_MS,
  PRESSED_SCREENSHOT_WAIT_MS,
  waitForLocalScreenshot,
} from '../src/local-managed-runner.js';
import { screenshotWaitMsForResult, SCREENSHOT_ARTIFACT_WAIT_MS } from '../src/managed-browser.js';

test('a pressed result waits for its picture whether or not the caller asked to wait for a preview', () => {
  assert.equal(localScreenshotWaitMsForResult(false, { submitOutcome: { pressed: true } }), PRESSED_SCREENSHOT_WAIT_MS);
  assert.equal(localScreenshotWaitMsForResult(true, { submitOutcome: { pressed: true } }), PRESSED_SCREENSHOT_WAIT_MS);
  assert.equal(localScreenshotWaitMsForResult(undefined, { submitOutcome: { pressed: true, state: 'unknown' } }), PRESSED_SCREENSHOT_WAIT_MS);
  assert.ok(PRESSED_SCREENSHOT_WAIT_MS >= 15_000, 'covers the runner\'s own 15s capture timeout');
});

test('the pressed wait ends before the caller\'s deadline: bounded, never past it, and zero once it has passed', () => {
  const pressed = { submitOutcome: { pressed: true, state: 'unknown' } };
  const now = Date.parse('2026-09-04T15:55:50.000Z');
  const at = (secondsFromNow) => new Date(now + secondsFromNow * 1000).toISOString();
  // Plenty of budget left: the full wait.
  assert.equal(localScreenshotWaitMsForResult(false, pressed, { providerDeadlineAt: at(120), now }), PRESSED_SCREENSHOT_WAIT_MS);
  // Ten seconds of budget: the wait leaves the return margin for the answer.
  assert.equal(localScreenshotWaitMsForResult(false, pressed, { providerDeadlineAt: at(10), now }), 10_000 - PRESSED_SCREENSHOT_RETURN_MARGIN_MS);
  // The buzzer shape: the result landed at the action deadline, ten seconds before the caller's; no wait.
  assert.equal(localScreenshotWaitMsForResult(false, pressed, { providerDeadlineAt: at(10), now }) < 10_000, true);
  assert.equal(localScreenshotWaitMsForResult(false, pressed, { providerDeadlineAt: at(2), now }), 0);
  assert.equal(localScreenshotWaitMsForResult(false, pressed, { providerDeadlineAt: at(-5), now }), 0);
  // No deadline on the run (a caller that never sent one): the flat wait, as the host's own wait bounds it.
  assert.equal(localScreenshotWaitMsForResult(false, pressed, { providerDeadlineAt: undefined, now }), PRESSED_SCREENSHOT_WAIT_MS);
  assert.equal(localScreenshotWaitMsForResult(false, pressed, { providerDeadlineAt: 'not a date', now }), PRESSED_SCREENSHOT_WAIT_MS);
  // Unpressed results never consult the deadline.
  assert.equal(localScreenshotWaitMsForResult(true, {}, { providerDeadlineAt: at(-5), now }), SCREENSHOT_ARTIFACT_WAIT_MS);
});

test('the one call site is pinned: readResult waits through the local rule with the run\'s deadline, behind the screenshot gate', () => {
  const source = readFileSync(fileURLToPath(new URL('../src/local-managed-runner.js', import.meta.url)), 'utf8');
  assert.match(source, /async function readResult\(session, phase, screenshot, screenshotWait, providerDeadlineAt\) \{/u);
  assert.match(source, /if \(screenshot\) \{\s*const bytes = await waitForLocalScreenshot\(\s*session,\s*phase,\s*localScreenshotWaitMsForResult\(screenshotWait, result, \{ providerDeadlineAt \}\),\s*\);/u);
  assert.match(source, /readResult\(session, 0, context\.screenshot, context\.screenshotWait, context\.providerDeadlineAt\)/u);
  assert.match(source, /readResult\(session, 1, continuation\.screenshot, continuation\.screenshotWait, continuation\.providerDeadlineAt\)/u);
  assert.ok(!/waitForLocalScreenshot\(session, phase, screenshotWaitMsForResult\(/u.test(source), 'the sandbox-only rule is no longer the call');
});

test('an unpressed result keeps the sandbox contract exactly', () => {
  for (const [screenshotWait, result] of [
    [true, { submitOutcome: { pressed: false } }],
    [true, {}],
    [false, {}],
    [undefined, {}],
    [false, { submitOutcome: { pressed: false } }],
  ]) {
    assert.equal(localScreenshotWaitMsForResult(screenshotWait, result), screenshotWaitMsForResult(screenshotWait, result));
  }
  assert.equal(localScreenshotWaitMsForResult(true, {}), SCREENSHOT_ARTIFACT_WAIT_MS);
  assert.equal(localScreenshotWaitMsForResult(false, {}), 0);
});

test('the measured shape: the runner publishes the result, then the picture seconds later, and the host now receives it', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stratus-pressed-'));
  const session = { directory, child: { exitCode: null } };
  const publish = setTimeout(async () => {
    const temporary = path.join(directory, 'stratus-screenshot-0.png.tmp-1-abc');
    await fs.writeFile(temporary, Buffer.from('receipt-png'));
    await fs.rename(temporary, path.join(directory, 'stratus-screenshot-0.png'));
  }, 300);
  try {
    const waitMs = localScreenshotWaitMsForResult(false, { submitOutcome: { pressed: true, state: 'unknown' } });
    const started = Date.now();
    const bytes = await waitForLocalScreenshot(session, 0, waitMs, 50);
    assert.equal(bytes?.toString(), 'receipt-png');
    assert.ok(Date.now() - started >= 250, 'the read waited for the publication');
    // The old rule would have read once and left with nothing.
    await fs.rm(path.join(directory, 'stratus-screenshot-0.png'));
    assert.equal(await waitForLocalScreenshot(session, 0, screenshotWaitMsForResult(false, { submitOutcome: { pressed: true } }), 50), null);
  } finally {
    clearTimeout(publish);
    await fs.rm(directory, { recursive: true, force: true });
  }
});
