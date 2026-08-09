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
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODE = 'TPHJrFMJ';

// A Greenhouse application form, reduced to the parts that decide the outcome.
//
// novalidate for the same reason the other fixture uses it: with native validation on, an empty
// required field would stop the submission by itself and a guard that did nothing would look like a
// guard that worked. Greenhouse validates in JavaScript.
//
// The legend is present ON PURPOSE. '* indicates a required field' is on every Greenhouse form ever
// rendered, including every one with no challenge at all, and this repo has already shipped one
// gate that keyed on page text. Case 5 asserts the detector ignores it.
const fixture = `<!doctype html><meta charset="utf-8"><title>Security Code Fixture</title>
<form id="app-form" novalidate>
  <label for="first_name">First Name</label><input id="first_name" type="text">
  <label for="email">Email</label><input id="email" type="text">
  <p class="legend">* indicates a required field</p>
  <div id="challenge"></div>
  <button id="submit-btn" type="submit">Submit application</button>
</form>
<div id="submitted">no</div>
<div id="filed">no</div>
<div id="empty-code-submits">0</div>
<script>
  var attempts = 0;
  function renderChallenge() {
    var html = '<p>A verification code was sent to mehekmandal05@gmail.com. To submit your'
      + ' application, enter the 8-character code to confirm you\\'re a human.</p>'
      + '<label id="code-label">Security code</label><div id="code-group">';
    for (var b = 0; b < 8; b += 1) {
      html += '<input class="code-box" type="text" maxlength="1" autocomplete="one-time-code"'
        + ' aria-labelledby="code-label">';
    }
    document.getElementById('challenge').innerHTML = html + '</div>';
  }
  // What Greenhouse does. The first submit does not file the application: it emails a code and
  // renders the code field. Only a submit carrying the right code files anything.
  document.getElementById('app-form').addEventListener('submit', function (event) {
    event.preventDefault();
    attempts += 1;
    document.getElementById('submitted').textContent = String(attempts);
    var boxes = document.querySelectorAll('.code-box');
    if (boxes.length) {
      var typed = '';
      for (var i = 0; i < boxes.length; i += 1) typed += boxes[i].value || '';
      if (!typed) {
        document.getElementById('empty-code-submits').textContent = String(Number(document.getElementById('empty-code-submits').textContent) + 1);
      }
      if (typed === '${CODE}') {
        document.getElementById('challenge').innerHTML = '';
        document.getElementById('filed').textContent = 'yes';
        return;
      }
      return;
    }
    renderChallenge();
  });
  if (location.search.includes('challenge=1')) renderChallenge();
  // A boxed code group that auto-advances, which is what makes focus-and-type the right first
  // strategy for entering one.
  document.addEventListener('input', function (event) {
    if (!event.target.classList || !event.target.classList.contains('code-box')) return;
    var boxes = [].slice.call(document.querySelectorAll('.code-box'));
    var index = boxes.indexOf(event.target);
    if (event.target.value && index >= 0 && index < boxes.length - 1) boxes[index + 1].focus();
  });
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
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: { name: 'litos-final-submit', version: 1 }, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' },
    { type: 'extract', selector: '#submitted' },
    { type: 'extract', selector: '#filed' }
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
   * for form fields to fill instead of an email to open. It does not claim them, because Greenhouse
   * marks them with neither the required attribute, nor aria-required, nor a `_required_` label
   * class - which is the whole reason this detector reads the control's SHAPE instead. */
  assert.deepEqual(result.blockers, [],
    'the code boxes must not be reported as empty required fields, got ' + JSON.stringify(result.blockers));
}

// 4. THE CODE FINISHES THE APPLICATION in its own continuation run. That run begins on the changed
//    challenge DOM and carries exactly one atomic action, one receipt pass, and one physical click.
{
  const result = await replay([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: { name: 'litos-final-submit', version: 1 }, label: 'verification_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'verification', securityCode: CODE },
    { type: 'extract', selector: '#submitted' },
    { type: 'extract', selector: '#filed' },
    { type: 'extract', selector: '#empty-code-submits' }
  ], { allowSubmit: true, pathSuffix: '?challenge=1' });
  assert.equal(valueOf(result, '#submitted'), '1', 'the continuation makes exactly one submit with the code in it');
  assert.equal(valueOf(result, '#filed'), 'yes', 'and this time the employer has the application');
  assert.deepEqual(result.securityCodeAttempt, {
    supplied: true, entered: true, resubmitted: true, outcome: 'accepted'
  });
  assert.equal(valueOf(result, '#empty-code-submits'), '0', 'verification must never click before the changing code is entered');
  assert.equal(result.requiredFieldConfirmation.passes.length, 1);
  assert.equal(result.requiredFieldConfirmation.passes[0].submitKind, 'verification');
  assert.equal(result.humanVerification, null, 'the challenge is gone, which is what accepted means');
}

// 5. A WRONG CODE IS REPORTED AS WRONG. It must not read as accepted, and it must not read as a
//    generic failure either: the applicant needs to know the application is still sitting behind
//    the same check and a fresh code is in her mailbox.
{
  const result = await replay([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: { name: 'litos-final-submit', version: 1 }, label: 'verification_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'verification', securityCode: 'AAAAAAAA' },
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
console.log('security-code replay: 6 cases passed');
