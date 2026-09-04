/* THE RUNNER HOOK, DRIVEN THROUGH THE REAL HOST. startRun builds the child's NODE_PATH from
 * process.cwd()/node_modules, so a fixture directory holding a stub `playwright` package stands in
 * for Chromium: its chromium.launch writes the runner's result or error file and never returns,
 * exactly the two shapes the host waits on. Every assertion here is about what the host does
 * around the run: reserve before spawning, retain what the runner said, put the retained id on the
 * synchronous answer, refuse a tuple already in flight or already answered without spawning, and
 * release the capacity slot on every path. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const ATTEMPT = Object.freeze({
  runId: 'aaaaaaaa-1111-4111-8111-111111111111',
  claimId: 'bbbbbbbb-2222-4222-8222-222222222222',
  executionId: 'cccccccc-3333-4333-8333-333333333333',
});
const FRESH = Object.freeze({ ...ATTEMPT, executionId: 'dddddddd-4444-4444-8444-444444444444' });

function stubPlaywright(fixture, behaviour) {
  const dir = path.join(fixture, 'node_modules', 'playwright');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'playwright', version: '0.0.0-stub', main: 'index.js' }));
  fs.writeFileSync(path.join(dir, 'index.js'), `
const fs = require('node:fs');
const behaviour = ${JSON.stringify(behaviour)};
module.exports = {
  chromium: {
    async launch() {
      const input = JSON.parse(fs.readFileSync('stratus-input.json', 'utf8'));
      if (behaviour === 'slow-result') await new Promise((resolve) => setTimeout(resolve, 1500));
      if (behaviour === 'result' || behaviour === 'slow-result') {
        fs.writeFileSync('stratus-result-0.json.tmp', JSON.stringify({
          url: input.url, title: 'stub', text: 'stub page', links: [], filledFields: [], blockers: [], skipped: [],
          submitOutcome: { pressed: true, state: 'unknown' }, elapsedMs: 1,
          submissionAttempt: input.submissionAttempt ?? null,
        }));
        fs.renameSync('stratus-result-0.json.tmp', 'stratus-result-0.json');
      } else if (behaviour === 'error') {
        fs.writeFileSync('stratus-error.json', JSON.stringify({ message: 'stub runner refused the page' }));
      }
      await new Promise(() => {});
    },
  },
};
`);
}

/* config.js is evaluated once per process, so every host in this file shares one data directory:
 * it is created once here and its terminal-results are wiped between hosts. */
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-hook-data-'));
process.env.STRATUS_DATA_DIR = DATA;
process.env.MANAGED_CONCURRENCY = '1';
process.on('exit', () => { try { fs.rmSync(DATA, { recursive: true, force: true }); } catch {} });

async function withHost(behaviour, run, { concurrency = 1 } = {}) {
  const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-hook-fixture-'));
  const previousCwd = process.cwd();
  stubPlaywright(fixture, behaviour);
  fs.rmSync(path.join(DATA, 'terminal-results'), { recursive: true, force: true });
  process.chdir(fixture);
  process.env.MANAGED_CONCURRENCY = String(concurrency);
  try {
    // A fresh module instance per host, so the module-level store and capacity set start empty.
    const runner = await import(`../src/local-managed-runner.js?hook=${Date.now()}-${Math.random()}`);
    await run(runner);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(fixture, { recursive: true, force: true });
  }
}

// A submit-capable run: only those, and continuations, are retained (parity with the sandbox host).
// A submit-capable run must carry an absolute provider deadline, as every real caller does.
const input = (attempt) => ({
  url: 'https://example.com/apply',
  actions: [],
  submissionAttempt: attempt,
  allowSubmit: true,
  providerDeadlineAt: new Date(Date.now() + 280_000).toISOString(),
});

test('a completed run is retained, its id rides on the synchronous answer, and the slot is released', async () => withHost('result', async ({ executeLocalManagedRun, terminalResults }) => {
  const result = await executeLocalManagedRun(input(ATTEMPT));
  assert.deepEqual(result.submissionAttempt, ATTEMPT);
  assert.equal(result.submitOutcome.pressed, true);
  assert.match(result.terminalResult.resultId, /^[a-f0-9]{64}$/);
  const answer = await terminalResults.lookup(ATTEMPT);
  assert.equal(answer.status, 200);
  assert.equal(answer.body.state, 'completed');
  assert.equal(answer.body.resultId, result.terminalResult.resultId);
  assert.equal(answer.body.run.submitOutcome.pressed, true);
  // The same tuple again: refused without spawning, and the host still has its one slot.
  await assert.rejects(() => executeLocalManagedRun(input(ATTEMPT)), (e) => e.code === 'SUBMISSION_EXECUTION_CONFLICT' && e.status === 409);
  const fresh = await executeLocalManagedRun(input(FRESH));
  assert.deepEqual(fresh.submissionAttempt, FRESH);
  assert.equal((await terminalResults.lookup(FRESH)).status, 200);
}));

test('while the runner is executing, the tuple answers pending and a second start of it is refused without a second runner', async () => withHost('slow-result', async ({ executeLocalManagedRun, terminalResults }) => {
  const running = executeLocalManagedRun(input(ATTEMPT));
  await new Promise((resolve) => setTimeout(resolve, 400));
  const during = await terminalResults.lookup(ATTEMPT);
  assert.equal(during.status, 202, 'reserved before the runner was spawned, so the run is visible while it executes');
  assert.equal(during.body.state, 'pending');
  // Two slots are free, so only the reservation can stop a second runner for the same tuple.
  await assert.rejects(() => executeLocalManagedRun(input(ATTEMPT)), (e) => e.code === 'SUBMISSION_EXECUTION_IN_PROGRESS' && e.status === 409);
  const result = await running;
  assert.match(result.terminalResult.resultId, /^[a-f0-9]{64}$/);
  const after = await terminalResults.lookup(ATTEMPT);
  assert.equal(after.status, 200);
  assert.equal(after.body.resultId, result.terminalResult.resultId);
}, { concurrency: 2 }));

test('a run the runner refused is retained as failed with its message, and the slot is released', async () => withHost('error', async ({ executeLocalManagedRun, terminalResults }) => {
  await assert.rejects(() => executeLocalManagedRun(input(ATTEMPT)), (e) => e.code === 'SANDBOX_RUN_FAILED' && /stub runner refused/.test(e.message));
  const answer = await terminalResults.lookup(ATTEMPT);
  assert.equal(answer.status, 200);
  assert.equal(answer.body.state, 'failed');
  assert.equal(answer.body.error.code, 'SANDBOX_RUN_FAILED');
  assert.match(answer.body.error.message, /stub runner refused/);
  // The slot came back: a fresh tuple runs (and fails the same way) instead of answering 429.
  await assert.rejects(() => executeLocalManagedRun(input(FRESH)), (e) => e.code === 'SANDBOX_RUN_FAILED');
}));

test('a run without a durable attempt, or a scan that cannot submit, is not retained at all', async () => withHost('result', async ({ executeLocalManagedRun, terminalResults }) => {
  // config.dataDir is fixed at first import, so a later host may reload earlier files: compare, do not count.
  await terminalResults.loaded;
  const before = terminalResults.records.size;
  const anonymous = await executeLocalManagedRun({ url: 'https://example.com/apply', actions: [] });
  assert.equal(anonymous.terminalResult, undefined);
  const scan = await executeLocalManagedRun({ url: 'https://example.com/apply', actions: [], submissionAttempt: FRESH });
  assert.equal(scan.terminalResult, undefined, 'a prepare or discovery run carries an ephemeral tuple nobody will ask for');
  assert.equal(terminalResults.records.size, before);
  assert.equal((await terminalResults.lookup(FRESH)).status, 404);
}));

test('the continuation input names its parent, and a continuation is retained under its own tuple', () => {
  const source = fs.readFileSync(new URL('../src/local-managed-runner.js', import.meta.url), 'utf8');
  assert.match(source, /JSON\.stringify\(\{ \.\.\.continuation, parentSubmissionAttempt: session\.submissionAttempt \}\)/u);
  assert.match(source, /const continuationAttempt = continuation\.submissionAttempt \?\? null;/u);
  assert.match(source, /terminalResults\.retain\(continuationAttempt, \{ state: 'completed', run: result \}\)/u);
  assert.ok(!/continuation: true/u.test(source), 'no supersession of the first phase');
});
