/* A COMBOBOX THAT IS AN <input> PUBLISHES ITS CHOICE IN ITS OWN VALUE.
 *
 * Measured on the live Easy Dynamics Rippling form (2026-08-20): 'Please identify your race' is
 * '<input role="combobox" data-input="select-search-input" id="field-77">', and clicking the
 * "Asian" row of its portalled '#field-77-list' leaves the input holding value="Asian" with the
 * menu closed. There is no select__single-value node and no select__* class anywhere, and
 * textContent never carries an input's value, so readChoiceState calls it 'unknown', the verifier
 * marked a correct fill unreadable, and the run was parked over an answer that was on the form.
 *
 * The repair is deliberately NOT an arm of readChoiceState - promoting any closed-menu input
 * value to 'chosen' would leak into the arrival read, the clear check and the left-on-the-form
 * skip, and would let a fill verify its own keystrokes. It is a separate evidence read,
 * readCommittedSearchInputValue, weighed by verifyChoiceInContainer against the row that was
 * clicked. These cases run the REAL helper (extracted from the shipped runner, never copied)
 * against the measured shape, and pin the verifier's weighing in source.
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

const READ_COMMITTED = constSource('readCommittedSearchInputValue', 4);
const READ_CHOICE_STATE = constSource('readChoiceState', 4);

let browser;
let page;
test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

async function runExtracted(source, name, markup, containerSelector) {
  await page.setContent(`<!doctype html><html><body>${markup}</body></html>`);
  const container = page.locator(containerSelector);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction('container', `
    ${source}
    return ${name}(container);
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

test('a committed value behind a closed menu is read off the input', async () => {
  const held = await runExtracted(
    READ_COMMITTED, 'readCommittedSearchInputValue',
    rippling('aria-expanded="false" placeholder="Select..." value="Asian"'),
    '.etc2niq2',
  );
  assert.equal(held, 'Asian');
});

test('the same value behind an OPEN menu is a search query and reads null', async () => {
  const held = await runExtracted(
    READ_COMMITTED, 'readCommittedSearchInputValue',
    rippling('aria-expanded="true" placeholder="Select..." value="Asian"'),
    '.etc2niq2',
  );
  assert.equal(held, null);
});

test('the combobox handed in directly, not via a wrapper, reads its own value', async () => {
  const held = await runExtracted(
    READ_COMMITTED, 'readCommittedSearchInputValue',
    rippling('aria-expanded="false" placeholder="Search" value="+1 US"'),
    '#field-77',
  );
  assert.equal(held, '+1 US');
});

test('a container with no input-shaped combobox has no evidence to offer', async () => {
  const held = await runExtracted(
    READ_COMMITTED, 'readCommittedSearchInputValue',
    '<div class="block"><div id="field-90" role="combobox" aria-expanded="false">'
    + '<p>Select...</p></div></div>',
    '.block',
  );
  assert.equal(held, null);
});

test('readChoiceState itself still calls the measured Rippling shape unknown', async () => {
  const state = await runExtracted(
    READ_CHOICE_STATE, 'readChoiceState',
    rippling('aria-expanded="false" placeholder="Select..." value="Asian"'),
    '.etc2niq2',
  );
  assert.equal(state.kind, 'unknown');
});

/* THE WEIGHING LIVES IN verifyChoiceInContainer AND ONLY THERE. Source pins, in the style of the
 * budget and furniture pins: the acceptance must stay gated on the unknown state, on a click this
 * call actually made, on byte-for-byte equality with that whole clicked row, and on the held row
 * itself being the answer (or a list-shaped tier's recorded commit). Loosening any one of these
 * re-opens either the read-your-own-keystrokes tautology or the near-miss privilege. */
test('the verifier weighs the committed value against the clicked row, gated exactly', () => {
  const start = SANDBOX_RUNNER.indexOf('const verifyChoiceInContainer');
  const end = SANDBOX_RUNNER.indexOf('const markChoice');
  assert.ok(start !== -1 && end > start, 'verifyChoiceInContainer must precede markChoice');
  const verifier = SANDBOX_RUNNER.slice(start, end);
  assert.match(verifier, /state\.kind === 'unknown' && clean\(clickedOptionText \|\| ''\)/);
  assert.match(verifier, /readCommittedSearchInputValue\(container\)/);
  assert.match(verifier, /heldRow === clean\(clickedOptionText\)\.toLowerCase\(\)/);
  assert.match(verifier, /holdsAnswer\(committed, expected\) \|\| declineMatches\(committed, expected\)/);
  assert.match(verifier, /clean\(chooserTierAnswer \|\| ''\)\) && holdsAnswer\(chooserTierAnswer, expected\)/);
});
