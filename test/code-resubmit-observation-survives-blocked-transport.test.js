/* A BLOCKED WRITE-REPLAY MUST NOT ERASE A CODE RESUBMIT'S RECEIPT EITHER.
 *
 * The sibling to test/post-submit-observation-survives-blocked-transport.test.js (added by the PR
 * that fixed the plain application-submit arm of confirm_and_submit). That fix explicitly left one
 * arm alone: "The sibling security-code-resubmit arm has the identical
 * submitTransportResponseUnavailable-gated skip around readSubmitOutcome/securityCodeVerdict, but
 * no measured incident against it yet, so it is left alone here." This is that arm.
 *
 * Inside confirm_and_submit's verification.pass.submissionOutcome === 'clicked' branch (the
 * atomic security-code resubmit path), the pre-fix code did:
 *
 *   if (submitTransportResponseUnavailable()) {
 *     markPostSubmitObservationFailed();
 *     codeOutcome = 'unknown';
 *   } else {
 *     await waitForPostSubmitApplicationState({ securityCodeSettles: false });
 *     const receipt = await readSubmitOutcome();
 *     const still = await readSecurityCodeChallenge();
 *     codeOutcome = securityCodeVerdict(receipt, still);
 *   }
 *
 * exactly the shape the sibling fix removed from the application arm: a transport-safety refusal
 * to relay a write or receipt redirect Chromium could not vouch for (submitTransportDisposition
 * write_redirect_blocked / receipt_redirect_blocked / transport_replay_observation_failed) says
 * nothing about whether the DOM in front of the run can still be read, and
 * waitForPostSubmitApplicationState / readSubmitOutcome / readSecurityCodeChallenge only ever
 * evaluate that DOM - they send nothing of their own. Hardcoding codeOutcome to 'unknown' here
 * threw away a genuinely accepted code resubmission exactly the way the application arm's forced
 * 'unknown' threw away a genuinely confirmed application: litos-api's submissionRunner.ts treats
 * securityCodeAttempt.outcome === 'accepted' as one of two ways a submission counts as confirmed,
 * so this folded an accepted Greenhouse-style code resubmission into an unverified one.
 *
 * These tests execute the shipped statements extracted from SANDBOX_RUNNER against fake
 * dependencies, the same way the sibling test file and test/out-of-band-transport-origin.test.js
 * do, rather than pinning the text: they measure the control flow and the data flow, not the
 * spelling. securityCodeVerdict itself is extracted verbatim rather than reimplemented, so these
 * tests exercise the actual shipped verdict logic (bimodal by design - 'accepted' or 'rejected',
 * never the string 'unknown'; see the extraction and its comment below) instead of a hand-copied
 * stand-in that could silently drift out of step with it. Neither needs a real page, so both run
 * without a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* The security-code resubmit branch of confirm_and_submit, from the if's own opening brace through
 * its own closing brace - cut before the enclosing try's `} finally {`, whose
 * finishSubmitTransportGate() call belongs to a try this slice does not otherwise carry. Same
 * technique as the sibling file's extractApplicationClickedBranch. */
function extractSecurityCodeClickedBranch() {
  const startMarker = "if (verification.pass.submissionOutcome === 'clicked') {";
  const start = SANDBOX_RUNNER.indexOf(startMarker);
  assert.notEqual(start, -1, 'the runner must still contain the security-code resubmit branch');
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
  assert.notEqual(closeIdx, -1, 'the security-code branch must still be wrapped in a try/finally');
  return startMarker + rawBody.slice(0, closeIdx);
}

/* The real securityCodeVerdict, extracted verbatim rather than reimplemented in the test, so a
 * future change to its logic cannot silently drift out of step with what these tests assert.
 * Read plainly: it is bimodal. Only 'accepted' or 'rejected' ever come out of it - there is no
 * path to the string 'unknown', by design ("a standing control is a refusal" and "a cleared
 * control with nothing contrary is acceptance" - the file's own comment above its definition
 * argues both halves at length). That is why the fail-closed case below asserts 'rejected', not
 * 'unknown': 'unknown' was only ever the hardcoded value this fix removes, never a value
 * securityCodeVerdict itself produces. */
function extractSecurityCodeVerdictFn() {
  const startMarker = 'const securityCodeVerdict = (receipt, challengeStanding) => (';
  const start = SANDBOX_RUNNER.indexOf(startMarker);
  assert.notEqual(start, -1, 'the runner must still define securityCodeVerdict');
  assert.equal(
    SANDBOX_RUNNER.indexOf(startMarker, start + 1),
    -1,
    'the securityCodeVerdict marker must be unique or the slice below may cut the wrong occurrence',
  );
  const endMarker = '\n    );';
  const end = SANDBOX_RUNNER.indexOf(endMarker, start);
  assert.notEqual(end, -1, 'securityCodeVerdict must still close with the expected paren');
  const statement = SANDBOX_RUNNER.slice(start, end + endMarker.length);
  // eslint-disable-next-line no-new-func
  return new Function(`${statement}\nreturn securityCodeVerdict;`)();
}

async function runSecurityCodeClickedBranch({
  submissionOutcome = 'clicked',
  transportUnavailable,
  readSubmitOutcomeResult,
  readSecurityCodeChallengeResult,
}) {
  const calls = [];
  const statement = extractSecurityCodeClickedBranch();
  const securityCodeVerdict = extractSecurityCodeVerdictFn();
  // eslint-disable-next-line no-new-func
  const run = new Function(
    'verification',
    'page',
    'submitTransportResponseUnavailable',
    'markPostSubmitObservationFailed',
    'waitForPostSubmitApplicationState',
    'readSubmitOutcome',
    'readSecurityCodeChallenge',
    'securityCodeVerdict',
    `return (async () => { let codeOutcome = 'not_entered'; ${statement} return codeOutcome; })();`,
  );
  const codeOutcome = await run(
    { pass: { submissionOutcome } },
    { waitForLoadState: async () => { calls.push('networkidle'); } },
    () => transportUnavailable,
    () => { calls.push('markPostSubmitObservationFailed'); },
    (...args) => { calls.push(['waitForPostSubmitApplicationState', ...args]); },
    async () => { calls.push('readSubmitOutcome'); return readSubmitOutcomeResult; },
    async () => { calls.push('readSecurityCodeChallenge'); return readSecurityCodeChallengeResult; },
    (receipt, still) => { calls.push(['securityCodeVerdict', receipt, still]); return securityCodeVerdict(receipt, still); },
  );
  return { codeOutcome, calls };
}

const UNREADABLE_RECEIPT = { state: 'unknown', source: null, evidence: null, message: null, formStillPresent: null };
const ACCEPTED_RECEIPT = {
  state: 'confirmed',
  source: 'ats_route',
  evidence: 'location',
  message: 'Thank you for applying.',
  formStillPresent: false,
};
const STILL_STANDING_CHALLENGE = { kind: 'security_code', fieldCount: 8, sentTo: null, label: 'Security code' };

test('a blocked write-replay after a code resubmit press no longer skips the DOM watch, and an accepted verdict survives', async () => {
  const { codeOutcome, calls } = await runSecurityCodeClickedBranch({
    transportUnavailable: true,
    readSubmitOutcomeResult: ACCEPTED_RECEIPT,
    readSecurityCodeChallengeResult: null,
  });
  assert.ok(
    calls.includes('markPostSubmitObservationFailed'),
    'the containment event must still be recorded: got ' + JSON.stringify(calls),
  );
  assert.ok(
    calls.some((call) => Array.isArray(call) && call[0] === 'waitForPostSubmitApplicationState'
      && JSON.stringify(call[1]) === JSON.stringify({ securityCodeSettles: false })),
    'waitForPostSubmitApplicationState must still run, with the same option the clean-transport '
      + 'path already used: got ' + JSON.stringify(calls),
  );
  assert.ok(calls.includes('readSubmitOutcome'), 'readSubmitOutcome must still run: got ' + JSON.stringify(calls));
  assert.ok(
    calls.includes('readSecurityCodeChallenge'),
    'readSecurityCodeChallenge must still run: got ' + JSON.stringify(calls),
  );
  assert.equal(codeOutcome, 'accepted', 'an unforgeable accepted receipt must survive a blocked transport replay');
});

test('transport unavailable and nothing confirms the code either way still resolves through the real verdict logic, never the discarded literal unknown', async () => {
  const { codeOutcome, calls } = await runSecurityCodeClickedBranch({
    transportUnavailable: true,
    readSubmitOutcomeResult: UNREADABLE_RECEIPT,
    readSecurityCodeChallengeResult: STILL_STANDING_CHALLENGE,
  });
  assert.ok(
    calls.includes('markPostSubmitObservationFailed'),
    'the containment event must still be recorded: got ' + JSON.stringify(calls),
  );
  assert.ok(
    calls.includes('readSubmitOutcome'),
    'readSubmitOutcome must still run even though it will report unknown: got ' + JSON.stringify(calls),
  );
  assert.ok(
    calls.includes('readSecurityCodeChallenge'),
    'readSecurityCodeChallenge must still run: got ' + JSON.stringify(calls),
  );
  assert.notEqual(codeOutcome, 'unknown', 'the discarded hardcoded unknown must not reappear');
  assert.equal(
    codeOutcome,
    'rejected',
    'a still-standing challenge with nothing confirming it is the safe, fail-closed verdict '
      + '(securityCodeVerdict never returns the string unknown - see its extraction above)',
  );
});

test('a clean transport still watches the page and reaches the same accepted verdict (unchanged behaviour, pinned as the control case)', async () => {
  const { codeOutcome, calls } = await runSecurityCodeClickedBranch({
    transportUnavailable: false,
    readSubmitOutcomeResult: ACCEPTED_RECEIPT,
    readSecurityCodeChallengeResult: null,
  });
  assert.ok(
    !calls.includes('markPostSubmitObservationFailed'),
    'nothing was blocked, so no observation-failed disposition should be recorded: got ' + JSON.stringify(calls),
  );
  assert.ok(calls.includes('readSubmitOutcome'), 'readSubmitOutcome must run: got ' + JSON.stringify(calls));
  assert.ok(
    calls.includes('readSecurityCodeChallenge'),
    'readSecurityCodeChallenge must run: got ' + JSON.stringify(calls),
  );
  assert.equal(codeOutcome, 'accepted');
});

test('a clean transport with a still-standing challenge also reaches the safe rejected verdict (this fix does not touch that path)', async () => {
  const { codeOutcome, calls } = await runSecurityCodeClickedBranch({
    transportUnavailable: false,
    readSubmitOutcomeResult: UNREADABLE_RECEIPT,
    readSecurityCodeChallengeResult: STILL_STANDING_CHALLENGE,
  });
  assert.ok(
    !calls.includes('markPostSubmitObservationFailed'),
    'nothing was blocked, so no observation-failed disposition should be recorded: got ' + JSON.stringify(calls),
  );
  assert.equal(codeOutcome, 'rejected');
});

test('when the resubmit press itself was never clicked, codeOutcome stays not_entered and nothing is read (guard unaffected by this fix)', async () => {
  const { codeOutcome, calls } = await runSecurityCodeClickedBranch({
    submissionOutcome: 'blocked',
    transportUnavailable: true,
    readSubmitOutcomeResult: UNREADABLE_RECEIPT,
    readSecurityCodeChallengeResult: null,
  });
  assert.equal(codeOutcome, 'not_entered');
  assert.deepEqual(calls, [], 'nothing should run when the branch guard is false: got ' + JSON.stringify(calls));
});
