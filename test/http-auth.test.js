import test from 'node:test';
import assert from 'node:assert/strict';
import { authorize } from '../api/_http.js';

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
