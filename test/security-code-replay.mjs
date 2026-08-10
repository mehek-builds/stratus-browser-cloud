// Greenhouse's emailed security code, and the submit a fill run must never be able to make.
//
// Same replay technique as test/managed-runner-replay.mjs, and for the same reason: SANDBOX_RUNNER
// ships to the sandbox as a STRING, so nothing in the ordinary suite executes it and a defect in it
// survives every test that can only read it. This runs it, against a local fixture, in a real
// browser.
//
// TWO DEFECTS ARE PINNED HERE, and they are separate defects with separate fixes.
//
// (a) A FILL RUN SUBMITTED A REAL APPLICATION. On 2026-08-08 three Greenhouse packets (Redwood
//     Materials, Scale AI, Cresta) reached 'ready_for_final_approval' with submission_claimed_at,
//     submission_authorization and browser_session_id all null - the authorized submit path
//     provably never ran - while Greenhouse emailed the applicant a security code at the exact
//     minute of each FILL run. The mechanism then was an unaimed keystroke, since fixed. The
//     mechanism is not the point: an aimed Enter on a plain text input submits a form just as well,
//     so the fixture uses exactly that, and the guard is what has to hold.
//
// (b) THE CHALLENGE ITSELF. Greenhouse answers an unauthenticated submit by emailing an 8-character
//     code and rendering a code field, and files nothing until the form is submitted again with the
//     code in it. The fixture reproduces the control from the Cresta preview screenshot: eight
//     single-character boxes under a "Security code" label, with the sentence naming the address.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ATOMIC_SUBMIT_POLICY, SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODE = 'TPHJrFMJ';

/* THE WIDGET IS GREENHOUSE'S, NOT AN IMPRESSION OF ONE.
 *
 * Everything in the challenge below is transcribed from the code job-boards.greenhouse.io serves to
 * the live Cresta posting, read on 2026-08-10 out of
 * https://job-boards.cdn.greenhouse.io/assets/entry.client-Da_lLnMl.js, the asset that page links.
 * The previous fixture was written from a screenshot and got three things wrong, and every one of
 * them is load-bearing:
 *
 *   1. it put autocomplete="one-time-code" on the boxes. Greenhouse does not. Its inputs are
 *      id="security-input-0" through "security-input-7", type=text, maxLength 1, aria-required,
 *      aria-invalid, aria-errormessage, and nothing else. So the detector's platform-name branch
 *      never fires on a real Greenhouse form and the one-character-group branch does all the work.
 *   2. it left aria-required OFF. Greenhouse sets it on all eight, which is what made the old "the
 *      code boxes must not be reported as empty required fields" assertion vacuous: it passed
 *      because the fixture had no marker to find.
 *   3. it left the submit button permanently enabled. Greenhouse disables the form in the same
 *      breath as it learns the recipient, and re-enables it only once the eight joined box values
 *      are exactly eight characters long. A run that types the code and immediately reaches for a
 *      submit control finds a disabled one, and the atomic submit drops disabled candidates.
 *
 * The auto-advance and the paste distribution are the compiled handlers, with the input element
 * substituted for React's ref.current, which is what ref.current is:
 *
 *   onChange u(m,x): f=value; g=a[x+1]; y=a.map(k=>k.current?.value); a[x].current.value=f;
 *                    y[x]=f; b=y.join(""); t(b); d(b);
 *                    if (a[x].current?.value) g?.current?.select();
 *   onPaste  h(m,x): f=clipboardData.getData("text").split(""); g=0;
 *                    a.forEach((b,j)=>{ if (j<x) return; b.current.value=f[g]; g+=1 });
 *                    t(joined); d(joined)
 *   enable   d(m):   m.length === 8 ? setFormDisabled(false) : setFormDisabled(true)
 *
 * novalidate for the same reason the other fixture uses it: with native validation on, an empty
 * required field would stop the submission by itself and a guard that did nothing would look like a
 * guard that worked. Greenhouse validates in JavaScript.
 *
 * The legend is present ON PURPOSE. '* indicates a required field' is on every Greenhouse form ever
 * rendered, including every one with no challenge at all, and this repo has already shipped one
 * gate that keyed on page text. Case 6 asserts the detector ignores it.
 */
const fixture = `<!doctype html><meta charset="utf-8"><title>Security Code Fixture</title>
<form id="app-form" novalidate>
  <label for="first_name">First Name</label><input id="first_name" type="text">
  <label for="email">Email</label><input id="email" type="text">
  <p class="legend">* indicates a required field</p>
  <div id="challenge"></div>
  <div class="application--submit"><button id="submit-btn" type="submit">Submit application</button></div>
</form>
<div id="submitted">no</div>
<div id="filed">no</div>
<div id="empty-code-submits">0</div>
<div id="box-values">-</div>
<div id="disabled-at-challenge">-</div>
<div id="disabled-at-code-submit">-</div>
<script>
  var attempts = 0;
  var CODE_LENGTH = 8;
  var securityCode = '';
  function boxRefs() { return [].slice.call(document.querySelectorAll('#email-verification input')); }
  function setFormDisabled(state) { document.getElementById('submit-btn').disabled = state; }
  // d(m), one render later. React does not apply setFormDisabled during the change handler: it
  // schedules a re-render, and the button's disabled attribute changes when that render commits. A
  // fixture that flips the attribute synchronously would let a run that reaches for the submit
  // control the instant the last character lands pass here and fail against Greenhouse.
  function onCodeLength(value) {
    var next = value.length !== CODE_LENGTH;
    setTimeout(function () { setFormDisabled(next); }, 0);
  }
  function onCodeChange(event, index) {
    var a = boxRefs();
    var f = event.currentTarget.value;
    var g = a[index + 1];
    var y = a.map(function (k) { return k.value; });
    a[index].value = f;
    y[index] = f;
    var b = y.join('');
    securityCode = b;
    onCodeLength(b);
    if (a[index].value && g) g.select();
  }
  function onCodePaste(event, index) {
    var a = boxRefs();
    var f = (event.clipboardData ? event.clipboardData.getData('text') : '').split('');
    var g = 0;
    a.forEach(function (b, j) { if (j < index) return; b.value = f[g]; g += 1; });
    var y = a.map(function (b) { return b.value; }).join('');
    securityCode = y;
    onCodeLength(y);
    event.preventDefault();
  }
  function renderChallenge() {
    var html = '<div class="divider" role="separator"></div><fieldset id="email-verification">'
      + '<legend>A verification code was sent to mehekmandal05@gmail.com. To submit your'
      + ' application, enter the 8-character code to confirm you\\'re a human.</legend>'
      + '<label aria-hidden="true" id="email-verification-label" for="security-input-0">Security code</label>'
      + '<div class="email-verification__wrapper">';
    for (var b = 0; b < CODE_LENGTH; b += 1) {
      html += '<input id="security-input-' + b + '" type="text" aria-invalid="false"'
        + ' aria-errormessage="email-verification-error" aria-required="true" maxlength="1">';
    }
    document.getElementById('challenge').innerHTML = html + '</div></fieldset>';
    boxRefs().forEach(function (box, index) {
      box.addEventListener('input', function (event) { onCodeChange(event, index); });
      box.addEventListener('paste', function (event) { onCodePaste(event, index); });
    });
    securityCode = '';
    setFormDisabled(true);
    document.getElementById('disabled-at-challenge').textContent = String(document.getElementById('submit-btn').disabled);
  }
  document.getElementById('app-form').addEventListener('submit', function (event) {
    event.preventDefault();
    attempts += 1;
    document.getElementById('submitted').textContent = String(attempts);
    var boxes = boxRefs();
    if (boxes.length) {
      document.getElementById('disabled-at-code-submit').textContent = String(document.getElementById('submit-btn').disabled);
      document.getElementById('box-values').textContent = boxes.map(function (box) { return box.value || '_'; }).join('|');
      var typed = securityCode;
      if (!typed) {
        document.getElementById('empty-code-submits').textContent = String(Number(document.getElementById('empty-code-submits').textContent) + 1);
      }
      if (typed === '${CODE}') {
        var done = document.createElement('div');
        done.id = 'confirmation';
        done.textContent = 'Thank you for applying. Your application has been received.';
        /* THE VIEW SWAP IS NOT ATOMIC, and 'linger' is that fact made observable.
         *
         * On a client-rendered embed the receipt commits before the old subtree is unmounted, so
         * there is a window in which the page says the application is in AND the code control the
         * resubmit was aimed at is still attached. networkidle resolves inside that window - there
         * is no request to wait for - so a verdict read off the control alone reads a filed
         * application as a refusal. Measured on the Cresta packet: rejected at 17:35:04Z, and
         * recruiting@cresta.ai wrote "Thank you for applying to Cresta" to that alias at 17:36:04Z.
         *
         * The submit control goes with the receipt, because that is what makes the receipt readable:
         * every arm of readSubmitOutcome is gated on the form being gone. The code fieldset stays. */
        if (location.search.includes('linger=1')) {
          document.getElementById('submit-btn').remove();
          document.body.appendChild(done);
          document.getElementById('filed').textContent = 'yes';
          // 'keep' holds the window open for the whole run. See case 4c for why one case pins it
          // that way and does not rely on a timer.
          if (!location.search.includes('keep=1')) {
            setTimeout(function () { document.getElementById('email-verification').remove(); }, 250);
          }
          return;
        }
        // window.location.assign(confirmationPath). The form goes, and what replaces it is the body
        // of Greenhouse's own confirmation route, fetched read-only from the live Cresta board on
        // 2026-08-10.
        document.getElementById('app-form').remove();
        document.body.appendChild(done);
        document.getElementById('filed').textContent = 'yes';
        return;
      }
      return;
    }
    // A client-rendered ATS can commit the verification step on a later task. The submit click is
    // already real at this point, but there is briefly no navigation, receipt, or code control to
    // observe. The delayed query pins that production shape without slowing the other replay cases.
    if (location.search.includes('delayed=1')) setTimeout(renderChallenge, 250);
    else renderChallenge();
  });
  if (location.search.includes('challenge=1')) renderChallenge();
</script>`;

const server = http.createServer((request, response) => {
  // 'close' matters: a keep-alive socket stops Chromium ever reporting networkidle.
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
  response.end(fixture);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-seccode-'));
fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);

async function replay(actions, options = {}) {
  const pathSuffix = options.pathSuffix || '';
  const runOptions = { ...options };
  delete runOptions.pathSuffix;
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: base + pathSuffix,
    actions,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    ...runOptions
  }));
  fs.rmSync(path.join(workDir, 'stratus-result-0.json'), { force: true });
  const { status, stderr } = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'], {
      cwd: workDir,
      env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
    });
    let captured = '';
    child.stderr.on('data', (chunk) => { captured += chunk; });
    child.stdout.resume();
    child.on('close', (code) => resolve({ status: code, stderr: captured }));
  });
  assert.equal(status, 0, `runner exited ${status}: ${stderr.split('\n').slice(0, 3).join(' ')}`);
  return JSON.parse(fs.readFileSync(path.join(workDir, 'stratus-result-0.json'), 'utf8'));
}

const valueOf = (result, selector) => result.extracted.find((entry) => entry.selector === selector)?.value;

// 1. A FILL RUN CANNOT SUBMIT. The action list is the shape of a real prepare run: fills, then an
//    Enter aimed at a field, and no submit click anywhere. Before the guard, that Enter reached the
//    form and sent an application no one had authorized.
{
  const result = await replay([
    { type: 'fill', selector: '#first_name', value: 'Mehek', label: 'first_name' },
    { type: 'fill', selector: '#email', value: 'mehekmandal05@gmail.com', label: 'email' },
    { type: 'press', selector: '#email', value: 'Enter', label: 'email_confirm' },
    { type: 'extract', selector: '#submitted' }
  ]);
  assert.equal(valueOf(result, '#submitted'), 'no',
    'a run that was not allowed to submit must not have submitted');
  assert.equal(result.blockedSubmits, 1,
    'the blocked submission must be counted and reported, not silently swallowed');
  assert.equal(result.humanVerification, null, 'no submission means no challenge');
  // The fills still happened. A guard that works by breaking the run is not a fix.
  assert.deepEqual(result.filledFields, ['first_name', 'email']);
}

// 2. THE CONTRAST CASE, and the reason case 1 proves anything. The same keystroke on a run that
//    IS allowed to submit goes through. A guard that is always on would pass case 1 while making
//    the product unable to apply for a job.
{
  const result = await replay([
    { type: 'fill', selector: '#email', value: 'mehekmandal05@gmail.com', label: 'email' },
    { type: 'press', selector: '#email', value: 'Enter', label: 'email_confirm' },
    { type: 'extract', selector: '#submitted' }
  ], { allowSubmit: true });
  assert.equal(valueOf(result, '#submitted'), '1', 'an authorized run must still be able to submit');
  assert.equal(result.blockedSubmits, 0, 'nothing is blocked on a run that was allowed to submit');
}

// 3. THE CHALLENGE IS SEEN, AND IT IS READ OFF THE CONTROL. A submit with no code supplied leaves
//    the code group standing, and the run reports what the page is waiting for: how many characters,
//    and which address the code went to. Costing zero actions, which is why it can be read on every
//    run: MANAGED_ACTION_LIMIT is 120 and a real Greenhouse packet reconstructs to exactly 120.
{
  const result = await replay([
    { type: 'fill', selector: '#email', value: 'mehekmandal05@gmail.com', label: 'email' },
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' },
    { type: 'extract', selector: '#submitted' },
    { type: 'extract', selector: '#filed' },
    { type: 'extract', selector: '#disabled-at-challenge' }
  ], { allowSubmit: true });
  assert.equal(valueOf(result, '#submitted'), '1', 'the submit happened');
  assert.equal(valueOf(result, '#filed'), 'no', 'and the employer has nothing: the code gates it');
  assert.equal(result.humanVerification?.kind, 'security_code');
  assert.equal(result.humanVerification?.fieldCount, 8, 'sized off the control, not off the sentence');
  assert.equal(result.humanVerification?.sentTo, 'mehekmandal05@gmail.com');
  assert.equal(result.securityCodeAttempt, null, 'no code was supplied, so none was attempted');
  /* AND THE CHALLENGE IS NOT REPORTED AS EIGHT EMPTY REQUIRED FIELDS.
   *
   * D-01 promoted readSubmitReadiness to the end of EVERY run, so the same scan that withholds the
   * click now writes `blockers` too. The code control is eight empty inputs sitting on the form at
   * exactly the moment that scan runs. If it claimed them, a packet waiting on a code would carry
   * eight junk blocker sentences under its own honest one, and the applicant would be sent looking
   * for form fields to fill instead of an email to open.
   *
   * THIS ASSERTION USED TO PROVE NOTHING. Its comment said Greenhouse marks the boxes with neither
   * the required attribute nor aria-required, and the fixture was built to match that claim. The
   * live bundle says otherwise: aria-required="true" is on all eight, and the readiness scan reads
   * aria-required. The gate now excludes the group on its SHAPE, which is the same structural
   * signal the detector uses, and the fixture now carries the marker that makes the exclusion the
   * thing being tested. */
  assert.deepEqual(result.blockers, [],
    'the code boxes must not be reported as empty required fields, got ' + JSON.stringify(result.blockers));
  assert.equal(valueOf(result, '#disabled-at-challenge'), 'true',
    'Greenhouse disables its own submit the moment the challenge appears');
}

// 3b. THE POST-CLICK TRANSITION CAN BE CLIENT-RENDERED. This action is deliberately last, matching
// a production submit list. A runner that only waits for networkidle sees no network request, reads
// the old form immediately, and reports neither a challenge nor a receipt.
{
  const result = await replay([
    { type: 'fill', selector: '#email', value: 'mehekmandal05@gmail.com', label: 'email' },
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' }
  ], { allowSubmit: true, pathSuffix: '?delayed=1' });
  assert.equal(result.humanVerification?.kind, 'security_code',
    'the runner must observe a delayed client-rendered verification control');
  assert.equal(result.continuationOffered, false,
    'this replay did not request a continuation, so detecting the challenge must not invent one');
}

/* 3c. THE WINDOW OPENS ON THE CHALLENGE, NOT ON THE FORK.
 *
 * This is the case that decides whether a held session is usable at all. The window used to be
 * fixed before phase 0 started, so the fill spent it: a real Greenhouse packet is a hundred-odd
 * actions, and on the measured runs most of a 120 second budget was gone before there was anything
 * to continue. What was left had to cover reading a mailbox and coming back, and when it did not,
 * the only way back to a code field was to SEND THE APPLICATION AGAIN - which is what makes the
 * code stale, because Greenhouse issues a new one on every send.
 *
 * The assertion is a lower bound rather than an equality: the deadline must sit at least most of a
 * full TTL in the future AFTER a run that already spent real time submitting. A fork-clock deadline
 * cannot, by construction, because the run's own elapsed time has already come out of it.
 *
 * The marker is checked too, because the marker is what the claim script actually enforces. A
 * result that advertises a later deadline than the marker allows is worse than no rebase: the
 * caller would spend a continuation it is about to be refused.
 */
{
  const markerPath = path.join(workDir, 'stratus-continuation.json');
  const readyPath = path.join(workDir, 'stratus-continuation-ready.json');
  fs.rmSync(readyPath, { force: true });
  const forkedAt = Date.now();
  fs.writeFileSync(markerPath, JSON.stringify({
    tokenHash: 'token-hash', projectHash: 'project-hash', host: new URL(base).hostname,
    expiresAt: new Date(forkedAt + 15_000).toISOString(), used: false
  }));
  const result = await replay([
    { type: 'fill', selector: '#email', value: 'mehekmandal05@gmail.com', label: 'email' },
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' }
  ], {
    allowSubmit: true,
    requestContinuation: true,
    continuationTtlSeconds: 15,
    continuationExpiresAt: new Date(forkedAt + 15_000).toISOString()
  });
  assert.equal(result.continuationOffered, true, 'a challenge with a continuation requested is a continuation offered');
  const reopened = Date.parse(result.continuationExpiresAt);
  assert.ok(Number.isFinite(reopened), 'the run must report the deadline it is actually holding to');
  assert.ok(reopened - (forkedAt + 15_000) >= 1_000,
    'the window must be measured from the challenge: the run spent ' + result.elapsedMs
    + 'ms getting there, and a fork-clock deadline would already have lost every one of those ms');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  assert.equal(marker.expiresAt, result.continuationExpiresAt,
    'the deadline the caller is told must be the deadline the claim script enforces');
  assert.equal(marker.tokenHash, 'token-hash', 'rebasing the deadline must not disturb what the marker binds to');
  assert.equal(marker.used, false, 'rebasing must not consume the single use');
  assert.equal(JSON.parse(fs.readFileSync(readyPath, 'utf8')).expiresAt, result.continuationExpiresAt);
  assert.equal(fs.existsSync(path.join(workDir, 'stratus-continuation-next.json')), false,
    'the marker is replaced by rename, so no half-written copy may be left where a claim could read it');
  fs.rmSync(markerPath, { force: true });
  fs.rmSync(readyPath, { force: true });
}

// 4. THE CODE FINISHES THE APPLICATION in its own continuation run. That run begins on the changed
//    challenge DOM and carries exactly one atomic action, one receipt pass, and one physical click.
{
  const result = await replay([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'verification_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'verification', securityCode: CODE },
    { type: 'extract', selector: '#submitted' },
    { type: 'extract', selector: '#filed' },
    { type: 'extract', selector: '#empty-code-submits' },
    { type: 'extract', selector: '#box-values' },
    { type: 'extract', selector: '#disabled-at-code-submit' }
  ], { allowSubmit: true, pathSuffix: '?challenge=1' });
  assert.equal(valueOf(result, '#submitted'), '1', 'the continuation makes exactly one submit with the code in it');
  assert.equal(valueOf(result, '#filed'), 'yes', 'and this time the employer has the application');
  /* EIGHT CHARACTERS IN EIGHT BOXES, IN ORDER, and read back off the boxes themselves at the moment
     the form was submitted rather than inferred from the outcome. The widget auto-advances by
     calling select() on the next box after each character, so one focus and eight keystrokes is
     the right shape; on a widget that did not, this is the assertion that would say so. */
  assert.equal(valueOf(result, '#box-values'), CODE.split('').join('|'),
    'each box must hold exactly one character of the code, in order');
  /* AND THE SUBMIT WAS ENABLED WHEN IT WAS PRESSED. Greenhouse re-enables the button from state one
     render after the eighth character. Without the wait for that, the atomic submit's candidate
     filter drops disabled controls and raises "Atomic submit control was missing or ambiguous" over
     a form that was about to be perfectly submittable. */
  assert.equal(valueOf(result, '#disabled-at-code-submit'), 'false',
    'the code must be complete, and the form re-enabled, before the click');
  assert.deepEqual(result.securityCodeAttempt, {
    supplied: true, entered: true, resubmitted: true, outcome: 'accepted'
  });
  assert.equal(valueOf(result, '#empty-code-submits'), '0', 'verification must never click before the changing code is entered');
  assert.equal(result.requiredFieldConfirmation.passes.length, 1);
  assert.equal(result.requiredFieldConfirmation.passes[0].submitKind, 'verification');
  assert.equal(result.humanVerification, null, 'the challenge is gone, which is what accepted means');
  /* AND THE CHALLENGE BEING GONE IS NOT WHAT PROVES IT. The page said so itself, with the form
     replaced by the confirmation body. The backend refuses to write 'submitted' on a code run
     without both this and an 'accepted' code outcome. */
  assert.equal(result.submitOutcome?.state, 'confirmed');
  assert.equal(result.submitOutcome?.formStillPresent, false);
}

/* 4c. A CONFIRMED RECEIPT OUTRANKS A CONTROL THAT HAS NOT UNMOUNTED YET.
 *
 * The false negative this pins is the worst output on the security-code path, and it is worse than a
 * missing verdict: the application HAS been filed, and the applicant is told "the employer did not
 * accept it, so this one needs you: open the portal and finish it there." She then reapplies to a
 * job she already holds an application for, or writes it off.
 *
 * Two things had to change and this case needs both. The branch waits for a post-submit state the
 * way the sibling application submit already did, and the receipt outranks control presence.
 *
 * THE CONTROL NEVER DETACHES HERE, deliberately. A fixture that removed it on a timer would be racy
 * in the direction that hides the bug: if the removal fires before the verdict read, the old code
 * passes too and the case proves nothing. Holding it attached for the whole run makes the assertion
 * impossible to satisfy by accident - the run must decide 'accepted' with the challenge in front of
 * it - and humanVerification is asserted non-null to prove it really was there. */
{
  const result = await replay([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'verification_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'verification', securityCode: CODE },
    { type: 'extract', selector: '#filed' }
  ], { allowSubmit: true, pathSuffix: '?challenge=1&linger=1&keep=1' });
  assert.equal(valueOf(result, '#filed'), 'yes', 'the employer has the application');
  assert.equal(result.submitOutcome?.state, 'confirmed', 'and the page says so');
  assert.equal(result.humanVerification?.kind, 'security_code',
    'the code control is still on the page, which is what makes the next assertion mean something');
  assert.equal(result.securityCodeAttempt?.outcome, 'accepted',
    'a filed application must not be reported as a rejected code because its control has not unmounted');
}

/* 4d. THE SAME THING IN ITS PRODUCTION SHAPE, where the control unmounts a beat after the receipt
 * instead of never. This is the measured Cresta timing, and it is here because a fix that only
 * handled the permanent case would be fitting the fixture rather than the defect.
 *
 * The property under test is that the verdict is STABLE ACROSS THE SWAP WINDOW: whether the run
 * reads the page before or after the unmount, the answer is the same, because the receipt is what
 * decides it either way. Which side of the window the read lands on depends on how fast the machine
 * is - the same suite measured 12s and 140s on one laptop - so nothing here asserts the end-of-run
 * challenge state. An assertion that a timer had fired would be testing the host, and case 4c
 * already pins the hard side of the window deterministically. */
{
  const result = await replay([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'verification_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'verification', securityCode: CODE },
    { type: 'extract', selector: '#filed' }
  ], { allowSubmit: true, pathSuffix: '?challenge=1&linger=1' });
  assert.equal(valueOf(result, '#filed'), 'yes');
  assert.equal(result.submitOutcome?.state, 'confirmed');
  assert.equal(result.securityCodeAttempt?.outcome, 'accepted');
}

// 4b. THE PRODUCTION SHAPE THAT FAILED, and the reason the code now travels on a continuation.
//
//     Packet 9810bdcf-fc3d-44bb-a8cb-b09c51aaf131, Cresta, 2026-08-09. The finishing run was given
//     the whole packet action list with the code hung on its terminal atomic submit. That list
//     begins with a fresh page load, so at the moment the atomic action ran there was no code
//     control on the page at all - Greenhouse only renders one in answer to a submit it has
//     refused. The runner reported no_control and threw, and the receipt shows eight empty boxes
//     under a fully populated form.
//
//     The runner's refusal is correct and stays: typing must come before the click, so an atomic
//     verification submit on a page with no code control has nothing it can honestly do. What
//     changed is the caller, which now sends this action only as a continuation of the run that
//     raised the challenge. This case pins the runner half.
{
  let failed = null;
  try {
    await replay([
      { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'verification_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'verification', securityCode: CODE }
    ], { allowSubmit: true });
  } catch (error) {
    failed = error;
  }
  assert.ok(failed, 'a verification submit with no code control on the page must not proceed');
  assert.match(String(failed.message), /Security code was not entered before atomic verification/);
}

// 5. A WRONG CODE IS REPORTED AS WRONG. It must not read as accepted, and it must not read as a
//    generic failure either: the applicant needs to know the application is still sitting behind
//    the same check and a fresh code is in her mailbox.
{
  const result = await replay([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'verification_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'verification', securityCode: 'AAAAAAAA' },
    { type: 'extract', selector: '#filed' },
    { type: 'extract', selector: '#empty-code-submits' }
  ], { allowSubmit: true, pathSuffix: '?challenge=1' });
  assert.equal(valueOf(result, '#filed'), 'no');
  assert.equal(result.securityCodeAttempt?.outcome, 'rejected');
  assert.equal(valueOf(result, '#empty-code-submits'), '0');
  assert.equal(result.humanVerification?.kind, 'security_code', 'the challenge is still standing');
}

// 6. THE LEGEND IS NOT A CHALLENGE. '* indicates a required field' is on the fixture from first
//    paint, exactly as it is on every Greenhouse form. A run that never submitted must report no
//    challenge at all. This is the regression that a text-matching detector would ship.
{
  const result = await replay([
    { type: 'fill', selector: '#first_name', value: 'Mehek', label: 'first_name' },
    { type: 'extract', selector: '.legend' }
  ]);
  assert.match(valueOf(result, '.legend'), /indicates a required field/,
    'the legend really is on the page, so case 6 is testing something');
  assert.equal(result.humanVerification, null, 'and it is not a security-code challenge');
}

server.close();
fs.rmSync(workDir, { recursive: true, force: true });
console.log('security-code replay: 10 cases passed');
