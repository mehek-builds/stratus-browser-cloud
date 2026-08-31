import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ACK_MANAGED_TERMINAL_RESULT_SCRIPT,
  acknowledgeManagedTerminalResult,
  executeSandboxRun,
  managedSubmissionRequestDigest,
  managedTerminalResultSandboxName,
  MANAGED_SUBMISSION_RESERVATION_PATH,
  MANAGED_SUBMISSION_RESERVATION_SCHEMA_VERSION,
  MANAGED_TERMINAL_ACK_PATH,
  MANAGED_TERMINAL_ACK_SCHEMA_VERSION,
  MANAGED_TERMINAL_RESULT_PATH,
  MANAGED_TERMINAL_RESULT_SCHEMA_VERSION,
  normalizeManagedRun,
  retrieveManagedTerminalResult,
} from '../src/managed-browser.js';

const TEMPLATE_NAME = 'stratus-browser-runtime-pw-1-61-1-v4';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ATTEMPT = Object.freeze({
  runId: '11111111-1111-4111-8111-111111111111',
  claimId: '22222222-2222-4222-8222-222222222222',
  executionId: '33333333-3333-4333-8333-333333333333',
});
const PROJECT_BINDING = 'terminal-result-tests';
const projectHash = (value) => crypto.createHash('sha256').update(value).digest('hex');
const deadline = (offsetMs = 240_000) => new Date(Date.now() + offsetMs).toISOString();
const request = (overrides = {}) => ({
  url: 'https://jobs.example.com/apply/one',
  actions: [],
  allowSubmit: true,
  screenshot: false,
  submissionAttempt: ATTEMPT,
  providerDeadlineAt: deadline(),
  ...overrides,
});

function reservationBuffer(requestDigest, {
  projectBinding = PROJECT_BINDING,
  submissionAttempt = ATTEMPT,
  reservedAt = new Date().toISOString(),
} = {}) {
  return Buffer.from(JSON.stringify({
    schemaVersion: MANAGED_SUBMISSION_RESERVATION_SCHEMA_VERSION,
    projectBindingHash: projectHash(projectBinding),
    submissionAttempt,
    requestDigest,
    reservedAt,
    expiresAt: new Date(Date.parse(reservedAt) + RETENTION_MS).toISOString(),
  }));
}

function terminalBuffer(input, run = null, {
  state = 'completed',
  phase = 0,
  completedAt = new Date().toISOString(),
} = {}) {
  const common = {
    schemaVersion: MANAGED_TERMINAL_RESULT_SCHEMA_VERSION,
    projectBindingHash: input.terminalResultProjectHash,
    submissionAttempt: input.submissionAttempt,
    requestDigest: input.terminalResultRequestDigest,
    state,
    completedAt,
    expiresAt: new Date(Date.parse(completedAt) + RETENTION_MS).toISOString(),
    phase,
  };
  const core = state === 'completed'
    ? { ...common, run }
    : {
        ...common,
        error: { code: 'SANDBOX_RUN_FAILED', message: 'Managed browser run failed' },
      };
  return Buffer.from(JSON.stringify({
    ...core,
    resultId: projectHash(JSON.stringify(core)),
    persistedAt: new Date().toISOString(),
  }));
}

function fakeSandboxApi() {
  const template = { name: TEMPLATE_NAME, currentSnapshotId: 'snapshot' };
  const sandboxes = new Map();
  const calls = { forks: 0, runnerStarts: 0, acknowledgements: 0 };

  class FakeSandbox {
    constructor(name) {
      this.name = name;
      this.files = new Map();
      this.stopCalls = 0;
    }

    async writeFiles(files) {
      for (const file of files) this.files.set(file.path, Buffer.from(file.content));
    }

    async runCommand(command, args) {
      if (typeof command === 'object') {
        calls.runnerStarts += 1;
        const input = JSON.parse(this.files.get('stratus-input.json').toString('utf8'));
        const run = {
          title: 'Application received',
          url: 'https://jobs.example.com/thanks',
          submitOutcome: { pressed: true, state: 'confirmed' },
          continuationOffered: false,
          submissionAttempt: input.submissionAttempt,
        };
        this.files.set('stratus-result-0.json', Buffer.from(JSON.stringify(run)));
        this.files.set(MANAGED_TERMINAL_RESULT_PATH, terminalBuffer(input, run));
        return { exitCode: null };
      }

      if (command === 'node' && args?.[1] === ACK_MANAGED_TERMINAL_RESULT_SCRIPT) {
        calls.acknowledgements += 1;
        const expected = JSON.parse(args[2]);
        const existing = this.files.get(MANAGED_TERMINAL_ACK_PATH);
        if (existing) return { exitCode: 0, stdout: async () => existing.toString('utf8') };
        const terminal = JSON.parse(this.files.get(MANAGED_TERMINAL_RESULT_PATH).toString('utf8'));
        const acknowledgedAt = new Date().toISOString();
        const acknowledgement = {
          schemaVersion: MANAGED_TERMINAL_ACK_SCHEMA_VERSION,
          projectBindingHash: expected.projectBindingHash,
          submissionAttempt: expected.submissionAttempt,
          requestDigest: terminal.requestDigest,
          resultId: terminal.resultId,
          acknowledgedAt,
          expiresAt: new Date(Date.parse(acknowledgedAt) + RETENTION_MS).toISOString(),
        };
        this.files.set(MANAGED_TERMINAL_ACK_PATH, Buffer.from(JSON.stringify(acknowledgement)));
        this.files.delete(MANAGED_TERMINAL_RESULT_PATH);
        return { exitCode: 0, stdout: async () => JSON.stringify(acknowledgement) };
      }

      const wanted = args.slice(3);
      const found = wanted.find((path) => this.files.has(path));
      return found
        ? { exitCode: 0, stdout: async () => found }
        : { exitCode: 3, stdout: async () => '' };
    }

    async readFileToBuffer({ path }) {
      return this.files.get(path) || null;
    }

    async stop() {
      this.stopCalls += 1;
    }
  }

  return {
    calls,
    sandboxes,
    api: {
      async get({ name }) {
        if (name === TEMPLATE_NAME) return template;
        return sandboxes.get(name) || null;
      },
      async fork(options) {
        calls.forks += 1;
        if (sandboxes.has(options.name)) {
          throw Object.assign(new Error('sandbox name already exists'), { status: 409 });
        }
        const sandbox = new FakeSandbox(options.name);
        sandboxes.set(options.name, sandbox);
        return sandbox;
      },
    },
    seed(files, submissionAttempt = ATTEMPT) {
      const name = managedTerminalResultSandboxName(PROJECT_BINDING, submissionAttempt);
      const sandbox = new FakeSandbox(name);
      for (const [path, value] of files) sandbox.files.set(path, Buffer.from(value));
      sandboxes.set(name, sandbox);
      return sandbox;
    },
  };
}

test('request correlation ignores only a fresh provider deadline', async () => {
  const first = await normalizeManagedRun(request({ providerDeadlineAt: deadline(180_000) }), {
    urlValidator: async (value) => new URL(value),
  });
  const replay = await normalizeManagedRun(request({ providerDeadlineAt: deadline(200_000) }), {
    urlValidator: async (value) => new URL(value),
  });
  const changed = await normalizeManagedRun(request({
    providerDeadlineAt: deadline(200_000),
    actions: [{ type: 'waitForSelector', selector: '#changed' }],
  }), { urlValidator: async (value) => new URL(value) });

  assert.equal(managedSubmissionRequestDigest(first), managedSubmissionRequestDigest(replay));
  assert.notEqual(managedSubmissionRequestDigest(first), managedSubmissionRequestDigest(changed));
});

test('a lost response is retrieved and the same execution never dispatches twice', async () => {
  const fake = fakeSandboxApi();
  const options = {
    sandboxApi: fake.api,
    projectBinding: PROJECT_BINDING,
    urlValidator: async (value) => new URL(value),
  };

  await executeSandboxRun(request(), options);
  assert.deepEqual(fake.calls, { forks: 1, runnerStarts: 1, acknowledgements: 0 });

  const recovered = await retrieveManagedTerminalResult(
    { submissionAttempt: ATTEMPT },
    { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
  );
  assert.equal(recovered.state, 'completed');
  assert.equal(recovered.run.submitOutcome.state, 'confirmed');
  assert.deepEqual(recovered.submissionAttempt, ATTEMPT);
  assert.ok(Date.parse(recovered.expiresAt) - Date.parse(recovered.completedAt) >= 24 * 60 * 60 * 1000);

  const replay = await executeSandboxRun(request({ providerDeadlineAt: deadline(220_000) }), options);
  assert.equal(replay.submitOutcome.state, 'confirmed');
  assert.deepEqual(fake.calls, { forks: 1, runnerStarts: 1, acknowledgements: 0 });

  await assert.rejects(
    executeSandboxRun(request({
      url: 'https://jobs.example.com/apply/different',
      providerDeadlineAt: deadline(220_000),
    }), options),
    (error) => error.code === 'SUBMISSION_EXECUTION_CONFLICT' && error.status === 409,
  );
  assert.deepEqual(fake.calls, { forks: 1, runnerStarts: 1, acknowledgements: 0 });
});

test('pending reservation blocks acknowledgement and any second dispatch', async () => {
  const fake = fakeSandboxApi();
  const normalized = await normalizeManagedRun(request(), {
    urlValidator: async (value) => new URL(value),
  });
  const requestDigest = managedSubmissionRequestDigest(normalized);
  fake.seed([
    [MANAGED_SUBMISSION_RESERVATION_PATH, reservationBuffer(requestDigest)],
  ]);

  const pending = await retrieveManagedTerminalResult(
    { submissionAttempt: ATTEMPT },
    { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
  );
  assert.equal(pending.state, 'pending');
  assert.deepEqual(pending.submissionAttempt, ATTEMPT);

  await assert.rejects(
    acknowledgeManagedTerminalResult(
      { submissionAttempt: ATTEMPT },
      { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
    ),
    (error) => error.code === 'SUBMISSION_EXECUTION_IN_PROGRESS' && error.status === 409,
  );
  await assert.rejects(
    executeSandboxRun(request({ providerDeadlineAt: deadline(210_000) }), {
      sandboxApi: fake.api,
      projectBinding: PROJECT_BINDING,
      urlValidator: async (value) => new URL(value),
    }),
    (error) => error.code === 'SUBMISSION_EXECUTION_IN_PROGRESS' && error.status === 409,
  );
  assert.equal(fake.calls.runnerStarts, 0);
  assert.equal(fake.calls.forks, 0);
});

test('failed terminal results remain readable as a correlated terminal outcome', async () => {
  const fake = fakeSandboxApi();
  const requestDigest = 'b'.repeat(64);
  const input = {
    submissionAttempt: ATTEMPT,
    terminalResultProjectHash: projectHash(PROJECT_BINDING),
    terminalResultRequestDigest: requestDigest,
  };
  fake.seed([
    [MANAGED_SUBMISSION_RESERVATION_PATH, reservationBuffer(requestDigest)],
    [MANAGED_TERMINAL_RESULT_PATH, terminalBuffer(input, null, { state: 'failed' })],
  ]);

  const recovered = await retrieveManagedTerminalResult(
    { submissionAttempt: ATTEMPT },
    { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
  );
  assert.deepEqual(recovered.error, {
    code: 'SANDBOX_RUN_FAILED',
    message: 'Managed browser run failed',
  });
  assert.equal(recovered.state, 'failed');
});

test('acknowledgement is idempotent and its tombstone prevents relaunch', async () => {
  const fake = fakeSandboxApi();
  const options = {
    sandboxApi: fake.api,
    projectBinding: PROJECT_BINDING,
    urlValidator: async (value) => new URL(value),
  };
  await executeSandboxRun(request(), options);

  const first = await acknowledgeManagedTerminalResult(
    { submissionAttempt: ATTEMPT },
    { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
  );
  const second = await acknowledgeManagedTerminalResult(
    { submissionAttempt: ATTEMPT },
    { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
  );
  assert.equal(second.acknowledgedAt, first.acknowledgedAt);
  assert.equal(fake.calls.acknowledgements, 1);

  await assert.rejects(
    retrieveManagedTerminalResult(
      { submissionAttempt: ATTEMPT },
      { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
    ),
    (error) => error.code === 'SUBMISSION_EXECUTION_GONE' && error.status === 410,
  );
  await assert.rejects(
    executeSandboxRun(request({ providerDeadlineAt: deadline(210_000) }), options),
    (error) => error.code === 'SUBMISSION_EXECUTION_GONE' && error.status === 410,
  );
  assert.equal(fake.calls.runnerStarts, 1);
  assert.equal(fake.calls.forks, 1);
});

test('unknown and expired attempt tuples have distinct recovery outcomes', async () => {
  const empty = fakeSandboxApi();
  await assert.rejects(
    retrieveManagedTerminalResult(
      { submissionAttempt: ATTEMPT },
      { sandboxApi: empty.api, projectBinding: PROJECT_BINDING },
    ),
    (error) => error.code === 'SUBMISSION_EXECUTION_NOT_FOUND' && error.status === 404,
  );

  const expired = fakeSandboxApi();
  const requestDigest = 'c'.repeat(64);
  const input = {
    submissionAttempt: ATTEMPT,
    terminalResultProjectHash: projectHash(PROJECT_BINDING),
    terminalResultRequestDigest: requestDigest,
  };
  const completedAt = new Date(Date.now() - RETENTION_MS - 1_000).toISOString();
  expired.seed([
    [MANAGED_SUBMISSION_RESERVATION_PATH, reservationBuffer(requestDigest)],
    [MANAGED_TERMINAL_RESULT_PATH, terminalBuffer(
      input,
      { title: 'Expired', submissionAttempt: ATTEMPT },
      { completedAt },
    )],
  ]);

  await assert.rejects(
    retrieveManagedTerminalResult(
      { submissionAttempt: ATTEMPT },
      { sandboxApi: expired.api, projectBinding: PROJECT_BINDING },
    ),
    (error) => error.code === 'SUBMISSION_EXECUTION_GONE' && error.status === 410,
  );
});

test('acknowledgement script durably tombstones and scrubs applicant artifacts', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-terminal-ack-'));
  try {
    const requestDigest = 'd'.repeat(64);
    const input = {
      submissionAttempt: ATTEMPT,
      terminalResultProjectHash: projectHash(PROJECT_BINDING),
      terminalResultRequestDigest: requestDigest,
    };
    fs.writeFileSync(
      path.join(directory, MANAGED_SUBMISSION_RESERVATION_PATH),
      reservationBuffer(requestDigest),
    );
    fs.writeFileSync(
      path.join(directory, MANAGED_TERMINAL_RESULT_PATH),
      terminalBuffer(input, { title: 'Application received' }),
    );
    fs.writeFileSync(path.join(directory, 'stratus-input.json'), '{"applicant":"private"}');
    fs.writeFileSync(path.join(directory, 'stratus-result-0.json'), '{"page":"private"}');
    fs.writeFileSync(path.join(directory, 'stratus-screenshot-0.png'), 'private');

    const expected = JSON.stringify({
      projectBindingHash: projectHash(PROJECT_BINDING),
      submissionAttempt: ATTEMPT,
    });
    const first = spawnSync(
      process.execPath,
      ['-e', ACK_MANAGED_TERMINAL_RESULT_SCRIPT, expected],
      { cwd: directory, encoding: 'utf8' },
    );
    assert.equal(first.status, 0, first.stderr);
    const firstAck = JSON.parse(first.stdout);
    assert.equal(firstAck.requestDigest, requestDigest);
    assert.ok(fs.existsSync(path.join(directory, MANAGED_SUBMISSION_RESERVATION_PATH)));
    assert.ok(fs.existsSync(path.join(directory, MANAGED_TERMINAL_ACK_PATH)));
    assert.equal(fs.existsSync(path.join(directory, MANAGED_TERMINAL_RESULT_PATH)), false);
    assert.equal(fs.existsSync(path.join(directory, 'stratus-input.json')), false);
    assert.equal(fs.existsSync(path.join(directory, 'stratus-result-0.json')), false);
    assert.equal(fs.existsSync(path.join(directory, 'stratus-screenshot-0.png')), false);

    const replay = spawnSync(
      process.execPath,
      ['-e', ACK_MANAGED_TERMINAL_RESULT_SCRIPT, expected],
      { cwd: directory, encoding: 'utf8' },
    );
    assert.equal(replay.status, 0, replay.stderr);
    assert.equal(JSON.parse(replay.stdout).acknowledgedAt, firstAck.acknowledgedAt);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
