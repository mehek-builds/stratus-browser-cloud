/* THE LEVER EDUCATION CARD'S SELECTS, ON THE MARKUP THAT LOST THEM.
 *
 * Measured on the live jobs.lever.co Mytos form, 2026-08-20 (packet 16f1c744). One card renders
 * NINE questions in one section: four required native selects (discipline, qualification level,
 * degree classification, UK visa), text inputs, and a Select2 university picker. Two defects, both
 * pinned here on transcribed markup:
 *
 *   1. The native selects carry nothing but name="cards[<uuid>][fieldN]"; their questions sit in
 *      the sibling .application-label. The card-heading walk refuses a section holding nine
 *      controls (rightly), and the leverCardHeading arm was gated on a placeholder, which a select
 *      cannot carry - so all four were named by their handles and dropped downstream, and the run
 *      said a required field "has no label Litos can read" about labels that were on the screen.
 *
 *   2. The university picker's discovered control is Select2's '<span role="combobox">' with no
 *      id, no name, no field path - so the question shipped with no durable selector, no fill
 *      action could be built, and "University of Southern California", present verbatim among the
 *      backing select's options, was reported "required and is still empty" on every run.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

function extractBraced(prefix) {
  const start = SANDBOX_RUNNER.indexOf(prefix);
  assert.notEqual(start, -1, prefix + ' must still be in the runner');
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
  throw new Error('could not find the end of ' + prefix);
}

const SOURCE = [
  extractBraced('function clean(s) {'),
  extractBraced('function renderedText(node) {'),
  extractBraced('function labelledByText(el) {'),
  extractBraced('function blockOf(el) {'),
  extractBraced('function questionLabel(el) {'),
  extractBraced('function durableSelectorOf(el, block) {'),
].join('\n');

/* Transcribed from the live Mytos form: one card section, several li.application-question, each
 * label a div.application-label whose .text div holds a bare text node plus the required span. */
const cardSelect = (field, prompt, options) => `
  <li class="application-question custom-question"><div>
    <div class="application-label full-width dropdown">
      <div class="text">${prompt}<span class="required">&#10047;</span></div>
    </div>
    <div class="application-field full-width required-field"><div class="application-dropdown">
      <select name="cards[62541ff1-0b7c-4f5b-a51d-a217d565776e][${field}]" required>
        <option value="">Select ...</option>
        ${options.map((option) => `<option value="${option}">${option}</option>`).join('')}
      </select>
    </div></div>
  </div></li>`;

const cardText = (field, prompt) => `
  <li class="application-question custom-question"><div>
    <div class="application-label full-width">
      <div class="text">${prompt}<span class="required">&#10047;</span></div>
    </div>
    <div class="application-field full-width required-field">
      <input class="card-field-input" placeholder="Type your response" type="text"
        name="cards[62541ff1-0b7c-4f5b-a51d-a217d565776e][${field}]" required />
    </div>
  </div></li>`;

const universityPicker = `
  <li class="application-question custom-question"><div>
    <div class="application-label full-width university">
      <div class="text">Which was the most recent university you attended?<span class="required">&#10047;</span></div>
    </div>
    <div class="application-field full-width required-field"><div class="application-university">
      <select id="university-picker-62541ff1-0" class="select2-hidden-accessible"
        name="cards[62541ff1-0b7c-4f5b-a51d-a217d565776e][field0]" required
        aria-hidden="true" tabindex="-1" style="position:absolute;width:1px;height:1px;clip:rect(0 0 0 0)">
        <option value=""></option>
        <option value="usc">University of Southern California</option>
      </select>
      <span class="select2 select2-container select2-container--default" style="width:400px">
        <span class="selection">
          <span class="select2-selection select2-selection--single" role="combobox"
            aria-haspopup="true" aria-expanded="false" aria-labelledby="select2-uni-container">
            <span class="select2-selection__rendered" id="select2-uni-container">
              <span class="select2-selection__placeholder">Select a university or college</span>
            </span>
          </span>
        </span>
      </span>
    </div></div>
  </div></li>`;

const mytosCard = (lis) => `
  <div class="section page-centered application-form" data-qa="additional-cards">
    <h4 data-qa="card-name">EDUCATION</h4>
    <input type="hidden" name="cards[62541ff1-0b7c-4f5b-a51d-a217d565776e][baseTemplate]" value="{}" />
    <ul>${lis}</ul>
  </div>`;

let browser;
let page;
test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

async function evaluateWith(html, fn) {
  await page.setContent('<!doctype html><html><body>' + html + '</body></html>');
  return page.evaluate(([source, body]) => {
    // eslint-disable-next-line no-new-func
    const helpers = new Function(source + '\nreturn { questionLabel, blockOf, durableSelectorOf };')();
    // eslint-disable-next-line no-new-func
    return new Function('helpers', body)(helpers);
  }, [SOURCE, fn]);
}

/* The full card, so every bound runs against the shape that has to refuse or allow it: nine
 * controls in the section (the card-heading walk must refuse), one control per li. */
const FULL_CARD = mytosCard(
  universityPicker
  + cardSelect('field1', 'What discipline did your degree fall under?', ['Engineering', 'Natural sciences'])
  + cardText('field2', 'What degree did you complete at the above university?')
  + cardSelect('field3', 'What level of formal educational qualification do you hold?', ['Bachelors', 'Masters'])
  + cardText('field4', 'What was your numeric percentage average?')
  + cardSelect('field5', 'What was your degree classification?', ['First', '2:1'])
  + `
  <li class="application-question custom-question"><div>
    <div class="application-label full-width">
      <div class="text">What have you built that was challenging, you had ownership of and are proud of?<span class="required">&#10047;</span></div>
    </div>
    <div class="application-field full-width required-field">
      <textarea class="card-field-input" name="cards[62541ff1-0b7c-4f5b-a51d-a217d565776e][field6]" required></textarea>
    </div>
  </div></li>`
  + cardSelect('field7', 'Do you require a visa to work in the UK?', ['Yes', 'No']),
);

test('a card select with no text of its own is named by its sibling application-label', async () => {
  const labels = await evaluateWith(FULL_CARD, `
    return [...document.querySelectorAll('select:not([aria-hidden])')].map((el) => helpers.questionLabel(el));
  `);
  /* Bare questions, exactly the shape the single-question heading walk returns, so downstream
   * treats both recoveries alike. The required marker is part of the employer's rendered label
   * and travels with it. */
  assert.deepEqual(labels, [
    'what discipline did your degree fall under?\u273f',
    'what level of formal educational qualification do you hold?\u273f',
    'what was your degree classification?\u273f',
    'do you require a visa to work in the uk?\u273f',
  ]);
  for (const label of labels) assert.doesNotMatch(label, /cards\s*\[/);
});

test('the text inputs beside them keep their placeholder-gated recovery unchanged', async () => {
  const labels = await evaluateWith(FULL_CARD, `
    return [...document.querySelectorAll('input.card-field-input')].map((el) => helpers.questionLabel(el));
  `);
  assert.deepEqual(labels, [
    'what degree did you complete at the above university?\u273f cards[62541ff1-0b7c-4f5b-a51d-a217d565776e][field2]',
    'what was your numeric percentage average?\u273f cards[62541ff1-0b7c-4f5b-a51d-a217d565776e][field4]',
  ]);
});

test('the Select2 span borrows its hidden backing select as durable selector', async () => {
  const selector = await evaluateWith(FULL_CARD, `
    const span = document.querySelector('span[role="combobox"]');
    return helpers.durableSelectorOf(span, helpers.blockOf(span));
  `);
  assert.equal(selector, '[name="cards[62541ff1-0b7c-4f5b-a51d-a217d565776e][field0]"]');
});

test('a select that carries a real label keeps it, and this arm cannot rename it', async () => {
  const [label] = await evaluateWith(mytosCard(`
    <li class="application-question"><div>
      <div class="application-label"><div class="text">The wrong question</div></div>
      <div class="application-field">
        <select name="cards[62541ff1-0b7c-4f5b-a51d-a217d565776e][field9]" aria-label="Country of residence">
          <option>UK</option>
        </select>
      </div>
    </div></li>`), `
    return [...document.querySelectorAll('select')].map((el) => helpers.questionLabel(el));
  `);
  assert.equal(label, 'country of residence cards[62541ff1-0b7c-4f5b-a51d-a217d565776e][field9]');
});

test('a card holding two visible controls in one question refuses the label, as before', async () => {
  const labels = await evaluateWith(mytosCard(`
    <li class="application-question"><div>
      <div class="application-label"><div class="text">A range</div></div>
      <div class="application-field">
        <select name="cards[a][from]"><option>1</option></select>
        <select name="cards[a][to]"><option>2</option></select>
      </div>
    </div></li>`), `
    return [...document.querySelectorAll('select')].map((el) => helpers.questionLabel(el));
  `);
  for (const label of labels) assert.match(label, /cards\s*\[/, 'ambiguity must yield the handle, never a guess');
});

test('a bare opener never borrows a visible select, and never one of two', async () => {
  const results = await evaluateWith(mytosCard(`
    <li class="application-question"><div>
      <div class="application-field">
        <select name="cards[b][visible]"><option>1</option></select>
        <span role="combobox" class="opener"></span>
      </div>
    </div></li>
    <li class="application-question"><div>
      <div class="application-field">
        <select name="cards[c][one]" aria-hidden="true"><option>1</option></select>
        <select name="cards[c][two]" aria-hidden="true"><option>2</option></select>
        <span role="combobox" class="opener"></span>
      </div>
    </div></li>`), `
    return [...document.querySelectorAll('span.opener')].map((el) => (
      helpers.durableSelectorOf(el, helpers.blockOf(el))
    ));
  `);
  assert.deepEqual(results, [null, null]);
});

test('the borrow requires the opener to live inside the select’s own widget', async () => {
  const selector = await evaluateWith(mytosCard(`
    <li class="application-question"><div>
      <div class="application-field">
        <select name="cards[d][backing]" aria-hidden="true"><option>1</option></select>
        <div class="unrelated"></div>
        <span role="combobox" class="stray"></span>
      </div>
    </div></li>`), `
    const el = document.querySelector('span.stray');
    return helpers.durableSelectorOf(el, helpers.blockOf(el));
  `);
  assert.equal(selector, null);
});

/* Same form, same day: the required "What have you built..." question is a TEXTAREA whose
 * placeholder is EMPTY, so the placeholder-gated arm cannot reach it and the run reported it as
 * "a required field has no label Litos can read". */
test('a card textarea with no text of its own is named by its sibling application-label', async () => {
  const [label] = await evaluateWith(FULL_CARD, `
    return [...document.querySelectorAll('textarea')].map((el) => helpers.questionLabel(el));
  `);
  assert.equal(label, 'what have you built that was challenging, you had ownership of and are proud of?\u273f');
});
