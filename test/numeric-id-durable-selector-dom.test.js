/* GREENHOUSE'S DEMOGRAPHIC REACT-SELECTS, WHOSE ONLY DURABLE NAME IS A NUMBER.
 *
 * Measured on Hudson River Trading (job-boards.greenhouse.io, packet 4a79eec1, 2026-09-02): the
 * "Voluntary Self-Identification" block renders "What is your gender?", "Are you a veteran?",
 * "Do you have a disability?" and "What is your race/ethnicity?" as react-selects whose inner
 * <input> carries id 245/248/249/250, role=combobox, no name, no data-field-path, no options in
 * the DOM until the menu opens. durableSelectorOf declined every one of them because `#248` is not
 * CSS, so the four shipped with durableSelector null; the backend then filed missing_exact_options
 * with portal_selector null and had no control to store a question against.
 *
 * `[id="248"]` is exact CSS. This pins that discovery reports it, that page.locator() resolves it
 * to exactly the control, that named ids keep the `#` form every consumer already parses, and
 * that normalizeManagedActions carries the selector through unchanged.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER, normalizeManagedActions } from '../src/managed-browser.js';

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

/* Transcribed from the live job-boards demographic block: a label bound by `for` to the numeric
 * id, the react-select shell, and the search input that IS the control discovery reports. */
const demographicSelect = (id, prompt) => `
  <div class="demographic-question">
    <label for="${id}">${prompt}<span class="required">*</span></label>
    <div class="select__container">
      <div class="select__control">
        <input id="${id}" type="text" role="combobox" aria-haspopup="listbox" aria-expanded="false"
          aria-autocomplete="list" autocomplete="off" value="" />
      </div>
    </div>
  </div>`;

const educationSelect = `
  <div class="education-question">
    <label for="school--0">School<span class="required">*</span></label>
    <div class="select__control">
      <input id="school--0" type="text" role="combobox" aria-haspopup="listbox" value="" />
    </div>
  </div>`;

const FORM = `
  <form id="application-form">
    ${educationSelect}
    <fieldset>
      <legend>Voluntary Self-Identification</legend>
      ${demographicSelect('245', 'What is your gender?')}
      ${demographicSelect('248', 'Are you a veteran?')}
      ${demographicSelect('249', 'Do you have a disability?')}
      ${demographicSelect('250', 'What is your race/ethnicity?')}
    </fieldset>
  </form>`;

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

test('a numeric-id react-select reports an attribute selector, and a named one keeps the hash form', async () => {
  const reported = await evaluateWith(FORM, `
    return [...document.querySelectorAll('input[role="combobox"]')].map((el) => ({
      id: el.id,
      durable: helpers.durableSelectorOf(el, helpers.blockOf(el)),
      label: helpers.questionLabel(el),
    }));
  `);
  assert.deepEqual(reported.map(({ id, durable }) => [id, durable]), [
    ['school--0', '#school--0'],
    ['245', '[id="245"]'],
    ['248', '[id="248"]'],
    ['249', '[id="249"]'],
    ['250', '[id="250"]'],
  ]);
  // The question text is still the employer's own, which is what the backend joins on.
  assert.match(reported[2].label, /are you a veteran\?/i);
});

test('the reported selector resolves through page.locator() to exactly that control', async () => {
  await page.setContent('<!doctype html><html><body>' + FORM + '</body></html>');
  for (const [id, prompt] of [['245', 'What is your gender?'], ['248', 'Are you a veteran?'], ['249', 'Do you have a disability?'], ['250', 'What is your race/ethnicity?']]) {
    const locator = page.locator('[id="' + id + '"]');
    assert.equal(await locator.count(), 1, id);
    const labelled = await page.locator('label[for="' + id + '"]').innerText();
    assert.match(labelled, new RegExp(prompt.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')));
  }
  // The old form would have thrown inside the locator; recorded so the choice is never reversed
  // for "it looked invalid" reasons.
  await assert.rejects(page.locator('#248').count(), /not a valid selector|SyntaxError|Unexpected token/i);
});

test('a quoted numeric id is escaped, and normalizeManagedActions carries the attribute selector through', () => {
  const source = extractBraced('function durableSelectorOf(el, block) {');
  const durableSelectorOf = Function('CSS', 'return (' + source + ');')({ escape: (value) => String(value) });
  assert.equal(durableSelectorOf({ id: '248', getAttribute: () => null }, null), '[id="248"]');
  assert.equal(durableSelectorOf({ id: '2"48', getAttribute: () => null }, null), '[id="2\\"48"]');
  assert.deepEqual(
    normalizeManagedActions([{ type: 'click', selector: '[id="248"]', label: 'question:are you a veteran?_open' }]),
    [{ type: 'click', selector: '[id="248"]', label: 'question:are you a veteran?_open' }],
  );
});
