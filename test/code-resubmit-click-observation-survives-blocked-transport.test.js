/* A BLOCKED WRITE-REPLAY MUST NOT ERASE THIS CODE RESUBMIT'S RECEIPT EITHER - THE SECOND,
 * INDEPENDENT CALL SITE.
 *
 * securityCodeVerdict(receipt, still) is called from exactly two places in the runner. The first
 * is inside confirm_and_submit's own security-code arm, covered by
 * test/code-resubmit-observation-survives-blocked-transport.test.js. This file covers the second:
 * the plain 'click' action handler's own security-code resubmit, the sequence that types the
 * emailed code into a Greenhouse-style challenge and presses the resubmit control itself (search
 * "action.securityCode && isFinalSubmitAction(action)" - there is exactly one such guard in the
 * runner).
 *
 * That second site had two gaps, not one, and they are independent of each other:
 *
 *   1. It never called submitTransportResponseUnavailable() or markPostSubmitObservationFailed()
 *      at all, so a blocked-transport disposition caused by resubmitting the code through THIS
 *      click was never recorded for containment tracking, even though submitTransportDisposition
 *      is one flag settleHeldRoute sets regardless of which click's networkidle wait it happens to
 *      be blocked during. Unlike the confirm_and_submit arm, this site never skipped the DOM read
 *      on a blocked transport - it always called readSubmitOutcome / readSecurityCodeChallenge /
 *      securityCodeVerdict unconditionally - so the fix here is purely additive: record the
 *      disposition, and separately, correct the verdict it can produce.
 *
 *   2. It called securityCodeVerdict(receipt, still) directly on whatever the two readers
 *      returned, with no override. settleHeldRoute's synthetic stub page ("Submission redirect
 *      blocked" / "Submission response unavailable" - no form, no code boxes) reads as "a cleared
 *      control with nothing contrary", which is securityCodeVerdict's own safe default for that
 *      shape: 'accepted'. A blocked transport during this click's own networkidle wait produces
 *      that exact stub and that exact false accept, the same class of defect the confirm_and_submit
 *      arm had, just through a second, unrelated code path that shares nothing with the first one
 *      except the same submitTransportDisposition flag and the same securityCodeVerdict call.
 *
 * These tests execute the shipped statements extracted from SANDBOX_RUNNER against fake
 * dependencies, the same way the sibling files for the other call site do, rather than pinning the
 * text: they measure the control flow and the data flow, not the spelling. securityCodeVerdict
 * itself is extracted verbatim rather than reimplemented, so these tests exercise the actual
 * shipped verdict logic (bimodal by design - 'accepted' or 'rejected', never the string 'unknown';
 * see its extraction and comment below) instead of a hand-copied stand-in that could silently drift
 * out of step with it. Neither needs a real page, so both run without a browser. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* The plain click handler's security-code resubmit branch, guard included: from the if's own
 * opening brace through its own matching closing brace, found by depth-counting braces rather than
 * by a following sentinel line, because this branch (unlike the confirm_and_submit arms) is not
 * wrapped in a try/finally of its own and has no finishSubmitTransportGate() call to anchor an end
 * marker to. Same technique extractFunctionSource already uses elsewhere in this suite. */
function extractSecurityCodeResubmitClickBranch() {
  const startMarker = "if (action.securityCode && isFinalSubmitAction(action)) {";
  const start = SANDBOX_RUNNER.indexOf(startMarker);
  assert.notEqual(start, -1, 'the runner must still contain the plain click-handler security-code resubmit branch');
  assert.equal(
    SANDBOX_RUNNER.indexOf(startMarker, start + 1),
    -1,
    'the start marker must be unique or the slice below may cut the wrong occurrence',
  );
  const openBrace = start + startMarker.length - 1;
  assert.equal(SANDBOX_RUNNER[openBrace], '{', 'the start marker must end on the branch\'s own opening brace');
  let depth = 0;
  for (let index = openBrace; index < SANDBOX_RUNNER.length; index += 1) {
    const char = SANDBOX_RUNNER[index];
    if (char === '{') depth += 1;
    else if (char === '}') {
      depth -= 1;
      if (depth === 0) return SANDBOX_RUNNER.slice(start, index + 1);
    }
  }
  throw new Error('could not find the end of the security-code resubmit click branch');
}

/* The real securityCodeVerdict, extracted verbatim rather than reimplemented in the test, so a
 * future change to its logic cannot silently drift out of step with what these tests assert. Read
 * plainly: it is bimodal. Only 'accepted' or 'rejected' ever come out of it - there is no path to
 * the string 'unknown', by design. That is why the false-accept fix below produces 'unknown' only
 * as an override APPLIED AFTER calling securityCodeVerdict, never as something securityCodeVerdict
 * itself returns. */
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

async function runSecurityCodeResubmitClickBranch({
  entryOutcome = 'entered',
  transportUnavailable,
  readSubmitOutcomeResult,
  readSecurityCodeChallengeResult,
}) {
  const calls = [];
  const skipped = [];
  const statement = extractSecurityCodeResubmitClickBranch();
  const securityCodeVerdict = extractSecurityCodeVerdictFn();
  // eslint-disable-next-line no-new-func
  const run = new Function(
    'action',
    'skipped',
    'isFinalSubmitAction',
    'page',
    'enterSecurityCode',
    'assertProviderActionWindow',
    'providerMinimumSubmitWindowMs',
    'locator',
    'submitTransportResponseUnavailable',
    'markPostSubmitObservationFailed',
    'waitForPostSubmitApplicationState',
    'readSubmitOutcome',
    'readSecurityCodeChallenge',
    'securityCodeVerdict',
    `return (async () => { let securityCodeAttempt = null; ${statement} return securityCodeAttempt; })();`,
  );
  const securityCodeAttempt = await run(
    { securityCode: 'ABC12345' },
    skipped,
    () => true,
    {
      waitForSelector: async () => { calls.push('waitForSelector'); },
      waitForLoadState: async () => { calls.push('networkidle'); },
    },
    async () => { calls.push('enterSecurityCode'); return entryOutcome; },
    () => { calls.push('assertProviderActionWindow'); },
    240000,
    { click: async () => { calls.push('locatorClick'); } },
    () => transportUnavailable,
    () => { calls.push('markPostSubmitObservationFailed'); },
    (...args) => { calls.push(['waitForPostSubmitApplicationState', ...args]); },
    async () => { calls.push('readSubmitOutcome'); return readSubmitOutcomeResult; },
    async () => { calls.push('readSecurityCodeChallenge'); return readSecurityCodeChallengeResult; },
    (receipt, still) => { calls.push(['securityCodeVerdict', receipt, still]); return securityCodeVerdict(receipt, still); },
  );
  return { securityCodeAttempt, calls, skipped };
}

const UNREADABLE_RECEIPT = { state: 'unknown', source: null, evidence: null, message: null, formStillPresent: null };
const ACCEPTED_RECEIPT = {
  state: 'confirmed',
  source: 'ats_route',
  evidence: 'location',
  message: 'Thank you for applying.',
  formStillPresent: false,
};
/* Shaped exactly the way readSubmitOutcome resolves on Stratus's own synthetic stub page (the
 * 'Submission redirect blocked' / 'Submission response unavailable' HTML settleHeldRoute
 * route.fulfill()s in place of whatever the ATS would have rendered): no arm recognises that
 * boilerplate, so it falls through to readSubmitOutcome's own last resort. UNREADABLE_RECEIPT above
 * (source: null) is the OTHER no-evidence shape - what readSubmitOutcome's outer catch produces
 * when the page's execution context was destroyed rather than merely replaced - so between the two
 * constants both no-evidence source values the fix treats as "nothing legible was read" are
 * covered. */
const NO_EVIDENCE_RECEIPT = {
  state: 'unknown',
  source: 'unmatched_page_text',
  evidence: 'https://boards.greenhouse.io/acme/jobs/4242000',
  message: 'Stratus blocked a write-preserving submit redirect.',
  formStillPresent: false,
};
const STILL_STANDING_CHALLENGE = { kind: 'security_code', fieldCount: 8, sentTo: null, label: 'Security code' };

test('the code is not typed: the branch guard short-circuits before any transport or DOM read runs (unaffected by this fix)', async () => {
  const { securityCodeAttempt, calls, skipped } = await runSecurityCodeResubmitClickBranch({
    entryOutcome: 'timeout',
    transportUnavailable: true,
    readSubmitOutcomeResult: UNREADABLE_RECEIPT,
    readSecurityCodeChallengeResult: null,
  });
  assert.deepEqual(securityCodeAttempt, { supplied: true, entered: false, outcome: 'timeout', resubmitted: false });
  assert.deepEqual(skipped, ['security_code: the code was not typed, timeout']);
  assert.ok(calls.includes('enterSecurityCode'), 'enterSecurityCode must still run: got ' + JSON.stringify(calls));
  for (const unexpected of [
    'locatorClick', 'markPostSubmitObservationFailed', 'readSubmitOutcome', 'readSecurityCodeChallenge',
  ]) {
    assert.ok(!calls.includes(unexpected), unexpected + ' must not run when the code was never entered: got ' + JSON.stringify(calls));
  }
});

test('Gap 1: a blocked transport during this click is now recorded, not silently dropped', async () => {
  const { calls } = await runSecurityCodeResubmitClickBranch({
    transportUnavailable: true,
    readSubmitOutcomeResult: ACCEPTED_RECEIPT,
    readSecurityCodeChallengeResult: null,
  });
  assert.ok(
    calls.includes('markPostSubmitObservationFailed'),
    'this call site must now record the containment disposition it previously ignored entirely: got ' + JSON.stringify(calls),
  );
});

test('Gap 1 control: a clean transport during this click records nothing', async () => {
  const { calls } = await runSecurityCodeResubmitClickBranch({
    transportUnavailable: false,
    readSubmitOutcomeResult: ACCEPTED_RECEIPT,
    readSecurityCodeChallengeResult: null,
  });
  assert.ok(
    !calls.includes('markPostSubmitObservationFailed'),
    'nothing was blocked, so no observation-failed disposition should be recorded: got ' + JSON.stringify(calls),
  );
});

test('Gap 2: a blocked transport with an unforgeable accepted receipt still resolves accepted', async () => {
  const { securityCodeAttempt, calls } = await runSecurityCodeResubmitClickBranch({
    transportUnavailable: true,
    readSubmitOutcomeResult: ACCEPTED_RECEIPT,
    readSecurityCodeChallengeResult: null,
  });
  assert.ok(calls.includes('readSubmitOutcome'), 'readSubmitOutcome must run: got ' + JSON.stringify(calls));
  assert.ok(calls.includes('readSecurityCodeChallenge'), 'readSecurityCodeChallenge must run: got ' + JSON.stringify(calls));
  assert.deepEqual(securityCodeAttempt, { supplied: true, entered: true, resubmitted: true, outcome: 'accepted' });
});

test('Gap 2: transport unavailable, no challenge control found, and a receipt that matched no ATS arm (unmatched_page_text) resolves unknown, not accepted', async () => {
  const { securityCodeAttempt, calls } = await runSecurityCodeResubmitClickBranch({
    transportUnavailable: true,
    readSubmitOutcomeResult: NO_EVIDENCE_RECEIPT,
    readSecurityCodeChallengeResult: null,
  });
  assert.ok(
    calls.some((call) => Array.isArray(call) && call[0] === 'securityCodeVerdict'),
    'securityCodeVerdict must still be consulted - the override applies to its result, not instead of calling it: '
      + 'got ' + JSON.stringify(calls),
  );
  assert.deepEqual(securityCodeAttempt, { supplied: true, entered: true, resubmitted: true, outcome: 'unknown' },
    'nothing legible came back from either reader (a stub page, not a quiet ATS page), so the verdict must not default to accepted');
});

test('Gap 2: transport unavailable, no challenge control found, and a destroyed-context receipt (source null) also resolves unknown, not accepted', async () => {
  const { securityCodeAttempt } = await runSecurityCodeResubmitClickBranch({
    transportUnavailable: true,
    readSubmitOutcomeResult: UNREADABLE_RECEIPT,
    readSecurityCodeChallengeResult: null,
  });
  assert.equal(
    securityCodeAttempt.outcome,
    'unknown',
    'the other no-evidence shape (readSubmitOutcome\'s own outer catch, source null) must resolve the same way as unmatched_page_text',
  );
});

test('Gap 2 leaves a genuine receipt alone: transport unavailable plus a real ats_route confirmation still resolves accepted', async () => {
  const { securityCodeAttempt } = await runSecurityCodeResubmitClickBranch({
    transportUnavailable: true,
    readSubmitOutcomeResult: ACCEPTED_RECEIPT,
    readSecurityCodeChallengeResult: null,
  });
  assert.equal(
    securityCodeAttempt.outcome,
    'accepted',
    'an ats_route receipt is real evidence the employer\'s own page rendered before any transport gate fired, and must survive unchanged',
  );
});

test('Gap 2 leaves a standing challenge alone: transport unavailable plus a still-standing code control resolves rejected even when the receipt also matched no ATS arm', async () => {
  const { securityCodeAttempt } = await runSecurityCodeResubmitClickBranch({
    transportUnavailable: true,
    readSubmitOutcomeResult: NO_EVIDENCE_RECEIPT,
    readSecurityCodeChallengeResult: STILL_STANDING_CHALLENGE,
  });
  assert.equal(
    securityCodeAttempt.outcome,
    'rejected',
    'the override only fires when the challenge reader also found nothing (still === null); a standing control must keep resolving rejected the way it always has',
  );
});

test('a clean transport with a still-standing challenge reaches the safe rejected verdict (this fix does not touch that path)', async () => {
  const { securityCodeAttempt, calls } = await runSecurityCodeResubmitClickBranch({
    transportUnavailable: false,
    readSubmitOutcomeResult: UNREADABLE_RECEIPT,
    readSecurityCodeChallengeResult: STILL_STANDING_CHALLENGE,
  });
  assert.ok(
    !calls.includes('markPostSubmitObservationFailed'),
    'nothing was blocked, so no observation-failed disposition should be recorded: got ' + JSON.stringify(calls),
  );
  assert.equal(securityCodeAttempt.outcome, 'rejected');
});
