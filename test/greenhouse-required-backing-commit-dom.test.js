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
 * WHAT THE RUNNER WAS READING, and it is never the form. Every verification in managed-browser.js
 * reads what the WIDGET is rendering: readChoiceState, the clicked-row rules,
 * readCommittedSearchInputValue, readCommittedOpenerText. That is the right thing to read and it
 * is not sufficient, because a widget's display and the value its form holds are separate state.
 * When they disagree, choiceLanded returns true, the label goes into filledFields, the readiness
 * scan sees a control that is no longer showing a placeholder, and the packet reads as complete
 * while the employer's form is holding nothing.
 *
 * WHAT THIS FIXTURE PINS, AND WHAT IT DOES NOT CLAIM. The shipped runner was driven against the
 * LIVE form this session and committed all sixteen of its select controls cleanly, twice, so the
 * lost commit is intermittent and its micro-cause is not pinned here and is not asserted anywhere
 * below. What the photograph does prove, and what this fixture reproduces, is the disagreement
 * itself: a control showing the applicant's answer while the form's own RequiredInput sits under
 * it. The fixture's 'racing' controls reach the DISPLAY on their first commit and the FORM's value
 * on a later one, which is the applicant's own description ("sometimes it just requires an extra
 * click for the answer to go through") stated as a rule rather than as a timing, so the same run
 * can drive a sound control and a racing one and the tests never depend on a race.
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
import { ATOMIC_SUBMIT_POLICY, SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const providerDeadlineAt = () => new Date(Date.now() + 240_000).toISOString();

import {
  fixture,
  GPA_LABEL, SCALE_LABEL, VETERAN_LABEL, DISABILITY_LABEL, RACE_LABEL, GENDER_LABEL, DEADLINE_LABEL, LANGUAGE_LABEL
} from './fixtures/greenhouse/hrt-required-select.mjs';
import { staleErrorFixture, STALE_LABEL, STALE_ID } from './fixtures/greenhouse/stale-required-error.mjs';

let server;
let workDir;
test.before(async () => {
  server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    response.end(request.url.startsWith('/stale') ? staleErrorFixture : fixture);
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

async function run(actions, { path: urlPath = '/', allowSubmit = false } = {}) {
  fs.rmSync(resultPath(), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: `http://127.0.0.1:${server.address().port}${urlPath}`,
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
const formStillRequires = (result, id) => Boolean(result.extracted
  .find((entry) => entry.selector === formStateProbe(id).selector)?.value);

/* WHAT EACH CONTROL ON THE FIXTURE IS FOR.
 *
 * LOST is a control whose option-row click did not select, leaving the measured "typed, not
 * selected" state: the answer visible in the search box, no chosen value, no placeholder, and the
 * form's own RequiredInput still sitting under it. COMMITTED is the same widget with the click
 * landing. Gender and race are the same required multi select with opposite outcomes, which is the
 * pair the whole report turns on.
 */
const LOST_SINGLE = [
  ['question_67889507', '3.76 - 4.0', GPA_LABEL],
  ['question_67889508', '0.0 - 4.0', SCALE_LABEL],
  ['248', 'No', VETERAN_LABEL]
];
const LOST_CHIPS = ['250', 'South Asian', RACE_LABEL];
const COMMITTED_CHIPS = ['245', 'Woman', GENDER_LABEL];
const COMMITTED_SINGLE = ['249', 'No', DISABILITY_LABEL];

const shownProbe = (id) => ({
  type: 'extract', selector: `.select:has(input[id="${id}"]) .select__value-container`, optional: true
});
const searchBoxProbe = (id) => ({ type: 'extract', selector: `[id="${id}"]`, attribute: 'value', optional: true });
const valueOf = (result, selector) => result.extracted.find((entry) => entry.selector === selector)?.value;
const shownFor = (result, id) => valueOf(result, `.select:has(input[id="${id}"]) .select__value-container`);

test('the two chips controls tell the whole story: one selected, one only looks like it did', async () => {
  /* THE PAIR. Gender and race are the same required multi select in the same block on the same
   * form. Gender's row click selects; race's does not, and what is left on race is the runner's
   * own typed query with the form's RequiredInput still under it. Before this change both were
   * reported filled, because the committed-search-input rule accepts a search box holding exactly
   * the row this call clicked, and on a lost click that string is the keystrokes. */
  const [raceId, raceValue, raceLabel] = LOST_CHIPS;
  const [genderId, genderValue, genderLabel] = COMMITTED_CHIPS;
  const result = await run([
    fillAction(genderId, genderValue, genderLabel),
    fillAction(raceId, raceValue, raceLabel),
    formStateProbe(genderId), formStateProbe(raceId),
    shownProbe(genderId), searchBoxProbe(raceId)
  ]);
  // The page really is in the two measured states.
  assert.equal(formStillRequires(result, genderId), false, 'gender must genuinely commit');
  assert.ok(formStillRequires(result, raceId), 'race must be left with the form still requiring it');
  assert.match(shownFor(result, genderId) || '', new RegExp('^' + genderValue));
  assert.equal(valueOf(result, `[id="${raceId}"]`), raceValue,
    'and race must be showing the typed query, which is what the old rule read back');
  // So one is filled and the other is named.
  assert.deepEqual(result.filledFields, [genderLabel]);
  assert.ok(result.skipped.some((sentence) => sentence.startsWith(raceLabel + ':')
    && /still reports the field as required and empty/.test(sentence)),
    'the applicant must be told, with the reason the form gave');
});

test('single selects whose click was lost are named, not counted as filled', async () => {
  const result = await run([
    ...LOST_SINGLE.map(([id, value, label]) => fillAction(id, value, label)),
    ...LOST_SINGLE.map(([id]) => formStateProbe(id))
  ]);
  for (const [id, , label] of LOST_SINGLE) {
    assert.ok(formStillRequires(result, id), `the form must still require "${label}"`);
    assert.ok(!result.filledFields.includes(label),
      `"${label}" was reported filled while the form still marks it required`);
    assert.ok(result.skipped.some((sentence) => sentence.startsWith(label + ':')
      && /still reports the field as required and empty/.test(sentence)));
  }
});

test('a control whose click landed is reported filled, single as well as multi', async () => {
  // A confirmation that refused these would be worse than no confirmation at all.
  const [id, value, label] = COMMITTED_SINGLE;
  const result = await run([fillAction(id, value, label), formStateProbe(id), shownProbe(id)]);
  assert.equal(formStillRequires(result, id), false);
  assert.equal(shownFor(result, id), value);
  assert.deepEqual(result.skipped.filter((sentence) => !sentence.startsWith('extract:')), []);
  assert.deepEqual(result.filledFields, [label]);
});

test('a control the form has no requirement on is judged exactly as it was before', async () => {
  /* The confirmation may only speak when the FORM speaks. This control loses its click exactly like
   * the ones above, and it is optional, so it carries no RequiredInput and the form has no opinion
   * to offer. Silence must mean "no opinion", never "not filled": the verdict here has to be the
   * one the widget reading alone already produced. */
  const result = await run([
    fillAction('question_67889515', '2 to 4 weeks', DEADLINE_LABEL),
    formStateProbe('question_67889515')
  ]);
  assert.equal(formStillRequires(result, 'question_67889515'), false);
  assert.deepEqual(result.skipped.filter((sentence) => !sentence.startsWith('extract:')), []);
  assert.deepEqual(result.filledFields, [DEADLINE_LABEL]);
});

test('no run reports a field both filled and blocked, and a refused one holds the run', async () => {
  // What the backend reads. filled_fields is a statement about the employer's form, so a run must
  // not be able to produce one that contradicts its own required-field gate.
  const result = await run([LOST_CHIPS, COMMITTED_CHIPS, COMMITTED_SINGLE, ...LOST_SINGLE]
    .map(([id, value, label]) => fillAction(id, value, label)));
  for (const [, , label] of [LOST_CHIPS, ...LOST_SINGLE]) {
    const named = label.replace(/:$/, '');
    assert.ok(!result.filledFields.includes(label));
    assert.ok(result.blockers.some((blocker) => blocker.includes(named)
      && /still reports it as required and empty, so the answer was not accepted/.test(blocker)),
      `"${label}" must block the run with the reason the form gave`);
  }
  for (const [, , label] of [COMMITTED_CHIPS, COMMITTED_SINGLE]) {
    assert.ok(result.filledFields.includes(label));
    assert.ok(!result.blockers.some((blocker) => blocker.includes(label.replace(/:$/, ''))));
  }
});

test('nothing touches a control again once its answer has been verified', async () => {
  /* THE R-004 GUARD, and it is here because the verifier cannot enforce it for itself.
   *
   * readChoiceState reads chosenNodes[0] and nothing else, so on an isMulti control a chip appended
   * at index 1 leaves its reported value byte-identical: a second race declaration the applicant
   * never made is INVISIBLE to every rule that compares the rendered value against the row that was
   * clicked. Any write this runner makes to a control after verifying it can therefore change the
   * answer without changing what the verifier sees.
   *
   * So the property is pinned from outside the verifier: this control appends a second option on
   * any input or change event it receives while holding a value, and the run must leave it holding
   * exactly one. A repair, a nudge, a re-press or a retry added later without a guard over the FULL
   * rendered selection fails here, on a required multi, which is the control this whole
   * investigation is named for. */
  const result = await run([
    fillAction('question_67889530', 'Python', LANGUAGE_LABEL),
    { type: 'extract', selector: '.select-shell[data-question="question_67889530"]', attribute: 'data-values', optional: true },
    formStateProbe('question_67889530')
  ]);
  assert.equal(valueOf(result, '.select-shell[data-question="question_67889530"]'), 'Python',
    'the employer must receive exactly the one answer she gave, and no second one');
  assert.equal(formStillRequires(result, 'question_67889530'), false);
  assert.deepEqual(result.filledFields, [LANGUAGE_LABEL]);
  assert.deepEqual(result.skipped.filter((sentence) => !sentence.startsWith('extract:')), []);
});

test('a stale Greenhouse error does not hold a form the browser would submit', async () => {
  /* THE MEASURED HUDSON RIVER TRADING STATE, driven all the way to the press. Greenhouse renders
   * "This field is required." once, on a field that was empty at the time, and never clears it or
   * aria-invalid when the field is answered afterwards. Read live on 2026-09-04: chip "Woman",
   * RequiredInput GONE, aria-invalid still "true", sentence still under the control. That is what
   * the photograph behind this whole investigation actually shows, and the fields in it were
   * filled.
   *
   * A REGRESSION GUARD, not proof of a fix. The run already handles this correctly: the required
   * scan calls the control affected, takes the re-drive path, preserves the answer and confirms.
   * Nothing in this PR changes that, and this pins it so nothing later does, because the failure
   * it would guard against is silent - a run that holds a send over a sentence the employer's own
   * form stopped meaning. */
  const result = await run([
    { type: 'fill', selector: `[id="${STALE_ID}"]`, value: 'Woman', label: STALE_LABEL, optional: true },
    { type: 'extract', selector: `[id="${STALE_ID}-error"]`, optional: true },
    { type: 'extract', selector: `.select:has(input[id="${STALE_ID}"]) input[required][aria-hidden="true"]`, attribute: 'class', optional: true },
    {
      type: 'confirmAndSubmit',
      selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
      chooserPolicy: ATOMIC_SUBMIT_POLICY,
      label: 'final_submit',
      optional: false,
      maxRetries: 1,
      contractVersion: 2,
      submitKind: 'application'
    },
    { type: 'extract', selector: '#submitted', optional: true }
  ], { path: '/stale', allowSubmit: true });

  // The page really is in the measured state: the sentence is still there, the backing is not.
  assert.equal(valueOf(result, `[id="${STALE_ID}-error"]`), 'This field is required.',
    'the fixture must keep the stale sentence, or this proves nothing');
  assert.equal(formStillRequires(result, STALE_ID), false,
    'and the form must actually be satisfied');
  // So the run must not hold the send over it.
  assert.ok(result.filledFields.includes(STALE_LABEL));
  assert.deepEqual(result.blockers, [], 'a stale sentence may not hold a form the browser would submit');
  assert.equal(result.blockedSubmits, 0);
  assert.equal(result.submitOutcome?.pressed, true, 'the submit must actually be pressed');
  assert.equal(result.requiredFieldConfirmation?.status, 'confirmed');
  assert.deepEqual(result.requiredFieldConfirmation?.passes?.[0]?.unresolved, []);
  assert.equal(valueOf(result, '#submitted'), 'submitted');
});
