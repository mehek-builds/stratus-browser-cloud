import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import acknowledgeHandler, {
  acknowledgeManagedRunResult,
  submissionAttemptFromAcknowledgementBody,
} from '../api/run-results-acknowledge.js';
import lookupHandler, {
  lookupManagedRunResult,
  submissionAttemptFromRunResultQuery,
} from '../api/run-results.js';

const ATTEMPT = Object.freeze({
  runId: '11111111-1111-4111-8111-111111111111',
  claimId: '22222222-2222-4222-8222-222222222222',
  executionId: '33333333-3333-4333-8333-333333333333',
});

function responseRecorder() {
  const output = { statusCode: 200, body: null, headers: {} };
  return {
    output,
    response: {
      setHeader(name, value) { output.headers[name] = value; },
      status(code) { output.statusCode = code; return this; },
      json(body) { output.body = body; return this; },
    },
  };
}

test('run result lookup accepts only the exact attempt tuple', () => {
  assert.deepEqual(submissionAttemptFromRunResultQuery(ATTEMPT), ATTEMPT);
  for (const invalid of [
    {},
    { ...ATTEMPT, extra: 'value' },
    { ...ATTEMPT, runId: [ATTEMPT.runId] },
  ]) {
    assert.throws(
      () => submissionAttemptFromRunResultQuery(invalid),
      (error) => error.code === 'INVALID_RUN_RESULT_REQUEST' && error.status === 400,
    );
  }
});

test('run result lookup preserves pending and terminal response envelopes', async () => {
  let seen;
  const pending = {
    state: 'pending',
    submissionAttempt: ATTEMPT,
    expiresAt: '2026-09-30T00:00:00.000Z',
  };
  const result = await lookupManagedRunResult(ATTEMPT, {
    projectBinding: 'project-binding',
    requestAcceptedAtMs: 1234,
    retrieve: async (input, options) => {
      seen = { input, options };
      return pending;
    },
  });
  assert.equal(result, pending);
  assert.deepEqual(seen, {
    input: { submissionAttempt: ATTEMPT },
    options: { projectBinding: 'project-binding', requestAcceptedAtMs: 1234 },
  });
});

test('acknowledgement requires the exact immutable result identifier and returns cleanup state', async () => {
  const resultId = 'a'.repeat(64);
  assert.deepEqual(
    submissionAttemptFromAcknowledgementBody({ submissionAttempt: ATTEMPT, resultId }),
    { submissionAttempt: ATTEMPT, resultId },
  );
  assert.throws(
    () => submissionAttemptFromAcknowledgementBody({ submissionAttempt: ATTEMPT }),
    (error) => error.code === 'INVALID_RUN_RESULT_ACKNOWLEDGEMENT' && error.status === 400,
  );

  const acknowledgedAt = '2026-08-31T00:00:00.000Z';
  const result = await acknowledgeManagedRunResult({ submissionAttempt: ATTEMPT, resultId }, {
    projectBinding: 'project-binding',
    requestAcceptedAtMs: 1234,
    acknowledge: async (input, options) => {
      assert.deepEqual(input, { submissionAttempt: ATTEMPT, resultId });
      assert.deepEqual(options, { projectBinding: 'project-binding', requestAcceptedAtMs: 1234 });
      return {
        submissionAttempt: ATTEMPT,
        resultId,
        acknowledgedAt,
        cleanupState: 'completed',
      };
    },
  });
  assert.deepEqual(result, {
    acknowledged: true,
    submissionAttempt: ATTEMPT,
    resultId,
    acknowledgedAt,
    cleanupState: 'completed',
  });
});

test('both terminal result endpoints authenticate before touching retained state', async () => {
  const previous = {
    VERCEL_ENV: process.env.VERCEL_ENV,
    STRATUS_API_KEY: process.env.STRATUS_API_KEY,
  };
  process.env.VERCEL_ENV = 'production';
  process.env.STRATUS_API_KEY = 'required-secret';
  try {
    const lookup = responseRecorder();
    await lookupHandler({ method: 'GET', headers: {}, query: ATTEMPT }, lookup.response);
    assert.equal(lookup.output.statusCode, 401);
    assert.equal(lookup.output.body.error.code, 'UNAUTHORIZED');

    const acknowledgement = responseRecorder();
    await acknowledgeHandler({
      method: 'POST',
      headers: {},
      body: { submissionAttempt: ATTEMPT },
    }, acknowledgement.response);
    assert.equal(acknowledgement.output.statusCode, 401);
    assert.equal(acknowledgement.output.body.error.code, 'UNAUTHORIZED');
  } finally {
    if (previous.VERCEL_ENV == null) delete process.env.VERCEL_ENV;
    else process.env.VERCEL_ENV = previous.VERCEL_ENV;
    if (previous.STRATUS_API_KEY == null) delete process.env.STRATUS_API_KEY;
    else process.env.STRATUS_API_KEY = previous.STRATUS_API_KEY;
  }
});

test('Vercel routes the nested acknowledgement path to its flat serverless function', () => {
  const config = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  assert.deepEqual(config.routes[0], {
    src: '/api/run-results/acknowledge',
    dest: '/api/run-results-acknowledge.js',
  });
});
