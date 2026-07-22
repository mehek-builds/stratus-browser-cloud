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

test('production managed API fails closed when its private key is absent', () => {
  const { output, response } = responseRecorder();
  assert.equal(authorize({ headers: {} }, response, { VERCEL_ENV: 'production' }), false);
  assert.equal(output.statusCode, 503);
  assert.equal(output.body.error.code, 'AUTH_NOT_CONFIGURED');
});

test('managed API accepts the exact configured key and rejects other values', () => {
  const accepted = responseRecorder();
  assert.equal(authorize({ headers: { 'x-stratus-api-key': 'correct' } }, accepted.response, { VERCEL_ENV: 'production', STRATUS_API_KEY: 'correct' }), true);
  const rejected = responseRecorder();
  assert.equal(authorize({ headers: { 'x-stratus-api-key': 'wrong' } }, rejected.response, { VERCEL_ENV: 'production', STRATUS_API_KEY: 'correct' }), false);
  assert.equal(rejected.output.statusCode, 401);
});
