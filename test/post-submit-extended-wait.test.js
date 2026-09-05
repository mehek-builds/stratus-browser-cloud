/* THE 30-SECOND POST-SUBMIT WINDOW EXTENDS, BOUNDED, WHEN THE PAGE IS STILL DEMONSTRABLY WAITING
 * ON THE EMPLOYER.
 *
 * Measured on the real incident this closes: Pony.ai on Workable, run a7876200, 2026-09-05 13:36Z.
 * The full 30-second waitForPostSubmitApplicationState window elapsed with the submit button still
 * disabled and reading "Submitting…" (readSubmitOutcome's pending: true), and the run gave up even
 * though MANAGED_RUN_TIMEOUT_MS (270s) still had slack. These tests run the REAL function extracted
 * from SANDBOX_RUNNER (never copied) against a fake clock and a scripted readSubmitOutcome, so they
 * pin control flow, not prose.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* Extracts the arrow function expression assigned to waitForPostSubmitApplicationState, from its
 * `async (` up to and including the matching closing brace, so it can be reconstructed as a
 * standalone function under test with every free variable it reads from its enclosing scope
 * (page, readSecurityCodeChallenge, readSubmitOutcome, submitNetwork, startedAt,
 * providerActionDeadlineMs, input) supplied as an explicit parameter instead. */
function extractWaitForPostSubmitApplicationState() {
  const constMarker = 'const waitForPostSubmitApplicationState = ';
  const constStart = SANDBOX_RUNNER.indexOf(constMarker);
  assert.notEqual(constStart, -1, 'waitForPostSubmitApplicationState must still be defined as a const');
  assert.equal(
    SANDBOX_RUNNER.indexOf(constMarker, constStart + 1),
    -1,
    'the const marker must be unique or the slice below may cut the wrong occurrence',
  );
  const exprStart = constStart + constMarker.length;
  const endMarker = '\n    };\n';
  const endIdx = SANDBOX_RUNNER.indexOf(endMarker, exprStart);
  assert.notEqual(endIdx, -1, 'the function body must still close with a bare "};" at its own indent');
  return SANDBOX_RUNNER.slice(exprStart, endIdx + '\n    }'.length);
}

/* Builds a runnable copy of the function against fully scripted dependencies and a fake clock:
 * Date.now() is monkeypatched globally (this function reads it directly, not as a parameter, the
 * same way the shipped code does) and page.waitForTimeout advances that same fake clock instead of
 * actually sleeping, so a function that targets up to two minutes of wall-clock time runs in this
 * test in microseconds. */
function buildHarness({
  postSubmitSettleMs = 500,
  // Always relative to the harness's own fake clock, never the real Date.now: a fixed offset from
  // real wall-clock time would make these tests' margins drift with whatever day they happen to
  // run on.
  providerActionDeadlineMs = (now) => now + 10_000_000,
  startedAtOffsetMs = 0,
  readSubmitOutcomeSequence,
  submitNetworkRef = { current: null },
} = {}) {
  const exprSource = extractWaitForPostSubmitApplicationState();
  // eslint-disable-next-line no-new-func
  const factory = new Function(
    'page', 'readSecurityCodeChallenge', 'readSubmitOutcome', 'submitNetwork',
    'startedAt', 'providerActionDeadlineMs', 'input',
    'return (' + exprSource + ');',
  );
  let fakeNow = 1_700_000_000_000;
  const realDateNow = Date.now;
  Date.now = () => fakeNow;
  const startedAt = fakeNow - startedAtOffsetMs;
  const resolvedDeadline = typeof providerActionDeadlineMs === 'function'
    ? providerActionDeadlineMs(fakeNow)
    : providerActionDeadlineMs;
  const page = {
    waitForTimeout: async (ms) => { fakeNow += Math.max(0, ms); },
  };
  let callIndex = 0;
  const calls = [];
  const readSubmitOutcome = async () => {
    const raw = readSubmitOutcomeSequence[Math.min(callIndex, readSubmitOutcomeSequence.length - 1)];
    const outcome = typeof raw === 'function' ? raw() : raw;
    calls.push({ atMs: fakeNow - startedAt, outcome });
    callIndex += 1;
    return outcome;
  };
  const readSecurityCodeChallenge = async () => false;
  const waitFn = factory(
    page, readSecurityCodeChallenge, readSubmitOutcome,
    submitNetworkRef.current, startedAt, resolvedDeadline, { postSubmitSettleMs },
  );
  const restore = () => { Date.now = realDateNow; };
  return { waitFn, calls, getFakeNow: () => fakeNow, getStartedAt: () => startedAt, restore };
}

test('a pending outcome at the 30s mark keeps polling instead of giving up', async () => {
  // A closure rather than a fixed array: the initial 200ms/50ms-tick window makes an exact call
  // count this test should not have to predict, so pending stays true comfortably past it (six
  // calls) before turning confirmed - the confirmed read can only ever be reached from inside the
  // extension, never the initial loop.
  let calls = 0;
  const readSubmitOutcomeSequence = [() => {
    calls += 1;
    return calls <= 6 ? { state: 'unknown', pending: true } : { state: 'confirmed', pending: false };
  }];
  const harness = buildHarness({ postSubmitSettleMs: 200, readSubmitOutcomeSequence });
  try {
    await harness.waitFn();
    assert.ok(
      harness.calls.length > 6,
      'the extension must keep reading the outcome past the initial window until it changes: got '
        + JSON.stringify(harness.calls),
    );
    const last = harness.calls[harness.calls.length - 1];
    assert.equal(last.outcome.state, 'confirmed', 'the loop must stop the moment the outcome confirms');
    // The initial window alone (200ms / 50ms ticks) cannot have produced six reads staying pending
    // AND a seventh reaching confirmed; the extra reads only exist because the extension ran.
    assert.ok(last.atMs > 200, 'the total observed elapsed time must exceed the initial 200ms window');
  } finally {
    harness.restore();
  }
});

test('a plain unknown outcome (no pending, no unanswered network) does not extend the wait', async () => {
  const readSubmitOutcomeSequence = [{ state: 'unknown', pending: false }];
  const harness = buildHarness({ postSubmitSettleMs: 200, readSubmitOutcomeSequence });
  try {
    await harness.waitFn();
    const elapsedMs = harness.getFakeNow() - harness.getStartedAt();
    assert.ok(
      elapsedMs < 1_000,
      'a plain unknown outcome must return promptly after the initial window, not spend the ' +
        'extended budget: elapsed ' + elapsedMs + 'ms',
    );
  } finally {
    harness.restore();
  }
});

test('an unanswered submit-network entry extends the wait even when pending is unset', async () => {
  const submitNetworkRef = { current: [{ method: 'POST', url: 'https://apply.workable.com/x', status: null, outcome: 'unanswered' }] };
  const readSubmitOutcomeSequence = [{ state: 'unknown' }, { state: 'unknown' }, { state: 'rejected' }];
  const harness = buildHarness({ postSubmitSettleMs: 200, readSubmitOutcomeSequence, submitNetworkRef });
  try {
    await harness.waitFn();
    assert.ok(
      harness.calls.length >= 3,
      'the network-unanswered signal alone must be enough to extend the wait: got '
        + JSON.stringify(harness.calls),
    );
    assert.equal(harness.calls[harness.calls.length - 1].outcome.state, 'rejected');
  } finally {
    harness.restore();
  }
});

test('the extension exits the moment the pending marker clears without a terminal state', async () => {
  // Stays pending through the whole 200ms/50ms-tick initial window (comfortably covered by five
  // calls), then clears pending without ever reaching a terminal state - the one condition the
  // extension must treat as "stop watching", not "keep waiting for the target 90s".
  let calls = 0;
  const readSubmitOutcomeSequence = [() => {
    calls += 1;
    return calls <= 5 ? { state: 'unknown', pending: true } : { state: 'unknown', pending: false };
  }];
  const harness = buildHarness({ postSubmitSettleMs: 200, readSubmitOutcomeSequence });
  try {
    await harness.waitFn();
    const last = harness.calls[harness.calls.length - 1];
    assert.equal(last.outcome.pending, false, 'the run must have observed pending clear before returning');
    assert.ok(
      harness.calls.length <= 7,
      'the loop must stop shortly after pending clears rather than exhausting the extended budget: got '
        + JSON.stringify(harness.calls),
    );
  } finally {
    harness.restore();
  }
});

test('the extension is capped by the tightest remaining ceiling, not the full 90s target', async () => {
  // providerActionDeadlineMs only 65s out: tightest remaining (65s) minus the 60s safety margin
  // leaves only ~5s of extra budget, far short of the 90s target extension.
  const readSubmitOutcomeSequence = [{ state: 'unknown', pending: true }];
  const harness = buildHarness({
    postSubmitSettleMs: 200,
    providerActionDeadlineMs: (now) => now + 65_000,
    readSubmitOutcomeSequence,
  });
  try {
    await harness.waitFn();
    const elapsedMs = harness.getFakeNow() - harness.getStartedAt();
    assert.ok(
      elapsedMs < 200 + 10_000,
      'a tight provider deadline must cap the extension well under the 90s target: elapsed '
        + elapsedMs + 'ms',
    );
  } finally {
    harness.restore();
  }
});

test('a request-issued-but-provider-lock-nearly-expired ceiling also cuts the extension short', async () => {
  // startedAtOffsetMs simulates a run already 235s into its own life by the time it reaches this
  // wait (Mercari-shaped: large form, submit pressed late). The 240s volley provider-call lock
  // ceiling then leaves only ~5s of remaining budget before the 60s safety margin even applies,
  // so extraBudgetMs must clamp to zero and the function must return without any extra reads.
  const readSubmitOutcomeSequence = [{ state: 'unknown', pending: true }];
  const harness = buildHarness({
    postSubmitSettleMs: 200,
    startedAtOffsetMs: 235_000,
    readSubmitOutcomeSequence,
  });
  try {
    await harness.waitFn();
    assert.equal(
      harness.calls.length,
      Math.ceil(200 / 50),
      'a near-expired provider-call lock must leave no extension budget: got '
        + JSON.stringify(harness.calls),
    );
  } finally {
    harness.restore();
  }
});
