/* WHICH LABEL AND WHICH OPTIONS BELONG TO WHICH CONTROL, ASKED OF THE REAL SCAN.
 *
 * WHAT THIS FILE IS PAYING FOR. Production account a18f774b, packet c9b0c807, application
 * b3f1c8f1, portal pinpoint, company Confluence Technologies, read from prod on 2026-09-02. A
 * required combobox whose portal_selector is '#postcode' was stored under this exact question, 99
 * characters long:
 *
 *     1.personal details we'll need these details in order to be able to contact you. apply with
 *     linkedin
 *
 * The resolver read "apply with linkedin" as a LinkedIn question and the applicant's LinkedIn URL
 * was typed into the postcode box. Two more rows in the same packet are the same class: a radio
 * stored as "3.questions", which is the section legend, answer_state skipped; and a combobox whose
 * only offered option was "Start typing an address", an address autocomplete's button text
 * harvested as a vocabulary. None of the three is a text-hygiene defect. The stored strings are
 * exactly what the employer's page says - they are simply the wrong control's words, because
 * pinpoint renders one <fieldset> per numbered SECTION and blockOf handed every control in the
 * section that whole fieldset.
 *
 * WHY THE REAL discover ACTION AND NOT questionLabel ON A HAND-BUILT ELEMENT. The previous attempt
 * at this defect (stratus #149) shipped a test that passed against code production never reaches,
 * because it called the label reader directly on an element the scan itself would never hand it.
 * So this file writes the runner string to disk, spawns it as a child process against a fixture
 * served on loopback, and reads stratus-result-0.json - the same file protocol, the same runner and
 * the same wire shape executeSandboxRun() uses in production. What is asserted below is the
 * discovered array a caller is actually handed. test/managed-runner-replay.mjs drives the runner
 * this way for the same reason; this file is that harness pointed at discovery.
 *
 * REAL GUIDS IN THE NEGATIVE FIXTURES, NEVER SHORT ALPHABETIC STAND-INS. #149's entire negative
 * test was vacuous for exactly that reason: '#a1' survives every provider-handle stripper in this
 * file untouched, so a fixture built from short ids never reaches the handle rules it claims to
 * pin, and a label made of nothing but such an id still reads as a label. The ids below are the
 * shape Greenhouse and Crelate actually serve.
 *
 * THE ASYMMETRY THE ASSERTIONS ENCODE, inherited from question-label-dom.test.js: a missing
 * question is a blocker a person finishes. A WRONG question is an answer typed into an employer's
 * form under a heading it does not belong to. So the pinpoint cases below assert on what a row is
 * NOT allowed to say at least as hard as on what it says, and the negative fixtures assert byte
 * equality with what main already returns.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/* Transcribed from the defect record rather than sketched, and three details are load-bearing:
 *   - the section header lives INSIDE the <legend> - the counter, the intro sentence and the
 *     "Apply with LinkedIn" button - which is the only arrangement that produces the 99 characters
 *     production stored, and it is what makes a legend a section caption rather than a question;
 *   - the address controls carry no <label> and no wrapper class blockOf matches, so the nearest
 *     block IS the section fieldset, which is how they reached the legend at all;
 *   - "3. Questions" holds TWO boolean pairs and two number inputs. The pairs are why both were
 *     named "3.questions" and one was lost to the blocker dedupe; the number inputs are why the
 *     fieldset is a section and not a group. */
const PINPOINT = `
<form id="pinpoint-application">
  <fieldset class="section" id="section-personal">
    <legend><span class="counter">1.</span>Personal Details
      <p class="intro">We'll need these details in order to be able to contact you.</p>
      <button type="button" class="linkedin">Apply with LinkedIn</button>
    </legend>
    <div><label for="first-name">First name</label>
      <input id="first-name" type="text" name="first_name" /></div>
    <div><label for="preferred-name">Preferred name</label>
      <input id="preferred-name" type="text" name="preferred_name" /></div>
    <div><label for="email">Email</label>
      <input id="email" type="email" name="email" /></div>
    <div class="address-finder">
      <input id="address-search" type="text" role="combobox" aria-haspopup="listbox"
        aria-expanded="false" placeholder="Start typing an address" />
      <button type="button" class="address-toggle">Start typing an address</button>
    </div>
    <div><input id="address-line-1" type="text" name="address_line_1" /></div>
    <div><input id="city" type="text" name="city" /></div>
    <div><input id="postcode" type="text" role="combobox" aria-haspopup="listbox"
      aria-expanded="false" required /></div>
  </fieldset>

  <fieldset class="section" id="section-questions">
    <legend><span class="counter">3.</span>Questions</legend>
    <div class="question">
      <label class="question-title">Do you have the right to work in the UK?</label>
      <div class="options">
        <label><input type="radio" name="q_rtw" value="yes" required /> Yes</label>
        <label><input type="radio" name="q_rtw" value="no" /> No</label>
      </div>
    </div>
    <div class="question">
      <label class="question-title">Do you require visa sponsorship?</label>
      <div class="options">
        <label><input type="radio" name="q_sponsor" value="yes" required /> Yes</label>
        <label><input type="radio" name="q_sponsor" value="no" /> No</label>
      </div>
    </div>
    <div class="question">
      <label class="question-title" for="q-salary">What are your salary expectations?</label>
      <input id="q-salary" type="number" name="q_salary" />
    </div>
    <div class="question">
      <label class="question-title" for="q-years">Years of experience</label>
      <input id="q-years" type="number" name="q_years" />
    </div>
  </fieldset>
</form>`;

/* NEGATIVE, against finding 148-1. Greenhouse's CC-305 disability group: a radio group alone under
 * a legend that IS the question. main names it by that legend, and the rejected attempt welded the
 * control's raw name onto it - "voluntary self-identification of disability disability_status" -
 * which is a NEW question identity on the next discovery, and this file's own runner comment says
 * what that costs: it flaps packet identity and every send attempt refuses with packet_stale,
 * forever. The hidden version input is here because it is real and because it is the reason every
 * sibling rule in this file has to say input:not([type="hidden"]). */
const GREENHOUSE_CC305 = `
<form id="greenhouse-application">
  <fieldset class="disability">
    <legend>Voluntary Self-Identification of Disability</legend>
    <input type="hidden" name="cc305_form_version" value="2" />
    <label><input type="radio" name="disability_status"
      id="8f2c41d6-7b93-4e05-a1c8-6d0f52b7e934" value="yes" required /> Yes, I have a disability</label>
    <label><input type="radio" name="disability_status"
      id="c47a9e18-3d62-4f80-9b15-2e8a70c4d5f1" value="no" /> No, I do not have a disability</label>
    <label><input type="radio" name="disability_status"
      id="1b6e5330-9a47-4c21-8f74-5c9d3e0a8b62" value="decline" /> I do not wish to answer</label>
  </fieldset>
</form>`;

/* NEGATIVE, against finding 148-2. Unique-name checkbox rows under one legend are ONE question
 * wearing three inputs. The rejected attempt gave each row a different label, so one question
 * became three, and its own fixture did not notice because it only asserted that no label STARTED
 * with an option word. This one asserts the three labels are equal to each other and to the
 * legend, which is the property that was actually lost. */
const CHECKBOX_ROWS_ONE_LEGEND = `
<form id="programs-application">
  <fieldset>
    <legend>Which programs are you interested in?</legend>
    <label><input type="checkbox" name="prog_internship"
      id="a2f7c904-6e18-4b53-9d70-3a5c81f2e6b4" /> Internship</label>
    <label><input type="checkbox" name="prog_fulltime"
      id="d5093b71-2c46-4a89-b0e3-7f61d84c9a02" /> Full-time</label>
    <label><input type="checkbox" name="prog_contract"
      id="6e814a25-b7f0-4d13-8c92-04ab5e37f9d8" /> Contract</label>
  </fieldset>
</form>`;

/* NEGATIVE, against finding 148-3. The rejected attempt exempted every aria-hidden control in the
 * ancestor chain, so this control took the PREVIOUS question's label and '#postcode' came back as
 * "country" - the same cross-binding class as the defect this file exists to remove, on the same
 * field name. Select2, Chosen, Kendo and react-select all leave aria-hidden backing controls in
 * the tree, so the shape is reachable on Lever, Recruitee and Crelate. */
const ARIA_HIDDEN_NEIGHBOUR = `
<form id="aria-hidden-application">
  <div class="panel">
    <div class="q"><label>Country</label>
      <select name="country" aria-hidden="true" style="display:none">
        <option value="gb">United Kingdom</option></select></div>
    <div class="row"><input name="postcode" type="text" /></div>
  </div>
</form>`;

/* NEGATIVE, against finding 148-4. A teamtailor consent paragraph is not a question, and the
 * rejected attempt stored the whole legal statement as one. Every sibling text rule in the runner
 * caps at 200 characters; this asserts the outcome those bounds exist for. */
const TEAMTAILOR_CONSENT = `
<form id="teamtailor-application">
  <div class="consent-panel">
    <p class="consent-copy">Required. By submitting this application I consent to Teamtailor
      storing my personal data for 24 months and to being contacted about future roles.</p>
    <input type="text"
      name="candidate[job_application][answers_attributes][0][value]" />
  </div>
</form>`;

/* NEGATIVE. Breezy's questionnaire, whose <h3> inside li.question is the question, and whose first
 * option is one the tenant auto-disqualifies - a group named by its first option asks the applicant
 * to disqualify herself. The narrowing must leave it exactly where it is. */
const BREEZY_QUESTION = `
<form id="breezy-application">
  <ul>
    <li class="question">
      <h3>English level</h3>
      <ul class="options">
        <li><label><input type="radio" name="section_1724054400_question_1"
          value="b1" required /> B1 (Intermediate) or below</label></li>
        <li><label><input type="radio" name="section_1724054400_question_1"
          value="c1" /> C1 (Advanced)</label></li>
      </ul>
    </li>
  </ul>
</form>`;

/* NEGATIVE. The CBS Recruitee shape the runner already refuses to hand a section legend to: an
 * ordinary control under "Meine Daten" keeps its own exact label. */
const MIXED_SECTION_WITH_OWN_LABELS = `
<form id="cbs-application">
  <fieldset>
    <legend>Meine Daten</legend>
    <div><label for="anrede">Allgemeine Anrede *</label>
      <select id="anrede" name="anrede"><option value="">Bitte wahlen</option>
      <option value="herr">Herr</option><option value="frau">Frau</option></select></div>
    <div><label for="nachname">Nachname</label><input id="nachname" type="text" name="nachname" /></div>
  </fieldset>
</form>`;

/* The same section shape as pinpoint's "3. Questions", with DIFFERENT vocabularies in the two
 * groups so a merged inventory is visible. On pinpoint both pairs were Yes/No, which hides the
 * merge behind two identical lists; here main answers both groups with all four options, so a
 * resolver answering "What is your notice period?" could snap onto "London". */
const TWO_NAMED_GROUPS_ONE_SECTION = `
<form id="two-group-application">
  <fieldset>
    <legend><span class="counter">2.</span>Eligibility</legend>
    <div class="question">
      <label class="question-title">What is your notice period?</label>
      <label><input type="radio" name="notice" value="immediate" required /> Immediate</label>
      <label><input type="radio" name="notice" value="one_month" /> One month</label>
    </div>
    <div class="question">
      <label class="question-title">Which office would you prefer?</label>
      <label><input type="radio" name="office" value="london" required /> London</label>
      <label><input type="radio" name="office" value="remote" /> Remote</label>
    </div>
    <div class="question">
      <label class="question-title" for="ref">How did you hear about us?</label>
      <input id="ref" type="text" name="referral" />
    </div>
  </fieldset>
</form>`;

/* ONE boolean pair in a numbered section, beside an ordinary control. fieldsetNames counts only
 * radios and checkboxes, so a single name passes the single-name test and the section legend is
 * handed to the pair before any block rule below it runs. This is the pinpoint shape with one
 * question removed, and without the fieldset guard it is still named "3.questions". */
const ONE_PAIR_IN_A_SECTION = `
<form id="one-pair-application">
  <fieldset>
    <legend><span class="counter">3.</span>Questions</legend>
    <div class="question">
      <label class="question-title">Do you have the right to work in the UK?</label>
      <label><input type="radio" name="q_rtw" value="yes" required /> Yes</label>
      <label><input type="radio" name="q_rtw" value="no" /> No</label>
    </div>
    <div class="question">
      <label class="question-title" for="q-salary">What are your salary expectations?</label>
      <input id="q-salary" type="number" name="q_salary" />
    </div>
  </fieldset>
</form>`;

/* An open control ALONE in its own block, with an ordinary button beside it. No narrowing applies
 * here - the block is already this control's - so this is the shape that asks whether an open
 * control is allowed a vocabulary at all, separately from which block it would read one out of. */
const OPEN_CONTROL_WITH_A_BUTTON = `
<form id="button-beside-application">
  <div class="field">
    <label for="expected-salary">Expected salary</label>
    <input id="expected-salary" type="number" name="expected_salary" />
    <button type="button" class="clear">Clear</button>
  </div>
</form>`;

let body = '';
let server;
let base;
let workDir;

test.before(async () => {
  server = http.createServer((request, response) => {
    // 'close' matters: a keep-alive socket stops Chromium ever reporting networkidle, which is the
    // waitUntil the runner is given below.
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    response.end(`<!doctype html><meta charset="utf-8"><title>Binding Fixture</title>${body}`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}/`;
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-binding-'));
  fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);
});

test.after(() => {
  if (server) server.close();
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
});

/* One spawn per distinct fixture. Each call launches a browser and waits for networkidle, and
 * several cases below ask about the same page, so the result is memoised on the fixture text. It
 * is the same run either way - what is cached is one runner's answer, not a hand-written one. */
const answers = new Map();

/** What a caller is handed for `html`, from the shipped runner, over the wire shape it ships. */
async function discover(html) {
  if (answers.has(html)) return answers.get(html);
  const pending = runDiscover(html);
  answers.set(html, pending);
  return pending;
}

async function runDiscover(html) {
  body = html;
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    providerDeadlineAt: new Date(Date.now() + 240_000).toISOString(),
    url: base,
    actions: [{ type: 'discover' }],
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 }
  }));
  fs.rmSync(path.join(workDir, 'stratus-result-0.json'), { force: true });
  // spawn, never spawnSync: the fixture server lives in this process, and spawnSync would block the
  // event loop so the page could never load.
  const { status, stderr } = await new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'],
      { cwd: workDir, env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') } }
    );
    let captured = '';
    child.stderr.on('data', (chunk) => { captured += chunk; });
    child.stdout.resume();
    child.on('close', (code) => resolve({ status: code, stderr: captured }));
  });
  assert.equal(status, 0, `runner exited ${status}: ${stderr.split('\n').slice(0, 5).join(' ')}`);
  return JSON.parse(fs.readFileSync(path.join(workDir, 'stratus-result-0.json'), 'utf8')).discovered;
}

const bySelector = (rows, durableSelector) => {
  const row = rows.find((entry) => entry.durableSelector === durableSelector);
  assert.ok(row, `${durableSelector} must be discovered: ${JSON.stringify(rows.map((e) => e.durableSelector))}`);
  return row;
};

/* THE PRODUCTION ROW, ASSERTED AS THE PRODUCTION ROW. The exact stored string is written out here
 * rather than described, because "does not contain linkedin" would also pass on a label that had
 * merely been truncated, and the defect is not length. */
const STORED_SECTION_LABEL = "1.personal details we'll need these details in order to be able to "
  + 'contact you. apply with linkedin';

test('the section legend never becomes the question for a control that is merely inside the section', async () => {
  assert.equal(STORED_SECTION_LABEL.length, 99, 'the record says 99 characters; keep this honest');
  const rows = await discover(PINPOINT);

  const postcode = bySelector(rows, '#postcode');
  assert.equal(postcode.required, true, 'the production row is required; the fixture must be too');
  assert.equal(postcode.role, 'combobox', 'the production row is a combobox');
  assert.notEqual(postcode.label, STORED_SECTION_LABEL);
  // The harm was not the length, it was the words: "apply with linkedin" is what the resolver read.
  assert.doesNotMatch(postcode.label, /linkedin/i,
    'a postcode control that mentions LinkedIn is the defect, got ' + JSON.stringify(postcode.label));
  assert.doesNotMatch(postcode.label, /personal details/i);
  assert.equal(postcode.label, 'postcode');

  // Every other control that shared the section. A control with a label of its own always had one;
  // these are the ones that reached the legend, and none of them may still.
  for (const selector of ['#address-search', '#address-line-1', '#city']) {
    const row = bySelector(rows, selector);
    assert.doesNotMatch(row.label, /linkedin/i,
      selector + ' still carries the section header: ' + JSON.stringify(row.label));
  }
});

test('two boolean pairs under one section legend are two questions, each named by its own heading', async () => {
  const rows = await discover(PINPOINT);
  const rtw = bySelector(rows, '[name="q_rtw"]');
  const sponsor = bySelector(rows, '[name="q_sponsor"]');

  assert.equal(rtw.label, 'do you have the right to work in the uk?');
  assert.equal(sponsor.label, 'do you require visa sponsorship?');
  // The measured symptom was not only a wrong name. Both pairs were called "3.questions", and two
  // questions sharing one label collapse downstream, which is how one of them came back skipped
  // with nothing recorded against it.
  assert.notEqual(rtw.label, sponsor.label,
    'two questions sharing one label is how the second one is lost');
  for (const row of [rtw, sponsor]) {
    assert.doesNotMatch(row.label, /^3\./, 'the section legend is not a question: ' + JSON.stringify(row.label));
    assert.deepEqual(row.options, ['Yes', 'No'], 'the group keeps its own options');
  }
});

test('an open control has no options, so a neighbouring group never lends it a vocabulary', async () => {
  const rows = await discover(PINPOINT);
  // The two number inputs sat beside the boolean pairs and came back offering ["Yes","No"], which
  // is what drew radio buttons on a salary field.
  for (const selector of ['#q-salary', '#q-years']) {
    const row = bySelector(rows, selector);
    assert.equal(row.options, null,
      selector + ' is a number input and has no options: ' + JSON.stringify(row.options));
    assert.equal(Object.hasOwn(row, 'optionsComplete'), false,
      'an open control is not an incomplete inventory, it is not an inventory');
  }
  // And the identity inputs, which came back offering the address finder's own button text - an
  // autocomplete's furniture presented to the applicant as the employer's choices.
  for (const selector of ['#first-name', '#preferred-name', '#email']) {
    const row = bySelector(rows, selector);
    assert.equal(row.options, null,
      selector + ' harvested a neighbour: ' + JSON.stringify(row.options));
  }
  // The identity labels were already right and must stay exactly right.
  assert.equal(bySelector(rows, '#preferred-name').label, 'preferred name preferred_name preferred-name');

  // The two openers in the section read their OWN block, so neither is offered the other's
  // furniture and neither is offered the section's LinkedIn button.
  assert.equal(bySelector(rows, '#postcode').options, null,
    'the postcode opener harvested the section: ' + JSON.stringify(bySelector(rows, '#postcode').options));
  const search = bySelector(rows, '#address-search');
  assert.equal((search.options || []).includes('Apply with LinkedIn'), false,
    'the address finder was offered the section header button: ' + JSON.stringify(search.options));

  // And an open control is refused a vocabulary even where no narrowing could have helped: this
  // block holds one control, and main still offered the button beside it as a choice.
  const beside = await discover(OPEN_CONTROL_WITH_A_BUTTON);
  assert.equal(beside.length, 1);
  assert.equal(beside[0].options, null,
    'a number input was offered "Clear" as an answer: ' + JSON.stringify(beside[0].options));
  assert.equal(beside[0].label, 'expected salary expected_salary expected-salary',
    'and its label is untouched');
});

test('one boolean pair in a numbered section is still named by its own question', async () => {
  // fieldsetNames counts only choice inputs, so ONE pair beside two number inputs passes the
  // single-name test and takes the section legend before any later rule can speak. Two pairs is
  // what production served; one pair is the same section wearing one question fewer, and it has to
  // read the same way.
  const rows = await discover(ONE_PAIR_IN_A_SECTION);
  const rtw = bySelector(rows, '[name="q_rtw"]');
  assert.equal(rtw.label, 'do you have the right to work in the uk?');
  assert.doesNotMatch(rtw.label, /^3\./, 'the section legend is not a question: ' + JSON.stringify(rtw.label));
  assert.deepEqual(rtw.options, ['Yes', 'No']);
  assert.equal(bySelector(rows, '#q-salary').options, null);
});

test('a group offers its own options, not every option in the section', async () => {
  const rows = await discover(TWO_NAMED_GROUPS_ONE_SECTION);
  const notice = bySelector(rows, '[name="notice"]');
  const office = bySelector(rows, '[name="office"]');

  assert.deepEqual(notice.options, ['Immediate', 'One month']);
  assert.deepEqual(office.options, ['London', 'Remote']);
  // The wrong option list is worse than none: it is the set the resolver is invited to snap a
  // stored answer onto, so a merged list is how "London" becomes an answer to a notice-period
  // question. main answered both groups with all four.
  assert.equal(notice.options.includes('London'), false, JSON.stringify(notice.options));
  assert.equal(office.options.includes('Immediate'), false, JSON.stringify(office.options));
  // And an inventory that holds one group is complete, where the merged one reported itself
  // incomplete because two inputs claimed the same option text.
  assert.equal(notice.optionsComplete, true);
  assert.equal(office.optionsComplete, true);
  // Each is still named by its own heading rather than by the section caption.
  assert.equal(notice.label, 'what is your notice period?');
  assert.equal(office.label, 'which office would you prefer?');
  assert.equal(bySelector(rows, '#ref').options, null, 'and the text input beside them offers nothing');
});

test('a legend that names one group still names it: a clean label gains no handle and stays one question', async () => {
  // 148-1. Nothing is welded onto a label that was already the employer's words.
  const cc305 = await discover(GREENHOUSE_CC305);
  assert.equal(cc305.length, 1, 'one group is one question: ' + JSON.stringify(cc305.map((r) => r.label)));
  assert.equal(cc305[0].label, 'voluntary self-identification of disability');
  assert.doesNotMatch(cc305[0].label, /disability_status/,
    'a raw name handle on a previously clean label mints a new question every discovery');
  assert.deepEqual(cc305[0].options, [
    'Yes, I have a disability', 'No, I do not have a disability', 'I do not wish to answer'
  ]);

  // 148-2. Three unique-name rows under one legend keep ONE name between them, and it is the
  // legend's. Equality between the rows is the assertion, because that is the property that was
  // lost when each row took its own option text.
  const programs = await discover(CHECKBOX_ROWS_ONE_LEGEND);
  const labels = programs.map((row) => row.label);
  assert.equal(new Set(labels).size, 1, 'one question wearing three inputs: ' + JSON.stringify(labels));
  assert.equal(labels[0], 'which programs are you interested in?');
  for (const row of programs) {
    assert.deepEqual(row.options, ['Internship', 'Full-time', 'Contract'],
      'every row still sees the whole group');
  }
});

test('a control never takes the question above it, and a consent paragraph is never a question', async () => {
  // 148-3. The aria-hidden <select name="country"> is the immediately preceding question. A walk
  // that can rise above the control's own block reaches it; this one cannot.
  const neighbour = await discover(ARIA_HIDDEN_NEIGHBOUR);
  const postcode = bySelector(neighbour, '[name="postcode"]');
  assert.equal(postcode.label, 'postcode');
  assert.doesNotMatch(postcode.label, /country/i,
    'this control took the previous question, which is the defect wearing a different name');

  // 148-4. The consent copy is 154 characters of legal statement and belongs to no control.
  const consent = await discover(TEAMTAILOR_CONSENT);
  assert.equal(consent.length, 1);
  assert.equal(consent[0].label, 'candidate[job_application][answers_attributes][0][value]');
  assert.doesNotMatch(consent[0].label, /consent|teamtailor|24 months/i,
    'a paragraph is not a question: ' + JSON.stringify(consent[0].label));
  assert.ok(consent[0].label.length <= 200, 'every text rule in the runner is bounded');
});

test('boards whose block already holds one question read exactly as they did', async () => {
  const breezy = await discover(BREEZY_QUESTION);
  assert.equal(breezy.length, 1);
  assert.equal(breezy[0].label, 'english level',
    'a group named by its first option asks the applicant to disqualify herself');
  assert.deepEqual(breezy[0].options, ['B1 (Intermediate) or below', 'C1 (Advanced)']);

  const cbs = await discover(MIXED_SECTION_WITH_OWN_LABELS);
  assert.equal(bySelector(cbs, '#anrede').label, 'allgemeine anrede * anrede anrede');
  assert.equal(bySelector(cbs, '#anrede').required, true,
    'the employer marks it required on its own label, and that reading is unchanged');
  assert.equal(bySelector(cbs, '#nachname').label, 'nachname nachname nachname');
});

/* THE OTHER READER, AND WHY IT IS IN THIS FILE.
 *
 * The runner carries a second, independent label reader for the pre-submit required-field gate,
 * and the comment above its sibling walk says the two are "kept in step by hand". They are not
 * merely similar: the discover copy's own comment states the invariant - "discovery has to agree
 * with it, or the same control is called two different things by two halves of one run." On the
 * pinpoint form both readers named the same required controls off the same section legend, so a
 * fix to only one of them would have replaced one wrong shared name with two different names.
 *
 * Extracted as the WHOLE scan, bounded by the `failed` fallback declared after it, the same way
 * own-question-readiness-dom.test.js does it - not one hand-picked helper, which is the thing this
 * file exists to refuse. */
function readinessScanSource() {
  const start = SANDBOX_RUNNER.indexOf('const scan = (root = document) => {');
  assert.notEqual(start, -1, 'the readiness scan must still be in the runner');
  const end = SANDBOX_RUNNER.indexOf("const failed = { blocking: ['Required-field readiness scan failed']", start);
  assert.ok(end > start, 'could not bound the readiness scan');
  return SANDBOX_RUNNER.slice(start, end).trimEnd();
}

test('the pre-submit gate names the same controls the same way', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.setContent(`<!doctype html><html><body>${PINPOINT}</body></html>`);
    const readiness = await page.evaluate((source) => {
      // eslint-disable-next-line no-new-func
      const scan = new Function(`${source}\nreturn scan;`)();
      return scan(document);
    }, readinessScanSource());

    const blocking = readiness.blocking.join(' | ');
    assert.doesNotMatch(blocking, /linkedin/i,
      'the blocker line told the applicant a LinkedIn field was blocking her: ' + blocking);
    assert.doesNotMatch(blocking, /3\.Questions/,
      'the section legend is not a field name: ' + blocking);
    // Both pairs, not one. The gate dedupes by MESSAGE, so two questions sharing the legend
    // collapsed into a single blocker and the second required group was never mentioned.
    assert.ok(readiness.blocking.includes('"Do you have the right to work in the UK?" is required and is still empty'), blocking);
    assert.ok(readiness.blocking.includes('"Do you require visa sponsorship?" is required and is still empty'), blocking);
    // And it never falls back to naming a group by the option beside it, which is what a heading
    // search narrowed without widening its candidate set would have done here.
    assert.doesNotMatch(blocking, /"Yes" is required/,
      'a group named by its own option is the defect blockOf exists to prevent: ' + blocking);
  } finally {
    await browser.close();
  }
});
