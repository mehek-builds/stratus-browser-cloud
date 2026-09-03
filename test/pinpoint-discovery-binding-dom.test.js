/* EACH CONTROL IS BOUND TO ITS OWN LABEL AND ITS OWN OPTIONS, run against the shipped runner.
 *
 * Measured live on Confluence Technologies (confluence.pinpointhq.com, packet c9b0c807,
 * 2026-09-02). Pinpoint renders one <fieldset> per numbered SECTION - "1. Personal Details",
 * "3. Questions", "4. Submit Application" - and every question of the section sits inside that
 * one fieldset. blockOf() resolves a control to the nearest fieldset, so the "block that owns one
 * question" was the whole section, and everything read off the block belonged to a neighbour:
 *   - the three number inputs (salary, years of Python, years of SQL) carried options
 *     ["Yes", "No"] harvested from the boolean radio pairs beside them, and the dashboard rendered
 *     radios on a number field;
 *   - both boolean pairs were labelled by the section legend "3.Questions", so the backend kept one
 *     and lost the other, and neither could be answered from the profile;
 *   - every identity and address input carried ["Start typing an address"] - the text of the
 *     address autocomplete's button - as its options;
 *   - address inputs, whose <label> has no `for`, were named by the "1. Personal Details" legend,
 *     whose text ends in "Apply with LinkedIn", so the resolver typed her LinkedIn URL into
 *     #postcode.
 *
 * The rule pinned here is structural, not textual: a control's label and options are read from the
 * blocks that hold THIS control and nothing else's; the first block holding a foreign control ends
 * the walk. A section heading is only ever reached by a control that shares its section with
 * nobody, which is what a heading over one question is. */
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

/* THE WHOLE DISCOVER SCAN, not its helpers one at a time. The defect was in how the pieces were
 * composed - which block each helper was handed - so the assertions run the exact evaluate body the
 * runner ships, from the candidate selector to the returned rows. */
const DISCOVER_PREFIX = 'const found = await page.evaluate(() => {';
const DISCOVER_BODY = extractBraced(DISCOVER_PREFIX).slice(DISCOVER_PREFIX.length - 1);

let browser;
let page;

test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

async function discover(html) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  return page.evaluate((body) => {
    // eslint-disable-next-line no-new-func
    return new Function(`return (function () ${body})();`)();
  }, DISCOVER_BODY);
}

/* Transcribed from the live form on 2026-09-02, trimmed to the nodes that decide the binding. Every
 * detail that mattered is real: the legend index lives in its own <span>, the "Personal Details"
 * legend carries the LinkedIn apply link, the boolean pair's question <label for> points at an id
 * that does NOT exist (the inputs are ..._true and ..._false), each radio's aria-labelledby names a
 * hidden per-option div, the number inputs have a real <label for>, the address inputs have a
 * <label> with no `for`, the address finder is a <button> whose text is its placeholder, and the
 * consent checkbox shares the submit fieldset with the submit button. */
const legend = (index, title, extra = '') => `
  <legend class="external-form__legend"><span class="external-form__legend-index">${index}.</span>${title}${extra}</legend>`;

const pinpointBoolean = (n, question) => `
  <div class="col-md-1-1"><div id="Shared::Form::Questions::Boolean-react-component-${n}"><div class="pad-v-3">
    <label class="external-form__label" for="application_form_application_answers_attributes_${n}_boolean_answer">
      <span class="external-form__label--title external-form__label--required">${question}</span></label>
    <div class="frow frow--gutters frow--gutters-sm-2x">
      <div class="col-1-2"><div class="checkable-input checkable-input--themed checkable-input--full">
        <div id="answer-label-${n}-true" style="display: none;">${question} yes</div>
        <input class="checkable-input__input" type="radio" id="application_form_application_answers_attributes_${n}_boolean_answer_true"
          name="application_form[application][answers_attributes][${n}][boolean_answer]" aria-labelledby="answer-label-${n}-true" value="true">
        <label aria-labelledby="answer-label-${n}-true" class="checkable-input__label" for="application_form_application_answers_attributes_${n}_boolean_answer_true">Yes</label>
      </div></div>
      <div class="col-1-2"><div class="checkable-input checkable-input--themed checkable-input--full">
        <div id="answer-label-${n}-false" style="display: none;">${question} no</div>
        <input class="checkable-input__input" type="radio" id="application_form_application_answers_attributes_${n}_boolean_answer_false"
          name="application_form[application][answers_attributes][${n}][boolean_answer]" aria-labelledby="answer-label-${n}-false" value="false">
        <label aria-labelledby="answer-label-${n}-false" class="checkable-input__label" for="application_form_application_answers_attributes_${n}_boolean_answer_false">No</label>
      </div></div>
    </div>
    <input type="hidden" name="application_form[application][answers_attributes][${n}][title]" value="${question}">
    <input type="hidden" name="application_form[application][answers_attributes][${n}][question_type]" value="boolean">
  </div></div></div>`;

const pinpointNumber = (n, question) => `
  <div class="col-md-1-1"><div id="Shared::Form::Questions::Numberinput-react-component-${n}"><div class="pad-v-3">
    <label class="external-form__label" for="application_form_application_answers_attributes_${n}_number_answer">
      <span class="external-form__label--title external-form__label--required">${question}</span></label>
    <div class="frow frow--gutters frow--direction-column"><div class="col-flex-grow-1"><div>
      <input id="application_form_application_answers_attributes_${n}_number_answer"
        name="application_form[application][answers_attributes][${n}][number_answer]" type="number" value="" required="">
    </div></div></div>
    <input type="hidden" name="application_form[application][answers_attributes][${n}][title]" value="${question}">
    <input type="hidden" name="application_form[application][answers_attributes][${n}][question_type]" value="number">
  </div></div></div>`;

const pinpointAddressInput = (id, label, required) => `
  <div class="col-1-1">
    <label class="external-form__label${required ? ' external-form__label--required' : ''}">${label}</label>
    <input id="${id}" name="application_form[application][${id}]" type="text" placeholder="${label}" value=""${required ? ' required=""' : ''}>
  </div>`;

const PINPOINT_DETAILS = `
  <fieldset id="application-fieldset-details" class="external-form__fieldset">
    ${legend(1, 'Personal Details', `<p class="external-form__text">We'll need these details in order to be able to contact you.</p>
      <a class="external-button external-button--linkedin" href="https://app.pinpointhq.com/auth/linkedin/new">Apply with LinkedIn</a>`)}
    <div class="frow frow--gutters-2x">
      <div class="col-md-1-1">
        <label for="application_form_application_first_name" class="external-form__label external-form__label--required">First Name</label>
        <input id="application_form_application_first_name" name="application_form[application][first_name]" type="text" placeholder="First name" required="required">
      </div>
      <div class="col-1-1">
        <label for="application_form_application_phone" class="external-form__label external-form__label--required">Phone</label>
        <div><div class="intl-tel-input allow-dropdown">
          <input id="application_form_application_phone" name="application_form[application][phone]" type="tel" placeholder="Phone" value="" required="">
          <input id="phone-country-code-dropdown" name="application_form[application][phone_iso2]" type="hidden" value="US">
        </div></div>
      </div>
      <div id="Shared::Form::Address-react-component" class="col-1-1"><div class="bp3-frow bp3-frow--vertical-gutters-32">
        <div id="address-country" class="col-1-1">
          <label class="external-form__label external-form__label--required">Country</label>
          <div class="react-select css-b62m3t-container"><div class="react-select__control"><div class="react-select__value-container"><div class="react-select__input-container">
            <input id="application_form[application][country]" type="text" class="react-select__input" role="combobox" aria-expanded="false" value="">
          </div></div></div></div>
          <input name="application_form[application][country]" type="hidden" value="AE">
          <select id="application_form[application][country]" class="hide-at-sm-block" style="display:none"><option value="AE">United Arab Emirates</option><option value="US">United States</option></select>
        </div>
        <div id="google-places-autocomplete" class="col-1-1">
          <label class="external-form__label">Find Address</label>
          <div class="bp3-popover-wrapper bp3-fill"><div aria-haspopup="true" class="bp3-popover-target"><div>
            <button type="button" class="bp3-fill bp3-large bp3-select-button" data-placeholder="Start typing an address">
              <span class="bp3-text-muted bp3-select-button-text">Start typing an address</span></button>
          </div></div></div>
        </div>
        ${pinpointAddressInput('address1', 'Address Line 1', true)}
        ${pinpointAddressInput('address2', 'Address Line 2', false)}
        ${pinpointAddressInput('town', 'Town', true)}
        ${pinpointAddressInput('postcode', 'Postcode', true)}
      </div></div>
    </div>
  </fieldset>`;

const PINPOINT_QUESTIONS = (questions) => `
  <fieldset id="application-fieldset-questions" class="external-form__fieldset">
    ${legend(3, 'Questions')}
    <div class="frow">${questions.join('')}</div>
  </fieldset>`;

const PINPOINT_SUBMIT = `
  <fieldset id="application-fieldset-submit" class="external-form__fieldset"><div class="frow frow--gutters-2x">
    <div class="col-1-1">
      ${legend(4, ' Submit Application ')}
      <p class="external-form__text">In order to contact you with future jobs that you may be interested in, we need to store your personal data.</p>
      <p class="external-form__text">If you are happy for us to do so please click the checkbox below.</p>
      <div class="pretty p-icon p-smooth">
        <input name="application[process_information]" type="hidden" value="0">
        <input required="required" type="checkbox" value="1" name="application[process_information]" id="application_process_information">
        <div class="state p-primary"><i class="icon fa fa-check" aria-hidden="true"></i>
          <label class="external-form__label" for="application_process_information"> Allow us to process your personal information. </label></div>
      </div>
    </div>
    <div class="col-1-1">
      <div class="mar-b-2"><span>Not ready to submit the application yet? </span>
        <button type="button" id="application-save-later-link" class="external-panel__link">Save application for later</button></div>
      <button name="button" type="submit" class="external-button external-button--theme-highlight">Submit Application</button>
    </div>
  </div></fieldset>`;

const ELIGIBLE = 'Are you eligible to work in the US?';
const SPONSORSHIP = 'Do you currently require VISA Sponsorship, or might you in the future?';
const SALARY = 'What are your base salary expectations (excluding benefits)? Please input an annual figure in local currency.';
const PYTHON = 'How many years of hands on experience do you have with Python??';
const SQL = 'How many years of hands on experience do you have with SQL?';

const CONFLUENCE_FORM = `<form id="application-form" class="external-form">
  ${PINPOINT_DETAILS}
  ${PINPOINT_QUESTIONS([
    pinpointBoolean(0, ELIGIBLE),
    pinpointBoolean(1, SPONSORSHIP),
    pinpointNumber(2, SALARY),
    pinpointNumber(3, PYTHON),
    pinpointNumber(4, SQL),
  ])}
  ${PINPOINT_SUBMIT}
</form>`;

const byDurable = (rows, selector) => rows.find((row) => row.durableSelector === selector);

test('a pinpoint number input carries no options: the Yes/No beside it belongs to the radio pair', async () => {
  const rows = await discover(CONFLUENCE_FORM);
  for (const n of [2, 3, 4]) {
    const row = byDurable(rows, `#application_form_application_answers_attributes_${n}_number_answer`);
    assert.ok(row, `number question ${n} is discovered`);
    assert.equal(row.inputType, 'number');
    assert.equal(row.options, null, `${row.label} must not carry ${JSON.stringify(row.options)}`);
    assert.equal(row.optionsComplete, undefined);
  }
  // A labelled control's stored label opens with its <label for> text; the name and id follow, as
  // they always have (the backend reads control handles out of that tail).
  const opensWith = (row, text) => assert.ok(row.label.startsWith(text.toLowerCase()), `${row.label} should open with ${text}`);
  opensWith(byDurable(rows, '#application_form_application_answers_attributes_2_number_answer'), SALARY);
  opensWith(byDurable(rows, '#application_form_application_answers_attributes_3_number_answer'), PYTHON);
  opensWith(byDurable(rows, '#application_form_application_answers_attributes_4_number_answer'), SQL);
});

test('each pinpoint boolean pair is stored once, under its own question, with exactly its own Yes and No', async () => {
  const rows = await discover(CONFLUENCE_FORM);
  const eligible = byDurable(rows, '#application_form_application_answers_attributes_0_boolean_answer_true');
  const sponsorship = byDurable(rows, '#application_form_application_answers_attributes_1_boolean_answer_true');
  assert.ok(eligible, 'the first boolean pair is discovered');
  assert.ok(sponsorship, 'the second boolean pair is discovered');
  assert.equal(eligible.label, ELIGIBLE.toLowerCase());
  assert.equal(sponsorship.label, SPONSORSHIP.toLowerCase());
  assert.deepEqual(eligible.options, ['Yes', 'No']);
  assert.deepEqual(sponsorship.options, ['Yes', 'No']);
  assert.equal(eligible.optionsComplete, true);
  assert.equal(sponsorship.optionsComplete, true);
  // One row per pair, never one per radio.
  assert.equal(rows.filter((row) => row.inputType === 'radio').length, 2);
});

test('a numbered section legend is never a question label, on any control of the section', async () => {
  const rows = await discover(CONFLUENCE_FORM);
  for (const row of rows) {
    assert.doesNotMatch(row.label, /^\s*\d+\s*[.)]/, `${row.durableSelector} is named by a section index: ${row.label}`);
    assert.doesNotMatch(row.label, /personal details|^questions$|submit application|apply with linkedin/, `${row.durableSelector}: ${row.label}`);
  }
  // The address inputs, whose <label> carries no `for`, are named by the label in their own row.
  assert.equal(byDurable(rows, '#address1').label, 'address line 1');
  assert.equal(byDurable(rows, '#town').label, 'town');
  assert.equal(byDurable(rows, '#postcode').label, 'postcode');
  assert.equal(byDurable(rows, '#application_form_application_first_name').label, 'first name application_form[application][first_name] application_form_application_first_name');
});

test('the address finder\'s placeholder is nobody\'s option', async () => {
  const rows = await discover(CONFLUENCE_FORM);
  for (const row of rows) {
    assert.ok(!(row.options || []).some((option) => /start typing/i.test(option)),
      `${row.durableSelector} carries the autocomplete placeholder: ${JSON.stringify(row.options)}`);
  }
  for (const selector of ['#application_form_application_first_name', '#application_form_application_phone', '#address1', '#town', '#postcode']) {
    const row = byDurable(rows, selector);
    assert.ok(row, `${selector} is discovered`);
    assert.equal(row.options, null, `${selector}: ${JSON.stringify(row.options)}`);
  }
});

test('the consent checkbox in the submit section is named by its own statement, not by "4. Submit Application"', async () => {
  const rows = await discover(CONFLUENCE_FORM);
  const consent = byDurable(rows, '#application_process_information');
  assert.ok(consent, 'the consent checkbox is still discovered: the consent-tick plan needs its record');
  assert.equal(consent.inputType, 'checkbox');
  assert.equal(consent.required, true);
  assert.match(consent.label, /^allow us to process your personal information\./);
  assert.doesNotMatch(consent.label, /submit application/);
  assert.deepEqual(consent.options, ['Allow us to process your personal information.']);
  // Neither button in the section is a question.
  assert.equal(rows.some((row) => /save application|submit application/i.test(row.label)), false);
});

/* ONE boolean in the section, which the old rule also got wrong in a different way: with a single
 * radio name in the fieldset, fieldsetOwnsChoice held and the LEGEND named the pair before the
 * choice branch ever ran. The number inputs beside it are each a labelled question of their own,
 * which is what makes the fieldset a section rather than a group. */
test('a lone pinpoint boolean beside labelled number inputs is still named by its own label, not the section legend', async () => {
  const rows = await discover(`<form>${PINPOINT_QUESTIONS([
    pinpointNumber(0, SALARY),
    pinpointBoolean(1, SPONSORSHIP),
    pinpointNumber(2, SQL),
  ])}</form>`);
  const pair = byDurable(rows, '#application_form_application_answers_attributes_1_boolean_answer_true');
  assert.ok(pair);
  assert.equal(pair.label, SPONSORSHIP.toLowerCase());
  assert.deepEqual(pair.options, ['Yes', 'No']);
  assert.equal(byDurable(rows, '#application_form_application_answers_attributes_0_number_answer').options, null);
  assert.equal(byDurable(rows, '#application_form_application_answers_attributes_2_number_answer').options, null);
});

/* THE SHAPES THAT MUST NOT MOVE. A fieldset that holds one choice group and nothing else labelled
 * is that group's own block, and its legend is the question (Greenhouse, Workable). An unlabelled
 * "please specify" text input under the group does not turn the fieldset into a section. */
test('a fieldset holding one group keeps its legend, even with an unlabelled specify box under the options', async () => {
  const rows = await discover(`<form>
    <fieldset>
      <legend>How did you hear about this role?</legend>
      <label><input type="radio" name="source" value="linkedin">LinkedIn</label>
      <label><input type="radio" name="source" value="other">Other</label>
      <input type="text" name="source_other" placeholder="Please specify">
    </fieldset>
    <fieldset>
      <legend>Privacy statement</legend>
      <label><input type="checkbox" name="privacy" value="1">I consent to the above.</label>
    </fieldset>
  </form>`);
  const source = rows.find((row) => row.inputType === 'radio');
  assert.equal(source.label, 'how did you hear about this role?');
  assert.deepEqual(source.options, ['LinkedIn', 'Other']);
  const specify = rows.find((row) => row.durableSelector === '[name="source_other"]');
  assert.equal(specify.options, null, 'a text input never inherits the radios beside it');
  const privacy = rows.find((row) => row.inputType === 'checkbox');
  assert.equal(privacy.label, 'privacy statement');
  assert.deepEqual(privacy.options, ['I consent to the above.']);
});

test('two radio pairs sharing one plain fieldset with no legend are still two questions with two option lists', async () => {
  const rows = await discover(`<form><fieldset>
    <div class="q"><label>Authorized to work?</label>
      <label><input type="radio" name="q1" id="q1" value="y">Yes</label>
      <label><input type="radio" name="q1" value="n">No</label></div>
    <div class="q"><label>Need sponsorship?</label>
      <label><input type="radio" name="q2" id="q2" value="y">Yes</label>
      <label><input type="radio" name="q2" value="n">No</label></div>
  </fieldset></form>`);
  assert.deepEqual(rows.map((row) => [row.label, row.options]), [
    ['authorized to work?', ['Yes', 'No']],
    ['need sponsorship?', ['Yes', 'No']],
  ]);
  assert.equal(rows[0].optionsComplete, true);
});
