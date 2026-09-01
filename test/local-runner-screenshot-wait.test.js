import test from 'node:test';
import assert from 'node:assert/strict';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { waitForLocalScreenshot } from '../src/local-managed-runner.js';
import { screenshotWaitMsForResult, SCREENSHOT_ARTIFACT_WAIT_MS } from '../src/managed-browser.js';

async function withSession(run) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stratus-local-wait-'));
  const child = { exitCode: null };
  try { await run({ directory, child }); } finally { await fs.rm(directory, { recursive: true, force: true }); }
}

test('a preview published after the result is found, because the runner writes it second', async () => withSession(async (session) => {
  const publish = setTimeout(async () => {
    const temporary = path.join(session.directory, 'stratus-screenshot-0.png.tmp-1-abc');
    await fs.writeFile(temporary, Buffer.from('png-bytes'));
    await fs.rename(temporary, path.join(session.directory, 'stratus-screenshot-0.png'));
  }, 250);
  try {
    const started = Date.now();
    const bytes = await waitForLocalScreenshot(session, 0, 5_000, 50);
    assert.equal(bytes?.toString(), 'png-bytes');
    assert.ok(Date.now() - started >= 200, 'the read waited for the publication');
  } finally { clearTimeout(publish); }
}));

test('no wait was asked for: one read, absent means null at once, as before', async () => withSession(async (session) => {
  const started = Date.now();
  assert.equal(await waitForLocalScreenshot(session, 0, 0, 50), null);
  assert.ok(Date.now() - started < 100);
}));

test('a child that exited without publishing the preview ends the wait immediately', async () => withSession(async (session) => {
  session.child.exitCode = 0;
  const started = Date.now();
  assert.equal(await waitForLocalScreenshot(session, 0, 5_000, 50), null);
  assert.ok(Date.now() - started < 200, 'did not wait out the budget on a dead runner');
}));

test('a child that exits mid-wait ends the wait at the next poll', async () => withSession(async (session) => {
  setTimeout(() => { session.child.exitCode = 1; }, 150);
  const started = Date.now();
  assert.equal(await waitForLocalScreenshot(session, 0, 5_000, 50), null);
  const elapsed = Date.now() - started;
  assert.ok(elapsed >= 100 && elapsed < 1_000, `stopped soon after the exit, not at the deadline (${elapsed}ms)`);
}));

test('only clean absence is retried; any other read failure resolves at once', async () => withSession(async (session) => {
  await fs.mkdir(path.join(session.directory, 'stratus-screenshot-0.png'));
  const started = Date.now();
  assert.equal(await waitForLocalScreenshot(session, 0, 5_000, 50), null);
  assert.ok(Date.now() - started < 100);
}));

test('the wait budget is the sandbox host contract: asked for, unpressed, else zero', () => {
  assert.equal(screenshotWaitMsForResult(true, { submitOutcome: { pressed: false } }), SCREENSHOT_ARTIFACT_WAIT_MS);
  assert.equal(screenshotWaitMsForResult(true, {}), SCREENSHOT_ARTIFACT_WAIT_MS);
  assert.equal(screenshotWaitMsForResult(true, { submitOutcome: { pressed: true } }), 0);
  assert.equal(screenshotWaitMsForResult(false, {}), 0);
  assert.equal(screenshotWaitMsForResult(undefined, {}), 0);
});
