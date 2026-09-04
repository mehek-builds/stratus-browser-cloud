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
  const unknownState = { ...ATTEMPT, executionId: '55555555-5555-4555-8555-555555555555' };
  await other.reservePending(unknownState, Date.now() + 1000);
  await assert.rejects(() => other.retain(unknownState, { state: 'nonsense' }), (e) => e.code === 'TERMINAL_RESULT_STORE_UNAVAILABLE');
});

test('acknowledging a pending or unknown attempt, or with a malformed id, is refused with the exact code', async () => {
  const store = new LocalTerminalResultStore();
  await assert.rejects(() => store.acknowledge(ATTEMPT, 'b'.repeat(64)), (e) => e.code === 'TERMINAL_RESULT_NOT_FOUND' && e.status === 404);
  await store.reservePending(ATTEMPT, Date.now() + 1000);
  await assert.rejects(() => store.acknowledge(ATTEMPT, 'b'.repeat(64)), (e) => e.code === 'TERMINAL_RESULT_PENDING' && e.status === 409);
  await assert.rejects(() => store.acknowledge(ATTEMPT, 'B'.repeat(64)), (e) => e.code === 'INVALID_RUN_RESULT_ACKNOWLEDGEMENT' && e.status === 400);
  await assert.rejects(() => store.lookup({ runId: 'x' }), (e) => e.code === 'INVALID_RUN_RESULT_REQUEST' && e.status === 400);
  // A second reservation while the first is executing is refused as in progress, never a second runner.
  await assert.rejects(() => store.reservePending(ATTEMPT, Date.now() + 1000), (e) => e.code === 'SUBMISSION_EXECUTION_IN_PROGRESS' && e.status === 409);
  // A second reservation for a tuple that already has a result is a conflict, never an overwrite.
  await store.retain(ATTEMPT, { state: 'completed', run: RUN });
  await assert.rejects(() => store.reservePending(ATTEMPT, Date.now() + 1000), (e) => e.code === 'SUBMISSION_EXECUTION_CONFLICT' && e.status === 409);
  // And a settled record is never rewritten by a later retain.
  await assert.rejects(() => store.retain(ATTEMPT, { state: 'failed', error: { message: 'late' } }), (e) => e.code === 'SUBMISSION_EXECUTION_CONFLICT');
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

    // A pending reservation is swept at its own deadline: by then this host has retained its own
    // indeterminate answer, and 202 past that point would make the caller wait on nobody.
    await second.reservePending(OTHER, time.now() + 5_000);
    time.advance(4_000);
    assert.equal((await second.lookup(OTHER)).status, 202);
    time.advance(2_000);
    assert.equal((await second.lookup(OTHER)).status, 404);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a reservation reloaded after a restart is answered as indeterminate, because the runner that owned it is gone', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-terminal-restart-'));
  try {
    const first = new LocalTerminalResultStore({ directory });
    await first.reservePending(ATTEMPT, Date.now() + 300_000);
    assert.equal((await first.lookup(ATTEMPT)).status, 202);
    // The process restarts: the volume still holds the pending file, the child does not exist.
    const second = new LocalTerminalResultStore({ directory });
    const answer = await second.lookup(ATTEMPT);
    assert.equal(answer.status, 200);
    assert.equal(answer.body.state, 'indeterminate');
    assert.equal(answer.body.error.code, 'RUN_LOST_ON_RESTART');
    assert.match(answer.body.resultId, HEX64);
    // And the same tuple cannot be started again here.
    await assert.rejects(() => second.reservePending(ATTEMPT, Date.now() + 1000), (e) => e.code === 'SUBMISSION_EXECUTION_CONFLICT');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a continuation supersedes the first phase for the same tuple, and nothing else may', async () => {
  const store = new LocalTerminalResultStore();
  await store.reservePending(ATTEMPT, Date.now() + 1000);
  const phase0 = await store.retain(ATTEMPT, { state: 'completed', run: { ...RUN, submitPressed: false, continuationOffered: true, continuationToken: 'tok' } });
  await assert.rejects(() => store.retain(ATTEMPT, { state: 'completed', run: RUN }), (e) => e.code === 'SUBMISSION_EXECUTION_CONFLICT');
  const phase1 = await store.retain(ATTEMPT, { state: 'completed', run: { ...RUN, submitPressed: true }, continuation: true });
  assert.notEqual(phase1.resultId, phase0.resultId);
  const answer = await store.lookup(ATTEMPT);
  assert.equal(answer.body.resultId, phase1.resultId);
  assert.equal(answer.body.run.submitPressed, true);
  // Once the continuation has answered, the tuple is settled.
  await assert.rejects(() => store.retain(ATTEMPT, { state: 'completed', run: RUN, continuation: true }), (e) => e.code === 'SUBMISSION_EXECUTION_CONFLICT');
});

test('the timer sweep bounds the files without anyone looking anything up', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-terminal-sweep-'));
  try {
    const time = clock(Date.parse('2026-09-04T16:00:00.000Z'));
    const store = new LocalTerminalResultStore({ directory, now: time.now, retentionMs: 1_000 });
    await store.reservePending(ATTEMPT, time.now() + 500);
    await store.retain(ATTEMPT, { state: 'completed', run: RUN });
    assert.equal(fs.readdirSync(directory).length, 1);
    time.advance(2_000);
    const timer = store.startSweeping(20);
    assert.equal(store.startSweeping(20), timer, 'one timer');
    await new Promise((resolve) => setTimeout(resolve, 120));
    clearInterval(timer);
    assert.equal(fs.readdirSync(directory).length, 0);
    assert.equal(store.records.size, 0);
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
    const repeated = await fetch(`${base}/api/run-results?${query}&runId=${OTHER.runId}`, { headers });
    assert.equal(repeated.status, 400, 'a repeated key is refused, never collapsed to the last value');

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
