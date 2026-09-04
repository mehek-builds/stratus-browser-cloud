import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  ATOMIC_SUBMIT_POLICY,
  ATOMIC_SUBMIT_POLICY_V3,
  ATOMIC_SUBMIT_POLICY_V4,
  ATOMIC_SUBMIT_V4_CAPABILITY,
  CLAIM_CONTINUATION_SCRIPT,
  EXTRACT_ASSERTIONS_CAPABILITY,
  EXACT_PAGE_URL_CAPABILITY,
  executeManagedRun,
  executeSandboxRun,
  FREE_MANAGED_LIMITS,
  MANAGED_SUBMISSION_RESERVATION_PATH,
  MANAGED_SUBMISSION_RESERVATION_SCHEMA_VERSION,
  MANAGED_CONTINUATION_RESERVATION_PATH,
  MANAGED_CONTINUATION_TERMINAL_RESULT_PATH,
  MANAGED_TERMINAL_RESULT_PATH,
  MANAGED_TERMINAL_RESULT_SCHEMA_VERSION,
  MANAGED_CONTINUATION_CONTRACT,
  managedContinuationExecutionId,
  normalizeManagedActions,
  normalizeManagedContinuation,
  normalizeManagedRun,
  PUBLIC_EGRESS_NETWORK_POLICY,
  resolvedManagedExactPageUrl,
  assertSubmissionReleaseAllowed,
  submissionReleasePolicy,
  STRATUS_SUBMISSION_CORRELATION_MODE_ENV,
  STRATUS_SUBMISSION_QUIESCENCE_ENV,
  SANDBOX_RUNNER
} from '../src/managed-browser.js';

const CURRENT_SANDBOX_TEMPLATE = 'stratus-browser-runtime-pw-1-61-1-v4';
const SUBMISSION_ATTEMPT = Object.freeze({
  runId: '11111111-1111-4111-8111-111111111111',
  claimId: '22222222-2222-4222-8222-222222222222',
  executionId: '33333333-3333-4333-8333-333333333333',
});

const providerDeadlineAt = (offsetMs = 240_000) => new Date(Date.now() + offsetMs).toISOString();

function managedTerminalEnvelope(run, input, { state = 'completed', phase = 0 } = {}) {
  const completedAt = new Date().toISOString();
  const common = {
    schemaVersion: MANAGED_TERMINAL_RESULT_SCHEMA_VERSION,
    projectBindingHash: input.terminalResultProjectHash,
    submissionAttempt: input.submissionAttempt,
    requestDigest: input.terminalResultRequestDigest,
    state,
    completedAt,
    expiresAt: new Date(Date.parse(completedAt) + 30 * 24 * 60 * 60 * 1000).toISOString(),
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
    resultId: crypto.createHash('sha256').update(JSON.stringify(core)).digest('hex'),
    persistedAt: new Date().toISOString(),
  }));
}

function managedReservation(projectBinding, submissionAttempt = SUBMISSION_ATTEMPT, requestDigest = 'a'.repeat(64)) {
  const reservedAt = new Date().toISOString();
  return Buffer.from(JSON.stringify({
    schemaVersion: MANAGED_SUBMISSION_RESERVATION_SCHEMA_VERSION,
    projectBindingHash: crypto.createHash('sha256').update(projectBinding).digest('hex'),
    submissionAttempt,
    requestDigest,
    providerDeadlineAt: providerDeadlineAt(),
    reservedAt,
    expiresAt: new Date(Date.parse(reservedAt) + 30 * 24 * 60 * 60 * 1000).toISOString(),
  }));
}

test('exact URL proof allows only Workable short-link canonicalization', () => {
  const expected = 'https://apply.workable.com/j/20e78cba92/apply?source=litos#apply';
  const resolved = 'https://apply.workable.com/max-borges-agency/j/20E78CBA92/apply?source=litos';
  assert.equal(resolvedManagedExactPageUrl(expected, resolved), resolved);
  assert.equal(resolvedManagedExactPageUrl(resolved, `${resolved}#receipt`), resolved);
  for (const rejected of [
    'https://apply.workable.com/max-borges-agency/j/AAAAAAAAAA/apply?source=litos',
    'https://apply.workable.com/max-borges-agency/j/20E78CBA92/apply?source=other',
    'https://apply.workable.com/another/j/20E78CBA92/apply/extra?source=litos',
    'https://user:pass@apply.workable.com/max-borges-agency/j/20E78CBA92/apply?source=litos',
    'https://apply.workable.com:444/max-borges-agency/j/20E78CBA92/apply?source=litos',
    'http://apply.workable.com/max-borges-agency/j/20E78CBA92/apply?source=litos',
    'https://careers.example.com/max-borges-agency/j/20E78CBA92/apply?source=litos',
    'https://apply.workable.com/j/20E78CBA92/apply?source=litos',
  ]) {
    assert.equal(resolvedManagedExactPageUrl(expected, rejected), null, rejected);
  }
  assert.equal(
    resolvedManagedExactPageUrl(
      resolved,
      'https://apply.workable.com/another-tenant/j/20E78CBA92/apply?source=litos',
    ),
    null,
  );
});

/* Greenhouse's legacy host answers a 301 to the current one with the path and query carried across
 * byte-for-byte, measured 2026-09-04:
 *   GET https://boards.greenhouse.io/embed/job_app?for=sage49&token=6131185004
 *     -> 301 https://job-boards.greenhouse.io/embed/job_app?for=sage49&token=6131185004
 * volley-backend builds every Greenhouse application URL on the legacy host, so before this was
 * accepted EVERY Greenhouse managed submit aborted with "Employer page URL changed before the
 * first application action" having filled nothing - measured on Sage application
 * aae653a3-2d5a-4f3e-ba3b-afea4219df37, which failed that way twice in a row. */
test('exact URL proof accepts Greenhouse legacy-host 301 but nothing that changes the job', () => {
  const expected = 'https://boards.greenhouse.io/embed/job_app?for=sage49&token=6131185004';
  const resolved = 'https://job-boards.greenhouse.io/embed/job_app?for=sage49&token=6131185004';
  assert.equal(resolvedManagedExactPageUrl(expected, resolved), resolved);
  // The same whole-host 301 is served for the hosted posting route, so it resolves too.
  assert.equal(
    resolvedManagedExactPageUrl(
      'https://boards.greenhouse.io/sage49/jobs/6131185004',
      'https://job-boards.greenhouse.io/sage49/jobs/6131185004',
    ),
    'https://job-boards.greenhouse.io/sage49/jobs/6131185004',
  );
  for (const rejected of [
    // A different board, or a different job, is a different application.
    'https://job-boards.greenhouse.io/embed/job_app?for=notsage&token=6131185004',
    'https://job-boards.greenhouse.io/embed/job_app?for=sage49&token=9999999999',
    'https://job-boards.greenhouse.io/embed/job_app?for=sage49',
    // The host migration carries the path across untouched, so a moved path is a real move.
    'https://job-boards.greenhouse.io/embed/job_app/extra?for=sage49&token=6131185004',
    'https://job-boards.greenhouse.io/sage49/jobs/6131185004?for=sage49&token=6131185004',
    // Neither a lookalike host nor an unrelated one is Greenhouse's own redirect target.
    'https://job-boards.greenhouse.io.evil.example/embed/job_app?for=sage49&token=6131185004',
    'https://job-boards.eu.greenhouse.io/embed/job_app?for=sage49&token=6131185004',
    'https://boards.greenhouse.io.evil.example/embed/job_app?for=sage49&token=6131185004',
    // The transport floor still applies to the accepted pair.
    'http://job-boards.greenhouse.io/embed/job_app?for=sage49&token=6131185004',
    'https://user:pass@job-boards.greenhouse.io/embed/job_app?for=sage49&token=6131185004',
    'https://job-boards.greenhouse.io:444/embed/job_app?for=sage49&token=6131185004',
  ]) {
    assert.equal(resolvedManagedExactPageUrl(expected, rejected), null, rejected);
  }
  // Greenhouse redirects legacy -> current only, so the reverse ordering is not this redirect.
  assert.equal(resolvedManagedExactPageUrl(resolved, expected), null);
  // An embed route naming no job has no identity for the equal query strings to have bound.
  assert.equal(
    resolvedManagedExactPageUrl(
      'https://boards.greenhouse.io/embed/job_app',
      'https://job-boards.greenhouse.io/embed/job_app',
    ),
    null,
  );
});

function extractFunctionSource(name) {
  const start = SANDBOX_RUNNER.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist in the sandbox runner`);
  const open = SANDBOX_RUNNER.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < SANDBOX_RUNNER.length; index += 1) {
    if (SANDBOX_RUNNER[index] === '{') depth += 1;
    if (SANDBOX_RUNNER[index] === '}') {
      depth -= 1;
      if (depth === 0) return SANDBOX_RUNNER.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

function sandboxQuestionLabel() {
  // blockOf as well as questionLabel: an anonymous control (Ashby's location combobox has no id, no
  // name and no aria-label) now resolves its question from the block that owns it rather than from
  // its placeholder, so the two are built together.
  const source = extractFunctionSource('questionLabel');
  const blockOfSource = extractFunctionSource('blockOf');
  const renderedTextSource = extractFunctionSource('renderedText');
  const labelledByTextSource = extractFunctionSource('labelledByText');
  const clean = (value) => (value == null ? '' : value).replace(/[​‌‍﻿ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const fakeDocument = { querySelector: () => null };
  const fakeCss = { escape: (value) => String(value) };
  return Function(
    'clean', 'document', 'CSS',
    `${renderedTextSource}\n${labelledByTextSource}\n${blockOfSource}\nreturn (${source});`,
  )(clean, fakeDocument, fakeCss);
}

function mockElement({ attrs = {}, textContent = '', parentElement = null, queryResult = null } = {}) {
  return {
    id: attrs.id || '',
    labels: [],
    parentElement,
    textContent,
    getAttribute(name) {
      return attrs[name] ?? null;
    },
    closest() {
      return null;
    },
    matches(selector) {
      return /div|section|li|fieldset/.test(selector);
    },
    querySelector() {
      return queryResult;
    }
  };
}

test('managed free limits are explicit and do not claim paid capacity', () => {
  assert.deepEqual(FREE_MANAGED_LIMITS, { concurrentBrowsers: 10, monthlyCpuHours: 5, maxRunSeconds: 60, persistedDays: 30 });
});

test('managed sandboxes install every enforceable non-global IPv4 range at the connection boundary', () => {
  assert.deepEqual(PUBLIC_EGRESS_NETWORK_POLICY, {
    subnets: {
      allow: ['0.0.0.0/1', '128.0.0.0/2', '192.0.0.0/3'],
      deny: [
        '0.0.0.0/8',
        '10.0.0.0/8',
        '100.64.0.0/10',
        '127.0.0.0/8',
        '169.254.0.0/16',
        '172.16.0.0/12',
        '192.0.0.0/24',
        '192.0.2.0/24',
        '192.88.99.0/24',
        '192.168.0.0/16',
        '198.18.0.0/15',
        '198.51.100.0/24',
        '203.0.113.0/24'
      ]
    }
  });
  assert.equal(Object.isFrozen(PUBLIC_EGRESS_NETWORK_POLICY), true);
  assert.equal(Object.isFrozen(PUBLIC_EGRESS_NETWORK_POLICY.subnets), true);
  assert.equal(Object.isFrozen(PUBLIC_EGRESS_NETWORK_POLICY.subnets.allow), true);
  assert.equal(Object.isFrozen(PUBLIC_EGRESS_NETWORK_POLICY.subnets.deny), true);
});

test('the shipped runner cannot enable private replay through its environment', () => {
  assert.match(SANDBOX_RUNNER, /const allowPrivateForTests = false;/);
  assert.doesNotMatch(SANDBOX_RUNNER, /STRATUS_TEST_ALLOW_PRIVATE_REPLAY/);
});

test('managed actions accept bounded declarative operations', () => {
  assert.deepEqual(normalizeManagedActions([
    { type: 'fill', selector: '#email', value: 'person@example.com' },
    { type: 'press', value: 'Enter' },
    { type: 'extract', selector: 'h1', label: 'filled_field:title' }
  ]), [
    { type: 'fill', selector: '#email', value: 'person@example.com' },
    { type: 'press', value: 'Enter' },
    { type: 'extract', selector: 'h1', label: 'filled_field:title' }
  ]);
  assert.throws(() => normalizeManagedActions([{ type: 'evaluate', value: 'process.exit()' }]), (error) => error.code === 'INVALID_ACTION');
  assert.throws(() => normalizeManagedActions(Array.from({ length: 121 }, () => ({ type: 'click', selector: 'button' }))), (error) => error.code === 'TOO_MANY_ACTIONS');
  assert.throws(
    () => normalizeManagedActions([{ type: 'discover' }, { type: 'discover' }]),
    (error) => error.code === 'MULTIPLE_DISCOVERY_ACTIONS',
  );
});

test('managed actions preserve unique-match and live extract assertions', () => {
  assert.deepEqual(normalizeManagedActions([
    { type: 'requireCapability', value: EXTRACT_ASSERTIONS_CAPABILITY, optional: false },
    { type: 'click', selector: '#country', optional: false, requireUnique: true },
    {
      type: 'extract',
      selector: '#country',
      optional: false,
      requireUnique: true,
      requireNonEmpty: true,
      expectedValueIncludes: '+971',
      expectedValueDigits: '971',
      timeout: 10000,
      stabilityWindowMs: 1200
    },
    {
      type: 'extract',
      selector: '#phone',
      attribute: 'value',
      optional: false,
      requireUnique: true,
      requireNonEmpty: true,
      expectedValueDigits: '0567417451',
      stabilityWindowMs: 1200
    }
  ]), [
    { type: 'requireCapability', optional: false, value: EXTRACT_ASSERTIONS_CAPABILITY },
    { type: 'click', selector: '#country', optional: false, requireUnique: true },
    {
      type: 'extract',
      selector: '#country',
      optional: false,
      requireUnique: true,
      requireNonEmpty: true,
      expectedValueIncludes: '+971',
      expectedValueDigits: '971',
      timeout: 10000,
      stabilityWindowMs: 1200
    },
    {
      type: 'extract',
      selector: '#phone',
      optional: false,
      requireUnique: true,
      requireNonEmpty: true,
      expectedValueDigits: '0567417451',
      stabilityWindowMs: 1200,
      attribute: 'value'
    }
  ]);
  assert.throws(
    () => normalizeManagedActions([{ type: 'click', selector: '#country', requireUnique: 'true' }]),
    (error) => error.code === 'INVALID_ACTION_ASSERTION'
  );
  assert.throws(
    () => normalizeManagedActions([{ type: 'fill', selector: '#phone', value: '1', requireNonEmpty: true }]),
    (error) => error.code === 'INVALID_ACTION_ASSERTION'
  );
  assert.throws(
    () => normalizeManagedActions([{ type: 'extract', selector: '#country', expectedValueIncludes: '' }]),
    (error) => error.code === 'INVALID_ACTION_ASSERTION'
  );
  assert.throws(
    () => normalizeManagedActions([{ type: 'extract', selector: '#phone', requireNonEmpty: true, stabilityWindowMs: 5000 }]),
    (error) => error.code === 'INVALID_ACTION_ASSERTION'
  );
  assert.throws(
    () => normalizeManagedActions([{ type: 'extract', selector: '#phone', expectedValueDigits: '+971' }]),
    (error) => error.code === 'INVALID_ACTION_ASSERTION'
  );
  assert.throws(
    () => normalizeManagedActions([{ type: 'requireCapability', value: 'extract-assertions-v2' }]),
    (error) => error.code === 'UNSUPPORTED_RUNNER_CAPABILITY'
  );
});

test('required unique actions and extract assertions fail closed in the shipped runner', () => {
  assert.match(SANDBOX_RUNNER, /if \(action\.requireUnique && matchCount !== 1\) \{/);
  assert.match(SANDBOX_RUNNER, /expected exactly one match for/);
  assert.match(SANDBOX_RUNNER, /attribute === 'value' && 'value' in element/);
  assert.match(SANDBOX_RUNNER, /action\.requireNonEmpty && !String\(value \?\? ''\)\.trim\(\)/);
  assert.match(SANDBOX_RUNNER, /!String\(value \?\? ''\)\.includes\(action\.expectedValueIncludes\)/);
  assert.match(SANDBOX_RUNNER, /String\(value \?\? ''\)\.replace\(\/\\D\/g, ''\) !== action\.expectedValueDigits/);
  assert.match(SANDBOX_RUNNER, /values\.length === 0[\s\S]*action\.expectedValueDigits != null/);
  assert.match(SANDBOX_RUNNER, /const sampleCount = action\.stabilityWindowMs \? 3 : 1;/);
  assert.match(SANDBOX_RUNNER, /Math\.ceil\(action\.stabilityWindowMs \/ \(sampleCount - 1\)\)/);
  assert.match(SANDBOX_RUNNER, /action\.type === 'extract' && action\.requireUnique && matchCount === 0 && action\.timeout/);
  assert.match(SANDBOX_RUNNER, /while \(matchCount === 0 && Date\.now\(\) < deadline\)/);
  assert.match(SANDBOX_RUNNER, /assertRequiredCapabilities\(input\.actions\);/);
  assert.match(SANDBOX_RUNNER, /extractAssertionsCapability/);
});

test('managed run rejects an unsupported required capability during request normalization', async () => {
  await assert.rejects(
    normalizeManagedRun({
      url: 'https://example.com/apply',
      actions: [{ type: 'requireCapability', value: 'extract-assertions-v2', optional: false }]
    }, { urlValidator: async (value) => new URL(value) }),
    (error) => error.code === 'UNSUPPORTED_RUNNER_CAPABILITY'
  );
});

test('every submit-capable run is bound to one durable backend attempt', async () => {
  await assert.rejects(
    normalizeManagedRun({ url: 'https://example.com/apply', allowSubmit: true }, {
      urlValidator: async (value) => new URL(value),
    }),
    (error) => error.code === 'SUBMISSION_ATTEMPT_REQUIRED',
  );
  await assert.rejects(
    normalizeManagedRun({
      url: 'https://example.com/apply',
      allowSubmit: true,
      submissionAttempt: { runId: SUBMISSION_ATTEMPT.runId },
    }, { urlValidator: async (value) => new URL(value) }),
    (error) => error.code === 'INVALID_SUBMISSION_ATTEMPT',
  );
  const normalized = await normalizeManagedRun({
    url: 'https://example.com/apply',
    allowSubmit: true,
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: providerDeadlineAt(),
  }, { urlValidator: async (value) => new URL(value) });
  assert.deepEqual(normalized.submissionAttempt, SUBMISSION_ATTEMPT);
  await assert.rejects(
    normalizeManagedRun({
      url: 'https://example.com/apply',
      allowSubmit: true,
      submissionAttempt: { ...SUBMISSION_ATTEMPT, executionId: 'not-a-uuid' },
    }, { urlValidator: async (value) => new URL(value) }),
    (error) => error.code === 'INVALID_SUBMISSION_ATTEMPT',
  );
});

test('continuations require the same durable attempt correlation', () => {
  const token = 'a'.repeat(43);
  assert.throws(
    () => normalizeManagedContinuation({ continuationToken: token, actions: [] }),
    (error) => error.code === 'SUBMISSION_ATTEMPT_REQUIRED',
  );
  const normalized = normalizeManagedContinuation({
    continuationToken: token,
    actions: [],
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: providerDeadlineAt(),
  });
  assert.deepEqual(normalized.submissionAttempt, SUBMISSION_ATTEMPT);
  assert.match(SANDBOX_RUNNER, /Submission attempt correlation changed during continuation/);
  assert.match(SANDBOX_RUNNER, /submissionAttempt/);
  assert.match(SANDBOX_RUNNER, /submissionAttempt: currentInput\.submissionAttempt/);
});

test('submission release policy defaults closed and exposes an explicit compat stage', async () => {
  assert.equal(STRATUS_SUBMISSION_CORRELATION_MODE_ENV, 'STRATUS_SUBMISSION_CORRELATION_MODE');
  assert.equal(STRATUS_SUBMISSION_QUIESCENCE_ENV, 'STRATUS_SUBMISSION_QUIESCED');
  assert.deepEqual(submissionReleasePolicy({}), {
    quiesced: false,
    correlationRequired: true,
  });
  assert.deepEqual(submissionReleasePolicy({
    [STRATUS_SUBMISSION_CORRELATION_MODE_ENV]: 'compat',
  }), {
    quiesced: false,
    correlationRequired: false,
  });
  assert.throws(
    () => submissionReleasePolicy({ [STRATUS_SUBMISSION_CORRELATION_MODE_ENV]: 'optional' }),
    (error) => error.code === 'SUBMISSION_RELEASE_POLICY_INVALID' && error.status === 503,
  );

  const acceptedAt = Date.parse('2026-08-26T10:00:00.000Z');
  const legacy = await normalizeManagedRun({
    url: 'https://example.com/apply',
    allowSubmit: true,
  }, {
    urlValidator: async (value) => new URL(value),
    releasePolicy: submissionReleasePolicy({
      [STRATUS_SUBMISSION_CORRELATION_MODE_ENV]: 'compat',
    }),
    requestAcceptedAtMs: acceptedAt,
  });
  assert.equal('submissionAttempt' in legacy, false);
  assert.equal(legacy.providerDeadlineAt, '2026-08-26T10:04:30.000Z');

  await assert.rejects(
    normalizeManagedRun({
      url: 'https://example.com/apply',
      allowSubmit: true,
      submissionAttempt: SUBMISSION_ATTEMPT,
    }, { urlValidator: async (value) => new URL(value) }),
    (error) => error.code === 'PROVIDER_DEADLINE_REQUIRED',
  );
});

test('submission quiescence rejects before every provider or continuation adapter call', async () => {
  const releasePolicy = submissionReleasePolicy({
    [STRATUS_SUBMISSION_CORRELATION_MODE_ENV]: 'compat',
    [STRATUS_SUBMISSION_QUIESCENCE_ENV]: '1',
  });
  let providerCalls = 0;
  let validatorCalls = 0;
  const options = {
    releasePolicy,
    urlValidator: async (value) => {
      validatorCalls += 1;
      return new URL(value);
    },
    sandboxExecutor: async () => {
      providerCalls += 1;
      return {};
    },
  };
  for (const request of [
    { url: 'https://example.com/apply', allowSubmit: true },
    { continuationToken: 'q'.repeat(43), actions: [] },
    { url: 'https://example.com/apply', actions: [{ type: 'click' }] },
    { url: 'https://example.com/apply', actions: [{ type: 'fill' }] },
    { url: 'https://example.com/apply', actions: [{ type: 'fillByLabelText' }] },
    { url: 'https://example.com/apply', actions: [{ type: 'upload' }] },
    { url: 'https://example.com/apply', actions: [{ type: 'press' }] },
    { url: 'https://example.com/apply', actions: [{ type: 'select' }] },
    { url: 'https://example.com/apply', actions: [{ type: 'confirmAndSubmit' }] },
  ]) {
    await assert.rejects(
      executeManagedRun(request, options),
      (error) => error.code === 'SUBMISSION_QUIESCED' && error.status === 503,
    );
  }
  assert.equal(providerCalls, 0);
  assert.equal(validatorCalls, 0);
});

test('raw final action grammar requires explicit release and durable correlation before dispatch', async () => {
  let providerCalls = 0;
  let validatorCalls = 0;
  const finalClick = { type: 'click', selector: 'button[type="submit"]', label: 'final_submit' };
  const options = {
    urlValidator: async (value) => {
      validatorCalls += 1;
      return new URL(value);
    },
    sandboxExecutor: async () => {
      providerCalls += 1;
      return {};
    },
  };
  await assert.rejects(
    executeManagedRun({ url: 'https://example.com/apply', actions: [finalClick] }, options),
    (error) => error.code === 'SUBMISSION_AUTHORIZATION_REQUIRED' && error.status === 400,
  );
  await assert.rejects(
    normalizeManagedRun({
      url: 'https://example.com/apply',
      allowSubmit: true,
      actions: [finalClick],
    }, { urlValidator: options.urlValidator }),
    (error) => error.code === 'SUBMISSION_ATTEMPT_REQUIRED',
  );
  await assert.rejects(
    normalizeManagedRun({
      url: 'https://example.com/apply',
      allowSubmit: true,
      submissionAttempt: SUBMISSION_ATTEMPT,
      actions: [finalClick],
    }, { urlValidator: options.urlValidator }),
    (error) => error.code === 'PROVIDER_DEADLINE_REQUIRED',
  );
  assert.equal(providerCalls, 0);
  assert.equal(validatorCalls, 0);
});

test('a bare discover run is read-only: no correlation demanded, and it survives a quiesce', async () => {
  /* The pre-scan path (2026-09-01). 'discover' is one page.evaluate DOM walk with the same
     footprint as waitForSelector and extract: it fills nothing, clicks nothing, and cannot reach a
     submit control. Classifying it as raw mutation made every posting-question pre-scan demand a
     durable submissionAttempt it can never have, and the product's step 3 died on every portal
     without a fresh cache. The probes around it (real clicks) stay gated; this pins only the walk. */
  const normalized = await normalizeManagedRun({
    url: 'https://example.com/apply',
    actions: [{ type: 'discover' }],
  }, { urlValidator: async (value) => new URL(value) });
  assert.ok(normalized.submissionAttempt == null, 'a bare discover run must not carry a submission attempt');

  await assert.doesNotReject(
    normalizeManagedRun({
      url: 'https://example.com/apply',
      actions: [{ type: 'discover' }],
    }, {
      urlValidator: async (value) => new URL(value),
      releasePolicy: { quiesced: true, correlationRequired: true },
    }),
  );
});

test('every raw mutation requires exact attempt and deadline before URL validation or provider work', async () => {
  const mutations = [
    { type: 'click' },
    { type: 'fill' },
    { type: 'fillByLabelText' },
    { type: 'upload' },
    { type: 'press', value: 'Tab' },
    { type: 'select' },
    { type: 'confirmAndSubmit', allowSubmit: true },
  ];
  let validatorCalls = 0;
  let providerCalls = 0;
  for (const mutation of mutations) {
    const { allowSubmit = false, ...action } = mutation;
    await assert.rejects(
      normalizeManagedRun({
        url: 'https://example.com/apply',
        allowSubmit,
        actions: [action],
      }, {
        urlValidator: async (value) => {
          validatorCalls += 1;
          return new URL(value);
        },
      }),
      (error) => error.code === 'SUBMISSION_ATTEMPT_REQUIRED',
      action.type,
    );
    await assert.rejects(
      normalizeManagedRun({
        url: 'https://example.com/apply',
        allowSubmit,
        actions: [action],
        submissionAttempt: SUBMISSION_ATTEMPT,
      }, {
        urlValidator: async (value) => {
          validatorCalls += 1;
          return new URL(value);
        },
      }),
      (error) => error.code === 'PROVIDER_DEADLINE_REQUIRED',
      action.type,
    );
  }
  await assert.rejects(
    executeManagedRun({
      url: 'https://example.com/apply',
      actions: [{ type: 'fill' }],
    }, {
      sandboxExecutor: async () => {
        providerCalls += 1;
        return {};
      },
    }),
    (error) => error.code === 'SUBMISSION_ATTEMPT_REQUIRED',
  );
  assert.equal(validatorCalls, 0);
  assert.equal(providerCalls, 0);
});

test('selector spelling never grants final action authority', async () => {
  const normalized = await normalizeManagedRun({
    url: 'https://example.com/apply',
    actions: [{ type: 'click', selector: 'button[type="submit"]' }],
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: providerDeadlineAt(),
  }, { urlValidator: async (value) => new URL(value) });
  assert.equal(normalized.allowSubmit, false);
  assert.equal(normalized.exactMutationAuthority, true);
  assert.equal(normalized.exactFinalActionAuthority, false);
});

test('managed actions accept reviewed questions and bounded resume uploads', () => {
  assert.deepEqual(normalizeManagedActions([
    { type: 'fillByLabelText', text: 'Why this role?', value: 'I enjoy platform engineering.', label: 'question:Why this role?' },
    { type: 'upload', selector: '#resume', optional: true, label: 'resume', file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: 'cGRm' } }
  ]), [
    { type: 'fillByLabelText', text: 'Why this role?', value: 'I enjoy platform engineering.', label: 'question:Why this role?' },
    { type: 'upload', selector: '#resume', optional: true, label: 'resume', file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: 'cGRm' } }
  ]);
  assert.throws(
    () => normalizeManagedActions([{ type: 'upload', selector: '#resume', file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: 'x'.repeat(6_000_001) } }]),
    (error) => error.code === 'INVALID_UPLOAD'
  );
  assert.throws(
    () => normalizeManagedActions([{ type: 'upload', selector: '#resume', file: { name: '../resume.pdf', mimeType: 'application/pdf', base64: 'cGRm' } }]),
    (error) => error.code === 'INVALID_UPLOAD'
  );
  assert.deepEqual(
    normalizeManagedActions([{
      type: 'upload',
      selector: '#resume',
      file: { name: 'resume.pdf', mimeType: 'Application/PDF', base64: 'cGRm' }
    }])[0].file,
    { name: 'resume.pdf', mimeType: 'application/pdf', base64: 'cGRm' }
  );
});

test('sandbox runner is syntactically valid and returns labelled extracts', () => {
  assert.doesNotThrow(() => new Function(SANDBOX_RUNNER));
  assert.match(SANDBOX_RUNNER, /appendExtracted\(\{[\s\S]*selector: action\.selector,[\s\S]*expectedValueDigits/);
});

test('the shipped runner bounds one oversized extract and cumulative extract output', () => {
  const start = SANDBOX_RUNNER.indexOf('    const extracted = [];');
  const end = SANDBOX_RUNNER.indexOf('    const filledFields = [];', start);
  assert.ok(start >= 0 && end > start, 'the extraction budget must remain extractable');
  const budgetSource = SANDBOX_RUNNER.slice(start, end);
  const createBudget = new Function(
    `${budgetSource}\nreturn { appendExtracted, extracted, extractedTotalBytes: () => extractedTotalBytes };`,
  );

  const oversized = createBudget();
  assert.throws(
    () => oversized.appendExtracted({ selector: '#one', value: 'x'.repeat(65 * 1024) }),
    /bounded result budget/,
  );
  assert.deepEqual(oversized.extracted, []);
  assert.equal(oversized.extractedTotalBytes(), 0);

  const cumulative = createBudget();
  const value = 'x'.repeat(63 * 1024);
  let accepted = 0;
  while (accepted < 256) {
    try {
      cumulative.appendExtracted({ selector: `#value-${accepted}`, value });
      accepted += 1;
    } catch (error) {
      assert.match(String(error?.message || error), /bounded result budget/);
      break;
    }
  }
  assert.ok(accepted > 1 && accepted < 256);
  assert.ok(cumulative.extractedTotalBytes() <= 4 * 1024 * 1024);
  assert.equal(cumulative.extracted.length, accepted);
});

test('managed browser source contains no literal NUL byte', () => {
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url));
  assert.equal(source.includes(0), false);
});

test('atomic v4 source retains its final native containment boundaries', () => {
  assert.match(SANDBOX_RUNNER, /ready = blockDocumentOpenPopup\(\) && ready;/);
  assert.match(SANDBOX_RUNNER, /capability\.disableDnsPrefetch = \(\) =>/);
  assert.match(SANDBOX_RUNNER, /if \(type === 'image'\) \{\s*if \(control === element\) return null;\s*continue;/);
  assert.match(SANDBOX_RUNNER, /actionUrl\.username[\s\S]*actionUrl\.password/);
  assert.match(SANDBOX_RUNNER, /!redirected\.username[\s\S]*!redirected\.password/);
  assert.match(SANDBOX_RUNNER, /\(firstHextet & 0xe000\) !== 0x2000/);
  assert.match(SANDBOX_RUNNER, /submitTransportDisposition[\s\S]*ancillary_transport_blocked_after_release/);
  assert.match(SANDBOX_RUNNER, /dns\.lookup\(destination\.hostname, \{ all: true, family: 4 \}\)/);
  assert.match(SANDBOX_RUNNER, /const visibleRenderedText = \(node, depth = 0\) =>/);
  assert.match(SANDBOX_RUNNER, /const unambiguousRequiredOwnerControl = \(associated\) =>/);
});

test('v4 fingerprints validation bypass state before rejecting unsupported native transport', () => {
  const fingerprintStart = SANDBOX_RUNNER.indexOf('const pristineActivationFingerprint =');
  const candidateStart = SANDBOX_RUNNER.indexOf(
    'const pristineV4SubmitCandidateSnapshot =',
    fingerprintStart,
  );
  const bindingStart = SANDBOX_RUNNER.indexOf('const pristineNativePostBinding =', candidateStart);
  const bindingEnd = SANDBOX_RUNNER.indexOf('const pristineRequiredControlBlockers =', bindingStart);
  assert.ok(
    fingerprintStart !== -1 && candidateStart > fingerprintStart
      && bindingStart > candidateStart && bindingEnd > bindingStart,
    'the v4 fingerprint, candidate, and native binding must be extractable in order',
  );

  const fingerprint = SANDBOX_RUNNER.slice(fingerprintStart, candidateStart);
  assert.match(fingerprint, /formState\.noValidateAttribute = attribute\(root, 'novalidate'\)/);
  assert.match(fingerprint, /formState\.noValidate = NativeBoolean\(read\(formNoValidateGetter, root\)\)/);
  assert.match(fingerprint, /submitterFingerprint\.formNoValidate = attribute\(element, 'formnovalidate'\)/);
  assert.doesNotMatch(
    fingerprint,
    /if \(NativeBoolean\(read\(formNoValidateGetter, root\)\)\s*\|\|\s*NativeBoolean\(read\(submitter\.noValidateGetter, element\)\)\) return null/,
    'novalidate is binding state, so it must not erase the submit candidate',
  );

  const candidate = SANDBOX_RUNNER.slice(candidateStart, bindingStart);
  assert.match(
    candidate,
    /const fingerprint = pristineActivationFingerprint\(root, element, true\)/,
  );

  const nativeBinding = SANDBOX_RUNNER.slice(bindingStart, bindingEnd);
  assert.match(
    nativeBinding,
    /validationDisabled = NativeBoolean\(read\(formNoValidateGetter, root\)\)\s*\|\|\s*NativeBoolean\(read\(submitter\.noValidateGetter, element\)\)/,
  );
  assert.match(
    nativeBinding,
    /if \(validationDisabled \|\| target !== '_self'[\s\S]*unsupportedReason: 'submit_transport_unsupported'/,
    'the native binding must report validation bypass as an unsupported transport',
  );
});

test('v3 detached failed choices stay scoped while v4 keeps its global refusal', () => {
  const start = SANDBOX_RUNNER.indexOf('const unsuccessfulChoiceFailuresForScope = async');
  const end = SANDBOX_RUNNER.indexOf('const protectChooserBinding =', start);
  assert.ok(start !== -1 && end > start, 'the failed-choice scope guard must be extractable');
  const guard = SANDBOX_RUNNER.slice(start, end);
  assert.match(
    guard,
    /const scopeRelevantFailures = retainedAtomicV4Run\s*\? currentPageFailures\s*:\s*\[\]/,
    'v4 must retain every same-document failed choice before disconnected-node checks'
  );
  assert.match(guard, /\(scope, originalForm\) => scope === originalForm/);
  assert.match(guard, /ancestry\[index\] === scope/);
  assert.match(guard, /failures: scopeRelevantFailures\.map/);
  assert.match(guard, /\.catch\(\(\) => scopeRelevantFailures\.map/);
  assert.match(
    guard,
    /if \(!controlConnected \|\| !boundScopeConnected\) \{\s*failures\.push\(failure\.kind\)/,
    'v4 must still fail closed when the original failed control or form detaches'
  );
});

test('managed run always uses the Stratus Sandbox execution system', async () => {
  const sandboxExecutor = async (input) => ({ title: 'Sandbox', url: input.url, screenshot: 'sandbox-image' });
  const result = await executeManagedRun({ url: 'https://example.com' }, { sandboxExecutor });
  assert.equal(result.title, 'Sandbox');
  assert.equal(result.screenshot, 'sandbox-image');
});

test('managed continuation contract is bounded and rejects URL or recursion', () => {
  assert.deepEqual(MANAGED_CONTINUATION_CONTRACT, {
    requestField: 'requestContinuation',
    checkpointField: 'continuationCheckpoint',
    ttlField: 'continuationTtlSeconds',
    tokenField: 'continuationToken',
    expiresAtField: 'continuationExpiresAt',
    defaultTtlSeconds: 180,
    minTtlSeconds: 15,
    maxTtlSeconds: 240,
    ttlStartsAt: 'challenge',
    maxContinuations: 1
  });
  const token = 'a'.repeat(43);
  const deadline = providerDeadlineAt();
  assert.deepEqual(normalizeManagedContinuation({
    continuationToken: token,
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: deadline,
    actions: [{ type: 'extract', selector: '#status' }],
    screenshot: false
  }), {
    continuationToken: token,
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: deadline,
    actions: [{ type: 'extract', selector: '#status' }],
    screenshot: false,
    // The preview-artifact wait is opt-in by the literal true; a continuation that did not ask
    // for it carries an explicit false so no reader can infer a wait from an absent field.
    screenshotWait: false,
    fullPage: false,
    // A read-only continuation carries both authority flags explicitly false so a downstream
    // reader can never infer mutation or final-action authority from their absence.
    exactFinalActionAuthority: false,
    exactMutationAuthority: false
  });
  assert.throws(
    () => normalizeManagedContinuation({ continuationToken: token, url: 'https://example.com', actions: [] }),
    (error) => error.code === 'CONTINUATION_URL_FORBIDDEN'
  );
  assert.throws(
    () => normalizeManagedContinuation({ continuationToken: token, requestContinuation: true, actions: [] }),
    (error) => error.code === 'CONTINUATION_LIMIT_REACHED'
  );
});

test('managed continuations reject every mutation action, including v3 application submit', () => {
  const continuation = {
    continuationToken: 'm'.repeat(43),
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: providerDeadlineAt(),
  };
  const submitBase = {
    type: 'confirmAndSubmit',
    selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
    chooserPolicy: ATOMIC_SUBMIT_POLICY_V3,
    label: 'final_submit',
    optional: false,
    maxRetries: 1,
    contractVersion: 2,
  };
  const mutationActions = [
    ['discover', { type: 'discover' }],
    ['click', { type: 'click', selector: '#continue' }],
    ['fill', { type: 'fill', selector: '#name', value: 'Mehek' }],
    ['fillByLabelText', { type: 'fillByLabelText', text: 'Name', value: 'Mehek' }],
    ['upload', {
      type: 'upload', selector: '#resume', file: {
        name: 'resume.pdf', mimeType: 'application/pdf', base64: 'cGRm',
      },
    }],
    ['press', { type: 'press', value: 'Enter' }],
    ['select', { type: 'select', selector: '#country', value: 'AE' }],
    ['v3 application confirmAndSubmit', { ...submitBase, submitKind: 'application' }],
  ];
  for (const [label, action] of mutationActions) {
    assert.throws(
      () => normalizeManagedContinuation({ ...continuation, actions: [action] }),
      (error) => error.code === 'CONTINUATION_ACTION_FORBIDDEN',
      label,
    );
  }
});

test('managed continuation execution ids are deterministic UUID v5 values scoped to the claim and purpose', () => {
  const securityCode = managedContinuationExecutionId(SUBMISSION_ATTEMPT.claimId, 'security_code');
  const receiptObservation = managedContinuationExecutionId(
    SUBMISSION_ATTEMPT.claimId,
    'receipt_observation',
  );
  assert.equal(securityCode, '8c3e3582-f4c8-5df6-ab4f-38ee12b9c542');
  assert.equal(
    managedContinuationExecutionId(SUBMISSION_ATTEMPT.claimId, 'security_code'),
    securityCode,
  );
  assert.notEqual(securityCode, receiptObservation);
  const securityAttempt = { ...SUBMISSION_ATTEMPT, executionId: securityCode };
  const receiptAttempt = { ...SUBMISSION_ATTEMPT, executionId: receiptObservation };
  assert.equal(securityAttempt.runId, receiptAttempt.runId);
  assert.equal(securityAttempt.claimId, receiptAttempt.claimId);
  assert.notEqual(securityAttempt.executionId, receiptAttempt.executionId);
  assert.notEqual(
    securityCode,
    managedContinuationExecutionId('44444444-4444-4444-8444-444444444444', 'security_code'),
  );
  assert.notEqual(securityCode, SUBMISSION_ATTEMPT.executionId);
});

test('exact v3 and v4 verification-code continuations remain allowed', () => {
  const expectedPageUrl = 'https://jobs.example.com/postings/verification';
  const exactCapability = {
    type: 'requireCapability',
    value: EXACT_PAGE_URL_CAPABILITY,
    optional: false,
    expectedPageUrl,
  };
  const submit = {
    type: 'confirmAndSubmit',
    selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
    label: 'verification_submit',
    optional: false,
    maxRetries: 1,
    contractVersion: 2,
    submitKind: 'verification',
    securityCode: 'ABC12345',
    expectedPageUrl,
  };
  const common = {
    continuationToken: 'v'.repeat(43),
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: providerDeadlineAt(),
    actions: [exactCapability, { ...submit, chooserPolicy: ATOMIC_SUBMIT_POLICY_V3 }],
  };
  const v3 = normalizeManagedContinuation(common);
  assert.equal(v3.actions[1].chooserPolicy.version, 3);
  assert.equal(v3.actions[1].securityCode, 'ABC12345');

  const v4 = normalizeManagedContinuation({
    ...common,
    continuationToken: 'w'.repeat(43),
    actions: [
      exactCapability,
      {
        type: 'requireCapability',
        value: ATOMIC_SUBMIT_V4_CAPABILITY,
        optional: false,
        applicationScopeSelector: '#application',
      },
      { ...submit, chooserPolicy: ATOMIC_SUBMIT_POLICY_V4 },
    ],
  });
  assert.equal(v4.actions[2].chooserPolicy.version, 4);
  assert.equal(v4.actions[2].securityCode, 'ABC12345');
});

test('receipt-observation continuation rejects a second application submit', () => {
  const expectedPageUrl = 'https://jobs.example.com/postings/receipt-observation';
  const actions = [
    {
      type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl,
    },
    {
      type: 'requireCapability', value: ATOMIC_SUBMIT_V4_CAPABILITY, optional: false,
      applicationScopeSelector: '#application',
    },
    {
      type: 'confirmAndSubmit',
      selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
      chooserPolicy: ATOMIC_SUBMIT_POLICY_V4,
      label: 'final_submit',
      optional: false,
      maxRetries: 1,
      contractVersion: 2,
      submitKind: 'application',
      expectedPageUrl,
    },
  ];
  assert.throws(
    () => normalizeManagedContinuation({
      continuationToken: 'r'.repeat(43), submissionAttempt: SUBMISSION_ATTEMPT,
      providerDeadlineAt: providerDeadlineAt(), actions,
    }),
    (error) => error.code === 'CONTINUATION_ACTION_FORBIDDEN',
  );
});

test('sandbox continuation is project-bound and single-use without exposing a session id', async () => {
  const sandboxes = new Map();
  const template = { name: CURRENT_SANDBOX_TEMPLATE, currentSnapshotId: 'snapshot' };
  class FakeSandbox {
    constructor(name) {
      this.name = name;
      this.files = new Map();
      this.stopped = false;
    }
    async writeFiles(files) {
      for (const file of files) this.files.set(file.path, Buffer.from(file.content));
      if (this.files.has('stratus-continuation-input.json')) {
        const continuation = JSON.parse(this.files.get('stratus-continuation-input.json').toString('utf8'));
        const original = JSON.parse(this.files.get('stratus-input.json').toString('utf8'));
        const result = {
          title: 'Application received',
          url: 'https://example.com/thanks',
          text: 'received',
          submissionAttempt: continuation.submissionAttempt,
        };
        this.files.set('stratus-result-1.json', Buffer.from(JSON.stringify(result)));
        this.files.set(MANAGED_TERMINAL_RESULT_PATH, managedTerminalEnvelope(result, original, {
          phase: 1,
        }));
      }
    }
    async runCommand(command, args) {
      if (typeof command === 'object') {
        const input = JSON.parse(this.files.get('stratus-input.json').toString('utf8'));
        this.files.set('stratus-result-0.json', Buffer.from(JSON.stringify({
          title: 'Continue',
          url: input.url,
          text: 'Check your inbox',
          humanVerification: { kind: 'security_code', fieldCount: 8, sentTo: 'applicant@example.com' },
          submissionAttempt: input.submissionAttempt,
        })));
        if (input.requestContinuation) this.files.set('stratus-continuation-ready.json', Buffer.from('{}'));
        return { exitCode: null };
      }
      const script = args[1];
      if (script.includes('stratus-continuation.json')) {
        if (this.stopped || !this.files.has('stratus-continuation.json') || !this.files.has('stratus-continuation-ready.json')) return { exitCode: 7 };
        this.files.set('stratus-continuation-used.json', this.files.get('stratus-continuation.json'));
        this.files.delete('stratus-continuation.json');
        return { exitCode: 0 };
      }
      // The wait now watches SEVERAL paths - a result or a recorded crash - and reports which one
      // it found on stdout, so the fake answers the same way the sandbox does.
      const wanted = args.slice(3);
      const found = wanted.find((path) => this.files.has(path));
      return found ? { exitCode: 0, stdout: async () => found } : { exitCode: 3, stdout: async () => '' };
    }
    async readFileToBuffer({ path }) { return this.files.get(path) || null; }
    async stop() { this.stopped = true; }
  }
  const sandboxApi = {
    async get({ name }) {
      if (name === template.name) return template;
      const sandbox = sandboxes.get(name);
      if (!sandbox) throw new Error('not found');
      return sandbox;
    },
    async fork({ name }) {
      const sandbox = new FakeSandbox(name);
      sandboxes.set(name, sandbox);
      return sandbox;
    }
  };
  const urlValidator = async (value) => new URL(value);
  const releasePolicy = submissionReleasePolicy({
    [STRATUS_SUBMISSION_CORRELATION_MODE_ENV]: 'compat',
  });
  const first = await executeSandboxRun({
    url: 'https://example.com/apply', actions: [], requestContinuation: true,
    providerDeadlineAt: providerDeadlineAt(),
  }, { sandboxApi, urlValidator, projectBinding: 'project-a', releasePolicy });
  assert.match(first.continuationToken, /^[A-Za-z0-9_-]+$/);
  assert.ok(first.continuationExpiresAt);
  assert.equal('sessionId' in first, false);
  const second = await executeSandboxRun({
    continuationToken: first.continuationToken,
    providerDeadlineAt: providerDeadlineAt(),
    actions: []
  }, { sandboxApi, urlValidator, projectBinding: 'project-a', releasePolicy });
  assert.equal(second.title, 'Application received');
  await assert.rejects(executeSandboxRun({
    continuationToken: first.continuationToken,
    providerDeadlineAt: providerDeadlineAt(), actions: [],
  }, { sandboxApi, urlValidator, projectBinding: 'project-a', releasePolicy }),
    (error) => error.code === 'CONTINUATION_REJECTED',
  );
  await assert.rejects(
    executeSandboxRun({
      continuationToken: first.continuationToken,
      providerDeadlineAt: providerDeadlineAt(), actions: [],
    }, { sandboxApi, urlValidator, projectBinding: 'project-b', releasePolicy }),
    (error) => error.code === 'CONTINUATION_REJECTED'
  );
});

test('v4 continuation refuses an incompatible retained runner before writing continuation input', async () => {
  const expectedPageUrl = 'https://jobs.example.com/postings/continuation-v4';
  const exactCapability = {
    type: 'requireCapability',
    value: EXACT_PAGE_URL_CAPABILITY,
    optional: false,
    expectedPageUrl,
  };
  const v4Capability = {
    type: 'requireCapability',
    value: ATOMIC_SUBMIT_V4_CAPABILITY,
    optional: false,
    applicationScopeSelector: '#application',
  };
  const submit = {
    type: 'confirmAndSubmit',
    selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
    chooserPolicy: ATOMIC_SUBMIT_POLICY_V4,
    label: 'final_submit',
    optional: false,
    maxRetries: 1,
    contractVersion: 2,
    submitKind: 'verification',
    securityCode: 'ABC12345',
    expectedPageUrl,
  };
  const harness = (manifest, projectBinding) => {
    const requestDigest = 'a'.repeat(64);
    const terminalInput = {
      submissionAttempt: SUBMISSION_ATTEMPT,
      terminalResultProjectHash: crypto.createHash('sha256').update(projectBinding).digest('hex'),
      terminalResultRequestDigest: requestDigest,
    };
    const files = new Map([
      [MANAGED_SUBMISSION_RESERVATION_PATH, managedReservation(
        projectBinding,
        SUBMISSION_ATTEMPT,
        requestDigest,
      )],
    ]);
    let continuationWrites = 0;
    let claimedCapabilities = null;
    let claimedActionMode = null;
    let stopped = false;
    const sandbox = {
      async runCommand(command, args) {
        if (command === 'node'
          && typeof args?.[1] === 'string'
          && args[1].includes('const [tokenHash, projectHash, requiredJson')) {
          claimedCapabilities = JSON.parse(args[4] || '[]');
          claimedActionMode = args[5] || null;
          const needsV4 = claimedCapabilities.includes(ATOMIC_SUBMIT_V4_CAPABILITY);
          const supportsV4 = manifest?.protocolVersion >= 4
            && Array.isArray(manifest.capabilities)
            && claimedCapabilities.every((capability) => manifest.capabilities.includes(capability));
          return { exitCode: needsV4 && !supportsV4 ? 8 : 0 };
        }
        const wanted = args.slice(3);
        const found = wanted.find((filePath) => files.has(filePath));
        return found ? { exitCode: 0, stdout: async () => found } : { exitCode: 3, stdout: async () => '' };
      },
      async writeFiles(batch) {
        for (const file of batch) {
          files.set(file.path, Buffer.from(file.content));
          if (file.path === 'stratus-continuation-input.json') continuationWrites += 1;
        }
        if (files.has('stratus-continuation-input.json')) {
          const continuation = JSON.parse(files.get('stratus-continuation-input.json').toString('utf8'));
          const result = {
            title: 'Compatible continuation',
            submissionAttempt: continuation.submissionAttempt,
          };
          files.set('stratus-result-1.json', Buffer.from(JSON.stringify(result)));
          files.set(MANAGED_TERMINAL_RESULT_PATH, managedTerminalEnvelope(result, terminalInput, {
            phase: 1,
          }));
        }
      },
      async readFileToBuffer({ path: filePath }) { return files.get(filePath) || null; },
      async stop() { stopped = true; },
    };
    return {
      sandbox,
      sandboxApi: { async get() { return sandbox; } },
      state: () => ({ continuationWrites, claimedCapabilities, claimedActionMode, stopped }),
    };
  };
  const v4Input = {
    continuationToken: 'v'.repeat(43),
    providerDeadlineAt: providerDeadlineAt(),
    actions: [exactCapability, v4Capability, submit],
    screenshot: false,
  };
  const compatibilityPolicy = submissionReleasePolicy({
    [STRATUS_SUBMISSION_CORRELATION_MODE_ENV]: 'compat',
  });
  const incompatibleManifests = [
    ['missing manifest', null],
    ['protocol 3 manifest', {
      protocolVersion: 3,
      capabilities: [EXACT_PAGE_URL_CAPABILITY, ATOMIC_SUBMIT_V4_CAPABILITY],
    }],
  ];
  for (const [label, manifest] of incompatibleManifests) {
    const projectBinding = `project-${label}`;
    const fake = harness(manifest, projectBinding);
    await assert.rejects(
      executeSandboxRun(v4Input, {
        sandboxApi: fake.sandboxApi,
        projectBinding,
        releasePolicy: compatibilityPolicy,
      }),
      (error) => error.code === 'CONTINUATION_RUNNER_INCOMPATIBLE' && error.status === 409,
      label,
    );
    assert.deepEqual(
      fake.state().claimedCapabilities,
      [EXACT_PAGE_URL_CAPABILITY, ATOMIC_SUBMIT_V4_CAPABILITY],
      `${label} must receive the v4 capability requirement`,
    );
    assert.equal(fake.state().claimedActionMode, 'security-code');
    assert.equal(fake.state().continuationWrites, 0, `${label} must fail before continuation input is written`);
    assert.equal(fake.state().stopped, true,
      'a rejected compatibility continuation closes its uncorrelated retained session');
  }

  const v3Fake = harness(null, 'project-v3');
  const v3Result = await executeSandboxRun({
    continuationToken: 'w'.repeat(43),
    providerDeadlineAt: providerDeadlineAt(),
    actions: [exactCapability, { ...submit, chooserPolicy: ATOMIC_SUBMIT_POLICY_V3 }],
    screenshot: false,
  }, {
    sandboxApi: v3Fake.sandboxApi,
    projectBinding: 'project-v3',
    releasePolicy: compatibilityPolicy,
  });
  assert.equal(v3Result.title, 'Compatible continuation');
  assert.deepEqual(v3Fake.state().claimedCapabilities, [EXACT_PAGE_URL_CAPABILITY]);
  assert.equal(v3Fake.state().claimedActionMode, 'security-code',
    'the exported v3 chooser must retain the one-shot v4 security-code continuation path');
  assert.equal(v3Fake.state().continuationWrites, 1);
});

test('retained v4 adapts the exported v3 code action only on its original bound document', () => {
  assert.match(SANDBOX_RUNNER, /let retainedV4SecurityCodeContinuation = false;/);
  assert.match(SANDBOX_RUNNER, /\[3, 4\]\.includes\(securityCodeAction\.chooserPolicy\?\.version\)/);
  assert.match(SANDBOX_RUNNER, /exactCapabilities\.length === 1[\s\S]*securityCodeAction\.expectedPageUrl === exactCapabilities\[0\]\.expectedPageUrl/);
  assert.match(SANDBOX_RUNNER, /const recordsSuccessfulAddresses = retainedV4SecurityCodeContinuation/);
  assert.match(SANDBOX_RUNNER, /const chooserVersion = retainedV4SecurityCodeContinuation[\s\S]*\? 4\n\s*: action\.chooserPolicy\.version;/);
  assert.match(SANDBOX_RUNNER, /if \(applicationScopeProofGeneration !== v4DocumentGeneration\) return 'not_entered';/);
  assert.match(SANDBOX_RUNNER, /'bindApplicationRoot',\n\s*formHandle[\s\S]*if \(scopeState !== 'bound'\) return 'not_entered';/);
  assert.match(SANDBOX_RUNNER, /applicationScopeProofHandle = retainedScopeHandle;/);
});

test('the continuation claim durably commits exact input and resumes an interrupted claim', async () => {
  const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-claim-'));
  const tokenHash = digest('receipt-observation-token');
  const projectHash = digest('project-a');
  const submissionRunHash = digest(SUBMISSION_ATTEMPT.runId);
  const submissionClaimHash = digest(SUBMISSION_ATTEMPT.claimId);
  const submissionExecutionHash = digest(SUBMISSION_ATTEMPT.executionId);
  const receiptExecutionHash = digest(managedContinuationExecutionId(
    SUBMISSION_ATTEMPT.claimId,
    'receipt_observation',
  ));
  const securityExecutionHash = digest(managedContinuationExecutionId(
    SUBMISSION_ATTEMPT.claimId,
    'security_code',
  ));
  const markerPath = path.join(workDir, 'stratus-continuation.json');
  const readyPath = path.join(workDir, 'stratus-continuation-ready.json');
  const usedPath = path.join(workDir, 'stratus-continuation-used.json');
  const manifestPath = path.join(workDir, 'stratus-runner-capabilities.json');
  const claimPath = path.join(workDir, 'stratus-continuation-claim.json');
  const reservationPath = path.join(workDir, MANAGED_CONTINUATION_RESERVATION_PATH);
  const inputPath = path.join(workDir, 'stratus-continuation-input.json');
  const writeMarker = (expiresAt, continuationPolicy = null) => {
    for (const artifact of [usedPath, claimPath, reservationPath, inputPath]) {
      fs.rmSync(artifact, { force: true });
    }
    for (const artifact of fs.readdirSync(workDir)) {
      if (artifact.startsWith('stratus-continuation-candidate-')) {
        fs.rmSync(path.join(workDir, artifact), { force: true });
      }
    }
    fs.writeFileSync(markerPath, JSON.stringify({
      tokenHash, projectHash, expiresAt, used: false,
      submissionRunHash, submissionClaimHash, submissionExecutionHash,
      continuationReceiptObservationExecutionHash: receiptExecutionHash,
      continuationSecurityCodeExecutionHash: securityExecutionHash,
      ...(continuationPolicy ? { continuationPolicy } : {}),
    }));
    fs.writeFileSync(readyPath, '{}');
  };
  const candidate = ({
    requestDigest = digest('exact-request'),
    actionMode = 'observation',
    requiredCapabilities = [],
  } = {}) => {
    const value = {
      schemaVersion: 'stratus-continuation-claim-v1',
      projectHash,
      actionMode,
      requestDigest,
      requiredCapabilities,
      input: {
        continuationToken: 'private-token',
        actions: [],
        submissionAttempt: {
          ...SUBMISSION_ATTEMPT,
          executionId: actionMode === 'security-code'
            ? managedContinuationExecutionId(SUBMISSION_ATTEMPT.claimId, 'security_code')
            : managedContinuationExecutionId(SUBMISSION_ATTEMPT.claimId, 'receipt_observation'),
        },
      },
      reservation: {
        schemaVersion: MANAGED_SUBMISSION_RESERVATION_SCHEMA_VERSION,
        submissionAttempt: SUBMISSION_ATTEMPT,
      },
    };
    const content = Buffer.from(JSON.stringify(value));
    const candidateDigest = digest(content);
    const candidatePath = `stratus-continuation-candidate-${candidateDigest}.json`;
    fs.writeFileSync(path.join(workDir, candidatePath), content);
    return { candidatePath, candidateDigest, value };
  };
  const claim = ({
    candidateValue = candidate(),
    claimedProjectHash = projectHash,
    claimedExecutionHash = receiptExecutionHash,
    preload = null,
  } = {}) => new Promise((resolve) => {
    const child = spawn(process.execPath, [
      ...(preload ? ['--require', preload] : []),
      '-e', CLAIM_CONTINUATION_SCRIPT,
      candidateValue.candidatePath,
      candidateValue.candidateDigest,
      tokenHash,
      claimedProjectHash,
      candidateValue.value.actionMode,
      submissionRunHash, submissionClaimHash, claimedExecutionHash,
    ], {
      cwd: workDir,
      stdio: 'ignore',
    });
    child.on('close', resolve);
  });

  writeMarker(new Date(Date.now() + 15_000).toISOString());
  assert.equal(await claim({ claimedProjectHash: digest('project-b') }), 13,
    'a candidate bound to another project must not be consumed');
  assert.equal(fs.existsSync(markerPath), true);

  writeMarker(new Date(Date.now() + 15_000).toISOString());
  assert.equal(await claim({ claimedExecutionHash: digest('different-execution') }), 11,
    'a continuation from another execution must not be consumed');
  assert.equal(fs.existsSync(markerPath), true);

  writeMarker(new Date(Date.now() - 1).toISOString());
  assert.equal(await claim(), 6, 'the short receipt token must refuse a claim after expiry');
  assert.equal(fs.existsSync(markerPath), true);

  writeMarker(
    new Date(Date.now() + 15_000).toISOString(),
    'v4-observation-or-security-code',
  );
  assert.equal(await claim({ candidateValue: candidate({ actionMode: 'mutation' }) }), 9,
    'a retained v4 receipt session must reject another mutation path');
  assert.equal(fs.existsSync(markerPath), true, 'a refused mutation must not consume the receipt session');

  fs.rmSync(manifestPath, { force: true });
  writeMarker(
    new Date(Date.now() + 15_000).toISOString(),
    'v4-observation-or-security-code',
  );
  assert.equal(await claim({ candidateValue: candidate({
    requiredCapabilities: [ATOMIC_SUBMIT_V4_CAPABILITY],
  }) }), 8);
  assert.equal(fs.existsSync(markerPath), true, 'a missing runner manifest must not consume the marker');
  assert.equal(fs.existsSync(usedPath), false);

  fs.writeFileSync(manifestPath, JSON.stringify({
    protocolVersion: 3,
    capabilities: [ATOMIC_SUBMIT_V4_CAPABILITY],
  }));
  writeMarker(
    new Date(Date.now() + 15_000).toISOString(),
    'v4-observation-or-security-code',
  );
  assert.equal(await claim({ candidateValue: candidate({
    requiredCapabilities: [ATOMIC_SUBMIT_V4_CAPABILITY],
  }) }), 8);
  assert.equal(fs.existsSync(markerPath), true, 'a protocol 3 manifest must not consume the marker');
  assert.equal(fs.existsSync(usedPath), false);

  fs.writeFileSync(manifestPath, JSON.stringify({
    protocolVersion: 4,
    capabilities: [EXACT_PAGE_URL_CAPABILITY, ATOMIC_SUBMIT_V4_CAPABILITY],
  }));
  writeMarker(new Date(Date.now() + 15_000).toISOString());
  assert.equal(await claim({ candidateValue: candidate({
    requiredCapabilities: [EXACT_PAGE_URL_CAPABILITY, ATOMIC_SUBMIT_V4_CAPABILITY],
  }) }), 10,
    'a v3 retained marker must refuse a v4 upgrade before it is consumed');
  assert.equal(fs.existsSync(markerPath), true, 'a refused v4 upgrade preserves the v3 marker');
  assert.equal(fs.existsSync(usedPath), false);
  writeMarker(
    new Date(Date.now() + 15_000).toISOString(),
    'v4-observation-or-security-code',
  );
  const v4Candidate = candidate({
    requiredCapabilities: [EXACT_PAGE_URL_CAPABILITY, ATOMIC_SUBMIT_V4_CAPABILITY],
  });
  assert.equal(await claim({ candidateValue: v4Candidate }), 0);
  assert.equal(fs.existsSync(markerPath), false);
  assert.equal(fs.existsSync(usedPath), true);

  const replayCandidate = candidate({
    requiredCapabilities: [EXACT_PAGE_URL_CAPABILITY, ATOMIC_SUBMIT_V4_CAPABILITY],
  });
  assert.equal(await claim({ candidateValue: replayCandidate }), 0,
    'an identical committed claim is idempotent');

  fs.rmSync(manifestPath, { force: true });
  writeMarker(new Date(Date.now() + 15_000).toISOString());
  const interruptedCandidate = candidate();
  const shimPath = path.join(workDir, 'fail-before-input.cjs');
  fs.writeFileSync(shimPath, [
    "const fs = require('node:fs');",
    'const renameSync = fs.renameSync;',
    "fs.renameSync = (from, to) => { if (to === 'stratus-continuation-input.json') throw new Error('forced'); return renameSync(from, to); };",
  ].join('\n'));
  assert.equal(await claim({ candidateValue: interruptedCandidate, preload: shimPath }), 7);
  assert.ok(fs.existsSync(claimPath));
  assert.ok(fs.existsSync(reservationPath));
  assert.equal(fs.existsSync(inputPath), false);
  assert.equal(fs.existsSync(usedPath), false);

  const divergent = candidate({ requestDigest: digest('divergent-request') });
  assert.equal(await claim({ candidateValue: divergent }), 12,
    'a divergent retry cannot take over the durable claim');
  assert.equal(await claim({ candidateValue: interruptedCandidate }), 0,
    'the exact interrupted claim resumes and durably writes provider input');
  assert.ok(fs.existsSync(inputPath));
  assert.ok(fs.existsSync(usedPath));
  assert.equal(fs.existsSync(claimPath), false);
});

// The runner ships to the sandbox as a string, so nothing type-checks it and a regression only
// shows up when a real application fails on a real portal. These pin the branches that cost three
// deploys to find, against a live Greenhouse form (Aquatic Capital Management, 2026-07-23).

test('an optional action that THROWS is stepped over, not fatal to the run', () => {
  // The old guard was `if (locator && action.optional && count === 0) continue`, which only covered
  // a MISSING element and never applied to fillByLabelText at all (no selector, so locator is null).
  // One unfillable checkbox therefore discarded the name, email, phone and resume already entered.
  assert.match(SANDBOX_RUNNER, /catch \(actionError\)/);
  assert.match(SANDBOX_RUNNER, /if \(!action\.optional\) \{/);
  assert.match(SANDBOX_RUNNER, /if \(!finalSubmitPressed\) throw actionError;/);
  assert.match(SANDBOX_RUNNER, /markPostSubmitObservationFailed\(\);/);
  assert.match(SANDBOX_RUNNER, /skipped\.push\(/);
});

test('a skipped action is reported rather than swallowed', () => {
  // A silent skip is how a half-filled form starts looking like a fully-filled one.
  assert.match(SANDBOX_RUNNER, /skipped: \[\.\.\.new Set\(skipped\)\]/);
  assert.match(SANDBOX_RUNNER, /fillByLabelText: label not found/);
  assert.match(SANDBOX_RUNNER, /fillByLabelText: field not found/);
});

test('fillByLabelText dispatches on the control type', () => {
  // Everything used to fall through to fill(), which throws on a checkbox or radio.
  assert.match(SANDBOX_RUNNER, /shape\.tag === 'select'/);
  assert.match(SANDBOX_RUNNER, /shape\.type === 'checkbox' \|\| shape\.type === 'radio'/);
  // The tick itself. check() first because the input is usually actionable, then the label, because
  // a board that clips the input out of the layout still paints words a person can click.
  assert.match(SANDBOX_RUNNER, /await match\.check\(\{ timeout: 5000 \}\)/);
  assert.match(SANDBOX_RUNNER, /\(byFor \|\| element\.closest\('label'\) \|\| element\)\.click\(\)/);
});

test('fills are reported only after the page keeps the value', () => {
  assert.match(SANDBOX_RUNNER, /const verifyFilled = async \(field, expected\) =>/);
  assert.match(SANDBOX_RUNNER, /const verifyChoiceInContainer = async \([\s\S]*?directControl = null,[\s\S]*?\) =>/);
  assert.match(SANDBOX_RUNNER, /value did not persist after fill/);
  assert.match(SANDBOX_RUNNER, /value did not persist after fillByLabelText/);
  assert.match(SANDBOX_RUNNER, /dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
});

test('fillByLabelText can use scoped custom listbox controls', () => {
  assert.match(SANDBOX_RUNNER, /const fillCustomChoice = async \(container, wanted, directControl = null, exactContext = null\) =>/);
  assert.match(SANDBOX_RUNNER, /\[role="combobox"\], \[aria-haspopup="listbox"\]/);
  assert.match(SANDBOX_RUNNER, /getByRole\('option', \{ name: option, exact: false \}\)/);
  assert.match(SANDBOX_RUNNER, /const customSelected = await fillCustomChoice\(\n\s+questionBlock,\n\s+action\.value \|\| '',\n\s+null,\n\s+exactActionContext\n\s+\);/);
});

test('an option is only ever clicked inside an option list, never loose in the page', () => {
  // THE REGRESSION, measured live on 2026-08-08. The fallback swept the whole document for
  // 'li, [data-value]' containing the answer, so opening Discipline on the DRW and Virtu Greenhouse
  // forms with the answer "Computer Science" clicked a bullet point in the JOB DESCRIPTION
  // ("Are pursuing a bachelor's ... computer science or any engineering discipline"), reported the
  // field answered, and left the control on "Select...". Both boards then said
  // '"Discipline" is required and is still empty' with the right option unclicked in the open menu.
  assert.doesNotMatch(SANDBOX_RUNNER, /\[role="listbox"\] \*/, 'no page-wide descendant sweep');
  assert.doesNotMatch(SANDBOX_RUNNER, /\[class\*="select2-result"\], li, \[data-value\]/, 'no bare li or [data-value]');
  // A bare li still qualifies, but only inside a listbox or a select2 results panel.
  assert.match(SANDBOX_RUNNER, /\[role="listbox"\] li/);
  assert.match(SANDBOX_RUNNER, /const OPTION_NODES =/);
  assert.match(SANDBOX_RUNNER, /const optionsRoot = \(\) => \(scopedMenu \?\? \(exactContext \? container : page\)\)\.locator\(OPTION_NODES\)/);
  // And the correctly scoped attempt gets a bounded wait, because it used to be made as an instant
  // count() 150ms after the click - before the menu rendered - which is what made the page-wide
  // sweep reachable in the first place. Measured: menus arrived 555-563ms after the control was hit.
  assert.match(SANDBOX_RUNNER, /const waitForMenu = async \(control, timeout\) =>/);
  assert.match(SANDBOX_RUNNER, /await waitForMenu\(control, 1200\)/);
});

test('a choice control that already holds an answer is never emptied to look for a better one', () => {
  // Litos sends several candidate values for one control on purpose (a stored major sentence, then
  // the fields of study inside it). Measured live on the Five Rings Greenhouse form: Discipline was
  // correctly set to "Computer Science" by one candidate and emptied by the next, in two ways.
  // 1. An empty fill is a backspace on a React Select's always-empty search box, and
  //    backspaceRemovesValue then deletes the selection.
  assert.match(SANDBOX_RUNNER, /if \(\(await readChoiceState\(container\)\)\.kind !== 'chosen'\) \{\n\s+await control\.fill\(''\)/);
  // 2. React Select renders its "Clear selections" indicator as a <button> inside the same
  //    container, and the control list includes buttons.
  assert.match(SANDBOX_RUNNER, /const CLEAR_CONTROL_RE =/);
  assert.match(SANDBOX_RUNNER, /if \(CLEAR_CONTROL_RE\.test\(clears\)\) continue;/);
  // An answer that already matches is left exactly as it is, with no click at all.
  assert.match(SANDBOX_RUNNER, /if \(alreadyAnswered\.kind === 'chosen' && optionMatches\(alreadyAnswered\.value, wanted\)\) return true;/);
  // And if it was somehow lost anyway, it goes back.
  assert.match(SANDBOX_RUNNER, /activeControlAllowsIdenticalExactLocationRows = await isGreenhouseLocationCityGeocoder\(control\);\n\s+if \(await searchFor\(control, alreadyAnswered\.value\)\) break;/);
});

test('a choice we could not make is reported as the applicant\'s, not as filled', () => {
  // The plain fill after a failed choice typed the answer into the widget's SEARCH box, and
  // verifyFilled then read it straight back out of that same box and called the field filled while
  // the control still said "Select...". A wrong "filled" is worse than a blank: it is the reason a
  // required-and-empty blocker arrived alongside a filled_fields list that claimed the opposite.
  //
  // The refusal used to be gated on `state.kind !== 'unknown'`, which is exactly the shape
  // readChoiceState reports for every non-react-select combobox (Ashby's homegrown location
  // autocomplete among them - see ashby-unknown-combobox-refuses-plain-fill.test.js): the guard
  // never fired for those, and the same plain-fill false success this test was written against
  // reproduced on a control this one never covered. The gate is gone; 'unknown' refuses exactly
  // like every other outcome now.
  assert.match(SANDBOX_RUNNER, /const state = await readChoiceState\(container\);/);
  assert.doesNotMatch(SANDBOX_RUNNER, /if \(state\.kind !== 'unknown'\) \{/);
  assert.match(SANDBOX_RUNNER, /left for you to choose/);
});

test('a widget that renders its answer shorter than the row that set it is not a lost answer', () => {
  /* THE LARGEST ANSWER-LOSS CLASS IN THE CORPUS, and it was never a lost answer.
   *
   * 45 of this user's 133 stored packets carry "choice value did not persist after fill"; 43 of them
   * are one control. Greenhouse's phone Country React Select is chosen from the menu row "United
   * Arab Emirates +971" and then renders what it holds as a flag element plus "+971", so verifying
   * that against the requested "United Arab Emirates" found nothing in common. Reproduced on 23 of
   * the 24 live employer forms behind those reports on 2026-08-09, and executed end to end in
   * test/managed-runner-replay.mjs case 10 against the live markup.
   *
   * The widening is verified against the row that was CLICKED, so it needs that row recorded.
   */
  assert.match(SANDBOX_RUNNER, /let lastClickedOptionText = '';/);
  // Recorded in the one place a row is ever clicked, so no rule can reach the page without leaving
  // the row behind for the third rule to verify against. It stays a textContent read: the row hint
  // is compared against what the WIDGET renders, and an accessible name is not what it renders.
  assert.match(SANDBOX_RUNNER, /const clickIfPresent = async \(locator\) => \{/);
  assert.match(SANDBOX_RUNNER, /lastClickedOptionText = clean\(await first\.textContent\(\)\.catch\(\(\) => ''\)\);/);
  assert.equal((SANDBOX_RUNNER.match(/lastClickedOptionText = clean\(/g) || []).length, 1, 'one place records the row');
  // Cleared at the top of every fill, so a row left over from an earlier control can never stand in
  // for one this control never showed.
  assert.match(SANDBOX_RUNNER, /const fillCustomChoice = async \(container, wanted, directControl = null, exactContext = null\) => \{\n(?:.*\n)*?\s+lastClickedOptionText = '';/);
  // Both halves are required: the row had to carry the answer, and the control has to be showing
  // part of that same row.
  assert.match(SANDBOX_RUNNER, /if \(!row \|\| shown\.length < 2 \|\| !row\.includes\(shown\)\) return false;/);
  // Compared on the CLEANED text, not the normalised text. Normalising strips punctuation and "+1"
  // would then read as a substring of "united arab emirates 971".
  assert.match(SANDBOX_RUNNER, /const row = clean\(clickedOptionText \|\| ''\)\.toLowerCase\(\);/);
  assert.match(SANDBOX_RUNNER, /const shown = clean\(text\)\.toLowerCase\(\);/);
  // The row hint is passed by the ONE helper every call site goes through, rather than spelled out
  // at each of them. That is not tidiness: the call site that spelled it out wrongly was the one
  // that did not verify at all, and test/choice-parity-replay.mjs measures what it let through.
  assert.match(SANDBOX_RUNNER, /const choiceLanded = async \(container, expected, directControl = null\) => \{\n\s+\/\/ React-controlled choices[\s\S]*?for \(let elapsed = 0; elapsed <= 500; elapsed \+= 50\) \{\n\s+if \(await verifyChoiceInContainer\([\s\S]*?directControl,[\s\S]*?\)\)/);
  // 2026-08-21: a code review of the Ashby fix (PR #98) found that choiceLanded's blurDrivenChoiceControl
  // fallback searched the whole container for the first node matching a fixed selector, in DOM order,
  // rather than asking the page what was actually focused - silently no-op'ing the whole fix on any
  // container wider than the widget. The two call sites that already hand fillCustomChoice a
  // directControl (the multi-line one below, and the react-select replay path) now hand the identical
  // element to choiceLanded too, for consistency. The other three call sites deliberately do NOT gain
  // a directControl here: 'field', the first typeable node fillByLabelText's shape dispatch finds, is
  // not reliably the element fillCustomChoice's own CHOICE_CONTROLS discovery actually drives - measured
  // on the choice-parity Select2 fixture, where 'field' resolves to a decoy typeahead input but the
  // real opener is '.select2-choice'. Passing it would redirect fillCustomChoice onto the wrong
  // element, not just narrow choiceLanded's blur target, so those three sites rely entirely on
  // blurDrivenChoiceControl's own document.activeElement fallback instead.
  // driveTarget is computed once and reused by both the fillCustomChoice and choiceLanded calls at
  // this site (hoisted 2026-08-21 so a future edit to the condition cannot update one call and miss
  // the other, which is exactly the class of bug this whole review pass exists to catch).
  assert.match(SANDBOX_RUNNER, /const driveTarget = targetInChoiceShell \|\| targetInGreenhouseQuestionChoice \? target : null;/);
  const landedReadbacks = (SANDBOX_RUNNER.match(/await choiceLanded\(questionBlock, action\.value \|\| ''\)/g) || []).length
    + (SANDBOX_RUNNER.match(/const landed = await choiceLanded\(\n\s+container,\n\s+action\.value \|\| '',\n\s+driveTarget,/g) || []).length;
  assert.equal(landedReadbacks, 4,
    'every fillCustomChoice call site reads the control back through the same helper');
  assert.equal((SANDBOX_RUNNER.match(/await verifyChoiceInContainer\(/g) || []).length, 3,
    'fill call sites cannot skip withdrawal; the second read waits for a delayed rollback to settle;'
    + ' the third is withdrawRefusedChoice\'s own confirm-before-clearing gate (see'
    + ' choice-withdrawal-confirms-before-clearing.test.js). choiceLanded\'s own post-blur reread,'
    + ' added for the Ashby location field (see ashby-blur-reverts-choice-dom.test.js), used to be a'
    + ' fourth direct call here; 2026-08-21 it was rebuilt on settleVerified so a slow-settling blur'
    + ' gets the same retry budget the pre-blur read already has (see the settleVerified assertion'
    + ' below), so its verifyChoiceInContainer call is no longer a bare await at this call site.');
  assert.match(SANDBOX_RUNNER, /await blurDrivenChoiceControl\(container, directControl\);\n\s+if \(await settleVerified\(\(\) => verifyChoiceInContainer\(/,
    'the post-blur reread reuses settleVerified rather than a single fixed wait');
});

test('a choice option that is not on the list names the answer that went looking', () => {
  // Measured 2026-08-09 on the live DV Trading form, one of the two packets that report this: the
  // "Graduation Date" React Select offers ranges - "January 2028 - July 2028", "August 2028 -
  // December 2028" - and the stored answer is the month "May 2028". The verdict is right and
  // unchanged; the bare "choice option not found" simply never told the applicant what to fix.
  // The emission, not the words: the sentence survives in the comment that explains why it went.
  assert.doesNotMatch(SANDBOX_RUNNER, /': choice option not found'/);
  assert.match(SANDBOX_RUNNER, /const unmatched = await readChoiceState\(questionBlock\);/);
  // The sentence now lives in one helper, so a chooser that DECLINED an ambiguous list can replace
  // it with what actually happened rather than claiming her answer was absent.
  assert.match(SANDBOX_RUNNER, /const unmatchedReason = \(value\) => lastChoiceRefusal/);
  // And it now carries what the option read actually saw, so the CBS Recruitee shape (a bare
  // refusal recorded with no trace of the list it judged) diagnoses itself on the next failure.
  assert.match(SANDBOX_RUNNER,
    /no option matched "' \+ clean\(value\) \+ '"' \+ choiceOffersClause\(\) \+ ', left for you to choose/);
});

test('fillByLabelText handles Greenhouse Select2 controls before hidden native selects', () => {
  assert.match(SANDBOX_RUNNER, /\.select2-choice, \.select2-container/);
  assert.match(SANDBOX_RUNNER, /\.select2-result, \.select2-results li/);
  assert.match(SANDBOX_RUNNER, /const customSelected = await fillCustomChoice\(\n\s+questionBlock,\n\s+action\.value \|\| '',\n\s+null,\n\s+exactActionContext\n\s+\);/);
  assert.match(SANDBOX_RUNNER, /const selectNativeOption = async \(field, wanted\) =>/);
  assert.match(SANDBOX_RUNNER, /const selected = customSelected \|\| await selectNativeOption\(field, action\.value \|\| ''\)/);
});

test('plain fill actions dispatch native selects through selectOption', () => {
  const helperStart = SANDBOX_RUNNER.indexOf('const selectNativeOption = async');
  const helperEnd = SANDBOX_RUNNER.indexOf('/* THE SELECTOR NAMED A QUESTION', helperStart);
  const helper = SANDBOX_RUNNER.slice(helperStart, helperEnd);
  assert.match(SANDBOX_RUNNER, /fillShape\.tag === 'select'/);
  assert.match(SANDBOX_RUNNER, /selectNativeOption\(target, action\.value \|\| ''\)/);
  assert.match(SANDBOX_RUNNER, /\[selected\.textContent \|\| '', selected\.value \|\| '', selected\.label \|\| ''\]/);
  assert.match(helper, /const choices = await field\.evaluate/);
  assert.match(helper, /const byLabel = chooseOptionIndex\(choices\.map\(\(choice\) => choice\.label\), wanted\)/);
  assert.equal((helper.match(/field\.evaluate/g) || []).length, 1, 'native options are inspected once');
  assert.equal((helper.match(/field\.selectOption/g) || []).length, 1, 'one proven option is selected once');
});

test('React Select comboboxes are filled as choices, not plain text', () => {
  assert.match(SANDBOX_RUNNER, /fillShape\.role === 'combobox'/);
  assert.match(SANDBOX_RUNNER, /shape\.role === 'combobox'/);
  assert.match(SANDBOX_RUNNER, /ariaAutocomplete === 'list'/);
  assert.match(SANDBOX_RUNNER, /const clickMatchingOption = async \(target, allowIdenticalExactLocationRows = false\) =>/);
  assert.match(SANDBOX_RUNNER, /await control\.fill\(option\)/);
  assert.match(SANDBOX_RUNNER, /await page\.keyboard\.type\(option, \{ delay: 5 \}\)/);
  assert.match(SANDBOX_RUNNER, /waitForTimeout\(1200\)/);
  assert.match(SANDBOX_RUNNER, /choice value did not persist after fill/);
  assert.match(SANDBOX_RUNNER, /choice value did not persist after fillByLabelText/);
  assert.match(SANDBOX_RUNNER, /const greenhouseQuestionId = String\(action\.selector \|\| ''\)\.match\(\/\^#\(question_\\d\+\)\$\/\)/);
  assert.match(SANDBOX_RUNNER, /selectorShowsChoicePlaceholder/);
  assert.match(SANDBOX_RUNNER, /label\[for="' \+ greenhouseQuestionId \+ '"\]/);
  assert.match(SANDBOX_RUNNER, /targetInChoiceShell \|\| targetInGreenhouseQuestionChoice \? target : null/);
});

test('only duplicate literal Location City geocoder rows may collapse to one click', async () => {
  const detectorStart = SANDBOX_RUNNER.indexOf('      const isGreenhouseLocationCityGeocoder = async');
  const chooserStart = SANDBOX_RUNNER.indexOf('      const clickMatchingOption = async', detectorStart);
  const chooserEnd = SANDBOX_RUNNER.indexOf('      /* REAL ROWS, NOT THE WIDGET', chooserStart);
  assert.notEqual(detectorStart, -1);
  assert.notEqual(chooserStart, -1);
  assert.notEqual(chooserEnd, -1);

  const detectorSource = SANDBOX_RUNNER.slice(detectorStart, chooserStart);
  const detector = Function(`${detectorSource}\nreturn isGreenhouseLocationCityGeocoder;`)();
  const control = ({
    id = 'candidate-location',
    role = 'combobox',
    autocomplete = 'list',
    label = 'Location (City)*',
  } = {}) => ({
    evaluate: async (callback) => callback({
      id,
      labels: [{ textContent: label }],
      ownerDocument: { getElementById: () => null },
      getAttribute(name) {
        return {
          role,
          'aria-autocomplete': autocomplete,
          'aria-labelledby': '',
        }[name] ?? null;
      },
      closest: () => null,
    }),
  });

  assert.equal(await detector(control()), true);
  assert.equal(await detector(control({ id: 'school' })), false, 'the provider id is mandatory');
  assert.equal(await detector(control({ role: 'textbox' })), false, 'the combobox role is mandatory');
  assert.equal(await detector(control({ autocomplete: 'both' })), false, 'a list geocoder is mandatory');
  assert.equal(await detector(control({ label: 'Preferred location*' })), false, 'the exact question label is mandatory');

  const chooserSource = SANDBOX_RUNNER.slice(chooserStart, chooserEnd);
  const choose = Function('names', 'allowIdenticalExactLocationRows', 'target', `
    let clicked = null;
    let lastClickedOptionAnswer = '';
    let lastChoiceRefusal = '';
    let choiceRefusals = 0;
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const normalized = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const escapeName = (value) => String(value).replace(/[.*+?^{}()|[\\]\\\\$]/g, '\\\\$&');
    const wholeName = (option) => new RegExp('^\\\\s*' + escapeName(option) + '\\\\s*$', 'i');
    const looseWholeName = (option) => {
      const words = normalized(option).split(' ').filter(Boolean);
      return words.length
        ? new RegExp('^[^a-z0-9]*' + words.map(escapeName).join('[^a-z0-9]+') + '[^a-z0-9]*$', 'i')
        : null;
    };
    const paddedWholeName = (option) => new RegExp('^' + escapeName(clean(option)) + '$', 'i');
    const answerOptions = (value) => [value];
    const nearMissChoiceReason = (value, count) => String(count) + ' matches for ' + value;
    const refuseChoice = (reason) => {
      lastChoiceRefusal = reason;
      choiceRefusals += 1;
      return false;
    };
    const rowLocator = (matches) => ({
      matches,
      nth: (position) => ({
        click: async () => { clicked = matches[position].index; },
        textContent: async () => matches[position].name,
      }),
      filter: () => rowLocator(matches),
    });
    const root = {
      getByRole: (_role, query) => rowLocator(names
        .map((name, index) => ({ name, index }))
        .filter((row) => query.name instanceof RegExp
          ? query.name.test(row.name)
          : (query.exact ? row.name === query.name : row.name.includes(query.name)))),
      locator: () => rowLocator(names.map((name, index) => ({ name, index }))),
    };
    const widenRoot = () => root;
    const menuRoot = () => root;
    const offeredRows = async (rows) => rows.matches.map((_, index) => index);
    const clickIfPresent = async (row) => { await row.click(); return true; };
    const OPTION_NODES = '[role="option"]';
    ${chooserSource}
    return clickMatchingOption(target, allowIdenticalExactLocationRows).then((hit) => ({
      hit,
      clicked,
      refusal: lastChoiceRefusal,
      answer: lastClickedOptionAnswer,
    }));
  `);

  const place = 'Los Angeles, California, United States';
  assert.deepEqual(await choose([place, place], true, place), {
    hit: true,
    clicked: 0,
    refusal: '',
    answer: place,
  });
  const generic = await choose([place, place], false, place);
  assert.equal(generic.hit, false);
  assert.equal(generic.clicked, null);
  assert.match(generic.refusal, /2 matches/);

  const caseDifferent = await choose([place, place.toUpperCase()], true, place);
  assert.equal(caseDifferent.hit, false, 'literal accessible names must themselves be identical');
  assert.equal(caseDifferent.clicked, null);
  assert.match(caseDifferent.refusal, /2 matches/);

  const punctuationOnly = await choose([
    'Los Angeles California United States',
    'Los Angeles  California  United States',
  ], true, place);
  assert.equal(punctuationOnly.hit, false, 'the punctuation-tolerant tier must keep its ambiguity refusal');
  assert.equal(punctuationOnly.clicked, null);
  assert.match(punctuationOnly.refusal, /2 matches/);

  assert.match(SANDBOX_RUNNER, /if \(choiceFilled\) \{\n\s+const landed = await choiceLanded\([\s\S]*?if \(action\.label && landed\) filledFields\.push/,
    'a duplicate-row click is not reported filled until the committed value is read back');
});

test('Location City waits briefly for a geocoder result that arrives after the ordinary settle', async () => {
  const helperStart = SANDBOX_RUNNER.indexOf('      const waitForGreenhouseLocationResults = async');
  const helperEnd = SANDBOX_RUNNER.indexOf('      /* HOW MANY ROWS THE MENU IS OFFERING', helperStart);
  assert.notEqual(helperStart, -1);
  assert.notEqual(helperEnd, -1);
  const helperSource = SANDBOX_RUNNER.slice(helperStart, helperEnd);

  const simulate = async ({ rowAt = Infinity, noOptionsAt = Infinity } = {}) => {
    let poll = -1;
    let declaredReads = 0;
    let portalReads = 0;
    let waits = 0;
    let now = 0;
    const readDeclaredMenu = async () => { declaredReads += 1; poll += 1; };
    const readMenuPortal = async () => { portalReads += 1; };
    const realOfferedRows = async () => ({ indices: poll >= rowAt ? [0] : [] });
    const notice = {
      isVisible: async () => true,
      textContent: async () => 'No options',
    };
    const notices = {
      count: async () => (poll >= noOptionsAt ? 1 : 0),
      nth: () => notice,
    };
    const root = {
      locator: (selector) => {
        assert.equal(selector, '[class*="select__menu-notice--no-options"]');
        return notices;
      },
    };
    const menuRoot = () => root;
    const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
    const page = {
      waitForTimeout: async (milliseconds) => {
        assert.ok(milliseconds > 0 && milliseconds <= 50);
        now += milliseconds;
        waits += 1;
      },
    };
    const FakeDate = { now: () => now };
    const wait = Function(
      'readDeclaredMenu',
      'readMenuPortal',
      'menuRoot',
      'realOfferedRows',
      'clean',
      'page',
      'Date',
      `${helperSource}\nreturn waitForGreenhouseLocationResults;`,
    )(readDeclaredMenu, readMenuPortal, menuRoot, realOfferedRows, clean, page, FakeDate);
    const outcome = await wait({});
    return { outcome, declaredReads, portalReads, waits };
  };

  assert.deepEqual(await simulate({ noOptionsAt: 0, rowAt: 2 }), {
    outcome: 'rows',
    declaredReads: 3,
    portalReads: 3,
    waits: 2,
  }, 'a row arriving 100ms into the grace supersedes a stale visible no-options notice');
  assert.deepEqual(await simulate({ noOptionsAt: 1 }), {
    outcome: 'empty',
    declaredReads: 11,
    portalReads: 11,
    waits: 10,
  }, 'an exact no-options response is remembered but does not shorten the 500ms grace');
  assert.deepEqual(await simulate(), {
    outcome: 'timeout',
    declaredReads: 11,
    portalReads: 11,
    waits: 10,
  }, 'the extra grace is bounded to 500ms');

  assert.match(SANDBOX_RUNNER,
    /await page\.waitForTimeout\(1200\)\.catch\(\(\) => undefined\);[\s\S]{0,500}?if \(activeControlAllowsIdenticalExactLocationRows\) \{\n\s+await waitForGreenhouseLocationResults\(control\);/,
    'the location-only poll starts after, and does not replace, the ordinary settle');
  assert.match(SANDBOX_RUNNER,
    /if \(activeControlAllowsIdenticalExactLocationRows\) \{\n\s+await waitForGreenhouseLocationResults\(control\);\n\s+\} else \{\n\s+await readDeclaredMenu\(control\);\n\s+await readMenuPortal\(\);/,
    'all other controls retain the single existing menu read with no extra wait');
  assert.match(SANDBOX_RUNNER,
    /if \(await chooseFromOfferedRows\(wanted\)\) return true;\n\s+if \(await searchFor\(control, wanted\)\) return true;/,
    'detecting the location control cannot split the unfiltered list tier from the typed search');
});

test('decline style EEO answers can match common portal option text', () => {
  assert.match(SANDBOX_RUNNER, /const answerOptions = \(value\) =>/);
  assert.match(SANDBOX_RUNNER, /i do not wish to answer/);
  assert.match(SANDBOX_RUNNER, /prefer not to answer/);
  // And a row that says something about her is never one of them, however much it looks like a
  // negation. "I do not identify with any of the above" is a claim an employer records.
  const { optionMatches } = choiceHelpers();
  assert.equal(optionMatches('I do not identify with any of the above', 'Decline to self-identify'), false);
  assert.equal(optionMatches('I do not wish to identify', 'Decline to self-identify'), true);
});

test('an opt-out is matched by what it means, not by how the employer spelled it', () => {
  // The two option vocabularies Litos has ever recorded, read out of stored Greenhouse label blobs
  // on 2026-08-09. Both word their opt-out their own way, and the stored answer is the plain
  // "Decline to self-identify" for both.
  const { optionMatches } = choiceHelpers();
  const stored = 'Decline to self-identify';
  assert.equal(optionMatches('I decline to self-identify for protected veteran status', stored), true);
  // "want", not "wish". No spelling on the enumerated synonym list could reach it.
  assert.equal(optionMatches('I do not want to answer', stored), true);
  assert.equal(optionMatches('I would rather not disclose this', stored), true);
  assert.equal(optionMatches("I don't wish to answer", stored), true);
  // And the answers on those same two lists that are CLAIMS about her are never read as refusals.
  assert.equal(optionMatches('I am not a protected veteran', stored), false);
  assert.equal(optionMatches('No, I do not have a disability and have not had one in the past', stored), false);
  assert.equal(optionMatches('Yes, I have a disability, or have had one in the past', stored), false);
  assert.equal(
    optionMatches('I identify as one or more of the classifications of protected veteran listed above', stored),
    false,
  );
  // Intent matching is decline-to-decline only: a refusal on the list does not answer a question
  // she gave a real answer to.
  assert.equal(optionMatches('I do not want to answer', 'Female'), false);
  assert.equal(optionMatches('I do not want to answer', 'Yes'), false);
});

test('a text fill that does not stick is retried as the choice it turned out to be', () => {
  // Measured on production packet 13bccb2d (Skydio, Ashby): "gender" and "veteran status" were both
  // resolved from the stored profile, both fell through to the plain text branch because the shape
  // read gave no role and no aria-haspopup to dispatch on, and both reported "value did not persist
  // after fillByLabelText". A real text input keeps what you type; one that does not is a widget.
  // settleVerified wraps this read now (see settle-window-covers-radio-select-checkbox.test.js): a
  // controlled widget reached down this path can commit its value on a later render than the one
  // the fill dispatched into, the same race choiceLanded already gives a react-select up to 500ms
  // to settle. The predicate verifyFilled runs is unchanged; only the number of times it is asked.
  assert.match(SANDBOX_RUNNER, /let persisted = await settleVerified\(\(\) => verifyFilled\(field, action\.value \|\| ''\)\);/);
  assert.match(SANDBOX_RUNNER, /if \(!persisted\) \{\n\s+if \(await pickOptionPill\(questionBlock, action\.value \|\| ''\)\) persisted = true;/);
  // The row hint travels on this path too: a widget reached this way abbreviates its chosen value
  // exactly as readily as one reached through the two branches above. Neither call is handed
  // 'field' as a directControl (2026-08-21) - see the landedReadbacks comment above for why that
  // would redirect fillCustomChoice's own discovery rather than merely narrow choiceLanded's blur.
  assert.match(SANDBOX_RUNNER, /else if \(await fillCustomChoice\(questionBlock, action\.value \|\| '', null, exactActionContext\)\) \{\n(?:.*\n)*?\s+persisted = await choiceLanded\(questionBlock, action\.value \|\| ''\);/);
  // Still only ever reported as filled once the page can be read back, and still reported as the
  // applicant's work when it cannot.
  assert.match(SANDBOX_RUNNER, /if \(action\.label && persisted\) filledFields\.push\(action\.label\);/);
  assert.match(SANDBOX_RUNNER, /value did not persist after fillByLabelText/);
});

test('choice matching is scoped to the question container, never the page', () => {
  // Unscoped, an answer as short as "Yes" could tick a consent or legal acknowledgement elsewhere
  // on the form, which the applicant cannot undo. The scope is now the question's OWN option block
  // rather than whatever container the anchor happened to land in; see D-02 and the test below.
  assert.match(SANDBOX_RUNNER, /const questionBlock = exactActionContext\n\s+\? exactBinding\.scope\n\s+: await questionOptionBlock\(label, container\);/);
  assert.match(SANDBOX_RUNNER, /const scope = questionBlock;/);
  // 'directChoices' is the one sanctioned widening: the fill branch's durable-name arm hands in
  // the exact inputs its SELECTOR named, so the scope is still the group and never the page.
  assert.match(SANDBOX_RUNNER, /const choices = directChoices \|\| scope\.locator\('input\[type=checkbox\], input\[type=radio\]'\)/);
  // And an answer that matches no option leaves the control alone rather than guessing - and says
  // so, which it used to do silently.
  assert.match(SANDBOX_RUNNER, /skipped\.push\(action\.label \+ ': ' \+ unmatchedReason\(wanted\)\)/);
  assert.match(SANDBOX_RUNNER, /total === 1 && \/\^yes\$\/i\.test\(wanted\)/);
  assert.match(SANDBOX_RUNNER, /actual\.includes\('checked'\) && \/\^yes\$\/i\.test\(clean\(expected\)\)/);
});

test('a radio is reported from the radio that was clicked, not from the first one in the block', () => {
  /* D-02, the reporting half. Measured against the live Skydio Ashby form on 2026-08-09 with the
   * runner at 41d3095: all four EEO questions came back "value did not persist after
   * fillByLabelText" and filled_fields was empty, while the gender control was visibly holding an
   * answer. The branch ticked option n and then fell through to verifyFilled(field), where field is
   * the FIRST input in the block, so every answer that was not option 0 read back unchecked.
   *
   * The option now reports on itself and the arm ends there. Nothing about a choice reaches the
   * text verification at the bottom of fillByLabelText. */
  assert.match(SANDBOX_RUNNER, /const isChecked = async \(\) => await match\.evaluate\(\(element\) => element\.checked === true\)/);
  // settleVerified now stands between the click and this verdict, for the same reason as the text-
  // fill path above: a controlled radio's checked state can commit on a render after the click, and
  // this used to read isChecked() back exactly once. See settle-window-covers-radio-select-checkbox.test.js.
  assert.match(SANDBOX_RUNNER, /return await settleVerified\(isChecked\) \? 'checked' : 'not-checked';/);
  assert.match(SANDBOX_RUNNER, /if \(outcome === 'checked'\) \{\n\s+successfulMutation = true;\n\s+if \(action\.label\) filledFields\.push\(action\.label\);\n\s+continue;/);
  // A click that did not take is the applicant's to finish, and is named as such.
  assert.match(SANDBOX_RUNNER, /the option was clicked and did not stay selected/);
});

test('a question is anchored on the element that names it, not on prose that mentions it', () => {
  /* D-02, the placement half, and the more damaging of the two. On the live Skydio Ashby form the
   * first element containing "gender" is the equal-opportunity preamble - "...without regard to
   * race, color, religion, sex, gender identity..." - three questions above any control. Its
   * nearest ancestor holding an input is the whole self-identification section, eleven radios
   * across two questions, so the Race answer "Decline to self-identify" matched GENDER's
   * "Decline to self-identify" first in DOM order and set it. Measured end to end: the gender
   * control finished holding a decline on a run whose packet said Female, and Race was left blank.
   *
   * A whole-string match is tried first, so an element whose entire text IS the question wins over
   * prose that merely contains it. Containment stays as the fallback. */
  assert.match(SANDBOX_RUNNER, /const wholeLabel = wantedLabel/);
  assert.match(SANDBOX_RUNNER, /const exactLabel = !exactActionContext && wholeLabel \? page\.getByText\(wholeLabel\)\.first\(\) : null;/);
  assert.match(SANDBOX_RUNNER, /page\.getByText\(wantedLabel \|\| action\.text, \{ exact: false \}\)\.first\(\)/);
  // And the option block is walked up from that anchor, through the four ways a board says "these
  // options belong together".
  assert.match(SANDBOX_RUNNER, /const questionOptionBlock = async \(anchor, fallback\) =>/);
  assert.match(SANDBOX_RUNNER, /self::fieldset or @data-field-path or @role="radiogroup" or @role="group"/);
  // Two named radio groups in one block are two questions, and answering either is a guess.
  assert.match(SANDBOX_RUNNER, /const radioGroupNames = async \(scope\) =>/);
  assert.match(SANDBOX_RUNNER, /if \(groups\.length > 1\) \{/);
  assert.match(SANDBOX_RUNNER, /could have landed on another question, left for you to choose/);
});

test('the label anchor is a whole-string match, so prose containing the question word loses', () => {
  // The regex the anchor is built from, exercised directly. "gender" is the stored question text
  // from packet 13bccb2d; "Gender" is Ashby's capitalisation, and the preamble sentence is the
  // element that used to win.
  const wholeLabel = (text) =>
    new RegExp('^\\s*' + text.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&') + '\\s*[*:]?\\s*$', 'i');
  const gender = wholeLabel('gender');
  assert.equal(gender.test('Gender'), true, 'the question label, in the board\'s own capitalisation');
  assert.equal(gender.test('Gender *'), true, 'a required label carries an asterisk');
  assert.equal(gender.test('Gender:'), true);
  assert.equal(
    gender.test('Skydio provides equal employment opportunities to applicants and employees without'
      + ' regard to race, color, religion, sex, gender identity, sexual orientation'),
    false,
    'the preamble that used to be the anchor',
  );
  assert.equal(gender.test('Input gender'), false, 'the control description under the label');
  assert.equal(gender.test('What gender identity do you most closely identify with?'), false);
  // A question with regex metacharacters in it is matched literally, not compiled.
  const parens = wholeLabel('Do you live with a disability (as outlined by the ADA)?');
  assert.equal(parens.test('Do you live with a disability (as outlined by the ADA)?'), true);
  assert.equal(parens.test('Do you live with a disability as outlined by the ADA?'), false);
});

test('fillByLabelText climbs to a container that actually owns controls', () => {
  assert.match(
    SANDBOX_RUNNER,
    /ancestor::\*\[\(self::div or self::fieldset\) and \(\.\/\/textarea or \.\/\/input\[not\(@type="file"\) and not\(@type="hidden"\)\] or \.\/\/select or \.\/\/\*\[@role="combobox"\] or \.\/\/\*\[@aria-haspopup="listbox"\]\)\]\[1\]/,
  );
  assert.match(
    SANDBOX_RUNNER,
    /const questionBlock = exactActionContext\n\s+\? exactBinding\.scope\n\s+: await questionOptionBlock\(label, container\);\n\s+const field = exactActionContext\n\s+\? exactBinding\.field\n\s+: questionBlock\.locator\('textarea, input:not\(\[type=file\]\):not\(\[type=hidden\]\), select'\)\.first\(\);/,
    'the field dispatch must use the question-scoped block, not the first control in a shared parent',
  );
});

test('a date control is recognised from the control, not from the answer', () => {
  // Ashby date pickers expose a visible "Pick date..." text control while the required date state
  // stays empty, and the answer they are handed is routinely NOT already date-shaped: production
  // packet 59fb48ae was handed the string "2028". The old gate was
  // (answer matches YYYY-MM-DD) AND (placeholder mentions a date), which can only recognise a date
  // control on a run that had been given a date to begin with, so it is gone.
  assert.doesNotMatch(SANDBOX_RUNNER, /dateLikeAnswer/);
  assert.doesNotMatch(SANDBOX_RUNNER, /dateLikeField/);
  assert.match(SANDBOX_RUNNER, /const dateControlPrecisionOf = async \(field\)/);
  assert.match(SANDBOX_RUNNER, /react-datepicker-wrapper/);
  // The commit is a real Tab keypress: react-datepicker parses on nothing else. See
  // test/date-control-dom.test.js, which runs this against a real DOM rather than reading it.
  assert.match(SANDBOX_RUNNER, /field\.press\('Tab'\)/);
  // Both fill branches route through the one helper, so neither can describe a date failure in
  // words the other does not use.
  assert.equal(SANDBOX_RUNNER.split('await fillDateControl(').length - 1, 2);
  assert.equal(SANDBOX_RUNNER.split('recordDateFill(result,').length - 1, 2);
});

test('a fill selector that names a question fills the one control inside it', () => {
  // Production packet 59fb48ae: 'Expected Graduation Year' is the only question on that Ashby form
  // whose input carries no id and no name, so its selector is the field-entry DIV and
  // locator.fill() threw against it. Exactly one candidate, or none: a wrapper holding two controls
  // speaks for two questions.
  assert.match(SANDBOX_RUNNER, /const fillTargetWithin = async \(locator\)/);
  assert.match(SANDBOX_RUNNER, /if \(\(await inside\.count\(\)\.catch\(\(\) => 0\)\) === 1\) return inside\.first\(\);/);
  // A combobox that is not an input is still THE control: a bare opener (itself, or the one
  // opener inside the named block) is a valid fill target and routes to the combobox dispatch.
  assert.match(SANDBOX_RUNNER, /const bareItself = await locator\.evaluate\(isBareOpener\)/);
  assert.doesNotMatch(SANDBOX_RUNNER, /await locator\.fill\(fillValue/);
});

test('an unticked required checkbox is reported as a blocker', () => {
  // A checkbox reports value "on" whether or not it is ticked, so a value check treats every
  // unticked required checkbox as already satisfied and never reports it.
  //
  // The claim is unchanged; where it is enforced moved. D-01 replaced the end-of-run scan that used
  // to answer this with readSubmitReadiness, the same reading the pre-submit gate makes, so the run
  // reports exactly what would withhold the click. hasAnswer is that reading, and it is unit-tested
  // directly further down this file.
  const { hasAnswer } = gateScope();
  assert.equal(hasAnswer(control({ type: 'checkbox', checked: false })), false);
  assert.equal(hasAnswer(control({ type: 'checkbox', checked: true })), true);
  // Only an enabled peer of the same native choice type and form may answer the group.
  assert.match(SANDBOX_RUNNER, /const enabledNativeChoiceAnswered =/);
  assert.match(SANDBOX_RUNNER, /peer\.type === element\.type/);
  assert.match(SANDBOX_RUNNER, /!peer\.matches\?\.\(':disabled'\)/);
});

test('blockers name a human label and never a machine identifier', () => {
  // The old fallback chain was aria-label -> name attribute -> the literal 'required field', which
  // produced the two strings applicants actually saw:
  //   "5a326a1d-1a9e-42b1-a918-ca74022064dc is required"   (Greenhouse names questions with UUIDs)
  //   "required field is required"                          (literal fallback, doubled)
  assert.match(SANDBOX_RUNNER, /label\[for="/);
  assert.match(SANDBOX_RUNNER, /aria-labelledby/);
  assert.match(SANDBOX_RUNNER, /\[0-9a-f\]\{8\}-/); // UUID rejection
  assert.match(SANDBOX_RUNNER, /is required and is still empty/);
  assert.match(SANDBOX_RUNNER, /no label Litos can read/);
  assert.doesNotMatch(SANDBOX_RUNNER, /\|\| 'required field';/);
});

test('a choice group is reported once, by its question, not once per option', () => {
  // Aquatic's Greenhouse form turned three unanswered questions into seventeen blockers, each
  // naming an option ("Statistics", "Putnam", "Handshake") rather than the question to answer.
  //
  // Same guarantee, reached differently since D-01 unified the two readings of the form. The scan
  // keys on the CONTROL rather than the group - Greenhouse's phone fieldset holds two required
  // controls and both must be reportable - and the blocking list is then deduped by MESSAGE, so
  // several inputs resolving to one question collapse to one entry. Measured on the empty live
  // Redwood form: 15 entries covering 8 distinct fields.
  assert.match(SANDBOX_RUNNER, /blocking: \[\.\.\.new Set\(required\.map\(\(entry\) => entry\.message\)\)\]/);
  assert.match(SANDBOX_RUNNER, /const seen = new Set\(\);/);
  // And the label for a choice control prefers the group's question over the option text: labelOf
  // reads the widget's own legend or label, never the option the input sits beside.
  assert.match(SANDBOX_RUNNER, /const legend = widget && widget\.querySelector\('legend'\)/);
  assert.match(SANDBOX_RUNNER, /const own = widget && widget\.querySelector\('label, \.label, \.upload-label, legend'\)/);
});

test('required file-upload groups are reported even when the hidden input is not required', () => {
  // Greenhouse marks transcript uploads as aria-required on the file-upload GROUP while leaving the
  // hidden input itself without a required attribute, so an input[required] scan misses it.
  //
  // D-01 folded the separate file-group pass into the one required scan: [aria-required="true"]
  // matches the group, and hasAnswer widens to the container because a container has no value of
  // its own to read. That also has to keep working when the upload finished and Greenhouse REMOVED
  // the input, leaving only a filename chip.
  assert.match(SANDBOX_RUNNER, /input\[required\], textarea\[required\], select\[required\], \[aria-required="true"\]/);
  const { hasAnswer } = gateScope();
  assert.equal(hasAnswer(block({ controls: [control({ type: 'file', files: [] })] })), false);
  assert.equal(hasAnswer(block({ controls: [control({ type: 'file', files: [{}] })] })), true);
  assert.equal(hasAnswer(block({ chip: true, controls: [] })), true);
  assert.match(SANDBOX_RUNNER, /A required field on the form has no label Litos can read/);
});

// R-055 on the managed path: /api/run is otherwise stateless (navigate, act, return), so this
// runner is the only place that ever has a live Page mid-run. The 'discover' action lets a caller
// (student-outreach-backend) scan the page for custom questions in the SAME sandboxed session it
// already pays for, resolve them server-side (Node, not this sandbox), and fill them in a second
// call - mirroring the direct-Playwright path's discoverPageQuestions(), not new logic.

test('discover is an allowed action and needs no selector', () => {
  assert.deepEqual(normalizeManagedActions([{ type: 'discover' }]), [{ type: 'discover' }]);
  assert.deepEqual(normalizeManagedActions([{ type: 'discover', optional: true }]), [{ type: 'discover', optional: true }]);
});

test('atomic required confirmation accepts exact chooser policies v3 and v4 without cross-normalizing them', () => {
  const actions = normalizeManagedActions([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' }
  ]);
  assert.deepEqual(actions[0], { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' });
  assert.throws(
    () => normalizeManagedActions([{ type: 'confirmAndSubmit', selector: 'button', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 1, submitKind: 'application' }]),
    (error) => error.code === 'INVALID_CONFIRM_AND_SUBMIT_VERSION'
  );
  assert.throws(
    () => normalizeManagedActions([{ type: 'confirmAndSubmit', selector: 'button', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' }]),
    (error) => error.code === 'INVALID_CONFIRM_AND_SUBMIT_SELECTOR'
  );
  assert.throws(
    () => normalizeManagedActions([{ ...actions[0], submitKind: 'application', securityCode: 'ABCD1234' }]),
    (error) => error.code === 'INVALID_SUBMIT_KIND'
  );
  assert.equal(ATOMIC_SUBMIT_POLICY.name, 'litos-final-submit');
  assert.equal(ATOMIC_SUBMIT_POLICY.version, 3);
  assert.deepEqual(ATOMIC_SUBMIT_POLICY, ATOMIC_SUBMIT_POLICY_V3);
  assert.equal(ATOMIC_SUBMIT_POLICY.grammarHash, '9bd60803e7a713555132b6740e9765599ba975e75f803f436841dbc6d340091e');
  assert.equal(
    crypto.createHash('sha256').update(`${ATOMIC_SUBMIT_POLICY.finalPattern}\n${ATOMIC_SUBMIT_POLICY.exclusionPattern}`).digest('hex'),
    ATOMIC_SUBMIT_POLICY.grammarHash
  );
  assert.equal(ATOMIC_SUBMIT_POLICY_V4.name, 'litos-final-submit');
  assert.equal(ATOMIC_SUBMIT_POLICY_V4.version, 4);
  assert.equal(
    ATOMIC_SUBMIT_POLICY_V4.finalPattern,
    '(?:\\b(?:submit|send)\\s+(?:your\\s+|my\\s+|the\\s+|this\\s+)?application\\b|\\bsubmit\\s+with\\s+(?:attachments?|resumes?|cvs?|cover\\s+letters?)\\b|^\\s*submit\\s*$|^\\s*send\\s*$|^\\s*apply\\s*$|^\\s*apply\\s+now\\s*$|^\\s*senden\\s*$|\\bfinish\\s+(?:and|&)\\s+apply\\b)'
  );
  assert.equal(ATOMIC_SUBMIT_POLICY_V4.exclusionPattern, ATOMIC_SUBMIT_POLICY_V3.exclusionPattern);
  assert.equal(ATOMIC_SUBMIT_POLICY_V4.grammarHash, 'ee6697971965f0ab360f77da88d935a58b0b7af8ea412ad5d5b3813e9cc11263');
  assert.equal(
    crypto.createHash('sha256').update(`${ATOMIC_SUBMIT_POLICY_V4.finalPattern}\n${ATOMIC_SUBMIT_POLICY_V4.exclusionPattern}`).digest('hex'),
    ATOMIC_SUBMIT_POLICY_V4.grammarHash
  );
  const v4ExpectedPageUrl = 'https://jobs.example.com/postings/v4';
  const v4Actions = normalizeManagedActions([
    { type: 'requireCapability', value: ATOMIC_SUBMIT_V4_CAPABILITY, optional: false },
    {
      ...actions[0],
      chooserPolicy: ATOMIC_SUBMIT_POLICY_V4,
      expectedPageUrl: v4ExpectedPageUrl
    }
  ]);
  assert.deepEqual(v4Actions[0], {
    type: 'requireCapability',
    optional: false,
    value: ATOMIC_SUBMIT_V4_CAPABILITY,
  });
  const v4Action = v4Actions[1];
  assert.deepEqual(v4Action.chooserPolicy, ATOMIC_SUBMIT_POLICY_V4);
  assert.equal(v4Action.chooserPolicy.version, 4);
  assert.equal(v4Action.expectedPageUrl, v4ExpectedPageUrl);
  assert.throws(
    () => normalizeManagedActions([{ ...actions[0], chooserPolicy: ATOMIC_SUBMIT_POLICY_V4 }]),
    (error) => error.code === 'INVALID_EXPECTED_PAGE_URL'
  );
  const applicationFinal = new RegExp(ATOMIC_SUBMIT_POLICY.finalPattern, 'i');
  const excluded = new RegExp(ATOMIC_SUBMIT_POLICY.exclusionPattern, 'i');
  const chooserCases = [
    ['Submit', true],
    ['Apply', true],
    ['Apply now', true],
    ['Submit application', true],
    ['Submit your application', true],
    ['Submit my application', true],
    ['Submit the application', true],
    ['Send this application', true],
    ['Send your application', true],
    ['Submit application with attachments', true],
    ['Submit your application with cover letter', true],
    ['Send application from your profile', true],
    ['Send application from your saved details', true],
    ['Submit application for review', true],
    ['Finish & apply', true],
    ['Submit your application - Contact Center Agent', true],
    ['Submit application - Acme Corp', true],
    ['Senden', true],
    ['Apply with LinkedIn', false],
    ['Apply With Indeed', false],
    ['Continue with Google', false],
    ['Sign in with Apple', false],
    ['Apply now with our recruiting partner', false],
    ['Import profile', false],
    ['Autofill with resume service', false],
    ['Quick apply', false],
    ['One-click apply', false],
    ['Submit feedback', false],
    ['Submit a support request', false],
    ['Submit your question', false],
    ['Submit application via Wellfound', false],
    ['Submit application with recruiting partner', false],
    ['Submit application feedback', false],
    ['Complete application', false],
    ['Finish application', false],
    ['Continue', false],
    ['Next', false],
    ['Finish', false],
    ['Sign in with Google', false],
    ['Start application', false],
    ['Submit application using Career Services', false],
    ['Send application from recruiting partner', false],
    ['Nachricht senden', false],
    ['Senden und weiter', false],
    ['Senden mit LinkedIn', false],
    ['Absenden', false]
  ];
  for (const [label, expected] of chooserCases) {
    assert.equal(applicationFinal.test(label) && !excluded.test(label), expected, label);
  }
  const score = (label) => {
    if (!applicationFinal.test(label) || excluded.test(label)) return null;
    if (/\b(?:submit|send)\s+(?:your\s+|my\s+|the\s+|this\s+)?application\b/i.test(label)) return 3;
    if (/\bfinish\s+(?:and|&)\s+apply\b|^\s*apply\s+now\s*$/i.test(label)) return 2;
    return 1;
  };
  assert.equal(score('Submit application'), 3);
  assert.equal(score('Send your application'), 3);
  assert.equal(score('Finish and apply'), 2);
  assert.equal(score('Apply now'), 2);
  assert.equal(score('Submit'), 1);
  assert.equal(score('Apply'), 1);
  assert.equal(score('Submit with attachments'), 1);
  assert.equal(score('Senden'), 1);
  assert.equal(score('Apply with LinkedIn'), null);
  const { chooserPolicy: _chooserPolicy, ...missingPolicy } = actions[0];
  assert.throws(
    () => normalizeManagedActions([missingPolicy]),
    (error) => error.code === 'INVALID_CONFIRM_AND_SUBMIT_POLICY'
  );
  assert.throws(
    () => normalizeManagedActions([{ ...actions[0], chooserPolicy: { ...ATOMIC_SUBMIT_POLICY, finalPattern: `${ATOMIC_SUBMIT_POLICY.finalPattern} ` } }]),
    (error) => error.code === 'INVALID_CONFIRM_AND_SUBMIT_POLICY'
  );
  assert.throws(
    () => normalizeManagedActions([{ ...actions[0], chooserPolicy: { ...ATOMIC_SUBMIT_POLICY, grammarHash: '0'.repeat(64) } }]),
    (error) => error.code === 'INVALID_CONFIRM_AND_SUBMIT_POLICY'
  );
  assert.throws(
    () => normalizeManagedActions([{ ...actions[0], chooserPolicy: { ...ATOMIC_SUBMIT_POLICY_V4, finalPattern: ATOMIC_SUBMIT_POLICY_V3.finalPattern } }]),
    (error) => error.code === 'INVALID_CONFIRM_AND_SUBMIT_POLICY'
  );
  assert.throws(
    () => normalizeManagedActions([{ ...actions[0], chooserPolicy: { ...ATOMIC_SUBMIT_POLICY_V4, grammarHash: ATOMIC_SUBMIT_POLICY_V3.grammarHash } }]),
    (error) => error.code === 'INVALID_CONFIRM_AND_SUBMIT_POLICY'
  );
  assert.throws(
    () => normalizeManagedActions([{ ...actions[0], chooserPolicy: { ...ATOMIC_SUBMIT_POLICY_V4, extra: true } }]),
    (error) => error.code === 'INVALID_CONFIRM_AND_SUBMIT_POLICY'
  );
  assert.throws(
    () => normalizeManagedActions([{ ...actions[0], chooserPolicy: { ...ATOMIC_SUBMIT_POLICY_V4, version: 5 } }]),
    (error) => error.code === 'INVALID_CONFIRM_AND_SUBMIT_POLICY'
  );
  assert.throws(
    () => normalizeManagedActions([actions[0], { ...actions[0], submitKind: 'verification' }]),
    (error) => error.code === 'MULTIPLE_ATOMIC_SUBMITS'
  );
  assert.match(SANDBOX_RUNNER, /requiredFieldConfirmation/);
  assert.match(SANDBOX_RUNNER, /confirmAndSubmitPass/);
  assert.match(SANDBOX_RUNNER, /await submitHandle\.click[\s\S]*finalSubmitPressed = true;/);
});

test('v4 chooser proof handles persist on one document and clear across document generations', () => {
  assert.ok((SANDBOX_RUNNER.match(/await handle\.dispose\(\)\.catch\(\(\) => undefined\);/g) || []).length >= 4);
  assert.match(SANDBOX_RUNNER, /for \(const address of successfulAddresses\.splice\(0\)\) \{\n\s+await address\.handle\?\.dispose/);
  assert.match(SANDBOX_RUNNER, /await address\.formHandle\?\.dispose/);
  assert.match(
    SANDBOX_RUNNER,
    /ancestryHandle = await handle\.evaluateHandle\(\(element\) => \{\n\s+const ancestors = \[\];[\s\S]*?return ancestors;\n\s+\}\)\.catch\(\(\) => null\);/,
  );
  assert.match(SANDBOX_RUNNER, /const ancestry = Array\.isArray\(failure\.ancestry\) \? failure\.ancestry : \[\];/);
  assert.match(SANDBOX_RUNNER, /ancestry: failure\.ancestryHandle/);
  assert.match(SANDBOX_RUNNER, /failure\?\.ancestryHandle[\s\S]*?handle\.dispose\(\)\.catch\(\(\) => undefined\)/);
  assert.match(SANDBOX_RUNNER, /await finalSubmitHandle\?\.dispose/);
  assert.match(SANDBOX_RUNNER, /await finalScopeHandle\?\.dispose/);
  assert.match(SANDBOX_RUNNER, /const documentChanged = Boolean\(v4UtilityContext && nextUtilityContext !== v4UtilityContext\)/);
  assert.match(SANDBOX_RUNNER, /if \(documentChanged\) \{\n\s+v4DocumentGeneration \+= 1;/);
  assert.match(SANDBOX_RUNNER, /documentGeneration: witness\.documentGeneration/);
  assert.ok(
    SANDBOX_RUNNER.lastIndexOf('for (const address of successfulAddresses.splice(0))')
      > SANDBOX_RUNNER.indexOf("fs.unlinkSync('stratus-continuation-input.json')"),
    'final cleanup must still run after the retained continuation loop',
  );
});

test('v4 final activation guard verifies trusted dispatch and the exact held native request', () => {
  assert.match(SANDBOX_RUNNER, /serviceWorkers: 'block'/);
  assert.match(SANDBOX_RUNNER, /--dns-prefetch-disable/);
  assert.match(SANDBOX_RUNNER, /--disable-blink-features=WebRTC,WebTransport,LinkPreconnect/);
  assert.match(SANDBOX_RUNNER, /'WebSocketStream', 'Worker', 'SharedWorker'/);
  assert.match(SANDBOX_RUNNER, /routeWebSocket\('\*\*\/\*', async \(webSocketRoute\) => \{\n\s+v4OutOfBandTransportAttempted = true/);
  assert.match(SANDBOX_RUNNER, /v4OutOfBandTransportAttempted = true/);
  assert.match(SANDBOX_RUNNER, /browserContext\.on\('console', \(message\) =>/);
  assert.doesNotMatch(SANDBOX_RUNNER, /page\.on\('console', \(message\) =>/);
  assert.match(SANDBOX_RUNNER, /HTMLLinkElement\.prototype, 'rel'/);
  assert.match(SANDBOX_RUNNER, /blockTokenMethod\('add', \['all'\]\)/);
  assert.match(SANDBOX_RUNNER, /const linkRelListOwners = new WeakMap\(\)/);
  assert.match(SANDBOX_RUNNER, /if \(!linkOwner\) return apply\(original, this, args\)/);
  assert.match(SANDBOX_RUNNER, /blockMarkupSetter\(ShadowRoot\.prototype, 'innerHTML'\)/);
  assert.match(SANDBOX_RUNNER, /blockNodeMethod\(parentPrototype, 'replaceChildren', \['all'\]\)/);
  assert.match(SANDBOX_RUNNER, /blockNodeMethod\(parentPrototype, 'moveBefore', \[0\]\)/);
  assert.match(SANDBOX_RUNNER, /blockNodeMethod\(Range\.prototype, 'insertNode', \[0\]\)/);
  assert.match(SANDBOX_RUNNER, /blockMarkupMethod\(DOMParser\.prototype, 'parseFromString', 0\)/);
  assert.match(SANDBOX_RUNNER, /blockMarkupMethod\(Document\.prototype, 'write', 'allJoined'\)/);
  assert.match(SANDBOX_RUNNER, /blockExecCommandInsertHtml\(\)/);
  assert.match(SANDBOX_RUNNER, /blockMarkupMethod\(Element\.prototype, 'setHTML', 0\)/);
  assert.match(SANDBOX_RUNNER, /blockTransportMethod\(globalThis\.ServiceWorkerContainer\?\.prototype, 'register'\)/);
  assert.match(SANDBOX_RUNNER, /blockTransportMethod\(globalThis\.navigator\?\.serviceWorker, 'register'\)/);
  assert.match(SANDBOX_RUNNER, /if \(linkCount > 256\) return true/);
  assert.match(SANDBOX_RUNNER, /const nodeListLengthGetter = descriptor\(NodeList\.prototype, 'length'\)/);
  assert.doesNotMatch(SANDBOX_RUNNER, /\[1, 9, 11\]\.includes\(nodeType\)/);
  assert.match(SANDBOX_RUNNER, /const stringToLowerCase = String\.prototype\.toLowerCase/);
  assert.match(SANDBOX_RUNNER, /const forbiddenMarkup = \/<\(\?:link\|iframe\)\\b\/i/);
  assert.match(SANDBOX_RUNNER, /defineProperty\(Node\.prototype, 'nodeValue'/);
  assert.match(SANDBOX_RUNNER, /for \(const name of \['setNamedItem', 'setNamedItemNS'\]\)/);
  assert.match(SANDBOX_RUNNER, /function litosGuardedLinkUrlComponent\(value\)/);
  assert.match(SANDBOX_RUNNER, /state\.observer = new NativeMutationObserver/);
  assert.match(SANDBOX_RUNNER, /call\(addEventListener, nativeDocument, 'submit', state\.submitCapture, true\)/);
  assert.match(SANDBOX_RUNNER, /call\(addEventListener, nativeDocument, 'submit', state\.submitDocumentBubble, false\)/);
  assert.match(SANDBOX_RUNNER, /call\(addEventListener, nativeWindow, 'submit', state\.submitWindowBubble, false\)/);
  assert.match(SANDBOX_RUNNER, /!trustedEvent\(event\)[\s\S]*eventTarget\(event\) !== root/);
  assert.match(SANDBOX_RUNNER, /request\.frame\(\) !== page\.mainFrame\(\)/);
  assert.match(SANDBOX_RUNNER, /await submitHandle\.click\(\{ timeout: action\.timeout \|\| 10_000, noWaitAfter: true \}\)/);
  assert.match(SANDBOX_RUNNER, /await decideSubmitTransportGate/);
  assert.match(SANDBOX_RUNNER, /if \(gateResult\.status !== 'allowed'\)/);
  assert.match(SANDBOX_RUNNER, /const pristineNativePostBinding = async/);
  assert.match(SANDBOX_RUNNER, /const pristineConstraintFingerprint = \(provided, root, element\) =>/);
  assert.match(SANDBOX_RUNNER, /const pristineActivationFingerprint = \(root, element, usesAssociatedForm\) =>/);
  assert.match(SANDBOX_RUNNER, /state\.requiredBlockers = pristineRequiredControlBlockers\(token, root\)/);
  assert.match(SANDBOX_RUNNER, /if \(expected !== authorizedFingerprint\) return 'submit_activation_binding_changed'/);
  assert.match(SANDBOX_RUNNER, /authorizedActivationFingerprint = typeof binding\?\.bindingFingerprint === 'string'/);
  assert.match(SANDBOX_RUNNER, /'aria-required', 'aria-owns'/);
  assert.match(SANDBOX_RUNNER, /characterData: true/);
  assert.match(SANDBOX_RUNNER, /'badInput', 'customError', 'patternMismatch'/);
  assert.match(SANDBOX_RUNNER, /state\.constraints = pristineConstraintFingerprint\(token, root, element\)/);
  assert.match(SANDBOX_RUNNER, /'required', 'pattern',[\s\S]*'min', 'max', 'step', 'minlength', 'maxlength', 'multiple'/);
  assert.match(SANDBOX_RUNNER, /const getAttribute = Element\.prototype\.getAttribute/);
  assert.match(SANDBOX_RUNNER, /const preventDefault = Event\.prototype\.preventDefault/);
  assert.match(SANDBOX_RUNNER, /const eventDefaultPreventedGetter = getter\(Event\.prototype, 'defaultPrevented'\)/);
  assert.match(SANDBOX_RUNNER, /state\.reason = 'submit_event_canceled'/);
  assert.match(SANDBOX_RUNNER, /call\(preventDefault, event\)/);
  assert.match(SANDBOX_RUNNER, /const locationHrefGetter = descriptor\(nativeLocation, 'href'\)\?\.get \|\| null/);
  assert.match(SANDBOX_RUNNER, /const trust = descriptor\(event, 'isTrusted'\)/);
  assert.match(SANDBOX_RUNNER, /trust\.configurable === false/);
  assert.doesNotMatch(SANDBOX_RUNNER, /getter\(Event\.prototype, 'isTrusted'\)/);
  assert.match(SANDBOX_RUNNER, /const blobArrayBuffer = Blob\.prototype\.arrayBuffer/);
  assert.match(SANDBOX_RUNNER, /delegate\.addInitScript\(\{ source \}, 'utility'\)/);
  assert.match(SANDBOX_RUNNER, /mainFrame\(\)\.utilityContext\(\)/);
  assert.match(SANDBOX_RUNNER, /const callV4Utility = async \(method, \.\.\.args\) =>/);
  assert.match(SANDBOX_RUNNER, /const compareDocumentPosition = Node\.prototype\.compareDocumentPosition/);
  assert.match(SANDBOX_RUNNER, /position & documentPositionFollowing/);
  assert.match(SANDBOX_RUNNER, /call\(elementQuerySelectorAll, root, '\[aria-required\]'\)/);
  assert.match(SANDBOX_RUNNER, /const labelControlGetter = getter\(HTMLLabelElement\.prototype, 'control'\)/);
  assert.match(SANDBOX_RUNNER, /const rootTree = call\(getRootNode, root\)/);
  assert.match(SANDBOX_RUNNER, /classMarksRequired = \/_required_\//);
  assert.match(SANDBOX_RUNNER, /Required application control \"' \+ identity \+ '\" is empty/);
  assert.match(SANDBOX_RUNNER, /const replayOneNativeHop = async \(request, browserHeaders, onDispatch, options = \{\}\) =>/);
  assert.match(SANDBOX_RUNNER, /if \(options\?\.all\) \{\n\s+callback\(null, \[\{ address: pinned\.address, family: pinned\.family \}\]\)/);
  assert.match(SANDBOX_RUNNER, /if \(dispatched\) return/);
  assert.match(SANDBOX_RUNNER, /const event = destination\.protocol === 'https:' \? 'secureConnect' : 'connect'/);
  assert.match(SANDBOX_RUNNER, /dns\.lookup\(destination\.hostname, \{ all: true, family: 4 \}\)/);
  assert.match(SANDBOX_RUNNER, /const released = await native\[0\]\.completed/);
  assert.doesNotMatch(SANDBOX_RUNNER, /const released = await Promise\.race/);
  assert.match(SANDBOX_RUNNER, /reusePinned: true/);
  assert.match(SANDBOX_RUNNER, /record\.gate\.receipt = \{/);
  assert.match(SANDBOX_RUNNER, /text === v4TransportConsoleToken \+ ':parser-attempt'/);
  assert.match(SANDBOX_RUNNER, /const readOnly = method === 'GET' \|\| method === 'HEAD'/);
  assert.match(SANDBOX_RUNNER, /a === 100 && b >= 64 && b <= 127/);
  assert.match(SANDBOX_RUNNER, /a === 198 && \(b === 18 \|\| b === 19\)/);
  assert.match(SANDBOX_RUNNER, /\['2001:2::', 48\]/);
  assert.match(SANDBOX_RUNNER, /\['2001:10::', 28\]/);
  assert.match(SANDBOX_RUNNER, /\['2001:20::', 28\]/);
  assert.match(SANDBOX_RUNNER, /\['3fff::', 20\]/);
  assert.match(SANDBOX_RUNNER, /\(firstHextet & 0xe000\) !== 0x2000/);
  assert.match(SANDBOX_RUNNER, /actionUrl\.origin !== allowedOrigin/);
  assert.match(SANDBOX_RUNNER, /blockedTransportObserved: false/);
  assert.match(SANDBOX_RUNNER, /containment\.blockedTransportObserved = true/);
  assert.match(SANDBOX_RUNNER, /v4PreSubmitTransportContainment\?\.blockedTransportObserved/);
  assert.match(SANDBOX_RUNNER, /The page attempted an unbound network transport after applicant actions began/);
  assert.doesNotMatch(SANDBOX_RUNNER, /const relevant = type === 'document'/);
  assert.doesNotMatch(SANDBOX_RUNNER, /record\.route\.fetch\(/);
  assert.match(SANDBOX_RUNNER, /crypto\.createHmac\('sha256', chooserBindingHmacKey\)/);
  assert.match(SANDBOX_RUNNER, /digest: payloadDigest\([\s\S]*hmacKey: transportHmacKey/);
  assert.match(SANDBOX_RUNNER, /validationDisabled = NativeBoolean\(read\(formNoValidateGetter, root\)\)/);
  assert.doesNotMatch(SANDBOX_RUNNER, /crypto\.subtle\.(?:sign|importKey)/);
  assert.doesNotMatch(SANDBOX_RUNNER, /input\.hmacKey/);
  assert.doesNotMatch(SANDBOX_RUNNER, /\.nativeSubmit\s*=/);
  assert.doesNotMatch(SANDBOX_RUNNER, /__litosSubmitActivationGuards/);
  const routeAt = SANDBOX_RUNNER.indexOf('activationGate = await armSubmitTransportGate');
  const armedAt = SANDBOX_RUNNER.indexOf("const guardArmResult = await callV4Utility(", routeAt);
  const clickedAt = SANDBOX_RUNNER.indexOf('await submitHandle.click', armedAt);
  const finalizedAt = SANDBOX_RUNNER.indexOf("'finalizeActivationJson'", clickedAt);
  const checkedAt = SANDBOX_RUNNER.indexOf("if (gateResult.status !== 'allowed')", clickedAt);
  assert.ok(routeAt !== -1 && routeAt < armedAt, 'the request gate must be installed before the DOM witness');
  assert.ok(armedAt < clickedAt, 'the activation witness must be armed before the click');
  assert.ok(clickedAt < finalizedAt && finalizedAt < checkedAt,
    'the closure-held witness must be finalized before the exact terminal gate result is checked');
});

test('v4 pinned DNS lookup honors Node 22 all-record and scalar callback shapes', async () => {
  const start = SANDBOX_RUNNER.indexOf('const pinnedLookup = pinned');
  const end = SANDBOX_RUNNER.indexOf('return new Promise((resolve, reject) => {', start);
  assert.ok(start !== -1 && end > start, 'the shipped pinned lookup must be extractable');
  const source = SANDBOX_RUNNER.slice(start, end);
  const createLookup = new Function('pinned', source + '\nreturn pinnedLookup;');
  const pinned = { address: '203.0.113.42', family: 4 };
  const lookup = createLookup(pinned);
  const all = await new Promise((resolve, reject) => {
    lookup('example.test', { all: true }, (error, records) => (
      error ? reject(error) : resolve(records)
    ));
  });
  assert.deepEqual(all, [pinned]);
  const scalar = await new Promise((resolve, reject) => {
    lookup('example.test', { all: false }, (error, address, family) => (
      error ? reject(error) : resolve({ address, family })
    ));
  });
  assert.deepEqual(scalar, pinned);
});

test('v4 verification no-click preserves the existing no-control security-code outcome', () => {
  assert.match(
    SANDBOX_RUNNER,
    /if \(verification\.noClick\) \{\n\s+securityCodeAttempt = \{ supplied: true, entered: true, outcome: 'no_control', resubmitted: false \};/,
  );
  assert.match(SANDBOX_RUNNER, /entry === 'entered_unaddressed'/);
  assert.match(SANDBOX_RUNNER, /action\.securityCodePayloadAddressed === false/);
  assert.match(SANDBOX_RUNNER, /security_code_payload_unaddressed/);
  assert.doesNotMatch(SANDBOX_RUNNER, /submit_control_unavailable/);
});

test('v4 binds repeated security-code controls to their proved native serialization order', () => {
  assert.match(SANDBOX_RUNNER, /snapshot\.names = nullArray\(elements\.length\)/);
  assert.match(SANDBOX_RUNNER, /snapshot\.types = nullArray\(elements\.length\)/);
  assert.match(SANDBOX_RUNNER, /codeGroupIdentityDigest/);
  assert.match(SANDBOX_RUNNER, /successfulControlOrder/);
  assert.match(SANDBOX_RUNNER, /securityCodeGroupId/);
  assert.match(SANDBOX_RUNNER, /securityCodeIndex: index/);
  assert.match(SANDBOX_RUNNER, /serializedSecurityCodeIndices\.some\(\(index, position\) => index !== position\)/);
  assert.match(SANDBOX_RUNNER, /blockerReason = 'security_code_binding_changed'/);
});

test('exact employer page URL capability is required before actions and at the atomic click', async () => {
  const expectedPageUrl = 'https://jobs.example.com/postings/cbs-123?source=litos';
  const submit = {
    type: 'confirmAndSubmit',
    selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
    chooserPolicy: ATOMIC_SUBMIT_POLICY,
    label: 'final_submit',
    optional: false,
    maxRetries: 1,
    contractVersion: 2,
    submitKind: 'application',
    expectedPageUrl,
  };
  const normalizeReleased = (body) => normalizeManagedRun({
    ...body,
    allowSubmit: true,
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: providerDeadlineAt(),
  }, { urlValidator: async (value) => new URL(value) });
  const actions = normalizeManagedActions([
    { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false },
    submit,
  ]);
  assert.equal(actions[1].expectedPageUrl, expectedPageUrl);
  const run = await normalizeReleased({ url: expectedPageUrl, actions });
  assert.equal(run.actions[1].expectedPageUrl, expectedPageUrl);
  await assert.rejects(
    normalizeReleased({ url: expectedPageUrl, actions: [actions[0], { ...submit, expectedPageUrl: 'https://jobs.example.com/postings/other' }] }),
    (error) => error.code === 'INVALID_EXPECTED_PAGE_URL',
  );
  assert.match(SANDBOX_RUNNER, /Employer page URL changed before the first application action/);
  assert.match(SANDBOX_RUNNER, /Employer page URL changed before applicant data could be applied/);
  assert.match(SANDBOX_RUNNER, /Employer page URL changed before the final submit click/);
  assert.ok(SANDBOX_RUNNER.indexOf('exactPageUrlProof.beforeActions = resolved') < SANDBOX_RUNNER.indexOf('for (const action of currentInput.actions'));
  assert.ok(SANDBOX_RUNNER.indexOf('exactPageUrlProof.beforeApplicantData = observed') < SANDBOX_RUNNER.indexOf('addressedSelectors.push'));
  assert.ok(SANDBOX_RUNNER.indexOf('exactPageUrlProof.beforeSubmit = observed') < SANDBOX_RUNNER.indexOf('await submitHandle.click'));
  const fillOnly = normalizeManagedActions([
    { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl },
    { type: 'fill', selector: '#email', value: 'person@example.com' },
  ]);
  // A fill is a mutation, so it now needs a durable attempt even though it never presses submit.
  // Authority is no longer inferred from whether a selector happens to spell "submit".
  const fillRun = await normalizeManagedRun({
    url: expectedPageUrl,
    actions: fillOnly,
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: providerDeadlineAt(),
  }, {
    urlValidator: async (value) => new URL(value),
  });
  assert.equal(fillRun.actions[0].expectedPageUrl, expectedPageUrl);
  assert.equal(normalizeManagedActions([
    { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl },
    ...Array.from({ length: 120 }, () => ({ type: 'click', selector: 'button' })),
  ]).length, 121, 'capability declarations do not consume the browser-action budget');
  const verification = normalizeManagedContinuation({
    continuationToken: 'a'.repeat(43),
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: providerDeadlineAt(),
    actions: [
      { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl },
      { ...submit, submitKind: 'verification', securityCode: 'ABC12345' },
    ],
  });
  assert.equal(verification.actions[0].expectedPageUrl, expectedPageUrl);
  assert.doesNotMatch(SANDBOX_RUNNER, /requiresExactPageUrl && action\.submitKind === 'application'/);

  const v4Submit = { ...submit, chooserPolicy: ATOMIC_SUBMIT_POLICY_V4 };
  const exactV4Capability = {
    type: 'requireCapability',
    value: EXACT_PAGE_URL_CAPABILITY,
    optional: false,
    expectedPageUrl,
  };
  const atomicV4Capability = {
    type: 'requireCapability',
    value: ATOMIC_SUBMIT_V4_CAPABILITY,
    optional: false,
    applicationScopeSelector: '#application',
  };
  await assert.rejects(
    normalizeReleased({ url: expectedPageUrl, actions: [v4Submit] }),
    (error) => error.code === 'INVALID_EXPECTED_PAGE_URL',
  );
  await assert.rejects(
    normalizeReleased({
      url: expectedPageUrl,
      actions: [
        { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false },
        v4Submit,
      ],
    }),
    (error) => error.code === 'INVALID_EXPECTED_PAGE_URL',
  );
  await assert.rejects(
    normalizeReleased({
      url: expectedPageUrl,
      actions: [exactV4Capability, v4Submit],
    }),
    (error) => error.code === 'INVALID_ATOMIC_SUBMIT_V4_CAPABILITY',
  );
  await assert.rejects(
    normalizeReleased({
      url: expectedPageUrl,
      actions: [exactV4Capability, { ...atomicV4Capability, optional: true }, v4Submit],
    }),
    (error) => error.code === 'INVALID_ATOMIC_SUBMIT_V4_CAPABILITY',
  );
  await assert.rejects(
    normalizeReleased({
      url: expectedPageUrl,
      actions: [
        exactV4Capability,
        { type: 'requireCapability', value: ATOMIC_SUBMIT_V4_CAPABILITY, optional: false },
        v4Submit,
      ],
    }),
    (error) => error.code === 'INVALID_ATOMIC_SUBMIT_V4_CAPABILITY',
  );
  await assert.rejects(
    normalizeReleased({
      url: expectedPageUrl,
      actions: [exactV4Capability, atomicV4Capability, atomicV4Capability, v4Submit],
    }),
    (error) => error.code === 'INVALID_ATOMIC_SUBMIT_V4_CAPABILITY',
  );
  const v4Run = await normalizeReleased({
    url: expectedPageUrl,
    actions: [exactV4Capability, atomicV4Capability, v4Submit],
  });
  assert.equal(v4Run.actions[1].value, ATOMIC_SUBMIT_V4_CAPABILITY);
  assert.equal(v4Run.actions[1].optional, false);
  assert.equal(v4Run.actions[2].chooserPolicy.version, 4);
  const v4Continuation = normalizeManagedContinuation({
    continuationToken: 'c'.repeat(43),
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: providerDeadlineAt(),
    actions: [
      exactV4Capability,
      atomicV4Capability,
      { ...v4Submit, submitKind: 'verification', securityCode: 'ABC12345' },
    ],
  });
  assert.equal(v4Continuation.actions[1].value, ATOMIC_SUBMIT_V4_CAPABILITY);
  assert.equal(v4Continuation.actions[1].optional, false);
  assert.equal(v4Continuation.actions[2].chooserPolicy.version, 4);
  await assert.rejects(
    normalizeReleased({
      url: expectedPageUrl,
      actions: [
        { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl },
        { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl },
        atomicV4Capability,
        v4Submit,
      ],
    }),
    (error) => error.code === 'INVALID_EXPECTED_PAGE_URL',
  );
  await assert.rejects(
    normalizeReleased({
      url: expectedPageUrl,
      actions: [
        { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: true, expectedPageUrl },
        atomicV4Capability,
        v4Submit,
      ],
    }),
    (error) => error.code === 'INVALID_EXPECTED_PAGE_URL',
  );
  await assert.rejects(
    normalizeReleased({
      url: expectedPageUrl,
      actions: [
        {
          type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false,
          expectedPageUrl: 'https://jobs.example.com/postings/other',
        },
        atomicV4Capability,
        v4Submit,
      ],
    }),
    (error) => error.code === 'INVALID_EXPECTED_PAGE_URL',
  );
  assert.throws(
    () => normalizeManagedContinuation({
      continuationToken: 'b'.repeat(43),
      submissionAttempt: SUBMISSION_ATTEMPT,
      providerDeadlineAt: providerDeadlineAt(),
      actions: [v4Submit],
    }),
    (error) => error.code === 'INVALID_EXPECTED_PAGE_URL',
  );
});

/* Greenhouse's embed URL (?for=<board>&token=<jobId>) re-serializes its own query string after
 * mount, reordering the same params it was given - the exact-page-url check must tolerate that
 * reordering (params carry a posting's identity and can never be dropped) while still refusing a
 * genuinely different board or job id. Regression coverage for the false-refusal this caused live
 * on Redwood Materials, 3/3 identical failures via backend logs. */
test('canonicalPageUrl tolerates query param reordering but not a changed param set', () => {
  const { canonicalPageUrl } = sandboxScope(['canonicalPageUrl'], 2);
  const asGiven = 'https://boards.greenhouse.io/embed/job_app?for=redwood&token=123456';
  const asReordered = 'https://boards.greenhouse.io/embed/job_app?token=123456&for=redwood';
  assert.equal(canonicalPageUrl(asReordered), canonicalPageUrl(asGiven));
  assert.notEqual(
    canonicalPageUrl('https://boards.greenhouse.io/embed/job_app?for=other&token=123456'),
    canonicalPageUrl(asGiven),
  );
  assert.notEqual(
    canonicalPageUrl('https://boards.greenhouse.io/embed/job_app?for=redwood&token=999999'),
    canonicalPageUrl(asGiven),
  );
  assert.equal(canonicalPageUrl(asGiven + '#section'), canonicalPageUrl(asGiven));
});

/* confirmAndSubmitPass compares action.expectedPageUrl (hash-stripped only) against
 * exactPageUrlProof.expected (sorted, via canonicalPageUrl) at three checkpoints. Comparing the
 * raw field directly caused a real false-refusal - any portal whose original param order was not
 * already alphabetical would fail here even though the page never moved. Pinning that the
 * normalized local variable, not the raw field, is what every checkpoint reads. */
test('confirmAndSubmitPass canonicalizes expectedPageUrl once, and every checkpoint reads the normalized value', () => {
  const confirmAndSubmitPassSource = extractConstSource('confirmAndSubmitPass', 4);
  assert.match(
    confirmAndSubmitPassSource,
    /const expectedPageUrl = action\.expectedPageUrl != null\s*\n\s*\? canonicalPageUrl\(action\.expectedPageUrl\)\s*\n\s*: action\.expectedPageUrl;/,
    'expectedPageUrl must be canonicalized once at the top of confirmAndSubmitPass',
  );
  const rawComparisons = confirmAndSubmitPassSource.match(/action\.expectedPageUrl !== exactPageUrlProof\.expected/g) || [];
  assert.equal(
    rawComparisons.length,
    0,
    'no comparison inside confirmAndSubmitPass should read the raw, unsorted action.expectedPageUrl again',
  );
  assert.equal(
    (confirmAndSubmitPassSource.match(/expectedPageUrl !== exactPageUrlProof\.expected/g) || []).length,
    3,
    'all three exact-page-url checkpoints inside confirmAndSubmitPass must compare against the normalized local variable',
  );
});

test('discover scans choice controls as well as text-shaped ones', () => {
  /* This used to exclude select, radio and checkbox on the reasoning that the caller never clicks a
     choice control. That reasoning was already stale - fillByLabelText has select, radio and
     checkbox arms - and D-01 measured what it cost: Deepgram's two work-eligibility questions are
     Ashby pill groups, so discovery never saw them, no question record was ever written, and the
     backend never got the chance to answer them from the booleans it had stored. A question that is
     never discovered can neither be answered nor asked. */
  assert.match(
    SANDBOX_RUNNER,
    /input\[type="text"\], input\[type="email"\], input\[type="tel"\], input\[type="url"\], input\[type="number"\],/,
  );
  assert.match(SANDBOX_RUNNER, /input\[type="date"\], input\[type="radio"\], input\[type="checkbox"\], input:not\(\[type\]\), textarea, select/);
  assert.match(SANDBOX_RUNNER, /const discovered = \[\];/);
  assert.match(SANDBOX_RUNNER, /const runnerCapabilities = \[/);
  assert.match(SANDBOX_RUNNER, /inputType: el\.tagName === 'TEXTAREA'/);
  assert.match(SANDBOX_RUNNER, /el\.getAttribute\('aria-haspopup'\) === 'listbox' \? 'combobox' : null/);
  assert.match(SANDBOX_RUNNER, /\? \['discovery-control-role-v1'\] : \[\]/);
  assert.match(SANDBOX_RUNNER, /\.\.\.\(runnerCapabilities\.length > 0 \? \{ capabilities: runnerCapabilities \} : \{\}\)/);
});

test('discover prefers the question text over generic Ashby date placeholders', () => {
  assert.match(SANDBOX_RUNNER, /function genericControlText\(value\)/);
  assert.match(SANDBOX_RUNNER, /if \(own && !genericControlText\(own\)\) return own;/);
  assert.match(SANDBOX_RUNNER, /return fallbackText \|\| own;/);
});

test('discover walks nested datepicker parents to find the Ashby question label', () => {
  const label = mockElement({ textContent: 'Are you currently enrolled in a degree program? If so, expected graduation date?' });
  const outer = mockElement({ queryResult: label });
  const middle = mockElement({ parentElement: outer });
  const dateWidget = mockElement({ parentElement: middle });
  const input = mockElement({ attrs: { placeholder: 'Pick date...' }, parentElement: dateWidget });
  assert.equal(sandboxQuestionLabel()(input), 'are you currently enrolled in a degree program? if so, expected graduation date?');
});

test('discover still returns placeholder-only fields when no outer question exists', () => {
  const wrapper = mockElement();
  const input = mockElement({ attrs: { placeholder: 'Enter your answer here' }, parentElement: wrapper });
  assert.equal(sandboxQuestionLabel()(input), 'enter your answer here');
});

test('discover never surfaces a honeypot field', () => {
  assert.match(SANDBOX_RUNNER, /function isHoneypot\(el\)/);
  assert.match(SANDBOX_RUNNER, /!isHoneypot\(el\)/);
});

test('required date blockers can use the enclosing question instead of Pick date', () => {
  assert.match(SANDBOX_RUNNER, /const nearestQuestionText = \(start\) =>/);
  assert.match(SANDBOX_RUNNER, /nearestQuestionText\(element\)/);
});

// R-100. The optional pre-check is an instantaneous snapshot with no auto-wait, and it used to
// apply to waitForSelector too, cancelling the one action whose entire job is to wait. That is the
// whole of the fix: waitForSelector is exempt and every other optional action keeps the snapshot it
// always had. An earlier version also gave the others a 1500ms settle grace against a run-wide
// budget; measured against both branches on two live Greenhouse forms (Redwood Materials and DRW,
// 2026-08-08) the grace produced identical filled_fields and identical blockers while costing
// +4336ms and +4298ms, so it is deliberately not here.
// test/managed-runner-replay.mjs proves the behaviour in a real browser; these pin the mechanism.

test('an optional waitForSelector is exempt from the pre-check entirely', () => {
  // It is the one action whose whole job is to wait, and its timeout is already clamped to
  // 100-20000ms by normalizeManagedActions, so a pre-check can only ever cancel it.
  assert.match(SANDBOX_RUNNER, /action\.optional && action\.type !== 'waitForSelector'\n\s+&& \(exactActionContext \? !exactActionRootHandle : await locator\.count\(\) === 0\)/);
  assert.match(SANDBOX_RUNNER, /if \(action\.type === 'waitForSelector'\) await page\.waitForSelector\(/);
});

test('the pre-check costs nothing beyond the snapshot it always took', () => {
  // The narrowing is load-bearing, not incidental: these are what a reintroduced grace would trip.
  assert.doesNotMatch(SANDBOX_RUNNER, /OPTIONAL_SETTLE_MS/);
  assert.doesNotMatch(SANDBOX_RUNNER, /settleBudgetMs/);
  assert.doesNotMatch(SANDBOX_RUNNER, /precedingActionCouldChangeDom/);
  assert.doesNotMatch(SANDBOX_RUNNER, /locator\.waitFor\(\{ state: 'attached'/);
});

test('an optional element that never arrived is reported rather than skipped in silence', () => {
  // The pre-check used to skip in complete silence, which is how several deploys went by with
  // fields quietly left empty and nothing in the run saying so.
  assert.match(SANDBOX_RUNNER, /skipped\.push\(\(action\.label \|\| action\.type\) \+ ': nothing matched ' \+ action\.selector\)/);
});

/* ---------------------------------------------------------------------------------------------
 * The Redwood Materials incident, 2026-08-08.
 *
 * A packet reached ready_for_final_approval with every question answered. Its stored preview
 * screenshot showed the form correctly filled AND five red "is required" messages under the very
 * controls that were visibly answered - which reads, to whoever approves it, as a form that is
 * about to be submitted blank.
 *
 * Measured on the live form, the messages were STALE. Action 14 of the run was
 * { press, value 'Enter', selector '#country' }, queued to commit the phone-country React Select.
 * normalizeManagedActions dropped the selector, the runner called page.keyboard.press(), the
 * keystroke reached the FORM, and the employer's validator ran while the phone, the resume and all
 * four screener questions were still empty. Greenhouse renders those errors once and does not clear
 * them when the fields are subsequently filled: "Phone is required." stayed on screen underneath a
 * filled phone number. Submitting the completed form passed validation with zero errors.
 *
 * Two failures, opposite directions, same root: a keystroke that went somewhere it was not aimed.
 * ------------------------------------------------------------------------------------------- */

// The runner ships as a string, so these pull the real declarations out of it and run them, rather
// than asserting that some text is present and hoping it still means what it used to.
function extractConstSource(name, indent = 4) {
  const pad = ' '.repeat(indent);
  const start = SANDBOX_RUNNER.indexOf(`\n${pad}const ${name} = `);
  assert.notEqual(start, -1, `${name} must exist in the sandbox runner`);
  const rest = SANDBOX_RUNNER.slice(start + 1);
  const next = rest.search(new RegExp(`\\n${pad}(?:const|let|var|for|if|return|await|fs\\.)`));
  return rest.slice(0, next === -1 ? rest.length : next);
}

function sandboxScope(names, indent = 4) {
  const sources = names.map((name) => extractConstSource(name, indent)).join('\n');
  return Function(`${sources}\nreturn { ${names.join(', ')} };`)();
}

const choiceHelpers = () => sandboxScope(['clean', 'normalized', 'DECLINE_TO_STATE', 'answerOptions', 'optionMatches', 'optionMatchesExactly', 'declineMatches', 'readChoiceState', 'verifyChoiceInContainer', 'choiceControlIsClosed']);

function reactSelectContainer({ chosen = '', placeholder = false, ownText = '', widgetText = '' } = {}) {
  const widget = {
    textContent: widgetText,
    querySelector(selector) {
      if (/single-value|multi-value__label/.test(selector)) return chosen ? { textContent: chosen } : null;
      if (/placeholder/.test(selector)) return placeholder ? { textContent: 'Select...' } : null;
      return null;
    }
  };
  const element = {
    textContent: ownText,
    closest: (selector) => (/select__container|select-shell/.test(selector) ? widget : null),
    querySelector: () => null
  };
  return { evaluate: async (fn) => fn(element) };
}

test('an answered React Select verifies even though the fill container is empty', async () => {
  // THE REGRESSION. The 'fill' branch scopes its container to the nearest ancestor holding a
  // combobox, which on a React Select is '.select__input-container' - a div whose textContent is
  // always ''. Reading that reported "choice value did not persist after fill" for four questions
  // that were answered No/Yes/Yes/Yes and would have submitted correctly.
  const { verifyChoiceInContainer } = choiceHelpers();
  assert.equal(await verifyChoiceInContainer(reactSelectContainer({ chosen: 'No', ownText: '' }), 'No'), true);
  assert.equal(await verifyChoiceInContainer(reactSelectContainer({ chosen: 'Yes', ownText: '' }), 'Yes'), true);
});

test('an unanswered React Select does not borrow its answer from the question label', async () => {
  // The widget's textContent carries the label, and a label is quite capable of containing the
  // answer word. Falling back to it would report an untouched control as filled, which is the one
  // mistake that puts a blank answer on a real application.
  const { verifyChoiceInContainer } = choiceHelpers();
  const untouched = reactSelectContainer({
    placeholder: true,
    widgetText: 'Have you ever worked for Redwood Materials? Select...',
    ownText: ''
  });
  assert.equal(await verifyChoiceInContainer(untouched, 'No'), false);
});

/* ---------------------------------------------------------------------------------------------
 * THE NON-LATIN FALSE ACCEPT, measured in Chromium on 2026-08-11.
 *
 * normalized() keeps only [a-z0-9]. Handed two non-Latin strings it returns the empty string for
 * both, and the containment arm of verifyChoiceInContainer then asked ''.includes(''), which is
 * true. Every non-Latin rendered value matched every non-Latin expected value, so a control
 * rendering いいえ verified as holding はい and the field was recorded as correctly filled.
 *
 * On a Japanese, Arabic or Cyrillic employer form that is the opposite answer to a yes/no
 * eligibility or work-authorisation question, submitted under her name, with the run reporting it
 * as filled. The Latin control at the bottom of each case is the proof that the defect was the
 * normalisation and not the comparison.
 * ------------------------------------------------------------------------------------------- */

test('a non-Latin answer does not verify as the opposite non-Latin answer', async () => {
  const { verifyChoiceInContainer } = choiceHelpers();
  const showing = (chosen) => reactSelectContainer({ chosen, ownText: '' });
  // Japanese. はい is yes, いいえ is no.
  assert.equal(await verifyChoiceInContainer(showing('いいえ'), 'はい'), false, 'いいえ is not はい');
  assert.equal(await verifyChoiceInContainer(showing('はい'), 'いいえ'), false, 'はい is not いいえ');
  // Cyrillic. Да is yes, Нет is no.
  assert.equal(await verifyChoiceInContainer(showing('Нет'), 'Да'), false, 'Нет is not Да');
  assert.equal(await verifyChoiceInContainer(showing('Да'), 'Нет'), false, 'Да is not Нет');
  // Arabic, which her own forms include. نعم is yes, لا is no.
  assert.equal(await verifyChoiceInContainer(showing('لا'), 'نعم'), false, 'لا is not نعم');
  assert.equal(await verifyChoiceInContainer(showing('نعم'), 'لا'), false, 'نعم is not لا');
  // And a non-Latin answer that shares nothing with the question it was asked.
  assert.equal(await verifyChoiceInContainer(showing('日本国籍'), '就労ビザが必要です'), false);
});

test('a correct non-Latin answer still verifies, rather than being handed back as unverified', async () => {
  /* THE HALF THAT MAKES THIS A REPAIR. Refusing every comparison whose operands normalise away
   * would also refuse the CORRECT non-Latin selection, and Litos would report a form it answered
   * properly as unverified and hand every control back to her. So the comparison falls back to the
   * cleaned text, which is what the employer rendered and what she asked for, and a right answer
   * verifies on its own merits.
   *
   * optionMatches cannot carry this: it returns false on its first line for anything that
   * normalises empty. This arm is the only place a non-Latin choice can verify at all.
   */
  const { verifyChoiceInContainer, optionMatches } = choiceHelpers();
  const showing = (chosen) => reactSelectContainer({ chosen, ownText: '' });
  assert.equal(await verifyChoiceInContainer(showing('はい'), 'はい'), true);
  assert.equal(await verifyChoiceInContainer(showing('いいえ'), 'いいえ'), true);
  assert.equal(await verifyChoiceInContainer(showing('Да'), 'Да'), true);
  assert.equal(await verifyChoiceInContainer(showing('نعم'), 'نعم'), true);
  // Case-folded the same way the Latin path is: a widget that renders да verifies against a stored Да.
  assert.equal(await verifyChoiceInContainer(showing('да'), 'Да'), true);
  /* A WIDGET SAYING MORE THAN THE ANSWER IS HANDED BACK ON THIS SCRIPT, and that is a deliberate
     narrowing rather than an oversight. The Latin arm allows it because optionMatches only counts
     containment above six normalised characters, which admits "No, I am not a protected veteran"
     for a stored "No" while refusing a longer declaration for a longer answer. There is no
     equivalent number here: a Japanese affirmative is two characters, so any floor that admits はい
     inside はい、必要です also admits 需要工作签証担保 inside its own negation, which is the exact
     shape that put a reversed sponsorship declaration on a form and reported it filled. On a script
     this file cannot read, "said more than the answer" and "said the opposite of the answer" are
     one shape, and it fails closed. The cost is a confirmation on a fill that was correct. */
  assert.equal(await verifyChoiceInContainer(showing('はい、必要です'), 'はい', 'はい、必要です', 'はい'), false);
  assert.equal(await verifyChoiceInContainer(showing('はい、必要です'), 'はい'), false);
  /* THE WIDENING THAT DOES SURVIVE, on both scripts, because the extra material carries no letters:
     the row names the country and the widget renders only its dial code. That is the case the
     clicked-row rule was built for and it is untouched. */
  assert.equal(await verifyChoiceInContainer(showing('+81'), '日本', '日本 +81', '日本'), true);
  // Stated out loud so the reason this arm exists cannot be optimised away: optionMatches refuses.
  assert.equal(optionMatches('はい', 'はい'), false, 'optionMatches still cannot see a non-Latin answer');
});

test('a mixed-script value is judged on the script that carries the answer', async () => {
  // A board that renders "いいえ (No)" gives normalized() something to work with - "no" - while the
  // stored はい still normalises away. The old arm asked 'no'.includes('') and said yes, so the
  // bilingual rendering was the worst case of all: it looks verifiable and is not.
  const { verifyChoiceInContainer } = choiceHelpers();
  const showing = (chosen) => reactSelectContainer({ chosen, ownText: '' });
  assert.equal(await verifyChoiceInContainer(showing('いいえ (No)'), 'はい'), false);
  // Same narrowing as above: the rendered value contains the answer and adds letters to it, so on a
  // script normalising erases it is handed back rather than assumed. Reached through the Latin side
  // of the same string it still verifies, which the next line asserts.
  assert.equal(await verifyChoiceInContainer(showing('はい (Yes)'), 'はい', 'はい (Yes)', 'はい'), false);
  // Latin on both sides of a mixed value is untouched: it never reaches the fallback at all.
  assert.equal(await verifyChoiceInContainer(showing('はい (Yes)'), 'Yes'), true);
  assert.equal(await verifyChoiceInContainer(showing('いいえ (No)'), 'Yes'), false);
});

test('a negation is not the answer it negates, on a script normalisation erases', async () => {
  /* THE OTHER HALF OF THE NON-LATIN REPAIR, and it was open in two places at once.
   *
   * ASSERTED THROUGH THE FOUR-ARGUMENT CALL, which is the only call the action loop makes. An
   * earlier version of this test used the two-argument form and passed while the defect stood: with
   * the clicked row and the answer it was clicked for supplied, the clicked-row rule accepted every
   * pair below, because the row and the rendered value are the same string and the provenance clause
   * is true by construction for any click made in the same call. A test that pins a call shape
   * production never makes is worth less than no test, because it reports the hazard as closed.
   *
   * WHY THE LATIN GUARD MISSES THESE. optionMatches returns false on its first line for anything
   * that normalises to nothing, so the near-miss refusal that catches this exact shape in English
   * never fired. And the shape only exists outside English: Chinese, Japanese and Korean negate with
   * a bound prefix or a trailing auxiliary, so the negation of an answer CONTAINS the answer, while
   * "I do not require sponsorship" does not contain "I require sponsorship". That is why nobody
   * testing on English forms could have seen it.
   */
  const { verifyChoiceInContainer } = choiceHelpers();
  const showing = (chosen) => reactSelectContainer({ chosen, ownText: '' });
  for (const [held, wanted] of [
    ['不需要工作签证担保', '需要工作签证担保'],
    ['没有工作授权', '有工作授权'],
    ['不是', '是'],
    ['ビザのサポートは必要ありません', 'ビザのサポートは必要'],
    ['스폰서십이 필요하지 않습니다', '스폰서십이 필요']
  ]) {
    assert.equal(
      await verifyChoiceInContainer(showing(held), wanted, held, wanted), false,
      `a control holding ${held} must not verify as holding ${wanted}, through the call the runner makes`
    );
    // And the same control holding what was actually asked for still verifies, so this is a repair
    // and not a blanket refusal of the script.
    assert.equal(await verifyChoiceInContainer(showing(wanted), wanted, wanted, wanted), true);
  }
  // The Latin pair from the same family, which never had the defect and must keep not having it.
  assert.equal(
    await verifyChoiceInContainer(
      showing('I do not require sponsorship'), 'I require sponsorship',
      'I do not require sponsorship', 'I require sponsorship'
    ),
    false
  );
});

test('a blank widget does not verify as a non-Latin answer', async () => {
  // readChoiceState reports kind 'chosen' for a value node that renders whitespace, and clean()
  // takes that to ''. Two empty strings used to satisfy the containment arm, so an EMPTY control
  // reported itself as holding はい. The 'empty' kind never had to be involved.
  const { verifyChoiceInContainer } = choiceHelpers();
  assert.equal(await verifyChoiceInContainer(reactSelectContainer({ chosen: ' ' }), 'はい'), false);
});

test('the clicked-row rule cannot launder a non-Latin answer either', async () => {
  /* The third rule verifies against the menu row that was clicked rather than against the rendered
   * value, and it ended in the same containment expression. Clicking いいえ and then asking whether
   * that row carries はい compared two blanks and said yes, so the widening built for Greenhouse's
   * "+971" would have re-admitted every case the arm above now refuses.
   *
   * Its row-includes-shown gate is raw text and was always sound on any script; only the last
   * comparison could not tell the two answers apart.
   */
  const { verifyChoiceInContainer } = choiceHelpers();
  const showing = (chosen) => reactSelectContainer({ chosen, ownText: '' });
  assert.equal(await verifyChoiceInContainer(showing('いいえ'), 'はい', 'いいえ'), false);
  assert.equal(await verifyChoiceInContainer(showing('Нет'), 'Да', 'Нет'), false);
  // The row that genuinely carries the requested answer still widens, exactly as it does in Latin:
  // Japan's row names the country and the widget renders only the dial code.
  assert.equal(await verifyChoiceInContainer(showing('+81'), '日本', '日本 +81', '日本'), true);
});

test('Latin choice verification is unchanged by the non-Latin repair', async () => {
  /* THE THING TO BE MOST CAREFUL ABOUT. The comparison still runs on the normalised strings whenever
   * both sides survive normalising, which is every Latin comparison, so the non-Latin repair changes
   * no Latin verdict.
   *
   * What DID change here, separately and deliberately, is that the first rule is now an equality
   * rather than containment, and every widening is anchored on the row that was clicked. Containment
   * cannot tell "the widget rendered more than the answer" from "the widget is holding a different,
   * longer declaration", and on sponsorship and work authorisation those are the same shape: a
   * control left holding "I do not require sponsorship" for a stored "I do not require sponsorship
   * now, but will in the future" verified TRUE on the old arm. So the widening cases below now pass
   * the clicked row, which is what the runner passes on every path that reaches them.
   */
  const { verifyChoiceInContainer } = choiceHelpers();
  const showing = (chosen) => reactSelectContainer({ chosen, ownText: '' });
  // Positives.
  assert.equal(await verifyChoiceInContainer(showing('No'), 'No'), true);
  assert.equal(await verifyChoiceInContainer(showing('Yes'), 'Yes'), true);
  assert.equal(await verifyChoiceInContainer(showing('YES'), 'yes'), true, 'case is not an answer');
  // The widening's own reason to exist: the widget renders more than the stored answer, and the row
  // that was clicked is what says that is a rendering rather than a different answer.
  assert.equal(
    await verifyChoiceInContainer(showing('No, I am not a protected veteran'), 'No', 'No, I am not a protected veteran', 'No'),
    true
  );
  assert.equal(await verifyChoiceInContainer(showing('I agree'), 'Yes'), true, 'a yes synonym still carries');
  // Punctuation is still collapsed before containment, which is the whole reason this arm compares
  // the NORMALISED text on a Latin pair and not the raw text.
  assert.equal(
    await verifyChoiceInContainer(showing("Yes, I'm authorized."), 'Yes', "Yes, I'm authorized.", 'Yes'),
    true
  );
  // Negatives.
  assert.equal(await verifyChoiceInContainer(showing('No'), 'Yes'), false);
  assert.equal(await verifyChoiceInContainer(showing('Yes'), 'No'), false);
  assert.equal(await verifyChoiceInContainer(showing('Male'), 'Female'), false);
  assert.equal(await verifyChoiceInContainer(showing('I decline to self-identify'), 'Male'), false);
  /* THE ONE THIS FILE PREVIOUSLY REPORTED AND LEFT STANDING. A widget showing "Female" against an
   * expected "Male" used to verify TRUE, because "female" contains "male" and the containment arm
   * had no minimum length. Replacing that arm with an equality closes it as a side effect, so it is
   * asserted now rather than described. */
  assert.equal(await verifyChoiceInContainer(showing('Female'), 'Male'), false);
  // The 43-packet widening, end to end: chosen from the row "United Arab Emirates +971" and rendered
  // as "+971". This is the case the third rule was built for and it is untouched.
  assert.equal(
    await verifyChoiceInContainer(showing('+971'), 'United Arab Emirates', 'United Arab Emirates +971', 'United Arab Emirates'),
    true
  );
  // And its guard: a control showing an answer that is not part of the row we clicked still fails.
  assert.equal(
    await verifyChoiceInContainer(showing('+1'), 'United Arab Emirates', 'United Arab Emirates +971', 'United Arab Emirates'),
    false
  );
  /* AND THE ONE THE EXACTNESS RULES ARE FOR. The row that was clicked carries the long answer, the
   * control ends up showing its short prefix, and that prefix is a substring of the row, so the
   * clicked-row widening would have accepted it. A near miss of the answer fails closed ahead of
   * every widening, because it is a different statement about visa status and not a rendering. */
  assert.equal(
    await verifyChoiceInContainer(
      showing('I am authorized to work'),
      'I am authorized to work only with a student visa',
      'I am authorized to work only with a student visa',
      'I am authorized to work only with a student visa'
    ),
    false
  );
});

// verifyFilled reads a control's own value rather than a widget's rendered answer, and its equality
// arm carried the identical defect one function away: normalized(candidate) === normalized(expected)
// is '' === '' for any two non-Latin strings.
const filledHelpers = () => sandboxScope([
  'clean', 'normalized', 'DECLINE_TO_STATE', 'answerOptions', 'optionMatches', 'optionMatchesExactly',
  'declineMatches', 'verifyFilled'
]);

// The element read is a DOM branch exercised in the replay suites against real markup; what these
// cases are about is the comparison it feeds, so the field hands back the read's own result. 'kind'
// is what routes a native select to the exact tier and everything else to the equality tier.
const holding = (...actual) => ({ evaluate: async () => ({ kind: 'other', actual }) });
const selectHolding = (...actual) => ({ evaluate: async () => ({ kind: 'select', actual }) });

test('a filled field holding one non-Latin answer does not verify as another', async () => {
  const { verifyFilled } = filledHelpers();
  assert.equal(await verifyFilled(holding('いいえ'), 'はい'), false);
  assert.equal(await verifyFilled(holding('Нет'), 'Да'), false);
  assert.equal(await verifyFilled(holding('لا'), 'نعم'), false);
  // An empty control normalised away too, so it verified as holding whatever non-Latin answer was
  // asked for. That is a blank field reported as a filled one.
  assert.equal(await verifyFilled(holding(''), 'はい'), false);
  // Still useful: the right answer verifies on its own text.
  assert.equal(await verifyFilled(holding('はい'), 'はい'), true);
  assert.equal(await verifyFilled(holding('نعم'), 'نعم'), true);
  assert.equal(await verifyFilled(holding('はい', 'yes'), 'はい'), true);
  // Latin, unchanged: equality is still judged on the normalised text.
  assert.equal(await verifyFilled(holding('Yes'), 'yes'), true);
  assert.equal(await verifyFilled(holding('Computer Science.'), 'Computer Science'), true);
  assert.equal(await verifyFilled(holding('No'), 'Yes'), false);
  assert.equal(await verifyFilled(holding(''), 'Yes'), false);
});

test('a native select holding a non-Latin answer fails closed rather than agreeing with itself', async () => {
  /* The select tier is exact-only, and both of its rules refuse anything normalized() erases. So a
   * Japanese <select> verifies as nothing and is left for the applicant: safe, and honest about
   * being unverified, which is the opposite of the defect above. Asserted rather than assumed,
   * because "it refuses" and "it accepts anything" look identical from the outside until you ask.
   */
  const { verifyFilled } = filledHelpers();
  assert.equal(await verifyFilled(selectHolding('いいえ', 'no'), 'はい'), false, 'never a false accept');
  assert.equal(await verifyFilled(selectHolding('はい', 'yes'), 'はい'), false, 'and not yet useful either');
  // Latin selects are unaffected: an exact answer verifies, a substring relative of it does not.
  assert.equal(await verifyFilled(selectHolding('Yes', 'yes'), 'Yes'), true);
  assert.equal(await verifyFilled(selectHolding('Yes, with sponsorship', 'y2'), 'Yes'), false);
});

test('Enter is withheld from a choice control whose menu is shut', async () => {
  const { choiceControlIsClosed } = choiceHelpers();
  const combobox = (expanded) => ({
    evaluate: async (fn) => fn({
      getAttribute: (name) => (name === 'role' ? 'combobox' : (name === 'aria-expanded' ? expanded : null)),
      closest: () => null,
      querySelector: () => null
    })
  });
  assert.equal(await choiceControlIsClosed(combobox('false')), true);
  // Menu open: Enter has a highlighted option to take, so it still has a job to do.
  assert.equal(await choiceControlIsClosed(combobox('true')), false);
  // Not a choice control at all: leave the press alone, this guard has no opinion.
  const plainInput = { evaluate: async (fn) => fn({ getAttribute: () => null, closest: () => null, querySelector: () => null }) };
  assert.equal(await choiceControlIsClosed(plainInput), false);
});

test('a press keeps the selector it was given', () => {
  // Dropping it here is what turned every aimed keystroke into a page-wide one, and made the
  // optional pre-check - which is guarded on the locator - unreachable for every press ever queued.
  const [aimed, unaimed] = normalizeManagedActions([
    { type: 'press', value: 'Enter', selector: '#country', label: 'phone_country_select', optional: true },
    { type: 'press', value: 'Enter' }
  ]);
  assert.equal(aimed.selector, '#country');
  assert.equal(aimed.optional, true);
  // Still optional to supply one: a caller may legitimately mean "send this key wherever focus is".
  assert.equal(unaimed.selector, undefined);
  assert.equal(unaimed.value, 'Enter');
});

test('a press lands on the element it names, and is skipped when that element is absent', () => {
  assert.match(SANDBOX_RUNNER, /await locator\.press\(action\.value\)/);
  assert.match(SANDBOX_RUNNER, /if \(!locator\) \{\n\s+await page\.keyboard\.press\(action\.value\);/);
  assert.match(SANDBOX_RUNNER, /Enter withheld/);
  assert.match(SANDBOX_RUNNER, /could only have submitted the form/);
});

const gateScope = () => sandboxScope(
  [
    'clean', 'widgetOf', 'CHOICE_SHELL', 'CHOICE_CONTROL', 'CHOICE_OPENER', 'reactChoiceBinding',
    'chosenValueOf', 'select2SourceAnswered', 'uploadHasFile', 'PILL_SELECTED', 'chosenPillOf',
    'chosenAshbyYesNoOf', 'semanticChoiceGroup', 'directSemanticChoicePeers',
    'enabledSemanticCheckboxGroupAnswered', 'enabledNativeChoiceAnswered',
    'selectHasEnabledSelection', 'ownedNativeControls', 'hasAnswer'
  ],
  6,
);

// A React Select's own shell, the thing its chosen value is rendered into.
function shellOf({ chosen = '', placeholder = false } = {}) {
  const shell = {
    control: null,
    querySelector(selector) {
      if (/single-value|multi-value__label/.test(selector)) return chosen ? { textContent: chosen } : null;
      if (/placeholder/.test(selector)) return placeholder ? {} : null;
      return null;
    },
    querySelectorAll(selector) {
      if (/single-value|multi-value__label/.test(selector)) {
        return chosen ? [{ textContent: chosen, closest: () => shell }] : [];
      }
      if (/placeholder/.test(selector)) return placeholder ? [{ closest: () => shell }] : [];
      if (/role="combobox"|aria-haspopup/.test(selector)) {
        return shell.control?.getAttribute('role') === 'combobox' ? [shell.control] : [];
      }
      if (/input:not\(\[type="hidden"\]\)|textarea|select/.test(selector)) {
        return shell.control ? [shell.control] : [];
      }
      return [];
    }
  };
  return shell;
}

// One form control. 'shell' is the select shell this control is INSIDE, which is the distinction
// R-103 turns on: a control that merely sits near an answered select is not inside it.
function control({ tag = 'INPUT', type = 'text', value = '', role = null, checked = null, files = null, name = null, shell = null, block = null } = {}) {
  const element = {
    tagName: tag, type, value, checked, files, name,
    getAttribute: (attribute) => (attribute === 'role' ? role : null),
    closest(selector) {
      if (!shell) return null;
      if (/select__container|select-shell/.test(selector)) return shell;
      if (/select__control/.test(selector)) return shell;
      return null;
    },
    parentElement: block || { querySelector: () => null, querySelectorAll: () => [] },
    querySelector: () => null,
    querySelectorAll: () => []
  };
  if (shell) shell.control = element;
  return element;
}

// A block that is itself flagged required: Greenhouse marks its uploader with a
// <div role="group" aria-required="true"> and leaves the file input unmarked.
function block({ chip = false, controls = [] } = {}) {
  return {
    tagName: 'DIV',
    closest: () => null,
    querySelector: (selector) => (/file-upload__filename|Remove file/.test(selector) && chip ? {} : null),
    querySelectorAll: (selector) => (/type="file"/.test(selector)
      ? controls.filter((candidate) => candidate.type === 'file')
      : controls.filter((candidate) => candidate.type !== 'hidden'))
  };
}

test('R-103: an empty required control is not answered by a choice control beside it', () => {
  const { hasAnswer } = gateScope();
  // THE REGRESSION. Greenhouse puts the phone number input and its country React Select in one
  // <fieldset class="phone-input">. The answer check used to be asked of that fieldset and returned
  // true on its first look at the country's rendered "+971", so an empty required #phone was
  // invisible. Measured live on the Redwood Materials form, 2026-08-08: with the form otherwise
  // complete, clearing #phone produced ZERO blockers while clearing #first_name or #email was caught
  // by name. "Phone is required." is one of the six messages from the incident this gate was built
  // for, so the gate was blind to the very field it exists to catch.
  const answeredCountry = shellOf({ chosen: '+971' });
  // The phone input is NOT inside the country's shell, and its own value is the answer.
  assert.equal(hasAnswer(control({ type: 'tel', value: '', shell: null })), false);
  assert.equal(hasAnswer(control({ type: 'tel', value: '+971 50 123 4567', shell: null })), true);
  // The country combobox IS inside it, and reads as answered. Both live in the same fieldset, and
  // they now give different answers, which is the whole point.
  assert.equal(hasAnswer(control({ role: 'combobox', value: '', shell: answeredCountry })), true);
});

test('the pre-submit gate reads an answer where the control actually keeps it', () => {
  const { hasAnswer } = gateScope();
  // React Select: the answer is rendered text, and the combobox input's value is search text that
  // react-select CLEARS on selection. Reading the input would call every answered question empty.
  assert.equal(hasAnswer(control({ role: 'combobox', value: '', shell: shellOf({ chosen: 'No' }) })), true);
  assert.equal(hasAnswer(control({ role: 'combobox', value: '', shell: shellOf({ placeholder: true }) })), false);
  assert.equal(hasAnswer(control({ type: 'text', value: 'Mehek' })), true);
  assert.equal(hasAnswer(control({ type: 'text', value: '' })), false);
  assert.equal(hasAnswer(control({ type: 'checkbox', checked: false })), false);
  assert.equal(hasAnswer(control({ type: 'checkbox', checked: true })), true);
  // A hidden input is not an answer the applicant gave.
  assert.equal(hasAnswer(control({ type: 'hidden', value: 'x' })), false);
  // A file input reads the block it sits in, because Greenhouse REMOVES the input once the upload
  // finishes and leaves a filename chip, so "this input holds no file" is true of an answered field.
  const empty = control({ type: 'file', files: [] });
  empty.parentElement = block({ controls: [empty] });
  assert.equal(hasAnswer(empty), false);
  const loaded = control({ type: 'file', files: [{}] });
  loaded.parentElement = block({ controls: [loaded] });
  assert.equal(hasAnswer(loaded), true);
  const chipped = control({ type: 'file', files: [] });
  chipped.parentElement = block({ chip: true, controls: [chipped] });
  assert.equal(hasAnswer(chipped), true);
});

test('a block flagged required is answered by what is inside it, since it holds no value itself', () => {
  const { hasAnswer } = gateScope();
  // Greenhouse marks its uploader required with a <div role="group" aria-required="true"> and leaves
  // the file input unmarked, so the flagged element is a container. This is the one place widening
  // is right, because a container has no value of its own to read.
  assert.equal(hasAnswer(block({ controls: [control({ type: 'file', files: [] })] })), false);
  assert.equal(hasAnswer(block({ controls: [control({ type: 'file', files: [{}] })] })), true);
  assert.equal(hasAnswer(block({ chip: true, controls: [] })), true);
});

test('the pre-submit gate runs before the final click and can stop it', () => {
  assert.match(SANDBOX_RUNNER, /const isFinalSubmitAction = \(action\) =>/);
  assert.match(SANDBOX_RUNNER, /if \(isFinalSubmitAction\(action\)\) \{/);
  assert.match(SANDBOX_RUNNER, /submitGateBlockers\.push\(\.\.\.blocking\)/);
  assert.match(SANDBOX_RUNNER, /submit withheld/);
  // The gate has to be able to see a control the old blocker scan could not: React Select's input
  // carries aria-required and no required attribute, so [required] alone never sees an unanswered
  // Greenhouse screener question.
  assert.match(SANDBOX_RUNNER, /\[aria-required="true"\]/);
  // And its findings have to reach the caller.
  assert.match(SANDBOX_RUNNER, /const blockers = \[\.\.\.submitGateBlockers\]/);
});

test('the final submit is recognised only by explicit intent', () => {
  const { isFinalSubmitAction } = sandboxScope(['isFinalSubmitAction']);
  assert.equal(isFinalSubmitAction({ type: 'click', selector: 'button[type="submit"], input[type="submit"]' }), false);
  assert.equal(isFinalSubmitAction({ type: 'click', selector: "button[type='submit']" }), false);
  assert.equal(isFinalSubmitAction({ type: 'click', selector: '#send', label: 'final_submit' }), true);
  // Ordinary clicks pass through the final-action classifier and are contained at runtime.
  assert.equal(isFinalSubmitAction({ type: 'click', selector: '#onetrust-accept-btn-handler' }), false);
  assert.equal(isFinalSubmitAction({ type: 'click', selector: 'a:has-text("Apply for this job")' }), false);
  assert.equal(isFinalSubmitAction({ type: 'fill', selector: 'button[type="submit"]' }), false);
});

test('stale validation text is reported but never blocks a complete form', () => {
  // Measured: filling the Redwood form correctly left six "is required" messages on screen, and
  // submitting it then passed validation with zero errors. Refusing on error TEXT would have thrown
  // away a complete, correct application - the same harm as sending a broken one, and harder to see.
  assert.match(SANDBOX_RUNNER, /if \(!culprit\) \{ stale\.push\(text\); continue; \}/);
  assert.match(SANDBOX_RUNNER, /pre_submit_gate: ignored /);
  assert.match(SANDBOX_RUNNER, /stale validation message\(s\) left over from an earlier pass/);
  // An error nobody can tie back to a control is the one case where text alone is enough, because
  // "we cannot tell" is not a reason to send.
  assert.match(SANDBOX_RUNNER, /could not tell which field it belongs to/);
});

test('the form\'s own "* indicates a required field" legend is not a blocker', () => {
  // Measured on the live Redwood Materials form: this legend was the ONLY thing the gate found on a
  // completely and correctly filled application. Left in, the gate would have refused to submit
  // every Greenhouse application there is, which is not caution, it is an outage with a good excuse.
  const { LEGEND_TEXT, ERROR_TEXT } = sandboxScope(['ERROR_TEXT', 'LEGEND_TEXT'], 6);
  const isFieldError = (text) => ERROR_TEXT.test(text) && !LEGEND_TEXT.test(text);
  assert.equal(isFieldError('indicates a required field'), false);
  assert.equal(isFieldError('* indicates a required field'), false);
  assert.equal(isFieldError('All fields are required'), false);
  // and the real messages still are errors
  assert.equal(isFieldError('This field is required.'), true);
  assert.equal(isFieldError('Resume/CV is required.'), true);
  assert.equal(isFieldError('Phone is required.'), true);
  assert.equal(isFieldError('Please select an option'), true);
});

test('a message in a block holding no control is not attributed to a field', () => {
  assert.match(SANDBOX_RUNNER, /const controls = \[\.\.\.widget\.querySelectorAll\('input:not\(\[type="hidden"\]\), textarea, select, \[role="combobox"\]'\)\];/);
  assert.match(SANDBOX_RUNNER, /if \(controls\.length === 0\) continue;/);
});

test('a message over a block of several controls accuses the required empty one, not the block', () => {
  // The same R-103 shape on the error path. Greenhouse's phone field is a fieldset holding the
  // country select and the number, and its uploader holds the resume and the cover letter. Reading
  // the block as a whole is wrong in both directions: it hides an empty required phone behind an
  // answered country, and it can blame an empty OPTIONAL cover letter for the resume's message,
  // which would refuse a complete application.
  assert.match(SANDBOX_RUNNER, /const marked = controls\.filter\(\(candidate\) => candidate\.required \|\| candidate\.getAttribute\('aria-required'\) === 'true'\);/);
  assert.match(SANDBOX_RUNNER, /culprit = marked\.find\(\(candidate\) => !hasAnswer\(candidate\)\) \|\| null;/);
  // When nothing in the block claims to be required the message is the only signal there is, and it
  // may block only if NOTHING in the block has been answered.
  assert.match(SANDBOX_RUNNER, /\} else if \(!controls\.some\(\(candidate\) => hasAnswer\(candidate\)\)\) \{/);
});

test('one unanswered React Select is not reported twice', () => {
  // Keying on the control rather than the block lets a fieldset report two empty required controls,
  // but an unanswered React Select carries aria-required on BOTH its combobox input and the hidden
  // input beside it, and the two resolve to the same question and the same label. Measured on the
  // empty live Redwood form: 15 raw entries covering 8 distinct fields.
  assert.match(SANDBOX_RUNNER, /blocking: \[\.\.\.new Set\(required\.map\(\(entry\) => entry\.message\)\)\]/);
});

/* THE PHASED-SUBMIT REGRESSION, measured on production packet 13bccb2d (Skydio, Ashby, 2026-08-09).
 *
 * A fake sandbox that never produces a phase-0 result, so the only thing under test is what the
 * caller does about it. On origin/main this waits 60 seconds and reports "Managed browser
 * continuation timed out" on a run that requested no continuation of anything.
 */
function silentSandboxApi({
  crash = null,
  result = null,
  progress = null,
  terminalAfterPolls = 0,
  maxSdkStreamMs = Infinity,
  resultSubmissionAttempt = null,
  progressSubmissionAttempt = null,
  resultReadError = null,
  screenshotStall = false,
} = {}) {
  const template = { name: CURRENT_SANDBOX_TEMPLATE, currentSnapshotId: 'snapshot' };
  const calls = [];
  const runnerCalls = [];
  const forkCalls = [];
  class Fake {
    constructor(name) {
      this.name = name;
      this.files = new Map();
      this.stopped = false;
      this.polls = 0;
    }
    materializeTerminal() {
      const inputBuffer = this.files.get('stratus-input.json');
      const input = inputBuffer ? JSON.parse(inputBuffer.toString('utf8')) : {};
      if (crash) {
        this.files.set('stratus-error.json', Buffer.from(JSON.stringify({ message: crash })));
        if (input.submissionAttempt) {
          this.files.set(MANAGED_TERMINAL_RESULT_PATH, managedTerminalEnvelope(null, input, {
            state: 'failed',
          }));
        }
      }
      if (progress) this.files.set('stratus-progress.json', Buffer.from(JSON.stringify({
        ...progress,
        ...(input.submissionAttempt ? { submissionAttempt: input.submissionAttempt } : {}),
        ...(progressSubmissionAttempt ? { submissionAttempt: progressSubmissionAttempt } : {}),
      })));
      if (result) {
        const resultPayload = {
          ...result,
          ...(input.submissionAttempt ? { submissionAttempt: input.submissionAttempt } : {}),
          ...(resultSubmissionAttempt ? { submissionAttempt: resultSubmissionAttempt } : {}),
        };
        this.files.set('stratus-result-0.json', Buffer.from(JSON.stringify(resultPayload)));
        if (input.submissionAttempt && resultPayload.continuationOffered !== true) {
          this.files.set(
            MANAGED_TERMINAL_RESULT_PATH,
            managedTerminalEnvelope(resultPayload, input),
          );
        }
      }
    }
    async writeFiles(files) { for (const file of files) this.files.set(file.path, Buffer.from(file.content)); }
    async runCommand(command, args, options) {
      const startsRunner = typeof command === 'object'
        || (command === 'node' && args?.[0] === 'stratus-runner.cjs');
      if (startsRunner) {
        if (typeof command === 'object') runnerCalls.push(command);
        if (terminalAfterPolls === 0) this.materializeTerminal();
        return typeof command === 'object'
          ? { exitCode: null }
          : { exitCode: 0, stderr: async () => '' };
      }
      if (Number(options?.timeoutMs) > maxSdkStreamMs) {
        throw new Error('Sandbox stream was closed and is not accepting commands.');
      }
      const timeoutMs = Number(args[2]);
      const wanted = args.slice(3);
      this.polls += 1;
      if (this.polls > terminalAfterPolls) this.materializeTerminal();
      calls.push({
        timeoutMs,
        commandTimeoutMs: Number(options?.timeoutMs),
        signal: options?.signal,
        wanted
      });
      const found = wanted.find((path) => this.files.has(path));
      return found ? { exitCode: 0, stdout: async () => found } : { exitCode: 3, stdout: async () => '' };
    }
    async readFileToBuffer({ path }, options = {}) {
      if (path === 'stratus-result-0.json' && resultReadError) throw resultReadError;
      if (path === 'stratus-screenshot-0.png' && screenshotStall) {
        return new Promise((resolve, reject) => {
          const signal = options.signal;
          if (signal?.aborted) {
            reject(signal.reason);
            return;
          }
          signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
        });
      }
      return this.files.get(path) || null;
    }
    async stop() { this.stopped = true; }
  }
  const sandboxes = [];
  return {
    calls,
    runnerCalls,
    forkCalls,
    sandboxes,
    api: {
      async get({ name }) { return name === template.name ? template : sandboxes.find((entry) => entry.name === name); },
      async fork(options) {
        forkCalls.push(options);
        const sandbox = new Fake(options.name);
        sandboxes.push(sandbox);
        return sandbox;
      }
    }
  };
}

const urlOnly = async (value) => new URL(value);

test('the public-only policy is installed on the sandbox fork before Chromium starts', async () => {
  const fake = silentSandboxApi({
    result: {
      title: 'Application',
      url: 'https://example.com/apply',
      text: 'Ready',
      humanVerification: null,
      continuationOffered: false
    }
  });
  await executeSandboxRun({
    url: 'https://example.com/apply',
    actions: [],
    requestContinuation: true,
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: providerDeadlineAt(),
  }, { sandboxApi: fake.api, urlValidator: urlOnly });

  assert.equal(fake.forkCalls.length, 1);
  assert.deepEqual(fake.forkCalls[0].networkPolicy, PUBLIC_EGRESS_NETWORK_POLICY);
  assert.notEqual(fake.forkCalls[0].networkPolicy, 'allow-all');
});

test('setup delay consumes the original provider deadline and prevents sandbox launch', async () => {
  const realNow = Date.now;
  let now = Date.parse('2026-08-26T12:00:00.000Z');
  let attemptGetCalls = 0;
  let templateGetCalls = 0;
  let forkCalls = 0;
  Date.now = () => now;
  try {
    await assert.rejects(
      executeSandboxRun({
        url: 'https://example.com/apply',
        actions: [],
        allowSubmit: true,
        submissionAttempt: SUBMISSION_ATTEMPT,
        providerDeadlineAt: new Date(now + 13_000).toISOString(),
      }, {
        requestAcceptedAtMs: now,
        urlValidator: urlOnly,
        sandboxApi: {
          async get({ name }) {
            if (name !== CURRENT_SANDBOX_TEMPLATE) {
              attemptGetCalls += 1;
              return null;
            }
            templateGetCalls += 1;
            now += 12_000;
            return { name: CURRENT_SANDBOX_TEMPLATE, currentSnapshotId: 'snapshot' };
          },
          async fork() {
            forkCalls += 1;
            throw new Error('must not fork after the deadline window closes');
          },
        },
      }),
      (error) => error.code === 'PROVIDER_DEADLINE_EXPIRED' && error.status === 408,
    );
  } finally {
    Date.now = realNow;
  }
  assert.equal(attemptGetCalls, 1);
  assert.equal(templateGetCalls, 1);
  assert.equal(forkCalls, 0);
});

test('blocking sandbox commands are provider-killed before the absolute response deadline', async () => {
  const fake = silentSandboxApi({ result: { title: 'Application ready' } });
  const deadline = providerDeadlineAt(20_000);
  const result = await executeSandboxRun({
    url: 'https://example.com/apply',
    actions: [],
    allowSubmit: true,
    screenshot: false,
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: deadline,
  }, {
    urlValidator: urlOnly,
    sandboxApi: fake.api,
  });
  const commandOptions = fake.runnerCalls[0];
  assert.equal(result.title, 'Application ready');
  assert.ok(commandOptions.timeoutMs > 0 && commandOptions.timeoutMs <= 18_000);
  assert.equal(typeof commandOptions.signal?.addEventListener, 'function');
  assert.ok(fake.calls[0].commandTimeoutMs > 0 && fake.calls[0].commandTimeoutMs <= 7_000);
  assert.equal(typeof fake.calls[0].signal?.addEventListener, 'function');
});

test('a submit run that produces nothing is a RUN timeout, on the run\'s own budget', async () => {
  const fake = silentSandboxApi({ maxSdkStreamMs: 7_000 });
  await assert.rejects(
    executeSandboxRun({
      url: 'https://example.com/apply', actions: [], allowSubmit: true,
      submissionAttempt: SUBMISSION_ATTEMPT,
      providerDeadlineAt: providerDeadlineAt(290_000),
    },
      { sandboxApi: fake.api, urlValidator: urlOnly }),
    (error) => {
      // Not CONTINUATION_EXPIRED. The applicant was told her application had hit a continuation
      // problem on a form that has never issued a security code in its life.
      assert.equal(error.code, 'RUN_TIMED_OUT');
      assert.match(error.message, /run timed out before it produced a result/);
      return true;
    }
  );
  // Jump run 3586ce1e used the old one-command 150-second wait and the SDK closed that command's
  // stream at the exact budget boundary. The 270-second phase budget (raised from 240 after
  // Mercari run 09814b03 filled all 23 Workable questions and expired with only the submit left)
  // is split into short command streams inside the caller's 300-second function.
  assert.equal(fake.calls.reduce((total, call) => total + call.timeoutMs, 0), 270_000,
    'phase 0 gets the measured large-form budget: ' + JSON.stringify(fake.calls));
  assert.ok(fake.calls.length > 1, 'the full phase budget must never be one SDK command stream');
  assert.ok(fake.calls.every((call) => call.timeoutMs <= 5_000), JSON.stringify(fake.calls));
  assert.ok(fake.calls.every((call) => call.commandTimeoutMs <= 7_000), JSON.stringify(fake.calls));
  assert.ok(fake.calls.every((call) => (
    JSON.stringify(call.wanted) === JSON.stringify([
      MANAGED_TERMINAL_RESULT_PATH,
      'stratus-result-0.json',
      'stratus-error.json',
    ])
  )));
  assert.equal(fake.runnerCalls[0].detached, true);
  assert.equal(fake.runnerCalls[0].timeoutMs, 270_000);
  assert.equal(typeof fake.runnerCalls[0].signal?.addEventListener, 'function');
});

test('sandbox lifetime leaves cleanup grace even when no continuation was requested', async () => {
  const fake = silentSandboxApi({
    result: {
      title: 'Application',
      url: 'https://example.com/apply',
      text: 'Ready',
      humanVerification: null,
      continuationOffered: false,
    },
  });
  await executeSandboxRun({ url: 'https://example.com/apply', actions: [] }, {
    sandboxApi: fake.api,
    urlValidator: urlOnly,
  });

  assert.equal(fake.forkCalls[0].timeout, 300_000,
    'a 270-second run must retain a separate 30-second result-read and cleanup window');
  assert.equal(fake.sandboxes[0].stopped, true);
});

test('a result written between polling chunks is returned without spending the full run budget', async () => {
  const fake = silentSandboxApi({
    terminalAfterPolls: 2,
    result: {
      title: 'Preview complete',
      url: 'https://example.com/apply',
      text: 'No submit attempted',
      humanVerification: null,
      continuationOffered: false,
    },
  });
  const result = await executeSandboxRun({
    url: 'https://example.com/apply',
    actions: [],
  }, { sandboxApi: fake.api, urlValidator: urlOnly });

  assert.equal(result.title, 'Preview complete');
  assert.equal(fake.calls.length, 3, 'two empty chunks are followed by the terminal result chunk');
  assert.equal(fake.sandboxes[0].stopped, true);
});

test('a result written at the final polling boundary wins over the run timeout', async () => {
  const fake = silentSandboxApi({
    terminalAfterPolls: 54,
    result: {
      title: 'Preview completed at boundary',
      url: 'https://example.com/apply',
      text: 'No submit attempted',
      humanVerification: null,
      continuationOffered: false,
    },
  });
  const result = await executeSandboxRun({
    url: 'https://example.com/apply',
    actions: [],
  }, { sandboxApi: fake.api, urlValidator: urlOnly });

  assert.equal(result.title, 'Preview completed at boundary');
  assert.equal(fake.calls.length, 55);
  assert.equal(fake.calls.at(-1).timeoutMs, 0, 'the final result check must not extend the run budget');
});

test('a continuation timeout keeps its own identity across bounded polling chunks', async () => {
  const calls = [];
  let stopped = false;
  const projectBinding = 'continuation-timeout';
  const continuationAttempt = {
    ...SUBMISSION_ATTEMPT,
    executionId: managedContinuationExecutionId(SUBMISSION_ATTEMPT.claimId, 'security_code'),
  };
  const requestDigest = 'a'.repeat(64);
  const reservation = managedReservation(projectBinding, SUBMISSION_ATTEMPT, requestDigest);
  const initialTerminalInput = {
    submissionAttempt: SUBMISSION_ATTEMPT,
    terminalResultProjectHash: crypto.createHash('sha256').update(projectBinding).digest('hex'),
    terminalResultRequestDigest: requestDigest,
  };
  const initialTerminal = managedTerminalEnvelope({
    title: 'Security code required',
    continuationOffered: true,
    continuationToken: 'c'.repeat(43),
    submissionAttempt: SUBMISSION_ATTEMPT,
  }, initialTerminalInput);
  const files = new Map([
    [MANAGED_SUBMISSION_RESERVATION_PATH, reservation],
    [MANAGED_TERMINAL_RESULT_PATH, initialTerminal],
  ]);
  const sandbox = {
    async runCommand(command, args, options) {
      if (command === 'node' && args?.[1] === CLAIM_CONTINUATION_SCRIPT) {
        files.set(
          MANAGED_CONTINUATION_RESERVATION_PATH,
          managedReservation(projectBinding, continuationAttempt, 'b'.repeat(64)),
        );
        return { exitCode: 0 };
      }
      const timeoutMs = Number(args[2]);
      calls.push({
        timeoutMs,
        commandTimeoutMs: Number(options?.timeoutMs),
        signal: options?.signal,
        wanted: args.slice(3)
      });
      return { exitCode: 3, stdout: async () => '' };
    },
    async writeFiles(batch) {
      for (const file of batch) files.set(file.path, Buffer.from(file.content));
    },
    async readFileToBuffer({ path: filePath }) {
      return files.get(filePath) || null;
    },
    async stop() { stopped = true; },
  };

  await assert.rejects(
    executeSandboxRun({
      continuationToken: 'c'.repeat(43),
      actions: [],
      submissionAttempt: continuationAttempt,
      providerDeadlineAt: providerDeadlineAt(70_000),
    }, {
      sandboxApi: { async get() { return sandbox; } },
      projectBinding,
    }),
    (error) => {
      assert.equal(error.code, 'CONTINUATION_EXPIRED');
      assert.equal(error.status, 410);
      assert.match(error.message, /continuation timed out/);
      return true;
    },
  );
  assert.equal(calls.reduce((total, call) => total + call.timeoutMs, 0), 60_000);
  assert.ok(calls.length > 1);
  assert.ok(calls.every((call) => call.timeoutMs <= 5_000 && call.commandTimeoutMs <= 7_000));
  assert.ok(calls.every((call) => typeof call.signal?.addEventListener === 'function'));
  assert.ok(calls.every((call) => (
    JSON.stringify(call.wanted) === JSON.stringify([
      MANAGED_CONTINUATION_TERMINAL_RESULT_PATH,
      'stratus-error.json',
    ])
  )));
  assert.equal(stopped, false,
    'a response timeout must leave the retained runner free to persist its terminal result');
});

test('a response timeout returns correlated press progress instead of exposing a blind retry', async () => {
  const progress = {
    version: 1,
    phase: 0,
    stage: 'submit_released',
    submitPressed: true,
    applicationSubmitPressed: true,
    verificationSubmitPressed: false,
    submitKind: 'application',
    policyVersion: 4,
  };
  const fake = silentSandboxApi({ progress });
  await assert.rejects(
    executeSandboxRun({
      url: 'https://example.com/apply',
      actions: [],
      allowSubmit: true,
      requestContinuation: true,
      submissionAttempt: SUBMISSION_ATTEMPT,
      providerDeadlineAt: providerDeadlineAt(),
    }, { sandboxApi: fake.api, urlValidator: urlOnly }),
    (error) => {
      assert.equal(error.code, 'RUN_TIMED_OUT');
      assert.deepEqual(error.runProgress, {
        ...progress,
        submissionAttempt: SUBMISSION_ATTEMPT,
      });
      return true;
    },
  );
  assert.equal(fake.sandboxes[0].stopped, false,
    'the lost response must not stop a runner after employer submission');
});

test('durable confirmation survives a lost ordinary result response and precedes screenshot work', async () => {
  const progress = {
    version: 1,
    phase: 0,
    stage: 'result_ready',
    submitPressed: true,
    applicationSubmitPressed: true,
    verificationSubmitPressed: false,
    submitKind: 'application',
    policyVersion: 4,
    employerOutcome: {
      kind: 'confirmed',
      state: 'confirmed',
      source: 'ats_state',
      evidence: '.application-success',
      message: 'Application received',
      formStillPresent: false,
    },
    requiredFieldConfirmationStatus: 'confirmed',
  };
  const fake = silentSandboxApi({
    progress,
    result: {
      title: 'Application received',
      submitOutcome: { pressed: true, state: 'confirmed' },
      continuationOffered: false,
    },
    resultReadError: new Error('provider response stream reset'),
  });
  const result = await executeSandboxRun({
    url: 'https://example.com/apply',
    actions: [],
    allowSubmit: true,
    requestContinuation: true,
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: providerDeadlineAt(),
  }, { sandboxApi: fake.api, urlValidator: urlOnly });
  assert.equal(result.title, 'Application received');
  assert.match(result.terminalResult.resultId, /^[a-f0-9]{64}$/);
  const progressIndex = SANDBOX_RUNNER.indexOf("stage: 'result_ready'");
  const terminalIndex = SANDBOX_RUNNER.indexOf(
    'persistTerminalResult(currentInput, phase, publishedResult)',
    progressIndex,
  );
  const screenshotIndex = SANDBOX_RUNNER.indexOf('if (currentInput.screenshot)', progressIndex);
  assert.ok(progressIndex >= 0 && terminalIndex > progressIndex);
  assert.ok(screenshotIndex > terminalIndex);
});

test('a stalled optional screenshot cannot hide a confirmed provider result', async () => {
  const progress = {
    version: 1,
    phase: 0,
    stage: 'result_ready',
    submitPressed: true,
    applicationSubmitPressed: true,
    verificationSubmitPressed: false,
    submitKind: 'application',
    policyVersion: 4,
    employerOutcome: {
      kind: 'confirmed',
      state: 'confirmed',
      source: 'ats_state',
      evidence: '.application-success',
      message: 'Application received',
      formStillPresent: false,
    },
    requiredFieldConfirmationStatus: 'confirmed',
  };
  const fake = silentSandboxApi({
    progress,
    result: {
      title: 'Application received',
      submitOutcome: { pressed: true, state: 'confirmed' },
      continuationOffered: false,
    },
    screenshotStall: true,
  });
  const result = await executeSandboxRun({
    url: 'https://example.com/apply',
    actions: [],
    allowSubmit: true,
    requestContinuation: true,
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: providerDeadlineAt(),
  }, {
    sandboxApi: fake.api,
    urlValidator: urlOnly,
    optionalArtifactTimeoutMs: 5,
  });
  assert.equal(result.submitOutcome.state, 'confirmed');
  assert.equal(result.screenshot, null);
});

test('the shipped publication block commits terminal success before a throwing screenshot and preserves legacy fallback', async () => {
  const start = SANDBOX_RUNNER.indexOf(
    'if (currentInput.submissionAttempt) assertNoDurableTerminalAuthority();',
  );
  const end = SANDBOX_RUNNER.indexOf(
    'if (phase > 0 || !continuationOffered) break;',
    start,
  );
  assert.ok(start >= 0 && end > start);
  const source = SANDBOX_RUNNER.slice(start, end);
  const events = [];
  const execute = new Function('events', 'Buffer', 'fs', 'durableAuthority', `
    const currentInput = {
      submissionAttempt: { runId: 'run', claimId: 'claim', executionId: 'execution' },
      screenshot: true,
      fullPage: false
    };
    const input = currentInput;
    const phase = 0;
    const continuationOffered = false;
    const resultPayload = { employerOutcome: { kind: 'confirmed' } };
    const activeTerminalAckPath = 'stratus-terminal-result-ack.json';
    const hasDurableSubmissionAuthority = durableAuthority;
    let terminalFailureInput = currentInput;
    const assertNoDurableTerminalAuthority = () => {
      if (hasDurableSubmissionAuthority) events.push('authority');
    };
    const persistTerminalResult = () => { events.push('terminal'); return true; };
    const writeDurableJson = () => events.push('legacy-result');
    const recordCrashProgress = (_patch, options) => events.push(
      options?.persist === false ? 'progress-memory' : 'progress-file'
    );
    const releaseDispatchLock = () => events.push('unlock');
    const page = { screenshot: async () => { events.push('screenshot'); throw new Error('optional'); } };
    return (async () => {
      ${source}
      return { terminalFailureInput };
    })();
  `);
  const state = await execute(
    events,
    Buffer,
    { existsSync: () => false, unlinkSync: () => {} },
    true,
  );
  assert.deepEqual(events, ['authority', 'terminal', 'progress-memory', 'unlock', 'screenshot']);
  assert.equal(state.terminalFailureInput, null);

  const legacyEvents = [];
  const legacyState = await execute(
    legacyEvents,
    Buffer,
    { existsSync: () => false, unlinkSync: () => {} },
    false,
  );
  assert.deepEqual(legacyEvents, ['legacy-result', 'progress-memory', 'unlock', 'screenshot']);
  assert.notEqual(legacyState.terminalFailureInput, null);
});

test('a detached runner that crashes reports the crash, not a timeout', async () => {
  const progress = {
    version: 1,
    phase: 0,
    stage: 'submit_released',
    submitPressed: true,
    applicationSubmitPressed: true,
    verificationSubmitPressed: false,
    submitKind: 'application',
    policyVersion: 4,
    submissionAttempt: SUBMISSION_ATTEMPT,
  };
  const fake = silentSandboxApi({
    crash: 'page.goto: net::ERR_CONNECTION_REFUSED',
    progress,
    terminalAfterPolls: 2,
  });
  await assert.rejects(
    executeSandboxRun({
      url: 'https://example.com/apply', actions: [], allowSubmit: true,
      submissionAttempt: SUBMISSION_ATTEMPT,
      providerDeadlineAt: providerDeadlineAt(),
    },
      { sandboxApi: fake.api, urlValidator: urlOnly }),
    (error) => {
      // Detaching the run took stderr away from the caller, so every crash arrived as "the run took
      // too long" after the full budget - a wrong cause and a slow one.
      assert.equal(error.code, 'SANDBOX_RUN_FAILED');
      assert.match(error.message, /ERR_CONNECTION_REFUSED/);
      assert.deepEqual(error.runProgress, progress);
      return true;
    }
  );
  assert.equal(fake.calls.length, 3, 'a crash written between chunks must end the wait immediately');
});

test('a stale sandbox result cannot cross into a newer execution', async () => {
  const fake = silentSandboxApi({
    result: {
      title: 'Application',
      url: 'https://example.com/apply',
      text: 'Ready',
      humanVerification: null,
      continuationOffered: false,
    },
    resultSubmissionAttempt: {
      ...SUBMISSION_ATTEMPT,
      executionId: '44444444-4444-4444-8444-444444444444',
    },
  });
  await assert.rejects(
    executeSandboxRun({
      url: 'https://example.com/apply',
      actions: [],
      allowSubmit: true,
      requestContinuation: true,
      submissionAttempt: SUBMISSION_ATTEMPT,
      providerDeadlineAt: providerDeadlineAt(),
    }, { sandboxApi: fake.api, urlValidator: urlOnly }),
    (error) => error.code === 'SUBMISSION_ATTEMPT_MISMATCH',
  );
});

test('mismatched crash progress is never returned as retryable evidence', async () => {
  const fake = silentSandboxApi({
    crash: 'page crashed',
    progress: {
      version: 1,
      phase: 0,
      stage: 'phase_started',
      submitPressed: false,
      applicationSubmitPressed: false,
      verificationSubmitPressed: false,
      submitKind: 'application',
      policyVersion: 4,
    },
    progressSubmissionAttempt: {
      ...SUBMISSION_ATTEMPT,
      executionId: '44444444-4444-4444-8444-444444444444',
    },
  });
  await assert.rejects(
    executeSandboxRun({
      url: 'https://example.com/apply',
      actions: [],
      allowSubmit: true,
      requestContinuation: true,
      submissionAttempt: SUBMISSION_ATTEMPT,
      providerDeadlineAt: providerDeadlineAt(),
    }, { sandboxApi: fake.api, urlValidator: urlOnly }),
    (error) => error.code === 'SANDBOX_RUN_FAILED' && !('runProgress' in error),
  );
});

test('malformed crash progress is not returned as submit evidence', async () => {
  const fake = silentSandboxApi({
    crash: 'page crashed',
    progress: {
      version: 1,
      phase: 0,
      stage: 'submit_released',
      submitPressed: 'yes',
      applicationSubmitPressed: true,
      verificationSubmitPressed: false,
      submitKind: 'application',
      policyVersion: 4,
      applicantAnswer: 'must never cross the boundary',
    },
  });
  await assert.rejects(
    executeSandboxRun(
      {
        url: 'https://example.com/apply', actions: [], allowSubmit: true, requestContinuation: true,
        submissionAttempt: SUBMISSION_ATTEMPT,
        providerDeadlineAt: providerDeadlineAt(),
      },
      { sandboxApi: fake.api, urlValidator: urlOnly },
    ),
    (error) => {
      assert.equal(error.code, 'SANDBOX_RUN_FAILED');
      assert.equal('runProgress' in error, false);
      return true;
    },
  );
});

test('contradictory crash progress is discarded at the Stratus boundary', async () => {
  const exactNotAttempted = {
    kind: 'not_attempted',
    state: 'not_attempted',
    source: null,
    evidence: null,
    message: null,
    formStillPresent: null,
  };
  const confirmed = {
    kind: 'confirmed',
    state: 'confirmed',
    source: 'ats_state',
    evidence: '.application-success',
    message: 'Application received',
    formStillPresent: false,
  };
  const pressedUnknown = {
    kind: 'pressed',
    state: 'unknown',
    source: null,
    evidence: null,
    message: null,
    formStillPresent: true,
  };
  const base = {
    version: 1,
    phase: 0,
    stage: 'submit_blocked',
    submitPressed: false,
    applicationSubmitPressed: false,
    verificationSubmitPressed: false,
    submitKind: 'application',
    policyVersion: 4,
  };
  const cases = [
    {
      name: 'confirmation paired with a blocked no-press checkpoint',
      progress: { ...base, employerOutcome: confirmed, requiredFieldConfirmationStatus: 'confirmed' },
    },
    {
      name: 'confirmed required fields paired with no physical press',
      progress: { ...base, requiredFieldConfirmationStatus: 'confirmed' },
    },
    {
      name: 'confirmed employer outcome paired with blocked required fields',
      progress: {
        ...base,
        stage: 'result_ready',
        submitPressed: true,
        applicationSubmitPressed: true,
        employerOutcome: confirmed,
        requiredFieldConfirmationStatus: 'blocked',
      },
    },
    {
      name: 'pressed outcome paired with no aggregate or per-kind press',
      progress: { ...base, employerOutcome: pressedUnknown },
    },
    {
      name: 'aggregate no-press paired with an application press',
      progress: {
        ...base,
        stage: 'submit_released',
        applicationSubmitPressed: true,
        employerOutcome: pressedUnknown,
      },
    },
    {
      name: 'physical press paired with no submit kind',
      progress: {
        ...base,
        stage: 'submit_released',
        submitPressed: true,
        applicationSubmitPressed: true,
        submitKind: null,
      },
    },
    {
      name: 'activation stage paired with the current-kind press already set',
      progress: {
        ...base,
        stage: 'submit_activation_started',
        submitPressed: true,
        applicationSubmitPressed: true,
      },
    },
    {
      name: 'released stage paired with no current-kind press',
      progress: { ...base, stage: 'submit_released', employerOutcome: exactNotAttempted },
    },
    {
      name: 'phase zero paired with a verification submit',
      progress: { ...base, submitKind: 'verification', employerOutcome: exactNotAttempted },
    },
    {
      name: 'accepted security code paired with no verification press',
      progress: {
        ...base,
        phase: 1,
        stage: 'result_ready',
        submitPressed: true,
        applicationSubmitPressed: true,
        submitKind: 'verification',
        employerOutcome: pressedUnknown,
        securityCodeOutcome: 'accepted',
      },
    },
    {
      name: 'no-control security code paired with a verification press',
      progress: {
        ...base,
        phase: 1,
        stage: 'result_ready',
        submitPressed: true,
        verificationSubmitPressed: true,
        submitKind: 'verification',
        employerOutcome: pressedUnknown,
        securityCodeOutcome: 'no_control',
      },
    },
    {
      name: 'accepted security code paired with a rejected employer outcome',
      progress: {
        ...base,
        phase: 1,
        stage: 'result_ready',
        submitPressed: true,
        applicationSubmitPressed: true,
        verificationSubmitPressed: true,
        submitKind: 'verification',
        employerOutcome: {
          kind: 'pressed',
          state: 'rejected',
          source: 'client_validation',
          evidence: 'Code rejected',
          message: 'Code rejected',
          formStillPresent: true,
        },
        securityCodeOutcome: 'accepted',
      },
    },
    {
      name: 'not-attempted outcome carrying employer evidence',
      progress: {
        ...base,
        employerOutcome: { ...exactNotAttempted, source: 'page_text', evidence: 'Not sent' },
      },
    },
  ];

  for (const entry of cases) {
    const fake = silentSandboxApi({ crash: 'page crashed', progress: entry.progress });
    await assert.rejects(
      executeSandboxRun({
        url: 'https://example.com/apply',
        actions: [],
        allowSubmit: true,
        requestContinuation: true,
        submissionAttempt: SUBMISSION_ATTEMPT,
        providerDeadlineAt: providerDeadlineAt(),
      }, { sandboxApi: fake.api, urlValidator: urlOnly }),
      (error) => {
        assert.equal(error.code, 'SANDBOX_RUN_FAILED', entry.name);
        assert.equal('runProgress' in error, false, entry.name);
        return true;
      },
    );
  }
});

test('consistent pre-submit and confirmation progress remains available', async () => {
  const exactNotAttempted = {
    kind: 'not_attempted',
    state: 'not_attempted',
    source: null,
    evidence: null,
    message: null,
    formStillPresent: null,
  };
  const confirmed = {
    kind: 'confirmed',
    state: 'confirmed',
    source: 'ats_route',
    evidence: '/complete',
    message: 'Application received',
    formStillPresent: false,
  };
  const cases = [
    {
      name: 'canonical not-attempted pre-submit checkpoint',
      progress: {
        version: 1,
        phase: 0,
        stage: 'submit_blocked',
        submitPressed: false,
        applicationSubmitPressed: false,
        verificationSubmitPressed: false,
        submitKind: 'application',
        policyVersion: 4,
        employerOutcome: exactNotAttempted,
      },
    },
    {
      name: 'application confirmation checkpoint',
      progress: {
        version: 1,
        phase: 0,
        stage: 'result_ready',
        submitPressed: true,
        applicationSubmitPressed: true,
        verificationSubmitPressed: false,
        submitKind: 'application',
        policyVersion: 4,
        employerOutcome: confirmed,
        requiredFieldConfirmationStatus: 'confirmed',
      },
    },
    {
      name: 'verification confirmation checkpoint',
      progress: {
        version: 1,
        phase: 1,
        stage: 'result_ready',
        submitPressed: true,
        applicationSubmitPressed: true,
        verificationSubmitPressed: true,
        submitKind: 'verification',
        policyVersion: 4,
        employerOutcome: confirmed,
        requiredFieldConfirmationStatus: 'confirmed',
        securityCodeOutcome: 'accepted',
      },
    },
  ];

  for (const entry of cases) {
    const fake = silentSandboxApi({ crash: 'page crashed', progress: entry.progress });
    await assert.rejects(
      executeSandboxRun({
        url: 'https://example.com/apply',
        actions: [],
        allowSubmit: true,
        requestContinuation: true,
        submissionAttempt: SUBMISSION_ATTEMPT,
        providerDeadlineAt: providerDeadlineAt(),
      }, { sandboxApi: fake.api, urlValidator: urlOnly }),
      (error) => {
        assert.equal(error.code, 'SANDBOX_RUN_FAILED', entry.name);
        assert.deepEqual(error.runProgress, {
          ...entry.progress,
          submissionAttempt: SUBMISSION_ATTEMPT,
        }, entry.name);
        return true;
      },
    );
  }
});

test('the runner checkpoints only bounded submit progress around activation and result writes', () => {
  assert.match(SANDBOX_RUNNER, /stage: 'launch',[\s\S]*submitPressed: false,[\s\S]*applicationSubmitPressed: false,[\s\S]*verificationSubmitPressed: false,[\s\S]*submitKind: null,[\s\S]*policyVersion: null/);
  assert.match(SANDBOX_RUNNER, /stage: 'submit_activation_started',[\s\S]*submitKind: action\.submitKind/);
  assert.match(SANDBOX_RUNNER, /finalSubmitPressed = true;\n\s*recordCrashProgress\(\{[\s\S]*stage: 'submit_released',[\s\S]*applicationSubmitPressed: true/);
  assert.match(SANDBOX_RUNNER, /assertNoDurableTerminalAuthority\(\)[\s\S]*persistTerminalResult\(currentInput, phase, publishedResult\)[\s\S]*recordCrashProgress\(\{ phase, stage: 'result_written' \}, \{ persist: false \}\)[\s\S]*if \(currentInput\.screenshot\)/);
  assert.doesNotMatch(SANDBOX_RUNNER, /recordCrashProgress\([^)]*(?:value|text|file|email|phone|name):/i);
});

test('one provider deadline governs launch, continuation, and every physical submit', () => {
  assert.ok(
    SANDBOX_RUNNER.indexOf('applyProviderDeadline(input.providerDeadlineAt)')
      < SANDBOX_RUNNER.indexOf('browser = await chromium.launch'),
  );
  assert.match(SANDBOX_RUNNER, /providerActionDeadlineMs = deadlineMs - providerResponseMarginMs/);
  assert.match(SANDBOX_RUNNER, /providerDeadlineExpired = true;\n\s*if \(browser\) void browser\.close/);
  assert.match(SANDBOX_RUNNER, /applyProviderDeadline\(currentInput\.providerDeadlineAt\);\n\s*assertProviderActionWindow/);
  assert.match(
    SANDBOX_RUNNER,
    // An exact-mutation transport authorization may sit inside the same critical section between
    // the window check and the network watch. The ordering is what this pins, not adjacency.
    /assertProviderActionWindow\(providerMinimumSubmitWindowMs\);\n(?:\s*(?:if \(chooserVersion !== 4\) )?authorizeManagedFinalTransport\(currentInput, action\);\n)?\s*armSubmitNetworkWatch\(\);\n\s*recordCrashProgress/,
  );
  assert.match(
    SANDBOX_RUNNER,
    /if \(action\.securityCode && isFinalSubmitAction\(action\)\)[\s\S]*assertProviderActionWindow\(providerMinimumSubmitWindowMs\);\n\s*await locator\.click/,
  );
});

test('the runner decides whether a continuation is held open, not the caller\'s text sweep', async () => {
  // An employer's own post-submit confirmation says "check your email", which is exactly what the
  // caller's regex reads as a security-code challenge. The runner saw the page and said no.
  const fake = silentSandboxApi({
    result: {
      title: 'Skydio',
      url: 'https://jobs.ashbyhq.com/skydio/x/application',
      text: 'Success. Thank you for submitting your application. Please check your email for a confirmation code.',
      humanVerification: null,
      continuationOffered: false,
      submitOutcome: { pressed: true, state: 'confirmed', source: 'ats_state', evidence: '.ashby-application-form-success-container' }
    }
  });
  const result = await executeSandboxRun({
    url: 'https://example.com/apply', actions: [], allowSubmit: true, requestContinuation: true,
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: providerDeadlineAt(),
  },
    { sandboxApi: fake.api, urlValidator: urlOnly });
  assert.equal('continuationToken' in result, false, 'no challenge means no continuation to offer');
  assert.equal(fake.sandboxes[0].stopped, true, 'and the sandbox is released rather than left idling');
  assert.equal(result.submitOutcome.state, 'confirmed');
});

test('only a phase-zero pressed unknown outcome adds the short receipt observation capability', () => {
  assert.match(SANDBOX_RUNNER, /const pressedUnknown = phase === 0\s*&& submitOutcome\.pressed === true\s*&& submitOutcome\.state === 'unknown'/s);
  assert.match(
    SANDBOX_RUNNER,
    /continuationOffered = input\.requestContinuation === true\s*&& \(Boolean\(humanVerification\) \|\| input\.continuationCheckpoint === true \|\| pressedUnknown\)/s,
  );
  assert.match(SANDBOX_RUNNER, /receiptObservationOnly\s*\? 15\s*: Math\.max/s);
  assert.match(SANDBOX_RUNNER, /if \(phase > 0 \|\| !continuationOffered\) break;/);
});

test('the runner reads the submit outcome off the page and reports it', () => {
  // Ashby's published state hooks, read out of the live Skydio posting's own bundle on 2026-08-09.
  // Keying on the container rather than the sentence is the point: the sentence is the employer's
  // own applicationSubmittedSuccessMessage and differs per org, the container does not.
  assert.match(SANDBOX_RUNNER, /ashby-application-form-success-container/);
  assert.match(SANDBOX_RUNNER, /ashby-application-form-failure-container/);
  // The failure container is checked FIRST. A page that rendered both would otherwise be read as a
  // submitted application.
  assert.ok(
    SANDBOX_RUNNER.indexOf('for (const selector of REJECTED_CONTAINERS)') < SANDBOX_RUNNER.indexOf('for (const selector of CONFIRMED_CONTAINERS)'),
    'a refusal must outrank a confirmation'
  );
  // Only on a run that pressed the button, and the press is recorded before the wait that can lose
  // it. "Was it pressed" is the fact the applicant's next move depends on.
  assert.match(
    SANDBOX_RUNNER,
    /if \(isFinalSubmitAction\(action\)\) \{\n\s*finalSubmitPressed = true;\n\s*recordCrashProgress\(\{[\s\S]*stage: 'submit_released',[\s\S]*submitPressed: true,[\s\S]*applicationSubmitPressed: true[\s\S]*\}\);\n\s*\}/,
  );
  assert.match(SANDBOX_RUNNER, /const submitOutcome = finalSubmitPressed/);
  // Body text alone cannot confirm anything while the form is still sitting there filled.
  assert.match(SANDBOX_RUNNER, /if \(!formStillPresent && CONFIRMED_TEXT\.test\(body\)\)/);
});

test('a tel field verifies on digits, so its own formatting is not a lost answer', () => {
  /* normalized() replaces each non-alphanumeric RUN with a SPACE rather than with nothing, so a
   * reformatted number never equalled the number written:
   *
   *   wrote  "2135746270"      -> normalized "2135746270"
   *   holds  "(213) 574-6270"  -> normalized "213 574 6270"
   *
   * Measured 2026-08-18 from the read-back this runner records on a lost fill. Five Rings, Akuna,
   * Tower Research, Jump Trading and IMC every one reported phone as lost with those two exact
   * strings, on forms where the value had landed and a person would see it on the page. */
  assert.match(SANDBOX_RUNNER, /state\.type === 'tel'/);
  assert.match(SANDBOX_RUNNER, /candidateDigits === expectedDigits/);
  // The control's own type has to travel with the reading for that arm to be reachable at all.
  assert.match(SANDBOX_RUNNER, /type: element instanceof HTMLInputElement \? String\(element\.type \|\| ''\) : ''/);
  // Fails closed outside that class: a letter on either side, or an empty side, judges as before.
  assert.match(SANDBOX_RUNNER, /const noLetters = \(value\) => !\/\[a-z\]\/i\.test/);
  // And the read-back that made the diagnosis possible stays.
  assert.match(SANDBOX_RUNNER, /field holds "/);
});

/* THE PAGE AFTER SEND IS THE ONLY PROOF, AND THE PLAIN SUBMIT CLICK NOW STAYS TO READ IT.
 *
 * Measured live on the Max Borges Workable form (2026-08-19): Send was pressed, the application
 * was really sent, and the confirmation renders as a client-side transition AFTER the submit XHR -
 * so networkidle resolved, the action loop ended, and the run's final text and screenshot were
 * taken in the gap before the thank-you rendered. The backend's receipt reader then reported the
 * run "never showed a confirmation it could read" for an application that was at the employer.
 * The atomic confirmAndSubmit path has waited out this window since it existed
 * (waitForPostSubmitApplicationState: up to 30s on the same page, returning on the first
 * confirmed, rejected or code-challenge read); the plain final-submit click is the path Workable
 * runs take, and it was the one that never waited. The replay suites prove the watch's behaviour
 * in a real browser; this pins that the plain click path actually enters it. */
test('a plain final submit stays and watches the page the way the atomic path does', () => {
  assert.match(
    SANDBOX_RUNNER,
    /if \(isFinalSubmitAction\(action\) && !action\.securityCode\) \{\n\s+await waitForPostSubmitApplicationState\(\);\n\s+\}/,
    'the final click must wait for the first readable post-submit state before the snapshot is taken'
  );
  // And the snapshot the caller stores is taken after the action loop, which is what makes the
  // watch above sufficient: the first readable state is what the text and screenshot capture.
  assert.ok(
    SANDBOX_RUNNER.indexOf('await waitForPostSubmitApplicationState();') <
    SANDBOX_RUNNER.indexOf('const text = await observeForResult('),
    'the post-submit watch runs before the final page-text snapshot'
  );
});

test('a phone field that does not say type="tel" still verifies on digits', () => {
  /* PR #65 keyed the digit comparison on the control's declared type, and two days later the same
   * defect reopened one board over: the live Rippling apply form (ats.rippling.com, Easy Dynamics,
   * 2026-08-20) renders its phone control as type="text" with inputmode="tel",
   * data-input="phone_number" and placeholder "Phone number", so the arm was unreachable and the
   * run reported 'value did not persist after fill (wrote "2135746270", field holds
   * "213-574-6270")' over ten identical digits. The employer's own per-control markup now travels
   * with the reading; tel-persistence-dom.test.js runs the arm against that exact element. */
  assert.match(SANDBOX_RUNNER, /if \(state\.telShaped\) \{/);
  assert.match(SANDBOX_RUNNER, /telShaped: element instanceof HTMLInputElement && \(/);
  // Each signal is the employer's own markup naming this one control a phone field.
  assert.match(SANDBOX_RUNNER, /getAttribute\('inputmode'\) \|\| ''\)\.toLowerCase\(\) === 'tel'/);
  assert.match(SANDBOX_RUNNER, /getAttribute\('autocomplete'\)/);
  // "telephone" spelt out is the most common long form; \btel\b alone cannot match it.
  assert.match(SANDBOX_RUNNER, /\(\?:\\b\|_\)\(\?:phone\|mobile\|telephone\|tel\)\(\?:\\b\|_\)/);
  // The inferred arm carries the bound the declared one does not: seven digits on both sides.
  assert.match(SANDBOX_RUNNER, /candidateDigits\.length >= 7 && expectedDigits\.length >= 7/);
});

test('discovery scans combobox openers that are not form tags', () => {
  /* Measured live on ats.rippling.com (Easy Dynamics, 2026-08-20): the required
   * work-authorization control is '<div id="field-63" role="combobox" aria-haspopup="listbox"
   * aria-label="Select" aria-required="true">' with no input anywhere inside it. The readiness
   * gate has always scanned [role="combobox"], so it reported a required control named "Select"
   * while discovery - which scanned form TAGS only - emitted nothing for it: no question record,
   * nothing the applicant could ever answer in Litos. */
  assert.match(SANDBOX_RUNNER, /\[role="combobox"\]:not\(input\):not\(select\):not\(textarea\),/);
  assert.match(SANDBOX_RUNNER, /\[aria-haspopup="listbox"\]:not\(input\):not\(select\):not\(textarea\)/);
  // A non-form-tag opener that holds a real control inside it is a wrapper, and the inner control
  // is already the candidate; scanning both would mint two questions for one control. Hidden and
  // aria-hidden backing controls do not count as real (Chosen nests its 1x1 select INSIDE the
  // shell), page chrome is out (a header language switcher is a listbox opener too), and of
  // nested openers only the innermost is scanned.
  assert.match(SANDBOX_RUNNER, /const bareOpener = choiceOpener && !\/\^\(\?:INPUT\|SELECT\|TEXTAREA\)\$\/\.test\(el\.tagName\);/);
  assert.match(SANDBOX_RUNNER, /if \(bareOpener && el\.closest\('header, footer, nav, \[role="navigation"\], \[role="banner"\], \[role="contentinfo"\]'\)\) return false;/);
  assert.match(SANDBOX_RUNNER, /'input:not\(\[type="hidden"\]\):not\(\[aria-hidden="true"\]\), textarea, select:not\(\[aria-hidden="true"\]\)'/);
  assert.match(SANDBOX_RUNNER, /if \(bareOpener && el\.querySelector\('\[role="combobox"\], \[aria-haspopup="listbox"\]'\)\) return false;/);
});

test('the required marker is stripped from the wanted label before matching', () => {
  /* Lever welds its required mark to the heading with no space while the stored question carries
   * it with one; the whole-string and containment matches both failed on that byte and every
   * reviewed radio on the live DGA form was silently skipped (measured 2026-08-20, proven in a live
   * Chromium check: 0 matches unstripped, 1 stripped).
   *
   * The mark Lever actually serves is U+2731 (HEAVY ASTERISK). The 2026-08-20 fix, and this pin
   * with it, transcribed it as U+2733 (EIGHT SPOKED ASTERISK), so the strip never fired on a live
   * Lever heading: measured 2026-09-04 on Belvedere Trading's "Name of School\u2731" heading
   * (application c4413bff), "fillByLabelText: label not found" on every run. Both codepoints are
   * now stripped, with U+2732 between them, on the wanted side and allowed on the page side at
   * BOTH label matchers - fillByLabelText's and exactFillByBinding's - so the two cannot disagree
   * about what a heading is called. The executed proof against real Select2 4.0.0 is in
   * lever-select2-v4-card-confirm-dom.test.js. */
  assert.match(SANDBOX_RUNNER, /const wantedLabel = clean\(action\.text\)\.replace\(\/\[\\s\\u2731\\u2732\\u2733\*\]\+\$\/, ''\);/);
  assert.match(SANDBOX_RUNNER, /const wanted = cleanText\(input\.wanted\)\.replace\(\/\[\\s\\u2731\\u2732\\u2733\*\]\+\$\/, ''\);/);
  // The page-side allowance is built from a string literal, so the runner text carries '\\s'.
  assert.equal((SANDBOX_RUNNER.match(/\\\\s\*\[\*:\\u2731\\u2732\\u2733\]\?\\\\s\*\$/g) || []).length, 2,
    'both whole-label regexes allow the same required marks on the page side');
  assert.doesNotMatch(SANDBOX_RUNNER, /\[\\s\\u2733\*\]\+\$/, 'no matcher strips the spoked asterisk alone any more');
  assert.match(SANDBOX_RUNNER, /getByText\(wantedLabel \|\| action\.text, \{ exact: false \}\)/);
});

test('the furniture-label vocabulary is one vocabulary in both passes', () => {
  /* FURNITURE_LABEL (readiness gate) and WIDGET_FURNITURE (discovery) are the same judgement
   * made in two evaluated sandboxes that cannot share a binding. A word added to one and not
   * the other makes the blocker and the stored question disagree about the same control, the
   * exact defect class this file has already measured in production. This pin turns that
   * silent drift into a red test. */
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  const literals = [...source.matchAll(/(?:FURNITURE_LABEL|WIDGET_FURNITURE|BARE_OPENER_FURNITURE) = (\/[^\n]+\/i);/g)].map((m) => m[1]);
  assert.equal(literals.length, 4, 'all four furniture vocabularies must exist');
  for (const literal of literals.slice(1)) {
    assert.equal(literal, literals[0], 'a furniture vocabulary drifted apart');
  }
});


test('a field-scoped Enter press is a select commit, not a final employer action', () => {
  const policy = submissionReleasePolicy({});
  // Field-scoped Enter (carries a selector) commits a dropdown/typeahead selection during a fill.
  // It selects an option, it does not submit the form, so it must be allowed without allowSubmit -
  // this is the fill of every form with a select control, which used to fail closed.
  assert.doesNotThrow(() => assertSubmissionReleaseAllowed({
    actions: [
      { type: 'fill', selector: '#name', value: 'Mehek', label: 'legal_name' },
      { type: 'press', selector: '#location', value: 'Enter', label: 'location_select' },
    ],
  }, policy));
  // A bare Enter with no selector can trigger native form submission, so it stays authority-gated.
  assert.throws(() => assertSubmissionReleaseAllowed({
    actions: [{ type: 'press', value: 'Enter', label: 'bare_enter' }],
  }, policy), /allowSubmit to be literal true/);
  // The authorized submit action still requires literal allowSubmit.
  assert.throws(() => assertSubmissionReleaseAllowed({
    actions: [{ type: 'confirmAndSubmit', selector: '#s', label: 'required_field_confirmation' }],
  }, policy), /allowSubmit to be literal true/);
  assert.doesNotThrow(() => assertSubmissionReleaseAllowed({
    actions: [{ type: 'confirmAndSubmit', selector: '#s', label: 'required_field_confirmation' }],
    allowSubmit: true,
  }, policy));
});
