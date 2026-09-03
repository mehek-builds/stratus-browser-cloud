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
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const providerDeadlineAt = () => new Date(Date.now() + 240_000).toISOString();

import {
  fixture,
  GPA_LABEL, SCALE_LABEL, VETERAN_LABEL, DISABILITY_LABEL, RACE_LABEL, GENDER_LABEL, DEADLINE_LABEL, LANGUAGE_LABEL
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
const formStillRequires = (result, id) => Boolean(result.extracted
  .find((entry) => entry.selector === formStateProbe(id).selector)?.value);

/* WHAT EACH CONTROL ON THE FIXTURE IS FOR.
 *
 * All of them commit their value into the widget on the first press. They differ only in what it
 * takes for the FORM to look at the field again:
 *   - STALE: the form evaluated this field when it was empty and nothing has asked it to look
 *     since. The measured Hudson River Trading state, and what the nudge is for.
 *   - SOUND: the form re-evaluated on the commit itself. Gender and the office preference on that
 *     same page. Nothing here may touch it.
 *   - STUCK: the form never re-evaluates however the control is touched. An extra click is not a
 *     cure for every lost commit, and this is what must still be reported honestly.
 */
const STALE_SINGLE = [
  ['question_67889507', '3.76 - 4.0', GPA_LABEL],
  ['question_67889508', '0.0 - 4.0', SCALE_LABEL],
  ['248', 'No', VETERAN_LABEL]
];
const STALE_CHIPS = ['250', 'South Asian', RACE_LABEL];
const SOUND_CHIPS = ['245', 'Woman', GENDER_LABEL];
const STUCK = ['249', 'No', DISABILITY_LABEL];

const shownProbe = (id) => ({
  type: 'extract', selector: `.select:has(input[id="${id}"]) .select__value-container`, optional: true
});
const nudgeProbe = (id) => ({
  type: 'extract', selector: `.select-shell[data-question="${id}"]`, attribute: 'data-nudges', optional: true
});
const searchBoxProbe = (id) => ({ type: 'extract', selector: `[id="${id}"]`, attribute: 'value', optional: true });
const valueOf = (result, selector) => result.extracted.find((entry) => entry.selector === selector)?.value;
const shownFor = (result, id) => valueOf(result, `.select:has(input[id="${id}"]) .select__value-container`);
const nudgesFor = (result, id) => Number(valueOf(result, `.select-shell[data-question="${id}"]`) || 0);

test('the two chips controls tell the whole story: one committed on its own, one was repaired', async () => {
  /* THE ORACLE. Gender and race are the same required multi select in the same block on the same
   * form, and on the measured packet only gender stuck. A fix that cannot tell them apart is not
   * the fix, and a fix that "works" by nudging everything is not it either. */
  const [raceId, raceValue, raceLabel] = STALE_CHIPS;
  const [genderId, genderValue, genderLabel] = SOUND_CHIPS;
  const result = await run([
    fillAction(genderId, genderValue, genderLabel),
    fillAction(raceId, raceValue, raceLabel),
    formStateProbe(genderId), formStateProbe(raceId),
    shownProbe(genderId), shownProbe(raceId),
    nudgeProbe(genderId), nudgeProbe(raceId)
  ]);
  // Both end accepted by the form and both are reported filled.
  assert.equal(formStillRequires(result, genderId), false);
  assert.equal(formStillRequires(result, raceId), false);
  assert.deepEqual(result.filledFields, [genderLabel, raceLabel]);
  assert.deepEqual(result.skipped.filter((sentence) => !sentence.startsWith('extract:')), []);
  // The one that committed on its own was never touched again; the one the form refused was.
  assert.equal(nudgesFor(result, genderId), 0,
    'a control the form already accepted must come out of the run untouched');
  assert.ok(nudgesFor(result, raceId) > 0, 'the refused control must actually have been nudged');
  // And the chip is still there. react-select removes an already-selected option when it is picked
  // again on a multi, so a repair that worked by re-picking would have taken this answer off.
  assert.match(shownFor(result, raceId) || '', new RegExp('^' + raceValue),
    'the chip must survive the repair: nothing may have re-picked it');
  assert.match(shownFor(result, genderId) || '', new RegExp('^' + genderValue));
});

test('single selects the form refused are repaired and reported filled', async () => {
  const result = await run([
    ...STALE_SINGLE.map(([id, value, label]) => fillAction(id, value, label)),
    ...STALE_SINGLE.flatMap(([id]) => [formStateProbe(id), shownProbe(id), searchBoxProbe(id)])
  ]);
  for (const [id, value, label] of STALE_SINGLE) {
    assert.equal(formStillRequires(result, id), false,
      `the form must have accepted "${label}" after the repair`);
    assert.ok(result.filledFields.includes(label));
    assert.equal(shownFor(result, id), value, 'and the control must still be showing her answer');
    // The nudge writes into the widget's own search box and puts it back byte for byte.
    assert.equal(valueOf(result, `[id="${id}"]`), '', 'the nudge may leave nothing behind');
  }
  assert.deepEqual(result.skipped.filter((sentence) => !sentence.startsWith('extract:')), []);
});

test('a control the nudge cannot repair is reported honestly, not quietly filled', async () => {
  const [id, value, label] = STUCK;
  const result = await run([fillAction(id, value, label), formStateProbe(id), shownProbe(id)]);
  // The photographed state: the control is showing her answer and the form still requires it.
  assert.ok(formStillRequires(result, id));
  assert.equal(shownFor(result, id), value);
  // The production defect: this went into filledFields, nothing went into skipped, and the packet
  // then read as complete while the employer's form held nothing.
  assert.ok(!result.filledFields.includes(label));
  assert.ok(result.skipped.some((sentence) => sentence.startsWith(label + ':')
    && /still reports the field as required and empty/.test(sentence)),
    'the applicant must be told, with the reason the form gave');
});

test('a control the form has no requirement on is judged exactly as it was before', async () => {
  /* The confirmation may only speak when the FORM speaks. This control is stale exactly like the
   * ones above, and it is optional, so it carries no RequiredInput and the form has no opinion to
   * offer. Silence must mean "no opinion", never "not filled", and nothing may be nudged over it. */
  const result = await run([
    fillAction('question_67889515', '2 to 4 weeks', DEADLINE_LABEL),
    formStateProbe('question_67889515'), nudgeProbe('question_67889515')
  ]);
  assert.equal(formStillRequires(result, 'question_67889515'), false);
  assert.equal(nudgesFor(result, 'question_67889515'), 0);
  assert.deepEqual(result.skipped.filter((sentence) => !sentence.startsWith('extract:')), []);
  assert.deepEqual(result.filledFields, [DEADLINE_LABEL]);
});

test('a nudge that lands a different answer than she gave is refused, and said so accurately', async () => {
  /* A form that looks at the field again can also COERCE: accept it, and snap the value to a
   * neighbouring option. The form is then satisfied and the control is holding something she never
   * said, so the repair must not report this filled - and it must not say the form still reports
   * the field empty either, because that would be a false sentence about a control she is looking
   * at. It falls to the ordinary lost-value path instead. */
  const result = await run([
    fillAction('question_67889530', 'Python', LANGUAGE_LABEL),
    formStateProbe('question_67889530'), shownProbe('question_67889530')
  ]);
  assert.equal(formStillRequires(result, 'question_67889530'), false,
    'the form must have accepted the field, or this proves nothing about coercion');
  assert.equal(shownFor(result, 'question_67889530'), 'Java',
    'and the control must be holding the answer the form snapped it to, not hers');
  assert.ok(!result.filledFields.includes(LANGUAGE_LABEL),
    'an answer she did not give may never be reported as her filled answer');
  const sentence = result.skipped.find((entry) => entry.startsWith(LANGUAGE_LABEL + ':')) || '';
  assert.ok(sentence, 'she must be told about it');
  assert.doesNotMatch(sentence, /still reports the field as required and empty/,
    'the form accepted this field, so the run may not tell her the form called it empty');
});

test('no run reports a field both filled and blocked, and a refused one holds the run', async () => {
  // What the backend reads. filled_fields is a statement about the employer's form, so a run must
  // not be able to produce one that contradicts its own required-field gate.
  const result = await run([STUCK, STALE_CHIPS, SOUND_CHIPS, ...STALE_SINGLE]
    .map(([id, value, label]) => fillAction(id, value, label)));
  const [, , stuckLabel] = STUCK;
  assert.ok(!result.filledFields.includes(stuckLabel));
  assert.ok(result.blockers.some((blocker) => blocker.includes(stuckLabel)
    && /still reports it as required and empty, so the answer was not accepted/.test(blocker)),
    'a control the repair could not reach must block the run, with the reason the form gave');
  for (const [, , label] of [STALE_CHIPS, SOUND_CHIPS, ...STALE_SINGLE]) {
    const named = label.replace(/:$/, '');
    assert.ok(result.filledFields.includes(label), `"${label}" must be reported filled`);
    assert.ok(!result.blockers.some((blocker) => blocker.includes(named)),
      `"${label}" reached the form, so nothing may still block over it`);
  }
});
