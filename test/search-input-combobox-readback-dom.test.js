/* A COMBOBOX THAT IS AN <input> PUBLISHES ITS CHOICE IN ITS OWN VALUE.
 *
 * Measured on the live Easy Dynamics Rippling form (2026-08-20): 'Please identify your race' is
 * '<input role="combobox" data-input="select-search-input" id="field-77">', and clicking the
 * "Asian" row of its portalled '#field-77-list' leaves the input holding value="Asian" with the
 * menu closed. There is no select__single-value node and no select__* class anywhere, and
 * textContent never carries an input's value, so readChoiceState called a correct fill 'unknown',
 * the verifier marked it unreadable, and the run was parked over an answer that was on the form.
 *
 * These cases run the REAL readChoiceState (extracted from the shipped runner, never copied)
 * against that measured shape and against the shapes that must keep their existing verdicts.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

function constSource(name, indent) {
  const pad = ' '.repeat(indent);
  const start = SANDBOX_RUNNER.indexOf(`\n${pad}const ${name} = `);
  assert.notEqual(start, -1, `${name} must exist in the sandbox runner`);
  const rest = SANDBOX_RUNNER.slice(start + 1);
  const next = rest.search(new RegExp(`\\n${pad}(?:const|let|var|for|if|return|await|//|/\\*)`));
  return rest.slice(0, next === -1 ? rest.length : next);
}

const READ_CHOICE_STATE = constSource('readChoiceState', 4);

let browser;
let page;
test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

async function choiceStateFor(markup, containerSelector) {
  await page.setContent(`<!doctype html><html><body>${markup}</body></html>`);
  const container = page.locator(containerSelector);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction('container', `
    ${READ_CHOICE_STATE}
    return readChoiceState(container);
  `);
  return run(container);
}

/* The Rippling wrapper the fill branch resolves as its container: the nearest ancestor div
 * holding a combobox. Byte-for-byte the classes the live form serves, which is the point - none
 * of them say "select". */
const rippling = (inputAttributes) => (
  '<div class="css-15epsmk etc2niq2">'
  + '<div data-testid="select-search-input" class="css-1sjw7wz efnm4lm1">'
  + '<input data-input="select-search-input" id="field-77" role="combobox"'
  + ' aria-autocomplete="list" aria-haspopup="listbox" class="css-d76fs efnm4lm5"'
  + ' ' + inputAttributes + '>'
  + '</div></div>'
);

test('a committed value in a closed search-input combobox reads back as chosen', async () => {
  const state = await choiceStateFor(
    rippling('aria-expanded="false" placeholder="Select..." value="Asian"'),
    '.etc2niq2',
  );
  assert.equal(state.kind, 'chosen');
  assert.equal(state.value, 'Asian');
  assert.deepEqual(state.values, ['Asian']);
});

test('the same value behind an OPEN menu is a search query, not a choice', async () => {
  const state = await choiceStateFor(
    rippling('aria-expanded="true" placeholder="Select..." value="Asian"'),
    '.etc2niq2',
  );
  assert.equal(state.kind, 'unknown');
});

test('an empty search input is not promoted to chosen', async () => {
  const state = await choiceStateFor(
    rippling('aria-expanded="false" placeholder="Select..." value=""'),
    '.etc2niq2',
  );
  assert.notEqual(state.kind, 'chosen');
});

test('a value that is exactly the resting placeholder is what nothing looks like', async () => {
  const state = await choiceStateFor(
    rippling('aria-expanded="false" placeholder="Select..." value="Select..."'),
    '.etc2niq2',
  );
  assert.notEqual(state.kind, 'chosen');
});

test('the combobox handed in directly, not via a wrapper, reads its own value', async () => {
  const state = await choiceStateFor(
    rippling('aria-expanded="false" placeholder="Search" value="+1 US"'),
    '#field-77',
  );
  assert.equal(state.kind, 'chosen');
  assert.equal(state.value, '+1 US');
});

test('a React Select chosen-value node still wins over the input read', async () => {
  const state = await choiceStateFor(
    '<div class="select__container"><div class="select__control">'
    + '<div class="select__single-value">United Arab Emirates</div>'
    + '<div class="select__input-container">'
    + '<input role="combobox" aria-expanded="false" value="typed query">'
    + '</div></div></div>',
    '.select__container',
  );
  assert.equal(state.kind, 'chosen');
  assert.equal(state.value, 'United Arab Emirates');
});

test('a React Select placeholder still reads empty, whatever its input holds', async () => {
  const state = await choiceStateFor(
    '<div class="select__container"><div class="select__control">'
    + '<div class="select__placeholder">Select...</div>'
    + '<div class="select__input-container">'
    + '<input role="combobox" aria-expanded="false" value="abandoned text">'
    + '</div></div></div>',
    '.select__container',
  );
  assert.equal(state.kind, 'empty');
});
