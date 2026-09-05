/* PINPOINT NAMES ITS QUESTIONS BY SECTION, AND DISCOVERY USED TO BELIEVE IT.
 *
 * Transcribed from the live franklin-electric.pinpointhq.com application form on 2026-09-05 (packet
 * 404ed568), not sketched. Pinpoint renders one <fieldset> per SECTION - "1. Personal Details",
 * "3. Questions", "4. Submit Application" - and every question of the section lives under that one
 * fieldset, so blockOf resolves each control to the section and the legend rules store the section
 * heading as the question. The stored review that came back from that form read:
 *
 *   #postcode                          -> "1.personal details we'll need these details..."
 *   answers_attributes_2_boolean       -> "3.questions"           (one row for two yes/no pairs)
 *   #application_process_information   -> "4. submit application" (the required consent box)
 *
 * and the phone, LinkedIn and postcode inputs each carried the address widget's "Start typing an
 * address" button as their only option. None of those rows could be answered, and the consent
 * grammar downstream could never see a consent behind "4. submit application".
 *
 * The run harness is the one test/question-label-dom.test.js uses: the label reader is extracted
 * from the shipped runner string, never copied, so this file fails the moment the reader drifts. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

function extractBraced(prefix) {
  const start = SANDBOX_RUNNER.indexOf(prefix);
  assert.notEqual(start, -1, `${prefix} must still be in the runner`);
  const open = SANDBOX_RUNNER.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SANDBOX_RUNNER.length; i += 1) {
    const ch = SANDBOX_RUNNER[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return SANDBOX_RUNNER.slice(start, i + 1);
    }
  }
  throw new Error(`could not find the end of ${prefix}`);
}

const SOURCE = [
  extractBraced('function clean(s) {'),
  extractBraced('function renderedText(node) {'),
  extractBraced('function labelledByText(el) {'),
  extractBraced('function blockOf(el) {'),
  extractBraced('function questionLabel(el) {'),
  extractBraced('function choiceQuestionKey(el, block) {'),
  extractBraced('function optionsOf(el, block) {'),
  extractBraced('function marksRequired(el, block) {'),
].join('\n');

let browser;
let page;
test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

/* One row per discovered question, the way the discover action itself dedupes a choice group. */
async function discoveredRows(html, selector) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  return page.evaluate(([source, target]) => {
    // eslint-disable-next-line no-new-func
    const helpers = new Function(`${source}\nreturn { blockOf, choiceQuestionKey, marksRequired, optionsOf, questionLabel };`)();
    const keys = new Set();
    const rows = [];
    for (const el of document.querySelectorAll(target)) {
      const block = helpers.blockOf(el);
      if (el.type === 'radio' || el.type === 'checkbox') {
        const key = helpers.choiceQuestionKey(el, block);
        if (keys.has(key)) continue;
        keys.add(key);
      }
      const inventory = helpers.optionsOf(el, block);
      rows.push({
        label: helpers.questionLabel(el),
        options: inventory.values,
        complete: inventory.complete,
        required: helpers.marksRequired(el, block),
      });
    }
    return rows;
  }, [SOURCE, selector]);
}

/* The Boolean question component, byte for byte as React renders it: the question in a <label>
 * whose for= names an id that does not exist, each radio labelled by its own hidden
 * "<question> yes" / "<question> no" div, and a visible per-option <label for>. */
const booleanQuestion = (index, question, help = '') => `
  <div class="col-md-1-1">
    <div id="Shared::Form::Questions::Boolean-react-component-${index}">
      <div class="pad-v-3">
        <label class="external-form__label" for="application_form_application_answers_attributes_${index}_boolean_answer">
          <span class="external-form__label--title external-form__label--required">${question}</span>
          ${help ? `<span class="external-form__label--help">${help}</span>` : ''}
        </label>
        <div class="frow frow--gutters">
          <div class="col-flex-grow-1"><div class="pretty p-default p-round"><div>
            <div id="answer-label-${index}-true" style="display: none;">${question} yes</div>
            <input type="radio" id="application_form_application_answers_attributes_${index}_boolean_answer_true"
              name="application_form[application][answers_attributes][${index}][boolean_answer]"
              tabindex="0" aria-labelledby="answer-label-${index}-true" value="true">
            <label aria-labelledby="answer-label-${index}-true"
              for="application_form_application_answers_attributes_${index}_boolean_answer_true">Yes</label>
          </div></div></div>
          <div class="col-flex-grow-1"><div class="pretty p-default p-round"><div>
            <div id="answer-label-${index}-false" style="display: none;">${question} no</div>
            <input type="radio" id="application_form_application_answers_attributes_${index}_boolean_answer_false"
              name="application_form[application][answers_attributes][${index}][boolean_answer]"
              tabindex="0" aria-labelledby="answer-label-${index}-false" value="false">
            <label aria-labelledby="answer-label-${index}-false"
              for="application_form_application_answers_attributes_${index}_boolean_answer_false">No</label>
          </div></div></div>
        </div>
      </div>
    </div>
  </div>`;

const questionsSection = `
  <fieldset class="external-form__fieldset" id="application-fieldset-questions">
    <legend class="external-form__legend"><span class="external-form__legend-index">3.</span>Questions</legend>
    <div class="frow">
      <div class="col-md-1-1">
        <div class="pad-v-3">
          <label class="external-form__label" for="application_form_application_answers_attributes_0_text_answer">
            <span class="external-form__label--title external-form__label--required">Are you aware of any contract or agreement that might impact your ability to work for Franklin Electric?</span>
          </label>
          <textarea name="application_form[application][answers_attributes][0][text_answer]"
            id="application_form_application_answers_attributes_0_text_answer" required="" rows="4"></textarea>
        </div>
      </div>
      ${booleanQuestion(1, 'Are you legally authorized to work in the country that you have applied?')}
      ${booleanQuestion(2, 'Are you currently employed by Franklin Electric (or any of its affiliates)?',
        'Select "Yes" only if you are currently employed by Franklin Electric or one of its subsidiaries or affiliates.')}
      <div class="col-md-1-1">
        <div class="pad-v-3">
          <label class="external-form__label" for="application_form_application_answers_attributes_6_text_answer">
            <span class="external-form__label--title external-form__label--required">What are your salary expectations (including bonus/commission) for this opportunity?</span>
          </label>
          <input id="application_form_application_answers_attributes_6_text_answer" type="text"
            name="application_form[application][answers_attributes][6][text_answer]" required="" placeholder="0123456789" value="">
        </div>
      </div>
      <div class="col-md-1-1">
        <div class="pad-v-3">
          <label class="external-form__label" for="application_form_application_answers_attributes_7_text_answer">
            <span class="external-form__label--title external-form__label--required">Are you able to commit to working on-site for the entire internship period?</span>
          </label>
          <div class="react-select">
            <div id="react-select-3-placeholder">Select...</div>
            <input autocomplete="off" id="application_form_application_answers_attributes_7_text_answer" tabindex="0" type="text"
              aria-autocomplete="list" aria-expanded="false" aria-haspopup="true"
              aria-label="Are you able to commit to working on-site for the entire internship period?" role="combobox" value="">
          </div>
        </div>
      </div>
    </div>
  </fieldset>`;

test('each Pinpoint yes/no pair is named by its own question, never by the section legend', async () => {
  const rows = await discoveredRows(questionsSection, 'input[type="radio"]');
  assert.equal(rows.length, 2);
  assert.match(rows[0].label, /^are you legally authorized to work in the country that you have applied\?/);
  assert.match(rows[1].label, /^are you currently employed by franklin electric \(or any of its affiliates\)\?/);
  for (const row of rows) {
    assert.doesNotMatch(row.label, /questions/, row.label);
    assert.doesNotMatch(row.label, /^yes|^no/, row.label);
    // Its own two options, once each, and nothing borrowed from the pair beside it.
    assert.deepEqual(row.options, ['Yes', 'No']);
    assert.equal(row.complete, true);
  }
});

test('the react-select and text controls in the same section do not inherit the radios as options', async () => {
  const [salary, onsite] = await discoveredRows(questionsSection, 'input[type="text"]');
  assert.match(salary.label, /salary expectations/);
  assert.deepEqual(salary.options, []);
  assert.match(onsite.label, /commit to working on-site/);
  assert.deepEqual(onsite.options, []);
  // A closed react-select with its menu shut has an inventory that is honestly incomplete, not the
  // neighbouring radios' Yes/No.
  assert.equal(onsite.complete, false);
});

test('the required Pinpoint consent checkbox is named by its own label, not "4. Submit Application"', async () => {
  const [consent] = await discoveredRows(`
    <fieldset class="external-form__fieldset" id="application-fieldset-submit">
      <div class="frow frow--gutters-2x"><div class="col-1-1">
        <legend class="external-form__legend"><span class="external-form__legend-index">4.</span> Submit Application</legend>
        <p class="external-form__text">In order to contact you with future jobs that you may be interested in, we need to store your personal data.</p>
        <p class="external-form__text">If you are happy for us to do so please click the checkbox below.</p>
        <p class="external-form__text">You can <a href="/themes/562/privacy_policy" target="_blank">view our privacy notice</a> for more information.</p>
        <div class="pretty p-icon p-smooth">
          <input name="application[process_information]" type="hidden" value="0">
          <input required="required" type="checkbox" value="1" name="application[process_information]" id="application_process_information">
          <div class="state p-primary">
            <i class="icon fa fa-check" aria-hidden="true"></i>
            <label class="external-form__label" for="application_process_information">
              (Required) Allow us to process your personal information. <span class="external-form__label--title" style="color: red">*</span>
            </label>
          </div>
        </div>
      </div>
      <div class="col-1-1">
        <button type="button" id="application-save-later-link">Save application for later</button>
        <button name="button" type="submit" class="external-button">Submit Application</button>
      </div></div>
    </fieldset>`, 'input[type="checkbox"]');
  assert.equal(consent.label, '(required) allow us to process your personal information. *');
  assert.equal(consent.required, true);
  // The section's own buttons are not this checkbox's options.
  assert.deepEqual(consent.options, []);
});

/* ADVERSARIAL: the legend rule still holds where the legend IS the question. A fieldset asking
 * "Do you agree to the terms?" over a single "Yes" box is one question whose only option is Yes,
 * and its own label is the answer word, so the legend keeps naming it. */
test('a lone checkbox whose own label is a bare answer word keeps the asking legend', async () => {
  const [row] = await discoveredRows(`
    <fieldset>
      <legend>Do you agree to the terms?</legend>
      <input type="checkbox" id="agree" name="agree"><label for="agree">Yes</label>
    </fieldset>`, 'input[type="checkbox"]');
  assert.equal(row.label, 'do you agree to the terms?');
});

test('a Pinpoint address field is named by the unassociated label beside it, not by the section legend', async () => {
  const rows = await discoveredRows(`
    <fieldset class="external-form__fieldset" id="application-fieldset-personal-details">
      <legend class="external-form__legend">
        <span class="external-form__legend-index">1.</span>Personal Details
        <div class="external-form__text">We'll need these details in order to be able to contact you.</div>
        <button type="button" class="external-button">Apply with LinkedIn</button>
      </legend>
      <div class="frow frow--gutters">
        <div class="col-md-1-2">
          <label class="external-form__label external-form__label--required" for="application_form_application_phone">Phone</label>
          <input type="tel" name="application_form[application][phone]" id="application_form_application_phone" required="">
        </div>
        <div class="col-md-1-1">
          <div class="bp3-frow">
            <div class="col-1-1">
              <label class="external-form__label external-form__label--required">Address line 1</label>
              <input type="text" name="application_form[application][address1]" id="address1" required="" placeholder="Start typing an address">
              <button type="button" class="external-panel__link">Start typing an address</button>
            </div>
            <div class="col-1-1">
              <label class="external-form__label external-form__label--required">Town / City</label>
              <input type="text" name="application_form[application][town]" id="town" required="" placeholder="Town / City">
            </div>
            <div class="col-1-1">
              <label class="external-form__label external-form__label--required">Postcode</label>
              <input type="text" name="application_form[application][postcode]" id="postcode" required="" placeholder="Postcode">
            </div>
          </div>
        </div>
      </div>
    </fieldset>`, 'input[type="tel"], input[type="text"]');
  const byLabel = Object.fromEntries(rows.map((row) => [row.label, row]));
  assert.ok(byLabel['town / city'], Object.keys(byLabel).join(' | '));
  assert.ok(byLabel['postcode'], Object.keys(byLabel).join(' | '));
  assert.equal(byLabel['postcode'].required, true);
  for (const row of rows) {
    assert.doesNotMatch(row.label, /personal details/, row.label);
    // The address widget's button is a neighbour, not an option of any text field in the section.
    assert.deepEqual(row.options, [], row.label);
  }
});
