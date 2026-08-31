import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ACK_MANAGED_TERMINAL_RESULT_SCRIPT,
  FINALIZE_MANAGED_INDETERMINATE_SCRIPT,
  acknowledgeManagedTerminalResult,
  executeSandboxRun,
  managedSubmissionRequestDigest,
  managedTerminalResultSandboxName,
  MANAGED_PROVISIONING_LEASE_MS,
  PROBE_MANAGED_EXECUTION_SCRIPT,
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
  providerDeadlineAt = deadline(),
} = {}) {
  return Buffer.from(JSON.stringify({
    schemaVersion: MANAGED_SUBMISSION_RESERVATION_SCHEMA_VERSION,
    projectBindingHash: projectHash(projectBinding),
    submissionAttempt,
    requestDigest,
    providerDeadlineAt,
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
        error: state === 'indeterminate'
          ? {
              code: 'SUBMISSION_EXECUTION_INDETERMINATE',
              message: 'Managed browser execution ended without a terminal employer result',
            }
          : { code: 'SANDBOX_RUN_FAILED', message: 'Managed browser run failed' },
      };
  return Buffer.from(JSON.stringify({
    ...core,
    resultId: projectHash(JSON.stringify(core)),
    persistedAt: new Date().toISOString(),
  }));
}

function progressBuffer({ submissionAttempt = ATTEMPT, ...overrides } = {}) {
  return Buffer.from(JSON.stringify({
    version: 1,
    phase: 0,
    stage: 'submit_released',
    submitPressed: true,
    applicationSubmitPressed: true,
    verificationSubmitPressed: false,
    submitKind: 'application',
    policyVersion: 4,
    submissionAttempt,
    ...overrides,
  }));
}

function fakeSandboxApi() {
  const template = { name: TEMPLATE_NAME, currentSnapshotId: 'snapshot' };
  const sandboxes = new Map();
  const calls = { forks: 0, runnerStarts: 0, acknowledgements: 0 };

  class FakeSandbox {
    constructor(name, {
      createdAt = Date.now(),
      activeRunner = false,
      reservationOnProbe = null,
    } = {}) {
      this.name = name;
      this.files = new Map();
      this.stopCalls = 0;
      this.deleteCalls = 0;
      this.createdAt = new Date(createdAt);
      this.activeRunner = activeRunner;
      this.reservationOnProbe = reservationOnProbe;
    }

    async writeFiles(files) {
      for (const file of files) this.files.set(file.path, Buffer.from(file.content));
    }

    async runCommand(command, args) {
      if (command === 'node' && args?.[1] === PROBE_MANAGED_EXECUTION_SCRIPT) {
        if (this.reservationOnProbe) {
          this.files.set(MANAGED_SUBMISSION_RESERVATION_PATH, this.reservationOnProbe);
        }
        return {
          exitCode: 0,
          stdout: async () => JSON.stringify({
            reservation: this.files.has(MANAGED_SUBMISSION_RESERVATION_PATH),
            input: this.files.has('stratus-input.json'),
            progress: this.files.has('stratus-progress.json'),
            activeRunner: this.activeRunner,
          }),
        };
      }

      if (command === 'node' && args?.[1] === FINALIZE_MANAGED_INDETERMINATE_SCRIPT) {
        if (this.activeRunner) return { exitCode: 17, stdout: async () => '' };
        if (!this.files.has(MANAGED_TERMINAL_RESULT_PATH)) {
          const expected = JSON.parse(args[2]);
          let phase = 0;
          try {
            const progress = JSON.parse(this.files.get('stratus-progress.json').toString('utf8'));
            if (Number.isInteger(progress.phase)) phase = progress.phase;
          } catch {}
          const input = {
            submissionAttempt: expected.submissionAttempt,
            terminalResultProjectHash: expected.projectBindingHash,
            terminalResultRequestDigest: expected.requestDigest,
          };
          this.files.set(
            MANAGED_TERMINAL_RESULT_PATH,
            terminalBuffer(input, null, { state: 'indeterminate', phase }),
          );
        }
        return { exitCode: 0, stdout: async () => '' };
      }

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

    async delete() {
      this.deleteCalls += 1;
      sandboxes.delete(this.name);
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
    seed(files, submissionAttempt = ATTEMPT, options = {}) {
      const name = managedTerminalResultSandboxName(PROJECT_BINDING, submissionAttempt);
      const sandbox = new FakeSandbox(name, options);
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

test('only a stale and completely empty provisioning sandbox can be reclaimed', async () => {
  const fake = fakeSandboxApi();
  const abandoned = fake.seed([], ATTEMPT, {
    createdAt: Date.now() - MANAGED_PROVISIONING_LEASE_MS - 1_000,
  });
  const result = await executeSandboxRun(request(), {
    sandboxApi: fake.api,
    projectBinding: PROJECT_BINDING,
    urlValidator: async (value) => new URL(value),
  });

  assert.equal(abandoned.deleteCalls, 1);
  assert.equal(result.submitOutcome.state, 'confirmed');
  assert.equal(fake.calls.forks, 1);
  assert.equal(fake.calls.runnerStarts, 1);
});

test('active or artifact-bearing stale provisioning remains blocked', async () => {
  const cases = [
    { files: [], options: { activeRunner: true } },
    { files: [['stratus-input.json', '{}']], options: {} },
    { files: [['stratus-progress.json', '{}']], options: {} },
    {
      files: [],
      options: { reservationOnProbe: reservationBuffer('7'.repeat(64)) },
    },
  ];
  for (const candidate of cases) {
    const fake = fakeSandboxApi();
    const existing = fake.seed(candidate.files, ATTEMPT, {
      createdAt: Date.now() - MANAGED_PROVISIONING_LEASE_MS - 1_000,
      ...candidate.options,
    });
    await assert.rejects(
      executeSandboxRun(request(), {
        sandboxApi: fake.api,
        projectBinding: PROJECT_BINDING,
        urlValidator: async (value) => new URL(value),
      }),
      (error) => error.code === 'SUBMISSION_EXECUTION_IN_PROGRESS' && error.status === 409,
    );
    assert.equal(existing.deleteCalls, 0);
    assert.equal(fake.calls.forks, 0);
    assert.equal(fake.calls.runnerStarts, 0);
  }
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

test('failed recovery returns only normalized progress bound to the exact attempt', async () => {
  const requestDigest = 'e'.repeat(64);
  const input = {
    submissionAttempt: ATTEMPT,
    terminalResultProjectHash: projectHash(PROJECT_BINDING),
    terminalResultRequestDigest: requestDigest,
  };
  const mismatchedAttempt = {
    ...ATTEMPT,
    executionId: '44444444-4444-4444-8444-444444444444',
  };
  const cases = [
    { progress: progressBuffer(), expected: true },
    { progress: Buffer.from('{"submitPressed":true}'), expected: false },
    { progress: progressBuffer({ submissionAttempt: mismatchedAttempt }), expected: false },
  ];

  for (const candidate of cases) {
    const fake = fakeSandboxApi();
    fake.seed([
      [MANAGED_SUBMISSION_RESERVATION_PATH, reservationBuffer(requestDigest)],
      [MANAGED_TERMINAL_RESULT_PATH, terminalBuffer(input, null, { state: 'failed' })],
      ['stratus-progress.json', candidate.progress],
    ]);
    const recovered = await retrieveManagedTerminalResult(
      { submissionAttempt: ATTEMPT },
      { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
    );
    assert.equal(Object.hasOwn(recovered, 'runProgress'), candidate.expected);
    if (candidate.expected) {
      assert.equal(recovered.runProgress.submitPressed, true);
      assert.deepEqual(recovered.runProgress.submissionAttempt, ATTEMPT);
    }
  }
});

test('a dead expired reservation becomes indeterminate and can never dispatch again', async () => {
  const fake = fakeSandboxApi();
  const normalized = await normalizeManagedRun(request(), {
    urlValidator: async (value) => new URL(value),
  });
  const requestDigest = managedSubmissionRequestDigest(normalized);
  const reservedAt = new Date(Date.now() - 120_000).toISOString();
  const providerDeadlineAt = new Date(Date.now() - 1_000).toISOString();
  fake.seed([
    [MANAGED_SUBMISSION_RESERVATION_PATH, reservationBuffer(requestDigest, {
      reservedAt,
      providerDeadlineAt,
    })],
    ['stratus-progress.json', progressBuffer()],
  ]);

  const recovered = await retrieveManagedTerminalResult(
    { submissionAttempt: ATTEMPT },
    { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
  );
  assert.equal(recovered.state, 'indeterminate');
  assert.equal(recovered.error.code, 'SUBMISSION_EXECUTION_INDETERMINATE');
  assert.equal(recovered.runProgress.stage, 'submit_released');
  assert.equal(recovered.runProgress.submitPressed, true);

  await assert.rejects(
    executeSandboxRun(request({ providerDeadlineAt: deadline(210_000) }), {
      sandboxApi: fake.api,
      projectBinding: PROJECT_BINDING,
      urlValidator: async (value) => new URL(value),
    }),
    (error) => error.code === 'SUBMISSION_EXECUTION_INDETERMINATE'
      && error.status === 409
      && error.runProgress?.submitPressed === true,
  );
  assert.equal(fake.calls.forks, 0);
  assert.equal(fake.calls.runnerStarts, 0);
});

test('the indeterminate finalizer durably binds the terminal envelope and progress phase', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-terminal-indeterminate-'));
  try {
    const requestDigest = '9'.repeat(64);
    const reservedAt = new Date(Date.now() - 120_000).toISOString();
    const providerDeadlineAt = new Date(Date.now() - 1_000).toISOString();
    fs.writeFileSync(
      path.join(directory, MANAGED_SUBMISSION_RESERVATION_PATH),
      reservationBuffer(requestDigest, { reservedAt, providerDeadlineAt }),
    );
    fs.writeFileSync(path.join(directory, 'stratus-progress.json'), progressBuffer({
      phase: 1,
      verificationSubmitPressed: true,
      submitKind: 'verification',
    }));
    const expected = JSON.stringify({
      projectBindingHash: projectHash(PROJECT_BINDING),
      submissionAttempt: ATTEMPT,
      requestDigest,
    });
    const procShimPath = path.join(directory, 'empty-proc.cjs');
    fs.writeFileSync(procShimPath, [
      "const fs = require('node:fs');",
      'const readdirSync = fs.readdirSync;',
      "fs.readdirSync = (target, ...args) => target === '/proc' ? [] : readdirSync(target, ...args);",
    ].join('\n'));

    const finalized = spawnSync(
      process.execPath,
      ['--require', procShimPath, '-e', FINALIZE_MANAGED_INDETERMINATE_SCRIPT, expected],
      { cwd: directory, encoding: 'utf8' },
    );
    assert.equal(finalized.status, 0, finalized.stderr);
    const terminal = JSON.parse(fs.readFileSync(
      path.join(directory, MANAGED_TERMINAL_RESULT_PATH),
      'utf8',
    ));
    assert.equal(terminal.state, 'indeterminate');
    assert.equal(terminal.phase, 1);
    assert.deepEqual(terminal.submissionAttempt, ATTEMPT);
    assert.equal(terminal.requestDigest, requestDigest);
    assert.equal(terminal.error.code, 'SUBMISSION_EXECUTION_INDETERMINATE');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
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
  assert.equal(fake.calls.acknowledgements, 2);

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
    fs.writeFileSync(
      path.join(directory, 'stratus-input.json.tmp-987-private'),
      '{"applicant":"private temporary"}',
    );
    fs.writeFileSync(path.join(directory, 'stratus-result-0.json'), '{"page":"private"}');
    fs.writeFileSync(
      path.join(directory, 'stratus-terminal-result.json.tmp-987-private'),
      '{"terminal":"private temporary"}',
    );
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
    assert.equal(fs.existsSync(path.join(directory, 'stratus-input.json.tmp-987-private')), false);
    assert.equal(fs.existsSync(path.join(directory, 'stratus-result-0.json')), false);
    assert.equal(fs.existsSync(path.join(directory, 'stratus-screenshot-0.png')), false);
    assert.equal(
      fs.existsSync(path.join(directory, 'stratus-terminal-result.json.tmp-987-private')),
      false,
    );

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

test('acknowledgement fails when any applicant artifact cannot be unlinked', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-terminal-ack-failure-'));
  try {
    const requestDigest = 'f'.repeat(64);
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
    const shimPath = path.join(directory, 'unlink-failure.cjs');
    fs.writeFileSync(shimPath, [
      "const fs = require('node:fs');",
      'const unlinkSync = fs.unlinkSync;',
      "fs.unlinkSync = (target) => { if (target === 'stratus-input.json') throw new Error('forced'); return unlinkSync(target); };",
    ].join('\n'));

    const expected = JSON.stringify({
      projectBindingHash: projectHash(PROJECT_BINDING),
      submissionAttempt: ATTEMPT,
    });
    const failed = spawnSync(
      process.execPath,
      ['--require', shimPath, '-e', ACK_MANAGED_TERMINAL_RESULT_SCRIPT, expected],
      { cwd: directory, encoding: 'utf8' },
    );
    assert.equal(failed.status, 14, failed.stderr);
    assert.ok(fs.existsSync(path.join(directory, MANAGED_TERMINAL_ACK_PATH)));
    assert.ok(fs.existsSync(path.join(directory, 'stratus-input.json')));

    const retry = spawnSync(
      process.execPath,
      ['-e', ACK_MANAGED_TERMINAL_RESULT_SCRIPT, expected],
      { cwd: directory, encoding: 'utf8' },
    );
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(fs.existsSync(path.join(directory, 'stratus-input.json')), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
