/* A pressed run's picture is the receipt. See localScreenshotWaitMsForResult in
 * src/local-managed-runner.js for the measured Hudson River Trading send of 2026-09-04. */
import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import {
  localScreenshotWaitMsForResult,
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
