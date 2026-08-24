import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize, privateErrorDiagnostic, sendError } from '../api/_http.js';

function responseRecorder() {
  const output = { statusCode: 200, body: null };
  return {
    output,
    response: {
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

test('private crash diagnostics redact applicant contact data and opaque tokens', () => {
  const diagnostic = privateErrorDiagnostic(Object.assign(
    new TypeError('Failed for mehek@example.com at https://apply.example/job?token=secret with +1 (213) 574-6270 and abcdefghijklmnopqrstuvwxyz012345'),
    { code: 'SANDBOX_RUN_FAILED' },
  ));
  assert.equal(diagnostic.name, 'TypeError');
  assert.equal(diagnostic.message, 'Failed for [email] at [url] with [phone] and [token]');
  assert.match(diagnostic.fingerprint, /^[a-f0-9]{16}$/);
});
