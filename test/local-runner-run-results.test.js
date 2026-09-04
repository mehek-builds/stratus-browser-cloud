/* THE RESULT THAT WENT TO A CLOSED SOCKET, pinned. See src/local-terminal-results.js for the
 * measured run (HRT attempt 2b521d32, 2026-09-04). These tests drive the store directly and the
 * two routes over HTTP against the Railway server, asserting the exact shapes litos-api parses in
 * student-outreach-backend src/lib/browserbase.ts getManagedBrowserTerminalResult and
 * acknowledgeManagedBrowserTerminalResult. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { LocalTerminalResultStore, normalizeLocalSubmissionAttempt } from '../src/local-terminal-results.js';

const ATTEMPT = Object.freeze({
  runId: 'f4cf9b15-5107-4f4f-bd13-1be70fbb1737',
  claimId: '2b521d32-e479-4077-ade0-f388d225502c',
  executionId: '33333333-3333-4333-8333-333333333333',
});
const OTHER = Object.freeze({ ...ATTEMPT, executionId: '44444444-4444-4444-8444-444444444444' });
const RUN = Object.freeze({
  submissionAttempt: ATTEMPT,
  submitPressed: true,
  submitState: 'unknown',
  requiredFieldConfirmation: 'confirmed',
  filledFields: [{ label: 'First Name' }],
  screenshot: 'iVBORw0KGgo=',
});
const HEX64 = /^[a-f0-9]{64}$/;

function clock(startMs) {
  let nowMs = startMs;
  return { now: () => nowMs, advance: (ms) => { nowMs += ms; } };
}

test('a durable attempt tuple is exact: three lowercase UUIDs and nothing else', () => {
  assert.deepEqual(normalizeLocalSubmissionAttempt({ ...ATTEMPT, runId: ATTEMPT.runId.toUpperCase() }), ATTEMPT);
  for (const bad of [null, 'x', [], {}, { ...ATTEMPT, extra: 1 }, { ...ATTEMPT, runId: 'not-a-uuid' }, { runId: ATTEMPT.runId, claimId: ATTEMPT.claimId }]) {
    assert.equal(normalizeLocalSubmissionAttempt(bad), null, JSON.stringify(bad));
  }
});

test('the measured run: reserved before the runner starts, retained when it finishes, released when acknowledged', async () => {
  const time = clock(Date.parse('2026-09-04T15:53:10.000Z'));
  const store = new LocalTerminalResultStore({ now: time.now });
  assert.equal((await store.lookup(ATTEMPT)).status, 404);

  await store.reservePending(ATTEMPT, time.now() + 330_000);
  const pending = await store.lookup(ATTEMPT);
  assert.equal(pending.status, 202);
  assert.deepEqual(pending.body, { state: 'pending', submissionAttempt: ATTEMPT, expiresAt: '2026-09-04T15:58:40.000Z' });

  time.advance(157_418);
  const retained = await store.retain(ATTEMPT, { state: 'completed', run: RUN });
  assert.match(retained.resultId, HEX64);
  const completed = await store.lookup(ATTEMPT);
  assert.equal(completed.status, 200);
  assert.equal(completed.body.state, 'completed');
  assert.deepEqual(completed.body.submissionAttempt, ATTEMPT);
  assert.equal(completed.body.resultId, retained.resultId);
  assert.equal(completed.body.completedAt, '2026-09-04T15:55:47.418Z');
  assert.equal(completed.body.expiresAt, '2026-09-04T21:55:47.418Z');
  // The run is echoed whole, minus the picture, and says so.
  assert.deepEqual(completed.body.run.submissionAttempt, ATTEMPT);
  assert.equal(completed.body.run.submitPressed, true);
  assert.equal(completed.body.run.screenshot, null);
  assert.equal(completed.body.run.screenshotRetained, false);
  assert.ok(!('reservedAt' in completed.body));

  await assert.rejects(() => store.acknowledge(ATTEMPT, 'a'.repeat(64)), (error) => error.code === 'TERMINAL_RESULT_ID_MISMATCH' && error.status === 409);
  const ack = await store.acknowledge(ATTEMPT, retained.resultId);
  assert.equal(ack.acknowledged, true);
  assert.deepEqual(ack.submissionAttempt, ATTEMPT);
  assert.equal(ack.resultId, retained.resultId);
  assert.equal(ack.cleanupState, 'completed');
  assert.equal(ack.acknowledgedAt, '2026-09-04T15:55:47.418Z');
  const gone = await store.lookup(ATTEMPT);
  assert.equal(gone.status, 410);
  assert.equal(gone.body.error.code, 'TERMINAL_RESULT_ACKNOWLEDGED');
  // Acknowledging again is idempotent, never a second cleanup.
  assert.equal((await store.acknowledge(ATTEMPT, retained.resultId)).acknowledgedAt, ack.acknowledgedAt);
});

test('a runner that failed or was lost is retained as failed or indeterminate with its error and progress', async () => {
  const store = new LocalTerminalResultStore({ now: clock(Date.parse('2026-09-04T16:00:00.000Z')).now });
  await store.reservePending(ATTEMPT, Date.parse('2026-09-04T16:05:00.000Z'));
  const error = Object.assign(new Error('A non-submit action attempted employer transport without exact final authority'), { code: 'SANDBOX_RUN_FAILED', status: 502 });
  const failed = await store.retain(ATTEMPT, { state: 'failed', error, runProgress: { stage: 'fill', submissionAttempt: ATTEMPT } });
  const answer = await store.lookup(ATTEMPT);
  assert.equal(answer.status, 200);
  assert.equal(answer.body.state, 'failed');
  assert.deepEqual(answer.body.error, { code: 'SANDBOX_RUN_FAILED', message: error.message });
  assert.deepEqual(answer.body.runProgress, { stage: 'fill', submissionAttempt: ATTEMPT });
  assert.match(answer.body.resultId, HEX64);
  assert.equal(failed.resultId, answer.body.resultId);

  const other = new LocalTerminalResultStore();
  await other.reservePending(OTHER, Date.now() + 1000);
  await other.retain(OTHER, { state: 'indeterminate', error: { message: 'Managed browser run timed out before it produced a result', code: 'RUN_TIMED_OUT' } });
  const lost = await other.lookup(OTHER);
  assert.equal(lost.body.state, 'indeterminate');
  assert.equal(lost.body.error.code, 'RUN_TIMED_OUT');
  await assert.rejects(() => other.retain(OTHER, { state: 'nonsense' }), (e) => e.code === 'TERMINAL_RESULT_STORE_UNAVAILABLE');
});

test('acknowledging a pending or unknown attempt, or with a malformed id, is refused with the exact code', async () => {
  const store = new LocalTerminalResultStore();
  await assert.rejects(() => store.acknowledge(ATTEMPT, 'b'.repeat(64)), (e) => e.code === 'TERMINAL_RESULT_NOT_FOUND' && e.status === 404);
  await store.reservePending(ATTEMPT, Date.now() + 1000);
  await assert.rejects(() => store.acknowledge(ATTEMPT, 'b'.repeat(64)), (e) => e.code === 'TERMINAL_RESULT_PENDING' && e.status === 409);
  await assert.rejects(() => store.acknowledge(ATTEMPT, 'B'.repeat(64)), (e) => e.code === 'INVALID_RUN_RESULT_ACKNOWLEDGEMENT' && e.status === 400);
  await assert.rejects(() => store.lookup({ runId: 'x' }), (e) => e.code === 'INVALID_RUN_RESULT_REQUEST' && e.status === 400);
  // A second reservation for a tuple that already has a result is a conflict, never an overwrite.
  await store.retain(ATTEMPT, { state: 'completed', run: RUN });
  await assert.rejects(() => store.reservePending(ATTEMPT, Date.now() + 1000), (e) => e.code === 'SUBMISSION_EXECUTION_CONFLICT' && e.status === 409);
  // A tuple this host never started is a 404, not somebody else's result.
  assert.equal((await store.lookup(OTHER)).status, 404);
});

test('records survive a restart of the process through their files, and expire on schedule', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-terminal-'));
  try {
    const time = clock(Date.parse('2026-09-04T16:00:00.000Z'));
    const first = new LocalTerminalResultStore({ directory, now: time.now, retentionMs: 60_000 });
    await first.reservePending(ATTEMPT, time.now() + 10_000);
    const retained = await first.retain(ATTEMPT, { state: 'completed', run: RUN });
    assert.ok(fs.existsSync(path.join(directory, `${ATTEMPT.runId}_${ATTEMPT.claimId}_${ATTEMPT.executionId}.json`)));

    const second = new LocalTerminalResultStore({ directory, now: time.now, retentionMs: 60_000 });
    const answer = await second.lookup(ATTEMPT);
    assert.equal(answer.status, 200);
    assert.equal(answer.body.resultId, retained.resultId);

    time.advance(60_001);
    assert.equal((await second.lookup(ATTEMPT)).status, 404);
    assert.ok(!fs.existsSync(path.join(directory, `${ATTEMPT.runId}_${ATTEMPT.claimId}_${ATTEMPT.executionId}.json`)));

    // A pending reservation whose deadline passed is kept for the retention window, so a late
    // lookup learns the run was started here rather than reading a false 404.
    await second.reservePending(OTHER, time.now() + 5_000);
    time.advance(30_000);
    assert.equal((await second.lookup(OTHER)).status, 202);
    time.advance(60_000);
    assert.equal((await second.lookup(OTHER)).status, 404);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('the Railway server answers /api/run-results and /api/run-results/acknowledge with the same contract, behind the run key', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-terminal-server-'));
  process.env.STRATUS_DATA_DIR = directory;
  const { createApp } = await import('../src/server.js');
  const { terminalResults } = await import('../src/local-managed-runner.js');
  const app = createApp({ database: ':memory:' });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const headers = { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me', 'Content-Type': 'application/json' };
  const query = new URLSearchParams(ATTEMPT).toString();
  try {
    // Before this change both paths fell through to the dashboard's index.html at 200.
    const unauthenticated = await fetch(`${base}/api/run-results?${query}`);
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get('content-type') || '', /application\/json/);

    const unknown = await fetch(`${base}/api/run-results?${query}`, { headers });
    assert.equal(unknown.status, 404);
    assert.equal((await unknown.json()).error.code, 'TERMINAL_RESULT_NOT_FOUND');

    const malformed = await fetch(`${base}/api/run-results?runId=${ATTEMPT.runId}`, { headers });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).error.code, 'INVALID_RUN_RESULT_REQUEST');

    const wrongMethod = await fetch(`${base}/api/run-results?${query}`, { method: 'POST', headers, body: '{}' });
    assert.equal(wrongMethod.status, 405);

    await terminalResults.reservePending(ATTEMPT, Date.now() + 60_000);
    const pending = await fetch(`${base}/api/run-results?${query}`, { headers });
    assert.equal(pending.status, 202);
    const pendingBody = await pending.json();
    assert.equal(pendingBody.state, 'pending');
    assert.deepEqual(pendingBody.submissionAttempt, ATTEMPT);
    assert.ok(Number.isFinite(Date.parse(pendingBody.expiresAt)));

    const retained = await terminalResults.retain(ATTEMPT, { state: 'completed', run: RUN });
    const completed = await fetch(`${base}/api/run-results?${query}`, { headers });
    assert.equal(completed.status, 200);
    const body = await completed.json();
    assert.equal(body.state, 'completed');
    assert.equal(body.resultId, retained.resultId);
    assert.deepEqual(body.run.submissionAttempt, ATTEMPT);
    assert.equal(body.run.submitPressed, true);

    const badAck = await fetch(`${base}/api/run-results/acknowledge`, { method: 'POST', headers, body: JSON.stringify({ submissionAttempt: ATTEMPT, resultId: 'c'.repeat(64) }) });
    assert.equal(badAck.status, 409);
    const ack = await fetch(`${base}/api/run-results/acknowledge`, { method: 'POST', headers, body: JSON.stringify({ submissionAttempt: ATTEMPT, resultId: retained.resultId }) });
    assert.equal(ack.status, 200);
    const ackBody = await ack.json();
    assert.equal(ackBody.acknowledged, true);
    assert.equal(ackBody.cleanupState, 'completed');
    assert.equal(ackBody.resultId, retained.resultId);
    assert.deepEqual(ackBody.submissionAttempt, ATTEMPT);

    const gone = await fetch(`${base}/api/run-results?${query}`, { headers });
    assert.equal(gone.status, 410);
  } finally {
    await app.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
