import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = `<!doctype html><meta charset="utf-8"><title>Required confirmation replay</title>
<form id="newsletter"><div class="field"><label for="newsletter-email">Newsletter email</label><input id="newsletter-email" required value="newsletter@example.com" aria-invalid="true"><span id="newsletter-error">This requires an answer</span></div><button>Subscribe</button><input type="button" value="Search"><span role="button">Join newsletter</span></form>
<form id="application" novalidate>
  <div class="field"><label for="text">Name *</label><input id="text" value="Mehek Mandal" aria-invalid="true"><span>This requires an answer</span></div>
  <div class="field"><label for="email-field">Email</label><input id="email-field" type="email" required value="mehek@example.com" aria-invalid="true"><span>This requires an answer</span></div>
  <div class="field"><label for="phone-field">Phone</label><input id="phone-field" type="tel" required value="+971501234567" aria-invalid="true"><span>This requires an answer</span></div>
  <div class="field"><label for="essay">Why this role?</label><textarea id="essay" required aria-invalid="true">Because it fits.</textarea><span>This requires an answer</span></div>
  <div class="field"><label for="resume">Resume</label><input id="resume" type="file" required><div id="file-state"></div></div>
  <div class="field"><label for="date">Start date</label><input id="date" type="date" required value="2026-08-10" aria-invalid="true"><span>This requires an answer</span></div>
  <div class="field"><label for="question_123[]">Bracket question</label><input id="question_123[]" required value="Already committed"></div>
  <div class="field select__container"><label for="react">Location</label><div class="select__single-value">Dubai</div><input id="react" role="combobox" aria-required="true" aria-invalid="true"><span>This requires an answer</span></div>
  <div class="field"><label for="select">Country</label><select id="select" required aria-invalid="true"><option selected>United Arab Emirates</option></select><span>This requires an answer</span></div>
  <fieldset><legend>Work authorized</legend><input id="radio" name="work" type="radio" required checked aria-invalid="true"><label for="radio">Yes</label><span>This requires an answer</span></fieldset>
  <div class="field"><label for="checkbox">I agree</label><input id="checkbox" type="checkbox" required checked aria-invalid="true"><span>This requires an answer</span></div>
  <div id="custom" class="field" role="group" aria-required="true" aria-invalid="true"><label>Schedule</label><button type="button" class="_active_test">Weekdays</button><span>This requires an answer</span></div>
  <button id="application-submit" type="submit">Submit application</button>
</form>
<div id="submitted"></div>
<div id="checkbox-state"></div><div id="checkbox-clicks">0</div><div id="custom-state">selected</div>
<script>
  function clear(id) {
    var control = document.getElementById(id);
    control.setAttribute('aria-invalid', 'false');
    var error = control.closest('.field, fieldset').querySelector('span');
    if (error) error.remove();
  }
  document.getElementById('newsletter-email').addEventListener('blur', function () { clear('newsletter-email'); });
  ['text', 'email-field', 'phone-field', 'essay', 'date'].forEach(function (id) {
    document.getElementById(id).addEventListener('blur', function () { clear(id); });
  });
  document.getElementById('text').addEventListener('blur', function () {
    if (location.search.includes('replace-submit')) {
      var oldSubmit = document.getElementById('application-submit');
      oldSubmit.replaceWith(oldSubmit.cloneNode(true));
    }
    if (location.search.includes('scan-exception')) {
      document.getElementById('application').querySelectorAll = function () { throw new Error('injected scoped scan failure'); };
    }
  });
  var transfer = new DataTransfer();
  transfer.items.add(new File(['resume'], 'resume.pdf', { type: 'application/pdf' }));
  document.getElementById('resume').files = transfer.files;
  document.getElementById('file-state').textContent = document.getElementById('resume').files[0].name;
  document.getElementById('react').addEventListener('click', function () { clear('react'); });
  document.getElementById('select').addEventListener('change', function () { clear('select'); });
  document.querySelector('label[for="radio"]').addEventListener('click', function () { clear('radio'); });
  document.getElementById('checkbox').addEventListener('click', function () {
    var clicks = document.getElementById('checkbox-clicks');
    clicks.textContent = String(Number(clicks.textContent) + 1);
  });
  document.getElementById('checkbox').addEventListener('change', function () {
    document.getElementById('checkbox-state').textContent = String(this.checked);
    clear('checkbox');
  });
  if (!location.search.includes('leave-custom-invalid')) {
    document.querySelector('#custom button').addEventListener('click', function () {
      var control = document.getElementById('custom');
      var selected = this.classList.toggle('_active_test');
      document.getElementById('custom-state').textContent = selected ? 'selected' : 'deselected';
      control.setAttribute('aria-invalid', 'false');
      if (control.querySelector('span')) control.querySelector('span').remove();
    });
  }
  var submitShape = new URLSearchParams(location.search).get('submit-shape');
  var submitLabel = new URLSearchParams(location.search).get('submit-label');
  if (submitLabel) document.getElementById('application-submit').textContent = submitLabel;
  if (location.search.includes('sole-continue')) document.getElementById('application-submit').textContent = 'Continue';
  if (location.search.includes('sole-linkedin')) document.getElementById('application-submit').textContent = 'Apply with LinkedIn';
  if (submitShape) {
    var original = document.getElementById('application-submit');
    var replacement;
    if (submitShape === 'button-default') {
      replacement = document.createElement('button');
      replacement.textContent = 'Submit application';
    } else if (submitShape === 'input-image') {
      replacement = document.createElement('input');
      replacement.type = 'image';
      replacement.alt = 'Submit application';
      replacement.setAttribute('aria-label', 'Submit application');
    } else if (submitShape === 'input-button') {
      replacement = document.createElement('input');
      replacement.type = 'button';
      replacement.value = 'Submit application';
      replacement.addEventListener('click', function () { this.form.requestSubmit(); });
    } else if (submitShape === 'role-button') {
      replacement = document.createElement('span');
      replacement.setAttribute('role', 'button');
      replacement.textContent = 'Submit application';
      replacement.addEventListener('click', function () { this.closest('form').requestSubmit(); });
    }
    replacement.id = 'application-submit';
    original.replaceWith(replacement);
  }
  document.getElementById('application').addEventListener('submit', function (event) {
    event.preventDefault();
    document.getElementById('submitted').textContent = 'yes';
    fetch('/record-submit', { method: 'POST' });
  });
</script>`;

let submissionCount = 0;
const server = http.createServer((request, response) => {
  if (request.url === '/record-submit') {
    submissionCount += 1;
    response.writeHead(204, { connection: 'close' });
    response.end();
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
  response.end(fixture);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-confirm-replay-'));
fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);
const confirmedSubmitActions = [
  { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: { name: 'litos-final-submit', version: 1 }, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' },
  { type: 'extract', selector: '#submitted' },
  { type: 'extract', selector: '#text', attribute: 'value' },
  { type: 'extract', selector: '.select__single-value' },
  { type: 'extract', selector: '#custom button' },
  { type: 'extract', selector: '#custom-state' },
  { type: 'extract', selector: '#checkbox-state' },
  { type: 'extract', selector: '#checkbox-clicks' },
  { type: 'extract', selector: '#newsletter-error' },
  { type: 'extract', selector: '#file-state' }
];

async function replay(suffix = '', actions = confirmedSubmitActions) {
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: `http://127.0.0.1:${server.address().port}/${suffix}`,
    actions,
    allowSubmit: true,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 }
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

async function replayFailure(suffix) {
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: `http://127.0.0.1:${server.address().port}/${suffix}`,
    actions: [confirmedSubmitActions[0]],
    allowSubmit: true,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 }
  }));
  fs.rmSync(path.join(workDir, 'stratus-result-0.json'), { force: true });
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'], {
      cwd: workDir,
      env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
    });
    child.stderr.resume();
    child.stdout.resume();
    child.on('close', resolve);
  });
}

const result = await replay();
assert.equal(result.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
assert.equal(result.extracted.find((entry) => entry.selector === '#text')?.value, 'Mehek Mandal');
assert.deepEqual(result.blockers, []);
assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
assert.equal(result.requiredFieldConfirmation.version, 2);
assert.equal(result.requiredFieldConfirmation.passes.length, 1);
const applicationPass = result.requiredFieldConfirmation.passes[0];
assert.equal(applicationPass.scope.requiredControlCount, 12);
assert.equal(applicationPass.requiredControls.length, 12);
assert.ok(applicationPass.requiredControls.every((control) => control.matchCount === 1));
assert.equal(applicationPass.attempts.length, 12);
assert.deepEqual(applicationPass.unresolved, []);
assert.equal(applicationPass.scope.sameNode, true);
assert.equal(applicationPass.submissionOutcome, 'clicked');
assert.deepEqual(new Set(applicationPass.attempts.map((attempt) => attempt.fieldType)), new Set([
  'text', 'date', 'select', 'react-select', 'radio', 'checkbox', 'custom', 'file'
]));
assert.ok(applicationPass.attempts.every((attempt) => ['confirmed', 'already_committed'].includes(attempt.outcome)));
assert.ok(applicationPass.attempts.every((attempt) => attempt.attemptCount === 1));
assert.equal(applicationPass.retries, 0);
assert.ok(applicationPass.attempts.every((attempt) => /^(?:#|\[data-litos-stable-id-v1=)/.test(attempt.selector)));
const bracketed = applicationPass.attempts.find((attempt) => attempt.label === 'Bracket question');
assert.match(bracketed?.selector || '', /^\[data-litos-stable-id-v1="v2-[a-f0-9]{24}-\d+"\]$/);
assert.equal(bracketed?.outcome, 'already_committed');
assert.equal(result.extracted.find((entry) => entry.selector === '.select__single-value')?.value, 'Dubai');
assert.equal(result.extracted.find((entry) => entry.selector === '#custom button')?.value, 'Weekdays');
assert.equal(result.extracted.find((entry) => entry.selector === '#custom-state')?.value, 'selected');
assert.equal(result.extracted.find((entry) => entry.selector === '#checkbox-state')?.value, 'true');
assert.equal(result.extracted.find((entry) => entry.selector === '#checkbox-clicks')?.value, '0');
assert.equal(result.extracted.find((entry) => entry.selector === '#newsletter-error')?.value, 'This requires an answer');
assert.equal(result.extracted.find((entry) => entry.selector === '#file-state')?.value, 'resume.pdf');
assert.equal(applicationPass.attempts.find((attempt) => attempt.selector === '#resume')?.outcome, 'already_committed');

const refused = await replay('?leave-custom-invalid');
assert.equal(refused.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.equal(refused.requiredFieldConfirmation.status, 'blocked');
assert.equal(refused.requiredFieldConfirmation.passes[0].unresolved.length, 1);
assert.equal(refused.requiredFieldConfirmation.passes[0].retries, 1);
assert.equal(refused.requiredFieldConfirmation.passes[0].attempts.find((attempt) => attempt.selector === '#custom')?.attemptCount, 2);
assert.ok(refused.blockers.some((message) => /Schedule.*could not be confirmed/.test(message)));
assert.ok(refused.skipped.some((message) => /atomic confirmation blocked submission/.test(message)));

for (const shape of ['button-default', 'input-image', 'input-button', 'role-button']) {
  const shaped = await replay('?submit-shape=' + shape);
  assert.equal(shaped.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes', shape + ' must be selected and clicked atomically');
  assert.equal(shaped.requiredFieldConfirmation.status, 'confirmed');
}

for (const label of ['Submit your application', 'Submit the application', 'Send your application']) {
  const labelled = await replay('?submit-label=' + encodeURIComponent(label));
  assert.equal(labelled.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes', label + ' must satisfy chooser policy v1');
  assert.equal(labelled.requiredFieldConfirmation.status, 'confirmed');
}

const replaced = await replay('?replace-submit');
assert.equal(replaced.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.equal(replaced.requiredFieldConfirmation.status, 'blocked');
assert.equal(replaced.requiredFieldConfirmation.passes[0].scope.sameNode, false);
assert.equal(replaced.requiredFieldConfirmation.passes[0].blockerReason, 'submit_node_replaced');
assert.equal(replaced.requiredFieldConfirmation.passes[0].submissionOutcome, 'blocked');

const scanFailure = await replay('?scan-exception');
assert.equal(scanFailure.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.equal(scanFailure.requiredFieldConfirmation.status, 'blocked');
assert.ok(scanFailure.requiredFieldConfirmation.passes[0].unresolved.includes('Required-field readiness scan failed'));

for (const handoff of [
  '?sole-continue',
  '?sole-linkedin',
  '?submit-label=Next',
  '?submit-label=Finish',
  '?submit-label=' + encodeURIComponent('Complete application'),
  '?submit-label=' + encodeURIComponent('Finish application'),
  '?submit-label=' + encodeURIComponent('Submit application via Wellfound'),
  '?submit-label=' + encodeURIComponent('Submit application with recruiting partner'),
  '?submit-label=' + encodeURIComponent('Submit application feedback'),
  '?submit-label=' + encodeURIComponent('Submit application using Career Services'),
  '?submit-label=' + encodeURIComponent('Send application from recruiting partner'),
  '?submit-label=' + encodeURIComponent('Submit a support request'),
  '?submit-label=' + encodeURIComponent('Submit your question'),
  '?submit-label=' + encodeURIComponent('Sign in with Google'),
  '?submit-label=' + encodeURIComponent('Import profile')
]) {
  const before = submissionCount;
  assert.notEqual(await replayFailure(handoff), 0, handoff + ' must fail closed as a non-final control');
  assert.equal(submissionCount, before, handoff + ' must not be clicked');
}

const missingProof = await replay('', [
  { type: 'click', selector: 'button[type="submit"]', label: 'final_submit' },
  { type: 'extract', selector: '#submitted' }
]);
assert.equal(missingProof.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.ok(missingProof.blockers.includes('Required-field confirmation proof is missing or malformed'));
server.close();
console.log('required confirmation replay: exact affected controls commit and verify before one final submit');
