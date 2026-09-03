/* A GREENHOUSE REACT-SELECT THAT DISPLAYS THE ANSWER WHILE THE EMPLOYER'S FORM STILL CALLS THE
 * FIELD EMPTY, run through the shipped runner against the markup that loses it.
 *
 * Measured on the live Hudson River Trading application form, photographed after a Litos fill:
 * six required controls rendered the answer inside the control and the form's own validation
 * still printed "This field is required." under five of them.
 *
 *   What is your overall college/university GPA? *   showed "3.76 - 4.0"   required
 *   Please select the corresponding GPA scale: *     showed "0.0 - 4.0"    required
 *   Are you a veteran? *                             showed "No"           required
 *   Do you have a disability? *                      showed "No"           required
 *   What is your race/ethnicity? *                   chip "South Asian x"  required
 *   What is your gender? *                           chip "Woman x"        no error
 *
 * The markup below is transcribed from that form's own server-rendered HTML
 * (job-boards.greenhouse.io/embed/job_app?for=wehrtyou, read 2026-09-03), structure and class
 * names intact, including the one node that settles the question:
 *
 *   <input required tabindex="-1" aria-hidden="true" class="...requiredInput" value=""/>
 *
 * That is react-select's own RequiredInput. It is rendered inside the select-shell for exactly as
 * long as the widget holds no value, and it is what makes the employer's form refuse the
 * submission. Every one of the four demographic controls carries it: gender (id 245) and race
 * (id 250) are both multi selects, veteran (248) and disability (249) both single, all four
 * required. Gender and race are therefore the SAME control shape with opposite outcomes, which is
 * what rules out "the runner uses a wholly wrong approach for chips".
 *
 * WHAT THE RUNNER WAS READING. On this widget an uncommitted control renders no
 * select__single-value, no select__multi-value__label AND no select__placeholder - react-select
 * drops the placeholder as soon as its search input holds text - so readChoiceState returns
 * 'unknown', and verifyChoiceInContainer's committed-search-input rule then accepts
 * input.select__input's own text as the committed value because it equals the row this call
 * clicked. When the row click is lost, that text is the runner's own keystrokes. The field goes
 * into filledFields, the required gate sees nothing to report, and the packet looks complete while
 * the employer's form holds nothing.
 *
 * WHY THE CLICK IS LOST, and why a second interaction commits it: this widget's menu is portalled
 * to '#react-portal-mount-point' (Greenhouse sets menuPortalTarget) and the portal wrapper does
 * not preventDefault on mousedown, so a pointer sequence that presses before it clicks blurs the
 * search input, the blur closes and unmounts the menu, and the 'click' never reaches the row. The
 * next interaction starts with the menu already reopening under its own mousedown, so the row
 * survives to receive the click - which is the "sometimes it just requires an extra click" the
 * applicant reported. The fixture reproduces that exactly, per control, so a sound control and a
 * racing control can be driven through the same runner in the same run.
 *
 * Every test here spawns the shipped runner (same runner string, same file protocol as production)
 * against a served page and asserts on what happened to the form and to result.filledFields.
 * Nothing matches on runner source text.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const providerDeadlineAt = () => new Date(Date.now() + 240_000).toISOString();

import {
  fixture,
  GPA_LABEL, SCALE_LABEL, VETERAN_LABEL, DISABILITY_LABEL, RACE_LABEL, GENDER_LABEL, DEADLINE_LABEL, HIGH_SCHOOL_LABEL
} from './fixtures/greenhouse/hrt-required-select.mjs';

let server;
let workDir;
test.before(async () => {
  server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    response.end(fixture);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-gh-required-'));
  fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);
});
test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

const resultPath = () => path.join(workDir, 'stratus-result-0.json');

function waitForRunner(child, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('runner timed out'));
    }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (status) => { clearTimeout(timer); resolve(status); });
  });
}

async function run(actions) {
  fs.rmSync(resultPath(), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: `http://127.0.0.1:${server.address().port}/`,
    actions,
    allowSubmit: false,
    providerDeadlineAt: providerDeadlineAt(),
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 1200 }
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

const fillAction = (id, value, label) => ({
  type: 'fill', selector: `[id="${id}"]`, value, label, optional: true
});

/* The employer's form's own answer to "did you receive this", read off the page the runner left
 * behind. react-select's RequiredInput exists for exactly as long as the widget holds no value, so
 * a shell that still has one is a field the form will refuse. Extracted through the runner's own
 * extract action, so the assertion is about the real page rather than about anything the test
 * arranged. */
const formStateProbe = (id) => ({
  type: 'extract',
  selector: `.select:has(input[id="${id}"]) input[required][aria-hidden="true"]`,
  attribute: 'class',
  optional: true
});
const formStillRequires = (result, id) => result.extracted
  .some((entry) => entry.selector.includes(`"${id}"`) && entry.value);

const RACING = [
  ['question_67889507', '3.76 - 4.0', GPA_LABEL],
  ['question_67889508', '0.0 - 4.0', SCALE_LABEL],
  ['248', 'No', VETERAN_LABEL],
  ['249', 'No', DISABILITY_LABEL],
  ['250', 'South Asian', RACE_LABEL]
];

test('a control that shows the answer while the form still requires it is not reported filled', async () => {
  const result = await run([
    ...RACING.map(([id, value, label]) => fillAction(id, value, label)),
    ...RACING.map(([id]) => formStateProbe(id))
  ]);
  for (const [id, value, label] of RACING) {
    // The page really is in the photographed state: the control is showing her answer and the
    // form's own RequiredInput is still sitting under it.
    assert.ok(formStillRequires(result, id),
      `the fixture must leave "${label}" showing ${value} with the form still requiring it`);
    // The production defect: all five went into filledFields, nothing went into skipped, and the
    // packet then read as complete while the employer's form held nothing.
    assert.ok(!result.filledFields.includes(label),
      `"${label}" was reported filled while the form still marks it required`);
    assert.ok(result.skipped.some((sentence) => sentence.startsWith(label + ':')
      && /still reports the field as required and empty/.test(sentence)),
      `"${label}" must be named in skipped, with the reason the form gave`);
  }
});

test('the same required multi select that does commit is still reported filled', async () => {
  // Gender and race are the same required multi select on the same form. A confirmation that
  // refused both would be useless, and the photograph shows gender committing.
  const result = await run([
    fillAction('245', 'Woman', GENDER_LABEL),
    formStateProbe('245')
  ]);
  assert.equal(formStillRequires(result, '245'), false,
    'gender must genuinely commit, or this test proves nothing about the confirmation');
  assert.deepEqual(result.skipped.filter((sentence) => !sentence.startsWith('extract:')), [],
    'a control that the form accepted may not be skipped');
  assert.deepEqual(result.filledFields, [GENDER_LABEL]);
});

test('a control the form has no requirement on is judged exactly as it was before', async () => {
  /* The confirmation may only speak when the FORM speaks. This control races its commit exactly
   * like the five above, and it is optional, so it carries no RequiredInput and the form has no
   * opinion to offer. Silence must mean "no opinion", never "not filled": the verdict here has to
   * be the one the widget reading alone already produced. */
  const result = await run([
    fillAction('question_67889515', '2 to 4 weeks', DEADLINE_LABEL),
    formStateProbe('question_67889515')
  ]);
  assert.equal(formStillRequires(result, 'question_67889515'), false);
  assert.deepEqual(result.skipped.filter((sentence) => !sentence.startsWith('extract:')), []);
  assert.deepEqual(result.filledFields, [DEADLINE_LABEL]);
});

test('a form that states the requirement only in words is believed too', async () => {
  /* Not every portal expresses "required" through the browser. This control carries no native
   * required node at all: the whole statement is aria-invalid plus the sentence the form renders
   * into the node its aria-errormessage names, which is the message in the photograph. A
   * confirmation that only read constraint validation would report this one filled. */
  const result = await run([
    fillAction('question_67889512', 'South America', HIGH_SCHOOL_LABEL),
    { type: 'extract', selector: '[id="question_67889512-error"]', optional: true },
    { type: 'extract', selector: '.select:has(input[id="question_67889512"]) .select__value-container', optional: true }
  ]);
  assert.equal(
    result.extracted.find((entry) => entry.selector === '[id="question_67889512-error"]')?.value,
    'This field is required.',
    'the fixture must leave the form saying, in words, that this field is empty'
  );
  assert.equal(
    result.extracted.find((entry) => entry.selector.includes('value-container'))?.value,
    'South America',
    'and the control must be showing the answer while it says so'
  );
  assert.ok(!result.filledFields.includes(HIGH_SCHOOL_LABEL));
  assert.ok(result.skipped.some((sentence) => sentence.startsWith(HIGH_SCHOOL_LABEL + ':')
    && /still reports the field as required and empty/.test(sentence)));
});

test('the run that lost five required answers does not present itself as a complete fill', async () => {
  // What the backend reads. filled_fields is a statement about the employer's form, so a run in
  // this state must not be able to produce one that contradicts its own required-field gate.
  const result = await run(RACING.map(([id, value, label]) => fillAction(id, value, label)));
  for (const [, , label] of RACING) {
    const claimed = result.filledFields.includes(label);
    const blocked = result.blockers.some((blocker) => blocker.startsWith('"' + label.replace(/[:?]$/, '')));
    assert.ok(!(claimed && blocked),
      `"${label}" was reported filled and blocked by the same run`);
    // And the run has to HOLD over it, not merely stay quiet: a choice the form refused is marked,
    // so the pre-submit gate blocks, and the sentence says which party refused it.
    // The readiness scan reads the label off the page, which drops a trailing colon.
    const named = label.replace(/:$/, '');
    assert.ok(result.blockers.some((blocker) => blocker.includes(named)
      && /still reports it as required and empty, so the answer was not accepted/.test(blocker)),
      `"${label}" must block the run with the reason the form gave`);
  }
  assert.equal(result.filledFields.length, 0);
});
