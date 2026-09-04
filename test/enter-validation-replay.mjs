/* THE KEYSTROKE THAT COVERS A CORRECTLY FILLED FORM IN RED, RUN THROUGH THE SHIPPED RUNNER.
 *
 * test/enter-field-local-job-dom.test.js executes the RULE. This executes the RUNNER: same runner
 * string, same stratus-input.json / stratus-result-0.json protocol, same `node stratus-runner.cjs`
 * invocation as executeSandboxRun, with only the sandbox and its preinstalled Playwright replaced
 * by test/managed-runner-shim.cjs. It exists because a rule a test can reach is not a rule
 * production calls: this repo has already shipped a gate whose library tests were lethal under
 * mutation while reverting the call site left the whole suite green.
 *
 * THE FIXTURE REPRODUCES THE MECHANISM, MEASURED, NOT A CARICATURE OF IT. Read off the live Hudson
 * River Trading Greenhouse form (job-boards.greenhouse.io/embed/job_app?for=wehrtyou&token=8052083),
 * read-only, 2026-09-04:
 *
 *   1. Enter runs the form's whole validator from the page's OWN key handler. No submit event is
 *      dispatched and form.submit() is never called, so the runner's default-deny submit guard sees
 *      nothing: measured with that guard installed verbatim, the messages rendered and
 *      window.__litosBlockedSubmits stayed 0.
 *   2. A message, once rendered, is never retracted. Filling the control afterwards leaves the red
 *      sentence standing over the answer, and only another whole-form validation pass clears it.
 *   3. A choice control consumes Enter only while its own listbox is offering rows. On "No options"
 *      the listbox holds zero rows, nothing consumes the keystroke, and it reaches the form.
 *
 * Numbers from that page: one Enter in '#first_name', after twenty fields had been filled correctly
 * and with no message anywhere, rendered 7. One Enter on a menu reading "No options" rendered 13.
 * The six the applicant photographed are the required controls that were still empty at that
 * instant, each showing its correct value under "This field is required.".
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const providerDeadlineAt = () => new Date(Date.now() + 120_000).toISOString();

const fixture = `<!doctype html><meta charset="utf-8"><title>Enter Validation Fixture</title>
<form id="application-form" action="/apply" method="post">
  <label for="first_name">First Name*</label>
  <input id="first_name" type="text">
  <div id="first_name-error"></div>

  <label for="cover">Cover letter</label>
  <textarea id="cover"></textarea>

  <!-- A choice control offering rows: Enter takes the highlighted one and stops there. -->
  <div class="select-shell" id="offered-shell">
    <div class="select__control"><input id="offered" role="combobox" aria-expanded="true" aria-controls="offered-listbox" autocomplete="off"></div>
    <div class="select__menu"><div id="offered-listbox" role="listbox">
      <div role="option" class="select__option select__option--is-focused">Yes</div>
      <div role="option" class="select__option">No</div>
    </div></div>
  </div>
  <div id="offered-taken">offered-took:nothing</div>

  <!-- The same widget on "No options": the state a fill attempt that matched no row leaves behind. -->
  <div class="select-shell" id="barren-shell">
    <div class="select__control"><input id="barren" role="combobox" aria-expanded="true" aria-controls="barren-listbox" autocomplete="off"></div>
    <div class="select__menu"><div id="barren-listbox" role="listbox"><div class="select__menu-notice">No options</div></div></div>
  </div>
  <div id="barren-taken">barren-took:nothing</div>

  <!-- A required control that is ALREADY ANSWERED, under a message from an earlier pass that this
       form will never take back. This is the shape the applicant photographed, and the only thing
       that used to happen to it was that the readiness gate counted it and said nothing. -->
  <div class="field" id="stale-block">
    <label for="stale_gpa">What is your overall college/university GPA?</label>
    <input id="stale_gpa" type="text" required value="3.76 - 4.0">
    <div class="error-message">This field is required.</div>
  </div>
</form>

<!-- Outside every form: an Enter here has no validator to run and no form to send, so the guard
     must leave it alone. Without a case on this side of the rule, shimming the containment test to
     "always inside a form" is invisible to this file. -->
<input id="loose" type="text">

<div id="validation-runs">validations:0</div>

<script>
  var runs = 0;
  function runFormValidation() {
    runs += 1;
    document.getElementById('validation-runs').textContent = 'validations:' + runs;
    if (!document.getElementById('first_name').value) {
      document.getElementById('first_name-error').textContent = 'This field is required.';
    }
  }
  // The control's own handler, in the bubble phase, exactly like the widget on the live form: it
  // consumes the keystroke only while it has a row to take, and otherwise lets it through.
  function wireChoice(id, listboxId, echoId) {
    var control = document.getElementById(id);
    control.addEventListener('keydown', function (event) {
      if (event.key !== 'Enter') return;
      var rows = document.getElementById(listboxId).querySelectorAll('[role="option"]');
      if (rows.length === 0) return;
      event.preventDefault();
      event.stopPropagation();
      document.getElementById(echoId).textContent = echoId.replace('-taken', '') + '-took:' + rows[0].textContent;
      control.setAttribute('aria-expanded', 'false');
    });
  }
  wireChoice('offered', 'offered-listbox', 'offered-taken');
  wireChoice('barren', 'barren-listbox', 'barren-taken');
  // THE FORM'S OWN VALIDATOR, reached by a keystroke nothing else consumed. No submit event is
  // dispatched, which is why the runner's submit guard cannot be the thing that stops this.
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Enter') return;
    // Scoped to the form it belongs to, and blind to a textarea, which is what a real form does:
    // Enter is a newline there and nothing else.
    if (!event.target || !event.target.closest || !event.target.closest('#application-form')) return;
    if (event.target.tagName === 'TEXTAREA') return;
    event.preventDefault();
    runFormValidation();
  });
</script>`;

const server = http.createServer((request, response) => {
  // 'close' matters: a keep-alive socket stops Chromium ever reporting networkidle.
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
  response.end(fixture);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-enter-replay-'));
fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);

async function replay(actions, options = {}) {
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    providerDeadlineAt: providerDeadlineAt(),
    url: base,
    actions,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    ...options
  }));
  fs.rmSync(path.join(workDir, 'stratus-result-0.json'), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
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

const withheld = (result) => result.skipped.filter((line) => /Enter withheld/.test(line));
// The fixture renders "This field is required." exactly once by construction, in the stale block.
// A second occurrence is the validator having run.
const requiredSentences = (result) => (String(result.text || '').match(/This field is required\./g) || []).length;
// Each choice control echoes the row a keydown it CONSUMED took, so the echo distinguishes a
// keystroke the widget handled from one that fell through to the form.
const takenBy = (result, id) => {
  const found = new RegExp(id + '-took:(\\S+)').exec(result.text || '');
  assert.notEqual(found, null, id + ' must publish what its keydown handler took');
  return found[1];
};
const validationRuns = (result) => {
  const found = /validations:(\d+)/.exec(result.text || '');
  assert.notEqual(found, null, 'fixture must report how many times its validator ran');
  return Number(found[1]);
};

/* 1. THE MEASURED HARM. An Enter aimed at a plain control inside the form. */
{
  const result = await replay([
    { type: 'press', value: 'Enter', selector: '#first_name', label: 'commit_name', optional: false }
  ]);
  assert.equal(validationRuns(result), 0, 'the employer validator must never have run');
  // And counted rather than merely absent: the fixture's stale block renders that sentence once
  // by construction, so "one" is the page untouched and "two" is the validator having run.
  assert.equal(requiredSentences(result), 1, 'no NEW validation message may have been rendered');
  const lines = withheld(result);
  assert.equal(lines.length, 1, `expected exactly one withholding, got ${JSON.stringify(result.skipped)}`);
  assert.match(lines[0], /commit_name: Enter withheld, #first_name is inside the application form/);
  assert.match(lines[0], /could only have run the employer validation over the fields not filled yet/);
  /* AND THE SUBMIT GUARD IS NOT WHAT STOPPED IT, which is the whole reason this rule has to exist.
   * The fixture reaches its validator without dispatching a submit event, exactly as the live form
   * does, so the guard's counter stays at zero through a keystroke it cannot see. If that counter
   * ever reads non-zero here the fixture has stopped reproducing the mechanism and every assertion
   * above it is being proved by the wrong lock. */
  assert.equal(result.blockedSubmits, 0, 'the fixture must reach its validator without a submit event');
}

/* 2. THE CASE THE GUARD MUST NOT BREAK. Enter on a menu that is offering rows. */
{
  const result = await replay([
    { type: 'press', value: 'Enter', selector: '#offered', label: 'commit_choice', optional: false }
  ]);
  assert.equal(withheld(result).length, 0, `nothing should be withheld here: ${JSON.stringify(result.skipped)}`);
  // Delivered, and the proof is the widget's own echo: it only writes a row when a keydown it
  // consumed found one to take.
  assert.equal(takenBy(result, 'offered'), 'Yes', 'the widget takes its highlighted row');
  assert.equal(takenBy(result, 'barren'), 'nothing', 'and nothing else was touched');
  assert.equal(validationRuns(result), 0, 'and the keystroke stops at the widget');
  assert.equal(requiredSentences(result), 1);
}

/* 3. THE STATE A FAILED FILL LEAVES BEHIND. Enter on an open menu offering nothing. */
{
  const result = await replay([
    { type: 'press', value: 'Enter', selector: '#barren', label: 'commit_gpa', optional: false }
  ]);
  assert.equal(validationRuns(result), 0);
  const lines = withheld(result);
  assert.equal(lines.length, 1, `expected exactly one withholding, got ${JSON.stringify(result.skipped)}`);
  assert.match(lines[0], /#barren is a choice control whose open menu is offering nothing to take/);
}

/* 4. THE ARM THAT RAN NO GUARD AT ALL. A press with no selector still lands somewhere. */
{
  const result = await replay([
    { type: 'click', selector: '#first_name', label: 'focus_name', optional: false },
    { type: 'press', value: 'Enter', label: 'commit_wherever_focus_is', optional: false }
  ]);
  assert.equal(validationRuns(result), 0, 'an unaimed Enter reaches the form exactly as an aimed one does');
  const lines = withheld(result);
  assert.equal(lines.length, 1, `expected exactly one withholding, got ${JSON.stringify(result.skipped)}`);
  assert.match(lines[0], /Enter withheld, the focused control is inside the application form/);
}

/* 5. THE TWO SHAPES THAT KEEP THEIR ENTER FOR A REASON THAT IS NOT ABOUT MENUS. A control outside
 *    every form has no validator to reach; a textarea's Enter is a newline and reaches nothing. A
 *    guard that withheld these would cost answers and buy no safety at all. */
{
  const result = await replay([
    { type: 'press', value: 'Enter', selector: '#loose', label: 'loose_commit', optional: false },
    { type: 'press', value: 'Enter', selector: '#cover', label: 'cover_newline', optional: false }
  ]);
  assert.equal(withheld(result).length, 0, `neither may be withheld: ${JSON.stringify(result.skipped)}`);
  assert.equal(validationRuns(result), 0);
  assert.equal(requiredSentences(result), 1);
}

/* 6. A KEY THAT IS NOT ENTER IS UNTOUCHED, aimed or not. Nothing above may quietly become a rule
 *    about presses in general: Tab and Escape are how this runner commits and dismisses. */
{
  const result = await replay([
    { type: 'press', value: 'Tab', selector: '#first_name', label: 'leave_name', optional: false },
    { type: 'press', value: 'Escape', label: 'dismiss', optional: false }
  ]);
  assert.equal(withheld(result).length, 0, `no press but Enter is judged: ${JSON.stringify(result.skipped)}`);
  assert.equal(validationRuns(result), 0);
}

/* 7. AND THE SCOPE, WHICH IS THE HALF THAT KEEPS THE PRODUCT ABLE TO APPLY. A run that WAS asked to
 *    submit keeps every keystroke it always had. Its authorized send goes through confirmAndSubmit,
 *    not through a keystroke, and this rule has no business on the riskiest surface in the product.
 *    Without this case the rule could be widened to every run and nothing here would notice. */
{
  const result = await replay([
    { type: 'press', value: 'Enter', selector: '#first_name', label: 'commit_name', optional: false }
  ], { allowSubmit: true });
  assert.equal(withheld(result).length, 0, `an authorized run keeps its Enter: ${JSON.stringify(result.skipped)}`);
  assert.equal(validationRuns(result), 1, 'and the keystroke does what the caller asked for');
}

/* 8. AND THE ONE THING THE APPLICANT CAN SEE IS SAID OUT LOUD. A message standing over a control
 *    that is answered is counted by the readiness gate on every run; until now the number was
 *    computed and dropped, so a screenshot covered in red and a fill that had failed produced
 *    identical records. */
{
  const result = await replay([{ type: 'extract', selector: 'title' }]);
  const line = result.skipped.find((entry) => entry.startsWith('form_rendering:'));
  assert.ok(line, `expected a form_rendering line, got ${JSON.stringify(result.skipped)}`);
  assert.match(line, /the form is still showing 1 validation message\(s\) left over from an earlier pass/);
  assert.match(line, /over fields that are now filled, so the screenshot shows those fields in red/);
  // It is a report, never a refusal: a stale message must not turn a complete application into a
  // blocked one, which is the false-positive history this half of the gate carries.
  assert.ok(
    !result.blockers.some((entry) => /overall college\/university GPA/.test(entry)),
    `an answered field must not be blocked over a leftover message: ${JSON.stringify(result.blockers)}`
  );
}

server.close();
fs.rmSync(workDir, { recursive: true, force: true });
console.log('enter-validation replay: ok');
