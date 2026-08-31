import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, privateErrorDiagnostic, sendError } from '../api/_http.js';
import healthHandler, { managedHealthPayload } from '../api/health.js';
import { managedRunProgressLogSummary } from '../api/run.js';

function responseRecorder() {
  const output = { statusCode: 200, body: null };
  return {
    output,
    response: {
      setHeader() { return this; },
      status(code) { output.statusCode = code; return this; },
      json(body) { output.body = body; return this; }
    }
  };
}

test('production managed API fails closed when no Vercel identity is supplied', async () => {
  const { output, response } = responseRecorder();
  assert.equal(await authorize({ headers: {} }, response, { VERCEL_ENV: 'production' }), false);
  assert.equal(output.statusCode, 401);
  assert.equal(output.body.error.code, 'UNAUTHORIZED');
});

test('managed API accepts the exact configured key and rejects other values', async () => {
  const accepted = responseRecorder();
  assert.equal(await authorize({ headers: { 'x-stratus-api-key': 'correct' } }, accepted.response, { VERCEL_ENV: 'production', STRATUS_API_KEY: 'correct' }), true);
  const rejected = responseRecorder();
  assert.equal(await authorize({ headers: { 'x-stratus-api-key': 'wrong' } }, rejected.response, { VERCEL_ENV: 'production', STRATUS_API_KEY: 'correct' }), false);
  assert.equal(rejected.output.statusCode, 401);
});

test('managed API accepts a verified short-lived Litos Vercel identity', async () => {
  const { response } = responseRecorder();
  let tokenSeen;
  let subjectSeen;
  const verified = await authorize(
    { headers: { authorization: 'Bearer signed-oidc-token' } },
    response,
    { VERCEL_ENV: 'production' },
    async (token, subject) => { tokenSeen = token; subjectSeen = subject; },
  );
  assert.equal(verified, true);
  assert.equal(tokenSeen, 'signed-oidc-token');
  assert.equal(subjectSeen, 'owner:mehek-builds-projects:project:student-outreach-backend:environment:production');
});

test('preview fails closed unless exact Litos development OIDC is explicitly enabled', async () => {
  const disabled = responseRecorder();
  let verifyCalls = 0;
  assert.equal(await authorize(
    { headers: { authorization: 'Bearer signed-oidc-token' } },
    disabled.response,
    { VERCEL_ENV: 'preview' },
    async () => { verifyCalls += 1; },
  ), false);
  assert.equal(verifyCalls, 0);
  assert.equal(disabled.output.statusCode, 401);

  const enabled = responseRecorder();
  let subjectSeen;
  assert.equal(await authorize(
    { headers: { authorization: 'Bearer signed-oidc-token' } },
    enabled.response,
    { VERCEL_ENV: 'preview', STRATUS_ALLOW_LITOS_DEVELOPMENT_OIDC: '1' },
    async (_token, subject) => { subjectSeen = subject; },
  ), true);
  assert.equal(subjectSeen, 'owner:mehek-builds-projects:project:student-outreach-backend:environment:development');
});

test('production never widens to the development subject', async () => {
  const { response } = responseRecorder();
  let subjectSeen;
  assert.equal(await authorize(
    { headers: { authorization: 'Bearer signed-oidc-token' } },
    response,
    { VERCEL_ENV: 'production', STRATUS_ALLOW_LITOS_DEVELOPMENT_OIDC: '1' },
    async (_token, subject) => { subjectSeen = subject; },
  ), true);
  assert.equal(subjectSeen, 'owner:mehek-builds-projects:project:student-outreach-backend:environment:production');
});

test('managed crash responses expose only the validated bounded run progress', () => {
  const { output, response } = responseRecorder();
  const runProgress = {
    version: 1,
    phase: 0,
    stage: 'submit_released',
    submitPressed: true,
    applicationSubmitPressed: true,
    verificationSubmitPressed: false,
    submitKind: 'application',
    policyVersion: 4,
  };
  sendError(response, Object.assign(new Error('Sandbox browser run failed'), {
    status: 502,
    code: 'SANDBOX_RUN_FAILED',
    runProgress,
  }));
  assert.equal(output.statusCode, 502);
  assert.deepEqual(output.body.error, {
    code: 'SANDBOX_RUN_FAILED',
    message: 'Sandbox browser run failed',
    runProgress,
  });
});

test('managed progress logs omit employer text, evidence, and attempt identifiers', () => {
  const summary = managedRunProgressLogSummary({
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
      source: 'page_text',
      evidence: 'mehek@example.com',
      message: 'Application received for Mehek Mandal',
      formStillPresent: false,
    },
    submissionAttempt: {
      runId: '11111111-1111-4111-8111-111111111111',
      claimId: '22222222-2222-4222-8222-222222222222',
      executionId: '33333333-3333-4333-8333-333333333333',
    },
  });
  assert.deepEqual(summary, {
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
      source: 'page_text',
      formStillPresent: false,
    },
  });
  assert.doesNotMatch(JSON.stringify(summary), /Mehek|example\.com|11111111/);
});

test('public health reports the live submission release gates without exposing environment values', () => {
  const providerSha = 'a'.repeat(40);
  const defaultPolicy = managedHealthPayload({
    STRATUS_API_KEY: 'secret-api-key',
    VERCEL_GIT_COMMIT_SHA: providerSha,
  });
  assert.equal(defaultPolicy.ok, true);
  assert.equal(defaultPolicy.submissionQuiesced, false);
  assert.equal(defaultPolicy.submissionCorrelationRequired, true);
  assert.equal(defaultPolicy.authenticationMode, 'api-key-or-vercel-oidc');
  assert.equal(defaultPolicy.commit, providerSha);
  assert.equal(defaultPolicy.declaredCommit, null);
  assert.equal(defaultPolicy.providerCommit, providerSha);
  assert.equal(defaultPolicy.revisionStatus, 'verified');
  assert.doesNotMatch(JSON.stringify(defaultPolicy), /secret-api-key/);

  const sharedSha = 'b'.repeat(40);
  const explicitBuildCommit = managedHealthPayload({
    GIT_SHA: sharedSha.toUpperCase(),
    VERCEL_GIT_COMMIT_SHA: sharedSha,
  });
  assert.equal(explicitBuildCommit.ok, true);
  assert.equal(explicitBuildCommit.commit, sharedSha);
  assert.equal(explicitBuildCommit.declaredCommit, sharedSha);
  assert.equal(explicitBuildCommit.providerCommit, sharedSha);

  const mismatch = managedHealthPayload({
    GIT_SHA: 'c'.repeat(40),
    VERCEL_GIT_COMMIT_SHA: 'd'.repeat(40),
  });
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.commit, null);
  assert.equal(mismatch.declaredCommit, 'c'.repeat(40));
  assert.equal(mismatch.providerCommit, 'd'.repeat(40));
  assert.equal(mismatch.revisionStatus, 'mismatch');

  const malformed = managedHealthPayload({ GIT_SHA: 'not-a-commit' });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.commit, null);
  assert.equal(malformed.declaredCommit, null);
  assert.equal(malformed.declaredCommitValid, false);
  assert.equal(malformed.revisionStatus, 'invalid');

  const rolloutPolicy = managedHealthPayload({
    STRATUS_SUBMISSION_CORRELATION_MODE: 'compat',
    STRATUS_SUBMISSION_QUIESCED: '1',
    GIT_SHA: sharedSha,
  });
  assert.equal(rolloutPolicy.submissionQuiesced, true);
  assert.equal(rolloutPolicy.submissionCorrelationRequired, false);
});

test('public health fails closed when declared and provider revisions conflict', () => {
  const previousDeclared = process.env.GIT_SHA;
  const previousProvider = process.env.VERCEL_GIT_COMMIT_SHA;
  try {
    process.env.GIT_SHA = 'e'.repeat(40);
    process.env.VERCEL_GIT_COMMIT_SHA = 'f'.repeat(40);
    const { output, response } = responseRecorder();
    healthHandler({ method: 'GET' }, response);
    assert.equal(output.statusCode, 503);
    assert.equal(output.body.ok, false);
    assert.equal(output.body.commit, null);
    assert.equal(output.body.declaredCommit, 'e'.repeat(40));
    assert.equal(output.body.providerCommit, 'f'.repeat(40));
    assert.equal(output.body.revisionStatus, 'mismatch');
  } finally {
    if (previousDeclared == null) delete process.env.GIT_SHA;
    else process.env.GIT_SHA = previousDeclared;
    if (previousProvider == null) delete process.env.VERCEL_GIT_COMMIT_SHA;
    else process.env.VERCEL_GIT_COMMIT_SHA = previousProvider;
  }
});

test('private crash diagnostics redact applicant contact data and opaque tokens', () => {
  const diagnostic = privateErrorDiagnostic(Object.assign(
    new TypeError('Failed for mehek@example.com at https://apply.example/job?token=secret with +1 (213) 574-6270 and abcdefghijklmnopqrstuvwxyz012345'),
    { code: 'SANDBOX_RUN_FAILED' },
  ));
  assert.equal(diagnostic.name, 'TypeError');
  assert.equal(diagnostic.message, 'Failed for [email] at [url] with [phone] and [token]');
  assert.match(diagnostic.fingerprint, /^[a-f0-9]{16}$/);
});
