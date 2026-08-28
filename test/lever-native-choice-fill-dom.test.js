/* A LEVER MULTIPLE-CHOICE ANSWER WHOSE ONLY DURABLE NAME IS ITS RADIO GROUP, run through the
 * shipped runner against the markup that lost it.
 *
 * Measured in production 2026-08-28, AFTER PR #114 deployed, on two live jobs.lever.co postings:
 *
 *   - DGA (application c3093dee): the two required radios - "Are you authorized to work lawfully
 *     in the United States?" (Yes) and "Have you ever been dismissed, terminated, fired..." (No) -
 *     read back '"..." is required and is still empty' after every fill, across three runs.
 *   - Mytos (application 55de7c9e): a run that filled everything and found the submit control
 *     still stopped without pressing it, because a required answer could not be confirmed.
 *
 * The DGA page (captured read-only the same day) renders each question as a bare label-wrapped
 * group inside '<li class="application-question custom-question">':
 *
 *   <ul data-qa="multiple-choice">
 *     <li><label><input type="radio" name="cards[<uuid>][field0]" value="Yes" required>
 *         <span class="application-answer-alternative">Yes</span></label></li>
 *     <li><label><input type="radio" name="cards[<uuid>][field0]" value="No" required>
 *         <span class="application-answer-alternative">No</span></label></li></ul>
 *
 * The inputs carry no id; the question text sits in a sibling div.application-label; nothing is a
 * fieldset, a radiogroup or a role=group. So discovery's durableSelectorOf correctly ships
 * '[name="cards[<uuid>][fieldN]"]' and the fill action arrives aimed at the GROUP. The fill
 * branch resolved its target through fillTargetWithin, whose FILLABLE_WITHIN deliberately
 * excludes radio and checkbox (fill() on one throws), and the branch had no choice arm at all -
 * so every such action was skipped as "does not name a control Litos can type into", the answers
 * sat resolved in the packet while the form stayed empty, and the required gate then spoke the
 * exact production sentence. A run that reached its submit control held the press over the same
 * unconfirmed groups, which is the Mytos-shaped stop.
 *
 * Every test here spawns the shipped runner (same runner string, same file protocol as
 * production) against a served page and asserts on what happened to the form. Nothing matches on
 * runner source text.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ATOMIC_SUBMIT_POLICY, SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD = 'cards[67287a5d-d48f-428a-8881-fbe076caa364]';
const providerDeadlineAt = () => new Date(Date.now() + 240_000).toISOString();

const AUTHORIZED_LABEL = 'Are you authorized to work lawfully in the United States?';
const DISMISSED_LABEL = 'Have you ever been dismissed, terminated, fired, or asked to leave from a previous job because of harassment, discrimination, retaliation, or unethical or illegal misconduct?';

/* Transcribed from the captured DGA apply page (2026-08-28), structure intact: the Lever CSS that
 * positions the input absolutely inside its label, the required marker welded to the heading, and
 * the option text in the sibling span rather than on any label[for]. */
const question = (field, prompt, options) => `
  <li class="application-question custom-question"><div>
    <div class="application-label full-width multiple-choice"><div class="text">${prompt}<span class="required">&#10033;</span></div></div>
    <div class="application-field full-width required-field"><ul data-qa="multiple-choice">
      ${options.map((option) => `<li><label><input type="radio" name="${CARD}[${field}]" value="${option}" required="required" /><span class="application-answer-alternative">${option}</span></label></li>`).join('\n      ')}
    </ul></div>
  </div></li>`;

const fixture = `<!doctype html><meta charset="utf-8"><title>Lever multiple-choice card</title>
<style>
  .application .application-field input[type=radio], .application .application-field input[type=checkbox] {position: absolute;left: 10px;top: 2px;}
  .application-question.custom-question .application-field input[type=radio] {left: 0px;}
  .application-question.custom-question .application-field ul label {padding-left: 30px; display: block; position: relative;}
</style>
<body class="application">
<form id="application-form" action="/candidates" method="post">
<div class="section page-centered application-form" data-qa="additional-cards">
<h4 data-qa="card-name">Authorization and Disclosure </h4>
<input type="hidden" value='{"text":"Authorization and Disclosure"}' name="${CARD}[baseTemplate]">
<ul>
${question('field0', AUTHORIZED_LABEL, ['Yes', 'No'])}
${question('field1', DISMISSED_LABEL, ['Yes', 'No'])}
</ul>
</div>
<button id="submit" type="submit" data-qa="btn-submit">Submit application</button>
</form>
<div id="submitted"></div>
<div id="echo"></div>
<script>
  document.addEventListener('change', function () {
    var picks = [];
    var checked = document.querySelectorAll('input[type=radio]:checked');
    for (var index = 0; index < checked.length; index += 1) {
      picks.push(checked[index].name.replace(/^.*\\[(field\\d+)\\]$/, '$1') + '=' + checked[index].value);
    }
    document.getElementById('echo').textContent = picks.join(',');
  });
  document.getElementById('application-form').addEventListener('submit', function (event) {
    event.preventDefault();
    document.getElementById('submitted').textContent = 'submitted';
  });
</script>
</body>`;

let server;
let workDir;
test.before(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    response.end(fixture);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-lever-choice-'));
  fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);
});
test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

const resultPath = () => path.join(workDir, 'stratus-result-0.json');

function waitForRunner(child, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('runner timed out'));
    }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (status) => { clearTimeout(timer); resolve(status); });
  });
}

async function run(fixturePath, actions, { allowSubmit = false } = {}) {
  fs.rmSync(resultPath(), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: `http://127.0.0.1:${server.address().port}${fixturePath}`,
    actions,
    allowSubmit,
    ...(allowSubmit ? {
      submissionAttempt: {
        runId: '11111111-1111-4111-8111-111111111111',
        claimId: '22222222-2222-4222-8222-222222222222',
        executionId: '33333333-3333-4333-8333-333333333333'
      }
    } : {}),
    providerDeadlineAt: providerDeadlineAt(),
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 }
  }));
  const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'], {
    cwd: workDir,
    env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
  });
  child.stderr.resume();
  child.stdout.resume();
  await waitForRunner(child);
  assert.ok(fs.existsSync(resultPath()), 'the runner must produce a result file');
  return JSON.parse(fs.readFileSync(resultPath(), 'utf8'));
}

const fillAction = (field, value, label) => ({
  type: 'fill',
  selector: `[name="${CARD}[${field}]"]`,
  value,
  label,
  optional: true
});

const submitAction = {
  type: 'confirmAndSubmit',
  selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
  chooserPolicy: ATOMIC_SUBMIT_POLICY,
  label: 'final_submit',
  optional: false,
  maxRetries: 1,
  contractVersion: 2,
  submitKind: 'application'
};

test('a fill aimed at a Lever radio group by its durable name ticks the value-matched option and verifies it', async () => {
  const result = await run('/', [
    fillAction('field0', 'Yes', AUTHORIZED_LABEL),
    fillAction('field1', 'No', DISMISSED_LABEL),
    { type: 'extract', selector: '#echo' }
  ]);
  // The production defect: both actions were skipped as "does not name a control Litos can type
  // into", nothing was ticked, and the required gate reported both questions still empty.
  assert.deepEqual(result.skipped, [], 'no answer with an exact option on the group may be skipped');
  assert.deepEqual(result.filledFields, [AUTHORIZED_LABEL, DISMISSED_LABEL]);
  // 'No' is the group's SECOND input in DOM order: locator.first() is the value="Yes" input, so
  // this pins that the pick matches on the option's own text/value rather than taking the first.
  assert.equal(result.extracted.find((entry) => entry.selector === '#echo')?.value,
    'field0=Yes,field1=No', 'the exact value-matched inputs must genuinely be checked on the form');
  assert.deepEqual(result.blockers, [], 'the required gate must read the answered groups as answered');
});

test('a run that answered the radio groups confirms the required answers and presses the submit', async () => {
  const result = await run('/', [
    fillAction('field0', 'Yes', AUTHORIZED_LABEL),
    fillAction('field1', 'No', DISMISSED_LABEL),
    submitAction,
    { type: 'extract', selector: '#submitted', optional: true }
  ], { allowSubmit: true });
  // The Mytos-shaped stop: everything filled, the submit control found, and the press withheld
  // because a required answer could not be confirmed. An answered Lever group must confirm.
  assert.equal(result.blockedSubmits, 0, 'the submit must not be withheld over an answered group');
  assert.equal(result.submitOutcome?.pressed, true, 'the submit must actually be pressed');
  assert.equal(result.requiredFieldConfirmation?.status, 'confirmed');
  const pass = result.requiredFieldConfirmation?.passes?.[0];
  assert.deepEqual(pass?.unresolved, [], 'no required answer may be left unconfirmed');
  assert.equal(result.extracted.find((entry) => entry.selector === '#submitted')?.value, 'submitted');
});

test('a selector that spans two radio groups is refused rather than answering somebody else\'s question', async () => {
  // 'input[type="radio"]' matches both questions' inputs at once, which is how an over-broad
  // discovered selector arrives. Two names under it are two questions.
  const result = await run('/', [
    { type: 'fill', selector: 'input[type="radio"]', value: 'No', label: DISMISSED_LABEL, optional: true },
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.filledFields, []);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /2 separate option groups/,
    'two names under one selector are two questions, and the refusal must say so');
  assert.equal(result.extracted.find((entry) => entry.selector === '#echo')?.value, '',
    'nothing may be ticked when the group is ambiguous');
});

test('an answer no option carries exactly is left unticked, and the sentence names the answer', async () => {
  const result = await run('/', [
    fillAction('field0', 'Prefer not to say', AUTHORIZED_LABEL),
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.filledFields, []);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /no option matched "Prefer not to say"/);
  assert.equal(result.extracted.find((entry) => entry.selector === '#echo')?.value, '',
    'a declaration must never be guessed on the applicant\'s behalf');
});
