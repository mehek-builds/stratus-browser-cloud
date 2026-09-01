import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ACK_MANAGED_TERMINAL_RESULT_SCRIPT,
  CLAIM_CONTINUATION_SCRIPT,
  FINALIZE_MANAGED_INDETERMINATE_SCRIPT,
  acknowledgeManagedTerminalResult,
  executeSandboxRun,
  managedContinuationExecutionId,
  managedSubmissionRequestDigest,
  managedTerminalResultSandboxName,
  MANAGED_PROVISIONING_LEASE_MS,
  MANAGED_PROVISIONING_QUARANTINE_PATH,
  QUARANTINE_STALE_PROVISIONING_SCRIPT,
  PROBE_MANAGED_EXECUTION_SCRIPT,
  MANAGED_CONTINUATION_RESERVATION_PATH,
  MANAGED_CONTINUATION_TERMINAL_ACK_PATH,
  MANAGED_CONTINUATION_TERMINAL_RESULT_PATH,
  MANAGED_SUBMISSION_RESERVATION_PATH,
  MANAGED_SUBMISSION_FINALIZATION_FENCE_PATH,
  MANAGED_SUBMISSION_DISPATCH_LOCK_PATH,
  MANAGED_SUBMISSION_RESERVATION_SCHEMA_VERSION,
  MANAGED_TERMINAL_ACK_PATH,
  MANAGED_TERMINAL_ACK_SCHEMA_VERSION,
  MANAGED_TERMINAL_RESULT_PATH,
  MANAGED_TERMINAL_RESULT_SCHEMA_VERSION,
  normalizeManagedRun,
  retrieveManagedTerminalResult,
  SANDBOX_RUNNER,
} from '../src/managed-browser.js';

const TEMPLATE_NAME = 'stratus-browser-runtime-pw-1-61-1-v4';
const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
const ATTEMPT = Object.freeze({
  runId: '11111111-1111-4111-8111-111111111111',
  claimId: '22222222-2222-4222-8222-222222222222',
  executionId: '33333333-3333-4333-8333-333333333333',
});
const CONTINUATION_ATTEMPT = Object.freeze({
  runId: ATTEMPT.runId,
  claimId: ATTEMPT.claimId,
  executionId: managedContinuationExecutionId(ATTEMPT.claimId, 'security_code'),
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

function acknowledgementBuffer({
  requestDigest,
  resultId,
  submissionAttempt = ATTEMPT,
  cleanupState = 'completed',
  acknowledgementKind = 'consumer_acknowledged',
  checkpoint = false,
  phase = 0,
}) {
  const acknowledgedAt = new Date().toISOString();
  return Buffer.from(JSON.stringify({
    schemaVersion: MANAGED_TERMINAL_ACK_SCHEMA_VERSION,
    projectBindingHash: projectHash(PROJECT_BINDING),
    submissionAttempt,
    requestDigest,
    resultId,
    acknowledgementKind,
    checkpoint,
    phase,
    acknowledgedAt,
    cleanupState,
    cleanupUpdatedAt: acknowledgedAt,
    expiresAt: new Date(Date.parse(acknowledgedAt) + RETENTION_MS).toISOString(),
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
  let nextForkOptions = {};

  class FakeSandbox {
    constructor(name, {
      createdAt = Date.now(),
      activeRunner = false,
      reservationOnProbe = null,
      clock = null,
      operationDelayMs = 0,
      writeFilesHook = null,
    } = {}) {
      this.name = name;
      this.files = new Map();
      this.stopCalls = 0;
      this.deleteCalls = 0;
      this.createdAt = new Date(createdAt);
      this.activeRunner = activeRunner;
      this.reservationOnProbe = reservationOnProbe;
      this.clock = clock;
      this.operationDelayMs = operationDelayMs;
      this.writeFilesHook = writeFilesHook;
    }

    advance() {
      if (this.clock) this.clock.value += this.operationDelayMs;
    }

    async writeFiles(files) {
      this.advance();
      if (this.writeFilesHook) {
        await this.writeFilesHook(this, files);
        return;
      }
      for (const file of files) this.files.set(file.path, Buffer.from(file.content));
    }

    async runCommand(command, args) {
      this.advance();
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
        const expected = JSON.parse(args[2]);
        if (!this.files.has(expected.terminalPath)) {
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
            expected.terminalPath,
            terminalBuffer(input, null, { state: 'indeterminate', phase }),
          );
        }
        return { exitCode: 0, stdout: async () => '' };
      }

      if (command === 'node' && args?.[1] === QUARANTINE_STALE_PROVISIONING_SCRIPT) {
        const expected = JSON.parse(args[2]);
        if (!this.files.has(MANAGED_PROVISIONING_QUARANTINE_PATH)) {
          this.files.set(MANAGED_PROVISIONING_QUARANTINE_PATH, Buffer.from(JSON.stringify({
            schemaVersion: 'stratus-provisioning-quarantine-v1',
            projectBindingHash: expected.projectBindingHash,
            submissionAttempt: expected.submissionAttempt,
            reason: 'stale_inactive_artifacts',
            persistedAt: new Date().toISOString(),
          })));
        }
        return { exitCode: 0, stdout: async () => '' };
      }

      if (command === 'node' && args?.[1] === CLAIM_CONTINUATION_SCRIPT) {
        if (!this.activeRunner) return { exitCode: 13, stdout: async () => '' };
        const candidate = JSON.parse(this.files.get(args[2]).toString('utf8'));
        this.files.set(
          MANAGED_CONTINUATION_RESERVATION_PATH,
          Buffer.from(JSON.stringify(candidate.reservation)),
        );
        this.files.set(
          'stratus-continuation-input.json',
          Buffer.from(JSON.stringify(candidate.input)),
        );
        const run = {
          title: 'Application received',
          submitOutcome: { pressed: true, state: 'confirmed' },
          continuationOffered: false,
          submissionAttempt: candidate.input.submissionAttempt,
        };
        this.files.set(
          MANAGED_CONTINUATION_TERMINAL_RESULT_PATH,
          terminalBuffer(candidate.input, run, { phase: 1 }),
        );
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
        const privateArtifact = expected.terminalPath === MANAGED_TERMINAL_RESULT_PATH
          ? /^(?:stratus-input\.json|stratus-result-0\.json|stratus-screenshot-0\.png|stratus-terminal-result\.json|stratus-progress\.json|stratus-error\.json)(?:\.tmp-[^/]+)?$/
          : /^(?:stratus-continuation-(?:input|candidate-[a-f0-9]+|claim|used|ready|terminal-result)\.json|stratus-continuation\.json|stratus-result-1\.json|stratus-screenshot-1\.png|stratus-progress\.json|stratus-error\.json)(?:\.tmp-[^/]+)?$/;
        const scrub = () => {
          for (const path of [...this.files.keys()]) {
            if (privateArtifact.test(path)) this.files.delete(path);
          }
        };
        const existing = this.files.get(expected.ackPath);
        if (existing) {
          const acknowledgement = JSON.parse(existing.toString('utf8'));
          if (acknowledgement.resultId !== expected.resultId) {
            return { exitCode: 11, stdout: async () => '' };
          }
          const completed = {
            ...acknowledgement,
            cleanupState: 'completed',
            cleanupUpdatedAt: new Date().toISOString(),
          };
          this.files.set(expected.ackPath, Buffer.from(JSON.stringify(completed)));
          scrub();
          return { exitCode: 0, stdout: async () => JSON.stringify(completed) };
        }
        const terminal = JSON.parse(this.files.get(expected.terminalPath).toString('utf8'));
        if (terminal.resultId !== expected.resultId) return { exitCode: 11, stdout: async () => '' };
        const acknowledgedAt = new Date().toISOString();
        const acknowledgement = {
          schemaVersion: MANAGED_TERMINAL_ACK_SCHEMA_VERSION,
          projectBindingHash: expected.projectBindingHash,
          submissionAttempt: expected.submissionAttempt,
          requestDigest: terminal.requestDigest,
          resultId: terminal.resultId,
          acknowledgementKind: expected.acknowledgementKind,
          checkpoint: expected.terminalPath === MANAGED_TERMINAL_RESULT_PATH
            && terminal.state === 'completed'
            && terminal.phase === 0
            && terminal.run?.continuationOffered === true
            && typeof terminal.run?.continuationToken === 'string',
          phase: terminal.phase,
          acknowledgedAt,
          cleanupState: 'completed',
          cleanupUpdatedAt: acknowledgedAt,
          expiresAt: new Date(Date.parse(acknowledgedAt) + RETENTION_MS).toISOString(),
        };
        this.files.set(expected.ackPath, Buffer.from(JSON.stringify(acknowledgement)));
        scrub();
        return { exitCode: 0, stdout: async () => JSON.stringify(acknowledgement) };
      }

      const wanted = args.slice(3);
      const found = wanted.find((path) => this.files.has(path));
      return found
        ? { exitCode: 0, stdout: async () => found }
        : { exitCode: 3, stdout: async () => '' };
    }

    async readFileToBuffer({ path }) {
      this.advance();
      return this.files.get(path) || null;
    }

    async stop() {
      this.advance();
      this.stopCalls += 1;
      this.activeRunner = false;
    }

    async delete() {
      this.advance();
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
        const sandbox = sandboxes.get(name) || null;
        sandbox?.advance();
        return sandbox;
      },
      async fork(options) {
        calls.forks += 1;
        if (sandboxes.has(options.name)) {
          throw Object.assign(new Error('sandbox name already exists'), { status: 409 });
        }
        const sandbox = new FakeSandbox(options.name, nextForkOptions);
        nextForkOptions = {};
        sandboxes.set(options.name, sandbox);
        return sandbox;
      },
    },
    configureNextFork(options) {
      nextForkOptions = options;
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
  assert.match(recovered.resultId, /^[a-f0-9]{64}$/);
  assert.equal(recovered.resultId, recovered.run.terminalResult.resultId);
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

test('a correlated mutating read scan runs ephemerally and mints no durable submission', async () => {
  // The onboarding-outage fix: an option-probe pre-scan (click a listbox open, read it, Escape)
  // classifies as a mutation, so correlationRequired makes it carry a submissionAttempt. That attempt
  // is for traceability and transport containment, NOT a submission. It must therefore run through the
  // ephemeral path: no persistent sandbox named after the attempt, no reservation, no minted terminal
  // result. It still echoes its attempt so the caller can bind the result to the exact call it made.
  const fake = fakeSandboxApi();
  const options = {
    sandboxApi: fake.api,
    projectBinding: PROJECT_BINDING,
    urlValidator: async (value) => new URL(value),
  };
  const readScan = request({
    allowSubmit: false,
    actions: [
      { type: 'click', selector: '#combobox', label: 'option_probe_open:combobox:1', optional: true },
      { type: 'extract', selector: '#listbox', label: 'options:combobox', optional: true },
      { type: 'press', selector: '#combobox', value: 'Escape', label: 'option_probe_close:combobox:1', optional: true },
    ],
  });

  const result = await executeSandboxRun(readScan, options);

  // The scan returned, echoing its correlation, without a durable terminal result.
  assert.deepEqual(result.submissionAttempt, ATTEMPT);
  assert.equal(result.terminalResult, undefined);
  // One ephemeral sandbox, stopped, never persisted under the attempt's terminal-result name.
  assert.deepEqual(fake.calls, { forks: 1, runnerStarts: 1, acknowledgements: 0 });
  assert.equal(fake.sandboxes.has(managedTerminalResultSandboxName(PROJECT_BINDING, ATTEMPT)), false,
    'a read scan must not create a persistent sandbox named after its attempt');
  // Nothing durable was minted, so a later terminal lookup for the same attempt finds no submission.
  await assert.rejects(
    retrieveManagedTerminalResult(
      { submissionAttempt: ATTEMPT },
      { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
    ),
    (error) => error.code === 'SUBMISSION_EXECUTION_NOT_FOUND' && error.status === 404,
  );

  // Contrast: the SAME attempt with an explicit submit release still takes the durable path and mints
  // a terminal result. The invariant is intact: durable receipts exist only where a submission can.
  const submitFake = fakeSandboxApi();
  const submitted = await executeSandboxRun(request(), {
    sandboxApi: submitFake.api,
    projectBinding: PROJECT_BINDING,
    urlValidator: async (value) => new URL(value),
  });
  assert.match(submitted.terminalResult.resultId, /^[a-f0-9]{64}$/);
  assert.equal(submitFake.sandboxes.has(managedTerminalResultSandboxName(PROJECT_BINDING, ATTEMPT)), true);
});

test('ACK and GET preserve the phase-0 runner until its exact continuation completes', async () => {
  const fake = fakeSandboxApi();
  const initialDigest = '1'.repeat(64);
  const initialInput = {
    submissionAttempt: ATTEMPT,
    terminalResultProjectHash: projectHash(PROJECT_BINDING),
    terminalResultRequestDigest: initialDigest,
  };
  const challengeRun = {
    title: 'Security code required',
    continuationOffered: true,
    continuationToken: 'c'.repeat(43),
    continuationExpiresAt: deadline(120_000),
    humanVerification: { kind: 'security_code' },
    submissionAttempt: ATTEMPT,
  };
  const sandbox = fake.seed([
    [MANAGED_SUBMISSION_RESERVATION_PATH, reservationBuffer(initialDigest)],
    [MANAGED_TERMINAL_RESULT_PATH, terminalBuffer(initialInput, challengeRun)],
  ], ATTEMPT, { activeRunner: true });

  const recoveredChallenge = await retrieveManagedTerminalResult(
    { submissionAttempt: ATTEMPT },
    { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
  );
  assert.equal(recoveredChallenge.run.continuationToken, challengeRun.continuationToken);
  assert.equal(recoveredChallenge.run.continuationOffered, true);

  const initialAck = await acknowledgeManagedTerminalResult({
    submissionAttempt: ATTEMPT,
    resultId: recoveredChallenge.resultId,
  }, { sandboxApi: fake.api, projectBinding: PROJECT_BINDING });
  assert.equal(initialAck.cleanupState, 'completed');
  assert.equal(initialAck.checkpoint, true);
  assert.equal(initialAck.phase, 0);
  assert.equal(sandbox.stopCalls, 0);
  assert.equal(sandbox.activeRunner, true);

  await assert.rejects(
    retrieveManagedTerminalResult(
      { submissionAttempt: ATTEMPT },
      { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
    ),
    (error) => error.code === 'SUBMISSION_EXECUTION_GONE' && error.status === 410,
  );
  assert.equal(sandbox.stopCalls, 0);
  assert.equal(sandbox.activeRunner, true);

  const recoveredContinuation = await executeSandboxRun({
    continuationToken: challengeRun.continuationToken,
    submissionAttempt: CONTINUATION_ATTEMPT,
    providerDeadlineAt: deadline(),
    actions: [],
    screenshot: false,
  }, { sandboxApi: fake.api, projectBinding: PROJECT_BINDING });
  assert.equal(recoveredContinuation.submitOutcome.state, 'confirmed');
  assert.equal(sandbox.stopCalls, 1);
  assert.equal(sandbox.activeRunner, false);

  const continuationAck = await acknowledgeManagedTerminalResult({
    submissionAttempt: CONTINUATION_ATTEMPT,
    resultId: recoveredContinuation.terminalResult.resultId,
  }, { sandboxApi: fake.api, projectBinding: PROJECT_BINDING });
  assert.equal(continuationAck.resultId, recoveredContinuation.terminalResult.resultId);
  assert.equal(continuationAck.checkpoint, false);
  assert.equal(continuationAck.phase, 1);
  assert.ok(sandbox.files.has(MANAGED_TERMINAL_ACK_PATH));
  assert.ok(sandbox.files.has(MANAGED_CONTINUATION_TERMINAL_ACK_PATH));
});

test('a durably claimed continuation remains GET-only through repeated pending reads and crash recovery', async () => {
  const fake = fakeSandboxApi();
  const initialDigest = '3'.repeat(64);
  const continuationDigest = '4'.repeat(64);
  const continuationInput = {
    submissionAttempt: CONTINUATION_ATTEMPT,
    terminalResultProjectHash: projectHash(PROJECT_BINDING),
    terminalResultRequestDigest: continuationDigest,
  };
  const sandbox = fake.seed([
    [MANAGED_SUBMISSION_RESERVATION_PATH, reservationBuffer(initialDigest)],
    [MANAGED_CONTINUATION_RESERVATION_PATH, reservationBuffer(continuationDigest, {
      submissionAttempt: CONTINUATION_ATTEMPT,
    })],
    ['stratus-continuation-input.json', JSON.stringify({
      submissionAttempt: CONTINUATION_ATTEMPT,
      securityCode: 'private-code',
    })],
  ]);

  for (let index = 0; index < 2; index += 1) {
    const pending = await retrieveManagedTerminalResult(
      { submissionAttempt: CONTINUATION_ATTEMPT },
      { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
    );
    assert.equal(pending.state, 'pending');
  }
  await assert.rejects(
    executeSandboxRun({
      continuationToken: 'c'.repeat(43),
      submissionAttempt: CONTINUATION_ATTEMPT,
      providerDeadlineAt: deadline(),
      actions: [],
    }, { sandboxApi: fake.api, projectBinding: PROJECT_BINDING }),
    (error) => error.code === 'SUBMISSION_EXECUTION_IN_PROGRESS',
  );
  assert.equal(fake.calls.runnerStarts, 0);

  sandbox.files.set(
    MANAGED_CONTINUATION_TERMINAL_RESULT_PATH,
    terminalBuffer(continuationInput, {
      title: 'Application received',
      submissionAttempt: CONTINUATION_ATTEMPT,
    }, { phase: 1 }),
  );
  const completed = await retrieveManagedTerminalResult(
    { submissionAttempt: CONTINUATION_ATTEMPT },
    { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
  );
  assert.equal(completed.state, 'completed');
  assert.equal(completed.run.title, 'Application received');
});

test('an expired continuation reservation terminalizes its exact tuple without redispatch', async () => {
  const fake = fakeSandboxApi();
  const continuationDigest = '5'.repeat(64);
  fake.seed([
    [MANAGED_SUBMISSION_RESERVATION_PATH, reservationBuffer('6'.repeat(64))],
    [MANAGED_CONTINUATION_RESERVATION_PATH, reservationBuffer(continuationDigest, {
      submissionAttempt: CONTINUATION_ATTEMPT,
      reservedAt: new Date(Date.now() - 120_000).toISOString(),
      providerDeadlineAt: new Date(Date.now() - 1_000).toISOString(),
    })],
    ['stratus-progress.json', progressBuffer({
      submissionAttempt: CONTINUATION_ATTEMPT,
      phase: 1,
      applicationSubmitPressed: false,
      verificationSubmitPressed: true,
      submitKind: 'verification',
    })],
  ]);
  const recovered = await retrieveManagedTerminalResult(
    { submissionAttempt: CONTINUATION_ATTEMPT },
    { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
  );
  assert.equal(recovered.state, 'indeterminate');
  assert.equal(recovered.submissionAttempt.executionId, CONTINUATION_ATTEMPT.executionId);
  assert.equal(fake.calls.runnerStarts, 0);
});

test('a different execution cannot read a related initial or continuation tuple', async () => {
  const fake = fakeSandboxApi();
  fake.seed([
    [MANAGED_SUBMISSION_RESERVATION_PATH, reservationBuffer('7'.repeat(64))],
    [MANAGED_CONTINUATION_RESERVATION_PATH, reservationBuffer('8'.repeat(64), {
      submissionAttempt: CONTINUATION_ATTEMPT,
    })],
  ]);
  const wrong = {
    ...ATTEMPT,
    executionId: '44444444-4444-4444-8444-444444444444',
  };
  await assert.rejects(
    retrieveManagedTerminalResult(
      { submissionAttempt: wrong },
      { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
    ),
    (error) => error.code === 'SUBMISSION_EXECUTION_NOT_FOUND' && error.status === 404,
  );
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
      { submissionAttempt: ATTEMPT, resultId: 'a'.repeat(64) },
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

test('GET reclaims an empty expired provisioning lease and permits one exact retry', async () => {
  const fake = fakeSandboxApi();
  const abandoned = fake.seed([], ATTEMPT, {
    createdAt: Date.now() - MANAGED_PROVISIONING_LEASE_MS - 1_000,
  });
  await assert.rejects(
    retrieveManagedTerminalResult(
      { submissionAttempt: ATTEMPT },
      { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
    ),
    (error) => error.code === 'SUBMISSION_EXECUTION_NOT_FOUND' && error.status === 404,
  );
  assert.equal(abandoned.deleteCalls, 1);

  const result = await executeSandboxRun(request(), {
    sandboxApi: fake.api,
    projectBinding: PROJECT_BINDING,
    urlValidator: async (value) => new URL(value),
  });
  assert.equal(result.submitOutcome.state, 'confirmed');
  assert.equal(fake.calls.forks, 1);
  assert.equal(fake.calls.runnerStarts, 1);
});

test('active stale provisioning stays pending while inactive artifacts are quarantined', async () => {
  const active = fakeSandboxApi();
  const activeSandbox = active.seed([], ATTEMPT, {
    createdAt: Date.now() - MANAGED_PROVISIONING_LEASE_MS - 1_000,
    activeRunner: true,
  });
  await assert.rejects(
    executeSandboxRun(request(), {
      sandboxApi: active.api,
      projectBinding: PROJECT_BINDING,
      urlValidator: async (value) => new URL(value),
    }),
    (error) => error.code === 'SUBMISSION_EXECUTION_IN_PROGRESS' && error.status === 409,
  );
  assert.equal(activeSandbox.deleteCalls, 0);
  assert.equal(active.calls.forks, 0);

  for (const files of [
    [['stratus-input.json', '{}']],
    [['stratus-progress.json', '{}']],
  ]) {
    const fake = fakeSandboxApi();
    const existing = fake.seed(files, ATTEMPT, {
      createdAt: Date.now() - MANAGED_PROVISIONING_LEASE_MS - 1_000,
    });
    await assert.rejects(
      executeSandboxRun(request(), {
        sandboxApi: fake.api,
        projectBinding: PROJECT_BINDING,
        urlValidator: async (value) => new URL(value),
      }),
      (error) => error.code === 'TERMINAL_RESULT_STORE_CORRUPT' && error.status === 502,
    );
    assert.ok(existing.files.has(MANAGED_PROVISIONING_QUARANTINE_PATH));
    assert.equal(existing.deleteCalls, 0);
    assert.equal(fake.calls.forks, 0);
    assert.equal(fake.calls.runnerStarts, 0);
  }
});

test('a stale artifact-bearing runner is quarantined once it becomes inactive', async () => {
  const fake = fakeSandboxApi();
  const sandbox = fake.seed([['stratus-input.json', '{}']], ATTEMPT, {
    createdAt: Date.now() - MANAGED_PROVISIONING_LEASE_MS - 1_000,
    activeRunner: true,
  });
  await assert.rejects(
    executeSandboxRun(request(), {
      sandboxApi: fake.api,
      projectBinding: PROJECT_BINDING,
      urlValidator: async (value) => new URL(value),
    }),
    (error) => error.code === 'SUBMISSION_EXECUTION_IN_PROGRESS',
  );
  sandbox.activeRunner = false;
  await assert.rejects(
    retrieveManagedTerminalResult(
      { submissionAttempt: ATTEMPT },
      { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
    ),
    (error) => error.code === 'TERMINAL_RESULT_STORE_CORRUPT',
  );
  assert.ok(sandbox.files.has(MANAGED_PROVISIONING_QUARANTINE_PATH));
  assert.equal(fake.calls.runnerStarts, 0);
});

test('a quarantine interleaving fences a delayed provisioner before runner dispatch', async () => {
  const fake = fakeSandboxApi();
  let announcePartial;
  let releaseWrite;
  const partial = new Promise((resolve) => { announcePartial = resolve; });
  const released = new Promise((resolve) => { releaseWrite = resolve; });
  fake.configureNextFork({
    createdAt: Date.now() - MANAGED_PROVISIONING_LEASE_MS - 1_000,
    writeFilesHook: async (sandbox, files) => {
      const inputFile = files.find((file) => file.path === 'stratus-input.json');
      sandbox.files.set(inputFile.path, Buffer.from(inputFile.content));
      announcePartial();
      await released;
      for (const file of files) sandbox.files.set(file.path, Buffer.from(file.content));
    },
  });
  const options = {
    sandboxApi: fake.api,
    projectBinding: PROJECT_BINDING,
    urlValidator: async (value) => new URL(value),
  };
  const first = executeSandboxRun(request(), options);
  await partial;

  await assert.rejects(
    executeSandboxRun(request({ providerDeadlineAt: deadline(220_000) }), options),
    (error) => error.code === 'TERMINAL_RESULT_STORE_CORRUPT' && error.status === 502,
  );
  releaseWrite();
  await assert.rejects(
    first,
    (error) => error.code === 'TERMINAL_RESULT_STORE_CORRUPT' && error.status === 502,
  );

  const [sandbox] = [...fake.sandboxes.values()];
  assert.ok(sandbox.files.has(MANAGED_PROVISIONING_QUARANTINE_PATH));
  assert.equal(fake.calls.runnerStarts, 0);
  assert.equal(fake.calls.forks, 1);
});

test('a reservation that appears during the stale probe is adopted and never redispatched', async () => {
  const fake = fakeSandboxApi();
  const normalized = await normalizeManagedRun(request(), {
    urlValidator: async (value) => new URL(value),
  });
  const existing = fake.seed([], ATTEMPT, {
    createdAt: Date.now() - MANAGED_PROVISIONING_LEASE_MS - 1_000,
    reservationOnProbe: reservationBuffer(managedSubmissionRequestDigest(normalized)),
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
      reservationPath: MANAGED_SUBMISSION_RESERVATION_PATH,
      terminalPath: MANAGED_TERMINAL_RESULT_PATH,
      ackPath: MANAGED_TERMINAL_ACK_PATH,
      fencePath: MANAGED_SUBMISSION_FINALIZATION_FENCE_PATH,
      lockPath: MANAGED_SUBMISSION_DISPATCH_LOCK_PATH,
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

test('concurrent deadline finalizers publish one immutable terminal envelope', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-terminal-finalizer-race-'));
  try {
    const requestDigest = 'e'.repeat(64);
    fs.writeFileSync(
      path.join(directory, MANAGED_SUBMISSION_RESERVATION_PATH),
      reservationBuffer(requestDigest, {
        reservedAt: new Date(Date.now() - 120_000).toISOString(),
        providerDeadlineAt: new Date(Date.now() - 1_000).toISOString(),
      }),
    );
    const expected = JSON.stringify({
      projectBindingHash: projectHash(PROJECT_BINDING),
      submissionAttempt: ATTEMPT,
      requestDigest,
      reservationPath: MANAGED_SUBMISSION_RESERVATION_PATH,
      terminalPath: MANAGED_TERMINAL_RESULT_PATH,
      ackPath: MANAGED_TERMINAL_ACK_PATH,
      fencePath: MANAGED_SUBMISSION_FINALIZATION_FENCE_PATH,
      lockPath: MANAGED_SUBMISSION_DISPATCH_LOCK_PATH,
    });
    const procShimPath = path.join(directory, 'empty-proc.cjs');
    fs.writeFileSync(procShimPath, [
      "const fs = require('node:fs');",
      'const readdirSync = fs.readdirSync;',
      "fs.readdirSync = (target, ...args) => target === '/proc' ? [] : readdirSync(target, ...args);",
    ].join('\n'));
    const launch = () => new Promise((resolve) => {
      const child = spawn(process.execPath, [
        '--require', procShimPath, '-e', FINALIZE_MANAGED_INDETERMINATE_SCRIPT, expected,
      ], { cwd: directory, stdio: 'ignore' });
      child.on('close', resolve);
    });
    const statuses = await Promise.all([launch(), launch()]);
    assert.deepEqual(statuses, [0, 0]);
    const firstBytes = fs.readFileSync(path.join(directory, MANAGED_TERMINAL_RESULT_PATH));
    const replay = spawnSync(process.execPath, [
      '--require', procShimPath, '-e', FINALIZE_MANAGED_INDETERMINATE_SCRIPT, expected,
    ], { cwd: directory, encoding: 'utf8' });
    assert.equal(replay.status, 0, replay.stderr);
    assert.deepEqual(
      fs.readFileSync(path.join(directory, MANAGED_TERMINAL_RESULT_PATH)),
      firstBytes,
    );
    assert.ok(fs.existsSync(path.join(directory, MANAGED_SUBMISSION_FINALIZATION_FENCE_PATH)));
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
  const submitted = await executeSandboxRun(request(), options);
  const resultId = submitted.terminalResult.resultId;

  const first = await acknowledgeManagedTerminalResult(
    { submissionAttempt: ATTEMPT, resultId },
    { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
  );
  const second = await acknowledgeManagedTerminalResult(
    { submissionAttempt: ATTEMPT, resultId },
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

test('legacy v2 acknowledgement tombstones remain readable during rollout', async () => {
  const fake = fakeSandboxApi();
  const requestDigest = 'a'.repeat(64);
  const acknowledgedAt = new Date().toISOString();
  const legacyAck = Buffer.from(JSON.stringify({
    schemaVersion: 'stratus-terminal-result-ack-v2',
    projectBindingHash: projectHash(PROJECT_BINDING),
    submissionAttempt: ATTEMPT,
    requestDigest,
    resultId: 'b'.repeat(64),
    acknowledgedAt,
    cleanupState: 'completed',
    cleanupUpdatedAt: acknowledgedAt,
    expiresAt: new Date(Date.parse(acknowledgedAt) + RETENTION_MS).toISOString(),
  }));
  const sandbox = fake.seed([
    [MANAGED_SUBMISSION_RESERVATION_PATH, reservationBuffer(requestDigest)],
    [MANAGED_TERMINAL_ACK_PATH, legacyAck],
  ]);

  await assert.rejects(
    retrieveManagedTerminalResult(
      { submissionAttempt: ATTEMPT },
      { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
    ),
    (error) => error.code === 'SUBMISSION_EXECUTION_GONE'
      && error.terminalResult.schemaVersion === 'stratus-terminal-result-ack-v2',
  );
  assert.equal(sandbox.stopCalls, 1);
});

test('acknowledgement is bound to the exact immutable result identifier', async () => {
  const fake = fakeSandboxApi();
  const submitted = await executeSandboxRun(request(), {
    sandboxApi: fake.api,
    projectBinding: PROJECT_BINDING,
    urlValidator: async (value) => new URL(value),
  });
  const exactResultId = submitted.terminalResult.resultId;
  await assert.rejects(
    acknowledgeManagedTerminalResult({
      submissionAttempt: ATTEMPT,
      resultId: 'f'.repeat(64),
    }, { sandboxApi: fake.api, projectBinding: PROJECT_BINDING }),
    (error) => error.code === 'TERMINAL_RESULT_ID_MISMATCH' && error.status === 409,
  );
  const recovered = await retrieveManagedTerminalResult(
    { submissionAttempt: ATTEMPT },
    { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
  );
  assert.equal(recovered.resultId, exactResultId);
  const acknowledgement = await acknowledgeManagedTerminalResult({
    submissionAttempt: ATTEMPT,
    resultId: exactResultId,
  }, { sandboxApi: fake.api, projectBinding: PROJECT_BINDING });
  assert.equal(acknowledgement.resultId, exactResultId);
});

test('GET retries tombstone-first cleanup without exposing the acknowledged result', async () => {
  const fake = fakeSandboxApi();
  const requestDigest = 'a'.repeat(64);
  const resultId = 'b'.repeat(64);
  const sandbox = fake.seed([
    [MANAGED_SUBMISSION_RESERVATION_PATH, reservationBuffer(requestDigest)],
    [MANAGED_TERMINAL_ACK_PATH, acknowledgementBuffer({
      requestDigest,
      resultId,
      cleanupState: 'pending',
    })],
    ['stratus-input.json', '{"applicant":"private"}'],
  ]);
  await assert.rejects(
    retrieveManagedTerminalResult(
      { submissionAttempt: ATTEMPT },
      { sandboxApi: fake.api, projectBinding: PROJECT_BINDING },
    ),
    (error) => error.code === 'SUBMISSION_EXECUTION_GONE' && error.status === 410,
  );
  assert.equal(sandbox.files.has('stratus-input.json'), false);
  const ack = JSON.parse(sandbox.files.get(MANAGED_TERMINAL_ACK_PATH).toString('utf8'));
  assert.equal(ack.cleanupState, 'completed');
  assert.equal(ack.resultId, resultId);
});

test('GET and ACK share one bounded request deadline across delayed store operations', async () => {
  const scenarios = [
    {
      label: 'pending GET',
      files: [[MANAGED_SUBMISSION_RESERVATION_PATH, reservationBuffer('1'.repeat(64))]],
      run: (fake, clock) => retrieveManagedTerminalResult(
        { submissionAttempt: ATTEMPT },
        {
          sandboxApi: fake.api,
          projectBinding: PROJECT_BINDING,
          requestAcceptedAtMs: 0,
          requestTimeoutMs: 60,
          now: () => clock.value,
        },
      ),
    },
    {
      label: 'terminal GET',
      files: (() => {
        const requestDigest = '2'.repeat(64);
        const input = {
          submissionAttempt: ATTEMPT,
          terminalResultProjectHash: projectHash(PROJECT_BINDING),
          terminalResultRequestDigest: requestDigest,
        };
        return [
          [MANAGED_SUBMISSION_RESERVATION_PATH, reservationBuffer(requestDigest)],
          [MANAGED_TERMINAL_RESULT_PATH, terminalBuffer(input, {
            title: 'Application received',
            submissionAttempt: ATTEMPT,
          })],
        ];
      })(),
      run: (fake, clock) => retrieveManagedTerminalResult(
        { submissionAttempt: ATTEMPT },
        {
          sandboxApi: fake.api,
          projectBinding: PROJECT_BINDING,
          requestAcceptedAtMs: 0,
          requestTimeoutMs: 60,
          now: () => clock.value,
        },
      ),
    },
    {
      label: 'idempotent ACK',
      files: (() => {
        const requestDigest = '3'.repeat(64);
        const resultId = '4'.repeat(64);
        return [
          [MANAGED_SUBMISSION_RESERVATION_PATH, reservationBuffer(requestDigest)],
          [MANAGED_TERMINAL_ACK_PATH, acknowledgementBuffer({ requestDigest, resultId })],
        ];
      })(),
      run: (fake, clock) => acknowledgeManagedTerminalResult(
        { submissionAttempt: ATTEMPT, resultId: '4'.repeat(64) },
        {
          sandboxApi: fake.api,
          projectBinding: PROJECT_BINDING,
          requestAcceptedAtMs: 0,
          requestTimeoutMs: 60,
          now: () => clock.value,
        },
      ),
    },
  ];
  for (const scenario of scenarios) {
    const clock = { value: 0 };
    const fake = fakeSandboxApi();
    fake.seed(scenario.files, ATTEMPT, { clock, operationDelayMs: 20 });
    await assert.rejects(
      scenario.run(fake, clock),
      (error) => error.code === 'TERMINAL_RESULT_REQUEST_DEADLINE_EXPIRED'
        && error.status === 503,
      scenario.label,
    );
    assert.ok(clock.value <= 60, `${scenario.label} must stop before the route budget is exceeded`);
  }
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
  const expiredSandbox = expired.seed([
    [MANAGED_SUBMISSION_RESERVATION_PATH, reservationBuffer(requestDigest)],
    [MANAGED_TERMINAL_RESULT_PATH, terminalBuffer(
      input,
      { title: 'Expired', submissionAttempt: ATTEMPT },
      { completedAt },
    )],
    ['stratus-input.json', '{"applicant":"private"}'],
    ['stratus-progress.json', '{"employer":"private"}'],
    ['stratus-error.json', '{"detail":"private"}'],
    ['stratus-screenshot-0.png', 'private'],
  ]);

  await assert.rejects(
    retrieveManagedTerminalResult(
      { submissionAttempt: ATTEMPT },
      { sandboxApi: expired.api, projectBinding: PROJECT_BINDING },
    ),
    (error) => error.code === 'SUBMISSION_EXECUTION_GONE' && error.status === 410,
  );
  const retired = JSON.parse(expiredSandbox.files.get(MANAGED_TERMINAL_ACK_PATH).toString('utf8'));
  assert.equal(retired.acknowledgementKind, 'retention_expired');
  assert.equal(retired.cleanupState, 'completed');
  assert.equal(expiredSandbox.files.has(MANAGED_TERMINAL_RESULT_PATH), false);
  assert.equal(expiredSandbox.files.has('stratus-input.json'), false);
  assert.equal(expiredSandbox.files.has('stratus-progress.json'), false);
  assert.equal(expiredSandbox.files.has('stratus-error.json'), false);
  assert.equal(expiredSandbox.files.has('stratus-screenshot-0.png'), false);
  await assert.rejects(
    acknowledgeManagedTerminalResult(
      { submissionAttempt: ATTEMPT, resultId: retired.resultId },
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
    const terminal = terminalBuffer(input, { title: 'Application received' });
    fs.writeFileSync(
      path.join(directory, MANAGED_TERMINAL_RESULT_PATH),
      terminal,
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
    fs.writeFileSync(path.join(directory, 'stratus-progress.json'), '{"employer":"private"}');
    fs.writeFileSync(path.join(directory, 'stratus-error.json'), '{"detail":"private"}');
    fs.writeFileSync(
      path.join(directory, 'stratus-progress.json.tmp-987-private'),
      '{"employer":"private temporary"}',
    );
    fs.writeFileSync(
      path.join(directory, 'stratus-error.json.tmp-987-private'),
      '{"detail":"private temporary"}',
    );

    const expected = JSON.stringify({
      projectBindingHash: projectHash(PROJECT_BINDING),
      submissionAttempt: ATTEMPT,
      resultId: JSON.parse(terminal.toString('utf8')).resultId,
      acknowledgementKind: 'consumer_acknowledged',
      reservationPath: MANAGED_SUBMISSION_RESERVATION_PATH,
      terminalPath: MANAGED_TERMINAL_RESULT_PATH,
      ackPath: MANAGED_TERMINAL_ACK_PATH,
    });
    const first = spawnSync(
      process.execPath,
      ['-e', ACK_MANAGED_TERMINAL_RESULT_SCRIPT, expected],
      { cwd: directory, encoding: 'utf8' },
    );
    assert.equal(first.status, 0, first.stderr);
    const firstAck = JSON.parse(first.stdout);
    assert.equal(firstAck.requestDigest, requestDigest);
    assert.equal(firstAck.cleanupState, 'completed');
    assert.equal(firstAck.acknowledgementKind, 'consumer_acknowledged');
    assert.equal(firstAck.phase, 0);
    assert.equal(firstAck.checkpoint, false);
    assert.ok(fs.existsSync(path.join(directory, MANAGED_SUBMISSION_RESERVATION_PATH)));
    assert.ok(fs.existsSync(path.join(directory, MANAGED_TERMINAL_ACK_PATH)));
    assert.equal(fs.existsSync(path.join(directory, MANAGED_TERMINAL_RESULT_PATH)), false);
    assert.equal(fs.existsSync(path.join(directory, 'stratus-input.json')), false);
    assert.equal(fs.existsSync(path.join(directory, 'stratus-input.json.tmp-987-private')), false);
    assert.equal(fs.existsSync(path.join(directory, 'stratus-result-0.json')), false);
    assert.equal(fs.existsSync(path.join(directory, 'stratus-screenshot-0.png')), false);
    assert.equal(fs.existsSync(path.join(directory, 'stratus-progress.json')), false);
    assert.equal(fs.existsSync(path.join(directory, 'stratus-error.json')), false);
    assert.equal(
      fs.existsSync(path.join(directory, 'stratus-progress.json.tmp-987-private')),
      false,
    );
    assert.equal(
      fs.existsSync(path.join(directory, 'stratus-error.json.tmp-987-private')),
      false,
    );
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
    const terminal = terminalBuffer(input, { title: 'Application received' });
    fs.writeFileSync(
      path.join(directory, MANAGED_TERMINAL_RESULT_PATH),
      terminal,
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
      resultId: JSON.parse(terminal.toString('utf8')).resultId,
      acknowledgementKind: 'consumer_acknowledged',
      reservationPath: MANAGED_SUBMISSION_RESERVATION_PATH,
      terminalPath: MANAGED_TERMINAL_RESULT_PATH,
      ackPath: MANAGED_TERMINAL_ACK_PATH,
    });
    const failed = spawnSync(
      process.execPath,
      ['--require', shimPath, '-e', ACK_MANAGED_TERMINAL_RESULT_SCRIPT, expected],
      { cwd: directory, encoding: 'utf8' },
    );
    assert.equal(failed.status, 14, failed.stderr);
    assert.ok(fs.existsSync(path.join(directory, MANAGED_TERMINAL_ACK_PATH)));
    assert.ok(fs.existsSync(path.join(directory, 'stratus-input.json')));
    assert.equal(
      JSON.parse(fs.readFileSync(path.join(directory, MANAGED_TERMINAL_ACK_PATH), 'utf8')).cleanupState,
      'pending',
    );

    const retry = spawnSync(
      process.execPath,
      ['-e', ACK_MANAGED_TERMINAL_RESULT_SCRIPT, expected],
      { cwd: directory, encoding: 'utf8' },
    );
    assert.equal(retry.status, 0, retry.stderr);
    assert.equal(fs.existsSync(path.join(directory, 'stratus-input.json')), false);
    assert.equal(JSON.parse(retry.stdout).cleanupState, 'completed');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('an ACK tombstone kills a late runner before Chromium launch even when input remains', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-late-runner-ack-'));
  try {
    const moduleDirectory = path.join(directory, 'node_modules', 'playwright');
    fs.mkdirSync(moduleDirectory, { recursive: true });
    fs.writeFileSync(path.join(moduleDirectory, 'index.js'), [
      "const fs = require('node:fs');",
      "exports.chromium = { launch: async () => { fs.writeFileSync('chromium-launched', '1'); throw new Error('must not launch'); } };",
    ].join('\n'));
    fs.writeFileSync(path.join(directory, 'stratus-runner.cjs'), SANDBOX_RUNNER);
    fs.writeFileSync(path.join(directory, 'stratus-input.json'), '{"applicant":"private"}');
    fs.writeFileSync(path.join(directory, MANAGED_TERMINAL_ACK_PATH), '{}');

    const runner = spawnSync(process.execPath, ['stratus-runner.cjs'], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.equal(runner.status, 0, runner.stderr);
    assert.equal(fs.existsSync(path.join(directory, 'chromium-launched')), false);
    assert.ok(fs.existsSync(path.join(directory, MANAGED_TERMINAL_ACK_PATH)));
    assert.ok(fs.existsSync(path.join(directory, 'stratus-input.json')));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a provisioning quarantine kills a late runner before Chromium launch', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-late-runner-quarantine-'));
  try {
    const moduleDirectory = path.join(directory, 'node_modules', 'playwright');
    fs.mkdirSync(moduleDirectory, { recursive: true });
    fs.writeFileSync(path.join(moduleDirectory, 'index.js'), [
      "const fs = require('node:fs');",
      "exports.chromium = { launch: async () => { fs.writeFileSync('chromium-launched', '1'); throw new Error('must not launch'); } };",
    ].join('\n'));
    fs.writeFileSync(path.join(directory, 'stratus-runner.cjs'), SANDBOX_RUNNER);
    fs.writeFileSync(path.join(directory, 'stratus-input.json'), '{"applicant":"private"}');
    fs.writeFileSync(path.join(directory, MANAGED_PROVISIONING_QUARANTINE_PATH), '{}');

    const runner = spawnSync(process.execPath, ['stratus-runner.cjs'], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.equal(runner.status, 0, runner.stderr);
    assert.equal(fs.existsSync(path.join(directory, 'chromium-launched')), false);
    assert.ok(fs.existsSync(path.join(directory, MANAGED_PROVISIONING_QUARANTINE_PATH)));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('a finalization fence prevents a paused late runner from opening the employer page', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-late-runner-fence-'));
  try {
    const moduleDirectory = path.join(directory, 'node_modules', 'playwright');
    fs.mkdirSync(moduleDirectory, { recursive: true });
    fs.writeFileSync(path.join(moduleDirectory, 'index.js'), [
      "const fs = require('node:fs');",
      "exports.chromium = { launch: async () => { fs.writeFileSync('chromium-launched', '1'); throw new Error('must not launch'); } };",
    ].join('\n'));
    fs.writeFileSync(path.join(directory, 'stratus-runner.cjs'), SANDBOX_RUNNER);
    fs.writeFileSync(path.join(directory, 'stratus-input.json'), JSON.stringify({
      url: 'https://jobs.example.com/apply',
      actions: [],
      providerDeadlineAt: deadline(),
      submissionAttempt: ATTEMPT,
      terminalResultProjectHash: projectHash(PROJECT_BINDING),
      terminalResultRequestDigest: 'd'.repeat(64),
    }));
    fs.writeFileSync(path.join(directory, MANAGED_SUBMISSION_FINALIZATION_FENCE_PATH), '{}');

    const runner = spawnSync(process.execPath, ['stratus-runner.cjs'], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.equal(runner.status, 0, runner.stderr);
    assert.equal(fs.existsSync(path.join(directory, 'chromium-launched')), false);
    assert.ok(fs.existsSync(path.join(directory, MANAGED_SUBMISSION_FINALIZATION_FENCE_PATH)));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('an indeterminate terminal result cannot be overwritten by a late detached runner', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-late-runner-terminal-'));
  try {
    const moduleDirectory = path.join(directory, 'node_modules', 'playwright');
    fs.mkdirSync(moduleDirectory, { recursive: true });
    fs.writeFileSync(path.join(moduleDirectory, 'index.js'), [
      "const fs = require('node:fs');",
      "exports.chromium = { launch: async () => { fs.writeFileSync('chromium-launched', '1'); throw new Error('must not launch'); } };",
    ].join('\n'));
    const requestDigest = '9'.repeat(64);
    const input = {
      url: 'https://jobs.example.com/apply',
      actions: [],
      providerDeadlineAt: deadline(),
      submissionAttempt: ATTEMPT,
      terminalResultProjectHash: projectHash(PROJECT_BINDING),
      terminalResultRequestDigest: requestDigest,
    };
    const terminal = terminalBuffer(input, null, { state: 'indeterminate' });
    fs.writeFileSync(path.join(directory, 'stratus-runner.cjs'), SANDBOX_RUNNER);
    fs.writeFileSync(path.join(directory, 'stratus-input.json'), JSON.stringify(input));
    fs.writeFileSync(path.join(directory, MANAGED_TERMINAL_RESULT_PATH), terminal);

    const runner = spawnSync(process.execPath, ['stratus-runner.cjs'], {
      cwd: directory,
      encoding: 'utf8',
    });
    assert.equal(runner.status, 0, runner.stderr);
    assert.equal(fs.existsSync(path.join(directory, 'chromium-launched')), false);
    assert.deepEqual(fs.readFileSync(path.join(directory, MANAGED_TERMINAL_RESULT_PATH)), terminal);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
