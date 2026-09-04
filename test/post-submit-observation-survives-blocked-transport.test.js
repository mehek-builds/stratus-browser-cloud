/* THE RECEIPT MUST SURVIVE A BLOCKED TRANSPORT REPLAY.
 *
 * Measured 2026-09-04, Exa "Software Engineer, Intern" on jobs.ashbyhq.com, packet
 * 73768339-7fef-4493-aa75-1d47c61ae51f, send run 35836836-fb81-4392-95ae-4949379b4e27: claim
 * 18:13:41Z, submission_attempted_at 18:14:21Z (forty seconds later), review.status
 * needs_attention, unverified_submission.cause no_confirmation_state, submission_error "Stratus
 * managed browser did not return a receipt screenshot".
 *
 * The runner pressed Submit through confirm_and_submit (confirmAndSubmitPass, the atomic chooser
 * path). Once markPostSubmitObservationFailed() had run - which the native-replay containment
 * calls whenever it refuses to relay a write redirect or a receipt redirect it cannot vouch for,
 * submitTransportDisposition write_redirect_blocked / receipt_redirect_blocked /
 * transport_replay_observation_failed - two things happened that had nothing to do with each
 * other but were wired to the same flag:
 *
 *   1. waitForPostSubmitApplicationState (the bounded poll of readSubmitOutcome /
 *      readSecurityCodeChallenge - a local page.evaluate that sends no request of its own) was
 *      skipped outright instead of run.
 *   2. The final submitOutcome was assembled through observeForResult, which returns its
 *      hardcoded { state: 'unknown', ... } fallback the instant postSubmitObservationDisposition
 *      is set, without ever calling readSubmitOutcome() again.
 *
 * A transport-safety refusal is a statement about a REDIRECT or RESPONSE Chromium was not let see;
 * it is not a statement that the DOM in front of the run became unreadable. Conflating the two
 * meant a run that genuinely pressed Submit, and may already have had the ATS's own confirmation
 * container on screen, reported unknown with nothing observed - the exact shape that makes
 * exactManagedSubmitVerdict (student-outreach-backend src/lib/managedSubmitOutcome.ts) fold to
 * unverified/no_confirmation_state. And because the receipt screenshot races the same result write
 * on every pressed run by design (browserbase.ts's MANAGED_PREPARE_FILL_OPTIONS doc comment:
 * screenshotWait is honoured only for an unpressed result), submissionRunner.ts was left with
 * neither a typed confirmation nor a screenshot to fall back on.
 *
 * These tests execute the shipped statements extracted from SANDBOX_RUNNER against fake
 * dependencies, the same way test/out-of-band-transport-origin.test.js does, rather than pinning
 * the text: they measure the control flow and the data flow, not the spelling. Neither needs a
 * real page, so both run without a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* The clicked-application branch of confirm_and_submit, from its guard through the try block that
 * decides whether to keep watching the page - cut before its own `} finally {`, whose
 * finishSubmitTransportGate() call belongs to a try this slice does not otherwise carry. */
function extractApplicationClickedBranch() {
  const startMarker = "if (application.pass.submissionOutcome === 'clicked') {";
  const start = SANDBOX_RUNNER.indexOf(startMarker);
  assert.notEqual(start, -1, 'the runner must still contain the application submit branch');
  assert.equal(
    SANDBOX_RUNNER.indexOf(startMarker, start + 1),
    -1,
    'the start marker must be unique or the slice below may cut the wrong occurrence',
  );
  const bodyStart = start + startMarker.length;
  const endMarker = 'await finishSubmitTransportGate();';
  const endIdx = SANDBOX_RUNNER.indexOf(endMarker, bodyStart);
  assert.notEqual(endIdx, -1, 'the runner must still call finishSubmitTransportGate after this branch');
  const rawBody = SANDBOX_RUNNER.slice(bodyStart, endIdx);
  const closeIdx = rawBody.indexOf('} finally {');
  assert.notEqual(closeIdx, -1, 'the clicked branch must still be wrapped in a try/finally');
  return startMarker + rawBody.slice(0, closeIdx);
}

async function runApplicationClickedBranch({ transportUnavailable }) {
  const calls = [];
  const statement = extractApplicationClickedBranch();
  // eslint-disable-next-line no-new-func
  const run = new Function(
    'application',
    'page',
    'submitTransportResponseUnavailable',
    'markPostSubmitObservationFailed',
    'waitForPostSubmitApplicationState',
    `return (async () => { ${statement} })();`,
  );
  await run(
    { pass: { submissionOutcome: 'clicked' } },
    { waitForLoadState: async () => { calls.push('networkidle'); } },
    () => transportUnavailable,
    () => { calls.push('markPostSubmitObservationFailed'); },
    (...args) => { calls.push(['waitForPostSubmitApplicationState', ...args]); },
  );
  return calls;
}

test('a blocked write-replay after the press no longer skips the page watch', async () => {
  const calls = await runApplicationClickedBranch({ transportUnavailable: true });
  assert.ok(
    calls.some((call) => Array.isArray(call) && call[0] === 'waitForPostSubmitApplicationState'),
    'waitForPostSubmitApplicationState must still run when the transport was flagged: got '
      + JSON.stringify(calls),
  );
  assert.ok(
    calls.includes('markPostSubmitObservationFailed'),
    'the containment event must still be recorded even though the watch now also runs',
  );
});

test('a clean transport still watches the page (unchanged behaviour, pinned as the control case)', async () => {
  const calls = await runApplicationClickedBranch({ transportUnavailable: false });
  assert.ok(
    calls.some((call) => Array.isArray(call) && call[0] === 'waitForPostSubmitApplicationState'),
    'a clean transport must keep watching the page',
  );
  assert.ok(
    !calls.includes('markPostSubmitObservationFailed'),
    'nothing was blocked, so no observation-failed disposition should be recorded',
  );
});

/* The final submitOutcome assembly, verbatim. */
function extractSubmitOutcomeAssembly() {
  const startMarker = 'const submitOutcome = finalSubmitPressed';
  const endMarker = ": { pressed: false, state: 'not_attempted', source: null, evidence: null, "
    + 'message: null, formStillPresent: null };';
  const start = SANDBOX_RUNNER.indexOf(startMarker);
  assert.notEqual(start, -1, 'the runner must still assemble submitOutcome from finalSubmitPressed');
  const end = SANDBOX_RUNNER.indexOf(endMarker, start);
  assert.notEqual(end, -1, 'the runner must still carry the not_attempted arm of submitOutcome');
  return SANDBOX_RUNNER.slice(start, end + endMarker.length);
}

async function runSubmitOutcomeAssembly({ finalSubmitPressed, readSubmitOutcome, submitNetwork, submitTransportDisposition }) {
  const statement = extractSubmitOutcomeAssembly();
  // eslint-disable-next-line no-new-func
  const run = new Function(
    'finalSubmitPressed',
    'readSubmitOutcome',
    'submitNetwork',
    'submitTransportDisposition',
    `return (async () => { ${statement}\nreturn submitOutcome; })();`,
  );
  return run(finalSubmitPressed, readSubmitOutcome, submitNetwork, submitTransportDisposition);
}

test('submitOutcome carries a real confirmed DOM read even after a blocked transport replay', async () => {
  const confirmedRead = {
    state: 'confirmed',
    source: 'ats_state',
    evidence: '.ashby-application-form-success-container',
    message: 'Thank you for submitting your application.',
    formStillPresent: false,
  };
  const result = await runSubmitOutcomeAssembly({
    finalSubmitPressed: true,
    readSubmitOutcome: async () => confirmedRead,
    submitNetwork: null,
    // The exact disposition the containment sets for an unbound receipt redirect - previously
    // enough, on its own, to force the outcome below to 'unknown' regardless of what
    // readSubmitOutcome actually found.
    submitTransportDisposition: 'receipt_redirect_blocked',
  });
  assert.equal(result.pressed, true);
  assert.equal(result.state, 'confirmed', 'a confirmed DOM read must survive a blocked transport replay');
  assert.equal(result.evidence, '.ashby-application-form-success-container');
  assert.equal(result.message, confirmedRead.message);
  assert.equal(
    result.transportDisposition,
    'receipt_redirect_blocked',
    'the containment event must still travel on the outcome once fixed, not disappear',
  );
});

test('submitOutcome still reports unknown when the DOM read itself is genuinely unknown', async () => {
  const result = await runSubmitOutcomeAssembly({
    finalSubmitPressed: true,
    readSubmitOutcome: async () => ({
      state: 'unknown', source: null, evidence: null, message: null, formStillPresent: null,
    }),
    submitNetwork: null,
    submitTransportDisposition: null,
  });
  assert.equal(result.state, 'unknown', 'a genuinely ambiguous page must still report unknown');
});

test('submitOutcome stays not_attempted when the run never pressed, without reading the DOM', async () => {
  const result = await runSubmitOutcomeAssembly({
    finalSubmitPressed: false,
    readSubmitOutcome: async () => { throw new Error('must not be called when nothing was pressed'); },
    submitNetwork: null,
    submitTransportDisposition: null,
  });
  assert.deepEqual(result, {
    pressed: false,
    state: 'not_attempted',
    source: null,
    evidence: null,
    message: null,
    formStillPresent: null,
  });
});
