/* TWO GAPS A CODE REVIEW OF THE ASHBY FIX FOUND, THE SAME DAY IT MERGED (PR #98, 2026-08-21).
 *
 * ashby-blur-reverts-choice-dom.test.js only ever fixtures Ashby's 'unknown'-kind widget - an
 * anonymous input with no select__/select2 class anywhere, so readChoiceState can never call it
 * 'chosen'. The post-blur reread this file adds also runs on 'chosen'-kind (react-select) controls,
 * reached through choiceLanded's 6 other call sites, and that path was untested. Two risks follow
 * from that gap:
 *
 *   1. The original fix gave the post-blur reread exactly one attempt after a fixed 150ms wait,
 *      with no retry - asymmetric with the settle loop it sits inside, which polls up to 500ms
 *      across 11 reads for exactly the same reason (a controlled component's render can lag its own
 *      click). A control whose blur-triggered validation genuinely takes longer than 150ms - this
 *      file's own IMC Trading location field a few hundred lines up in managed-browser.js is a real,
 *      measured example of a geocoder-backed autocomplete in this codebase - would fail the single
 *      reread even though it would have landed given a little more time.
 *
 *   2. Reaching that timing risk through a 'chosen'-kind control is worse than through Ashby's
 *      'unknown'-kind one: a failed post-blur reread falls through to withdrawRefusedChoice, and for
 *      a 'chosen' control whose own confirm-before-clear read also fails, that function calls
 *      clearChoiceControl - which finds and CLICKS the widget's clear affordance. A too-short retry
 *      window does not just mis-report a 'chosen'-kind control here; it can erase a genuinely
 *      correct answer.
 *
 * The fix (this same commit) replaces the fixed wait with settleVerified, giving the post-blur read
 * the identical up-to-500ms/eleven-read budget the pre-blur read already gets. These cases prove
 * both halves: a control that stays reverted for the whole window is still correctly withdrawn (the
 * fix does not loosen anything), and a control whose revert is transient - it recovers before the
 * window closes - is now rescued instead of destructively cleared.
 *
 * A second, independent gap: blurDrivenChoiceControl's fallback (used whenever a call site does not
 * know the exact driven element) searched 'container' for the first node matching a fixed opener
 * selector, in DOM order. On any container wider than the one widget - this file's own
 * CLEAR_CONTROLS comment already documents a "Remove education" button reachable by exactly this
 * shape of block-wide search - that blurs the wrong element and silently no-ops the whole fix. The
 * fallback now blurs document.activeElement instead of guessing by selector.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';
import { constSource, CHOOSER_NAMES } from './chooser-source.mjs';

const SUPPORT_NAMES = [
  'optionMatches', 'optionMatchesExactly',
  'readChoiceState', 'readCommittedSearchInputValue', 'refuseChoice', 'nearMissChoiceReason',
  'verifyChoiceInContainer', 'settleVerified',
  'CHOICE_SHELL_CLASSES', 'markChoice', 'unmarkChoice', 'clearChoiceControl',
  'withdrawRefusedChoice', 'blurDrivenChoiceControl',
  // choiceLanded's form confirmation and the sentence it speaks. Both are reached from
  // choiceLanded itself, so a harness that omits them executes a different function.
  'formRefusedChoiceReason', 'formStillRequiresChoice',
  'choiceLanded',
  'CLEAR_CONTROL_RE', 'CHOICE_CONTROLS', 'CLEAR_CONTROLS',
  'fillCustomChoice',
];
const SRC = CHOOSER_NAMES.map((name) => constSource(name, 4))
  .concat(SUPPORT_NAMES.map((name) => constSource(name, 4)))
  .join('\n');

let browser;
let page;
test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

function build() {
  return Function('page', `
    let lastClickedOptionText = '';
    let lastClickedOptionAnswer = '';
    let lastChooserTierAnswer = '';
    let lastChoiceArrival = { kind: 'empty', value: '' };
    let lastChoiceControlOpened = false;
    let lastChoiceRefusal = '';
    let choiceRefusals = 0;
    let lastChoiceUnreadable = false;
    let lastChoiceRejectedByForm = false;
    const tracksChoiceFailures = false;
    ${SRC}
    return {
      fillCustomChoice,
      choiceLanded,
      blurDrivenChoiceControl,
      state: () => ({
        lastClickedOptionText, lastClickedOptionAnswer, lastChooserTierAnswer,
        lastChoiceRefusal, choiceRefusals, lastChoiceControlOpened, lastChoiceUnreadable,
      }),
    };
  `)(page);
}

/* A minimal react-select shape: readChoiceState's OWN resolution climbs to the nearest
 * '[class*="select__control"]' (or, failing that, '[class*="select__container"]') and reads
 * '[class*="select__single-value"]' out of it - so this is 'chosen'-kind by the same rule the real
 * runner's Country/Discipline/Location selects are, never 'unknown' like the Ashby fixture.
 *
 * `revertsForMs`: null means the widget never reverts (the durable-commit control case). A number
 * means the widget clears its rendered value on blur exactly like Ashby's does, then - if the
 * number is finite - restores the SAME value after that many ms, modeling a control whose
 * blur-triggered validation is genuinely slower than a single fixed wait, not permanently broken.
 * Infinity models Ashby's own defect: reverts and never comes back.
 */
function reactSelectFixture({ options, revertsForMs }) {
  return `<!doctype html><html><body>
  <div class="select__container">
    <div class="select__control">
      <div class="select__value-container">
        <div class="select__placeholder">Select...</div>
      </div>
      <div class="select__input-container">
        <input role="combobox" aria-haspopup="listbox" aria-expanded="false">
      </div>
    </div>
  </div>
  <script>
  (() => {
    window.__clicked = [];
    const shell = document.querySelector('.select__container');
    const valueContainer = document.querySelector('.select__value-container');
    const input = document.querySelector('input[role="combobox"]');
    const OPTIONS = ${JSON.stringify(options)};
    const REVERTS_FOR_MS = ${JSON.stringify(revertsForMs === Infinity ? 'infinity' : (revertsForMs ?? null))};
    let menu = null;
    let query = '';
    let committedByClick = false;
    let lastCommitted = '';
    function close() { if (menu) menu.remove(); menu = null; input.setAttribute('aria-expanded', 'false'); }
    function renderValue(text) {
      valueContainer.innerHTML = text
        ? '<div class="select__single-value">' + text + '</div>'
        : '<div class="select__placeholder">Select...</div>';
    }
    function commit(text) {
      window.__clicked.push(text);
      lastCommitted = text;
      renderValue(text);
      committedByClick = true;
      close();
      input.focus();
    }
    function renderRows() {
      if (!menu) return;
      menu.innerHTML = '';
      const shown = OPTIONS.filter((text) => text.toLowerCase().includes(query.toLowerCase()));
      for (const text of shown) {
        const row = document.createElement('div');
        row.setAttribute('role', 'option');
        row.textContent = text;
        row.addEventListener('click', () => commit(text));
        menu.appendChild(row);
      }
    }
    function open() {
      if (menu) return;
      menu = document.createElement('div');
      shell.appendChild(menu);
      input.setAttribute('aria-expanded', 'true');
      renderRows();
    }
    input.addEventListener('mousedown', open);
    input.addEventListener('click', open);
    input.addEventListener('input', () => { query = input.value; open(); renderRows(); });
    input.addEventListener('blur', () => {
      if (REVERTS_FOR_MS === null || !committedByClick) return;
      renderValue('');
      committedByClick = false;
      if (REVERTS_FOR_MS !== 'infinity') {
        setTimeout(() => { renderValue(lastCommitted); committedByClick = true; }, REVERTS_FOR_MS);
      }
    });
  })();
  </script></body></html>`;
}

async function run(markup, answer) {
  await page.setContent(markup);
  const api = build();
  const container = page.locator('.select__container');
  const filled = await api.fillCustomChoice(container, answer);
  const landed = filled ? await api.choiceLanded(container, answer) : false;
  const after = await page.evaluate(() => ({
    clicked: window.__clicked,
    finalValueText: (document.querySelector('.select__single-value') || {}).textContent || '',
  }));
  return { filled, landed, ...after, state: api.state() };
}

test('a chosen-kind control that reverts for good is still correctly withdrawn through the widened settleVerified window', async () => {
  const result = await run(
    reactSelectFixture({ options: ['Dubai, United Arab Emirates'], revertsForMs: Infinity }),
    'Dubai',
  );
  assert.equal(result.filled, true);
  assert.equal(result.landed, false, 'a chosen-kind control that never recovers must not be reported landed');
  assert.equal(result.finalValueText, '', 'the real control is empty, same as the live Ashby screenshot shape');
});

test('a chosen-kind control whose blur-triggered revert is transient is rescued by the widened settleVerified window, not destructively withdrawn', async () => {
  // THE CASE THE OLD FIXED-150ms REREAD COULD NOT CATCH. The control reverts on blur exactly like
  // the permanently-broken case above, but recovers 300ms later - past the old single wait, well
  // inside settleVerified's up-to-500ms budget. Before this fix, choiceLanded's post-blur reread
  // would have fired once at t=150ms, seen the still-reverted value, and fallen through to
  // withdrawRefusedChoice - which, for a chosen-kind control whose own confirm read also lands
  // inside the same still-reverted window, calls clearChoiceControl and destructively clears a
  // control that was about to recover on its own.
  const result = await run(
    reactSelectFixture({ options: ['Dubai, United Arab Emirates'], revertsForMs: 300 }),
    'Dubai',
  );
  assert.equal(result.filled, true);
  assert.equal(result.landed, true, 'a control that recovers within the settle window must be reported landed, not withdrawn');
  assert.equal(result.finalValueText, 'Dubai, United Arab Emirates', 'the recovered value is what is left on the form');
});

test('a chosen-kind control that never reverts pays no more than the ordinary settle cost', async () => {
  const result = await run(
    reactSelectFixture({ options: ['Dubai, United Arab Emirates'], revertsForMs: null }),
    'Dubai',
  );
  assert.equal(result.filled, true);
  assert.equal(result.landed, true);
  assert.equal(result.finalValueText, 'Dubai, United Arab Emirates');
});

test('blurDrivenChoiceControl blurs whatever the page actually has focused, not the first DOM match, when no directControl is known', async () => {
  // Models the shape this file's own CLEAR_CONTROLS comment already documents as reachable by a
  // block-wide selector search: a decoy button (a repeated section's own "Remove education" control,
  // or an earlier multi-value chip's remove button) sorts ahead of the real, focused control in DOM
  // order. The old fallback ('input, [role="combobox"], [role="button"], button').first() would have
  // blurred the decoy - a no-op, since it was never focused - and left the real control untouched.
  await page.setContent(`<!doctype html><html><body>
    <div class="question-block">
      <button class="decoy">Remove education</button>
      <input role="combobox" id="real-control">
    </div>
  </body></html>`);
  const api = build();
  await page.locator('#real-control').focus();
  assert.equal(
    await page.evaluate(() => document.activeElement.id), 'real-control',
    'the fixture must start with the real control actually focused',
  );
  const container = page.locator('.question-block');
  await api.blurDrivenChoiceControl(container, null);
  const stillFocused = await page.evaluate(() => document.activeElement && document.activeElement.id);
  assert.notEqual(stillFocused, 'real-control', 'the actually-focused control was blurred');
});

test('blurDrivenChoiceControl leaves focus alone when nothing inside the container is focused', async () => {
  // Nothing to blur is not an error: an earlier action may have already moved focus elsewhere on
  // the page (a description this fill never touched), and this must not reach in and blur that.
  await page.setContent(`<!doctype html><html><body>
    <input id="unrelated">
    <div class="question-block"><input role="combobox" id="real-control"></div>
  </body></html>`);
  const api = build();
  await page.locator('#unrelated').focus();
  const container = page.locator('.question-block');
  await api.blurDrivenChoiceControl(container, null);
  assert.equal(
    await page.evaluate(() => document.activeElement && document.activeElement.id), 'unrelated',
    'focus outside the container must be left exactly where it was',
  );
});

test('blurDrivenChoiceControl still prefers directControl when it is known, ignoring the container entirely', async () => {
  await page.setContent(`<!doctype html><html><body>
    <div class="question-block">
      <input role="combobox" id="decoy-focused">
      <input role="combobox" id="the-driven-control">
    </div>
  </body></html>`);
  const api = build();
  await page.locator('#decoy-focused').focus();
  const container = page.locator('.question-block');
  const directControl = page.locator('#the-driven-control');
  await api.blurDrivenChoiceControl(container, directControl);
  assert.equal(
    await page.evaluate(() => document.activeElement && document.activeElement.id), 'decoy-focused',
    'a known directControl is blurred directly; a still-focused sibling is none of this call\'s business',
  );
});

test('choiceLanded reuses settleVerified for its post-blur reread rather than a fixed wait', () => {
  assert.match(SANDBOX_RUNNER, /await blurDrivenChoiceControl\(container, directControl\);\n\s+if \(await settleVerified\(\(\) => verifyChoiceInContainer\(/);
});
