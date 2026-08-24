/* THE WITHDRAWAL MUST ASK "IS THIS WRONG" BEFORE IT PRESSES ANYTHING, run against real react-select
 * markup in a real browser.
 *
 * choiceLanded already gives a React Select a bounded 500ms across eleven reads to publish the row
 * it was just clicked to hold (see the settle loop's own comment). That is a bound, not a guarantee:
 * the loop's LAST read and withdrawRefusedChoice's FIRST read are still two separate reads of a live
 * page, and a control that repaints between them is holding the correct answer at the exact moment
 * withdrawRefusedChoice reaches for its own clear affordance.
 *
 * Before this fix, withdrawRefusedChoice asked only what KIND of state the control was in - empty,
 * unknown, or chosen - and treated every 'chosen' state as a wrong answer to be cleared, whatever it
 * actually held. So the sequence was: the settle loop reads 'empty' because the widget has not
 * painted yet, the loop gives up, and on the very next read - now 'chosen', now holding the right
 * value - the withdrawal cleared it anyway and reported the field lost, on a control this run had
 * itself just emptied. Investigated 2026-08-20 while tracing "Answered here, still empty on the
 * form" reports across Jump Trading, Optiver and Mytos (Greenhouse and Lever react-select degree,
 * discipline and university fields): the packet's stored answer was correct and unchanged across
 * retries, so a fill-mechanics defect on the browser side - not an audit/staleness problem - was the
 * remaining explanation, and this is the one call site in the choice pipeline that had no verifier
 * standing between "the control is not empty" and "press the control's clear button".
 *
 * THE FIX: withdrawRefusedChoice takes the expected answer and asks verifyChoiceInContainer once
 * more, against the state it is about to act on, before it presses anything. A confirmed match is
 * not a coincidence to be suspicious of - verifyChoiceInContainer is the one function in this file
 * allowed to disagree with the chooser, and if it now agrees, the control is holding the answer by
 * the same rule choiceLanded's own successful path already accepts.
 *
 * THE RACE IS MODELLED BY A READ COUNT, NOT A WALL-CLOCK DELAY. A setTimeout tuned to land inside a
 * one-read-wide window is exactly the kind of test that is flaky on a slower CI box and worthless on
 * a faster one. What actually matters is ORDER: the widget must still be 'empty' for every read the
 * settle loop makes, and 'chosen' with the right value for the read immediately after. Counting
 * reads of the exact selector readChoiceState queries pins that order exactly, independent of how
 * long any single round trip happens to take.
 *
 * WHY A BROWSER AND NOT A STUB: same reason as combobox-single-action-commit.test.js. The race is a
 * property of two real reads of a real page disagreeing, and a stub that fakes the read schedule
 * cannot prove the fix closes a window it never modelled.
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
  'withdrawRefusedChoice', 'blurDrivenChoiceControl', 'choiceLanded',
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
    let tracksChoiceFailures = false;
    let mirrorsLegacyChoiceMarkers = false;
    ${SRC}
    return {
      fillCustomChoice,
      choiceLanded,
      readChoiceState,
      withdrawRefusedChoice,
      state: () => ({ lastClickedOptionText, lastClickedOptionAnswer, lastChooserTierAnswer, lastChoiceRefusal, choiceRefusals, lastChoiceControlOpened }),
    };
  `)(page);
}

// The exact selector readChoiceState queries for a chosen value. Pinned here as a literal, not
// derived, so a change to that selector fails this test loudly instead of silently going blind.
const CHOSEN_NODE_SELECTOR = '[class*="select__single-value"], [class*="select__multi-value__label"]';

/* A react-select whose chosen-value node exists in the DOM from the moment the row is clicked -
 * exactly as a real react-select's does, synchronously, on the same tick - but is invisible to
 * readChoiceState's OWN query for exactly `revealAfterReads - 1` reads of that query, and visible
 * from the `revealAfterReads`th read on. That models a real repaint landing between two reads
 * without depending on how long either read actually takes.
 */
function fixture({ options, revealAfterReads }) {
  return `<!doctype html><html><body>
  <div id="question">
    <label id="q-label">What degree are you currently pursuing?*</label>
    <div class="select-shell remix-css-fixture-container">
      <div class="select__control">
        <div class="select__value-container">
          <div class="select__placeholder">Select...</div>
          <div class="select__input-container">
            <input id="combo" class="select__input" type="text" role="combobox"
              aria-expanded="false" aria-autocomplete="none" autocomplete="off">
          </div>
        </div>
      </div>
    </div>
  </div>
  <script>
    (() => {
    window.__clicked = [];
    window.__reads = 0;
    window.__revealAfter = ${JSON.stringify(revealAfterReads)};
    // Intercepted ONCE PER PAGE, not once per fixture. page.setContent() re-injects a <script> into
    // the SAME window rather than a fresh JS realm (it is closer to document.write than to a
    // navigation), so a naive re-install on every call to fixture() wraps the previous test's
    // wrapper instead of replacing it - each layer captures its own 'window.__reads' closure by
    // reference, all of them fire on the same call, and the counter overshoots by one per test that
    // ran before it in this file. Guarded on a marker so only the FIRST fixture() in this page's
    // lifetime installs the interception; every later one just resets the two globals it reads.
    if (!window.__litosChoiceReadPatched) {
      window.__litosChoiceReadPatched = true;
      const realQSA = Element.prototype.querySelectorAll;
      const realQS = Element.prototype.querySelector;
      // Intercepted once, globally, for the one selector readChoiceState issues. Every other query
      // on the page (Playwright's own locators included) passes straight through untouched.
      //
      // readChoiceState queries BOTH querySelectorAll (for every chosen node) and, as its fallback
      // when that finds none, querySelector (singular) for the same selector - see the comment on
      // 'chosenNodes' in the shipped source. The counter increments once per call to
      // querySelectorAll, which always runs first; querySelector then honours whatever verdict that
      // call already reached for THIS read, so one readChoiceState invocation is one read regardless
      // of which of the two the widget's shape ends up satisfying.
      Element.prototype.querySelectorAll = function (selector) {
        if (selector === ${JSON.stringify(CHOSEN_NODE_SELECTOR)}) {
          window.__reads += 1;
          if (window.__reads < window.__revealAfter) return realQSA.call(this, '.litos-test-never-matches');
        }
        return realQSA.call(this, selector);
      };
      Element.prototype.querySelector = function (selector) {
        if (selector === ${JSON.stringify(CHOSEN_NODE_SELECTOR)} && window.__reads < window.__revealAfter) {
          return realQS.call(this, '.litos-test-never-matches');
        }
        return realQS.call(this, selector);
      };
    }
    const input = document.getElementById('combo');
    const shell = document.querySelector('.select-shell');
    const valueBox = document.querySelector('.select__value-container');
    const OPTIONS = ${JSON.stringify(options)};
    let menu = null;
    let query = '';
    function renderRows() {
      const list = menu.querySelector('[role="listbox"]');
      list.innerHTML = '';
      const shown = OPTIONS.filter((text) => text.toLowerCase().includes(query.toLowerCase()));
      for (const text of shown) {
        const row = document.createElement('div');
        row.className = 'select__option';
        row.setAttribute('role', 'option');
        row.textContent = text;
        row.addEventListener('click', () => choose(text));
        list.appendChild(row);
      }
    }
    function open() {
      if (menu) return;
      menu = document.createElement('div');
      menu.className = 'select__menu';
      const list = document.createElement('div');
      list.id = 'fixture-menu-listbox';
      list.className = 'select__menu-list';
      list.setAttribute('role', 'listbox');
      menu.appendChild(list);
      shell.appendChild(menu);
      input.setAttribute('aria-expanded', 'true');
      input.setAttribute('aria-controls', 'fixture-menu-listbox');
      renderRows();
    }
    // The chosen-value node is inserted IMMEDIATELY, on the same tick as the click - a real
    // react-select commits its state synchronously too. What is delayed is not the DOM write, it
    // is when readChoiceState's own query is allowed to SEE it, via the interception above.
    function choose(text) {
      window.__clicked.push(text);
      if (menu) { menu.remove(); menu = null; }
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-controls');
      input.value = '';
      query = '';
      const placeholder = valueBox.querySelector('.select__placeholder');
      if (placeholder) placeholder.remove();
      const single = document.createElement('div');
      single.className = 'select__single-value';
      single.textContent = text;
      valueBox.insertBefore(single, valueBox.querySelector('.select__input-container'));
    }
    input.addEventListener('mousedown', open);
    input.addEventListener('click', open);
    input.addEventListener('input', () => { query = input.value; open(); renderRows(); });
    })();
  </script></body></html>`;
}

test('a react-select whose paint is visible only on the read after the settle loop gives up is reported landed, not cleared', async () => {
  await page.setContent(fixture({
    options: ["High School Diploma", 'Associate Degree', "Bachelor's Degree", 'Masters/PhD'],
    // The settle loop makes exactly eleven reads (elapsed 0, 50, ..., 500). Revealing on the
    // TWELFTH means every one of those eleven reads sees 'empty', the loop exhausts having never
    // verified true, and withdrawRefusedChoice's own first read - the twelfth - is the one that
    // finally sees the committed value. That is PR #54's race translated into a read count.
    revealAfterReads: 12,
  }));
  const api = build();
  const container = page.locator('#question');
  const filled = await api.fillCustomChoice(container, "Bachelor's Degree");
  assert.equal(filled, true, 'the row must be clicked even though its paint is not yet visible to readChoiceState');
  // fillCustomChoice's own pre-click read ('alreadyAnswered') already spent one count against
  // REVEAL_AFTER before the settle loop below gets to make any of its own. Zeroed here so the
  // loop's eleven reads are counted on their own terms, independent of how many reads whatever
  // led up to this call happened to make.
  await page.evaluate(() => { window.__reads = 0; });
  const landed = await api.choiceLanded(container, "Bachelor's Degree");
  const after = await page.evaluate(() => ({
    shown: document.querySelector('.select__single-value')?.textContent ?? null,
    placeholder: Boolean(document.querySelector('.select__placeholder')),
    marked: document.getElementById('question').getAttribute('data-litos-unverified-choice'),
    reads: window.__reads,
  }));
  assert.ok(after.reads >= 12, 'the fixture must actually have been read past the reveal point');
  assert.equal(landed, true,
    'the control is holding the right answer by the time the withdrawal would have pressed clear, so this must be reported landed');
  assert.equal(after.shown, "Bachelor's Degree",
    'the correct answer must still be on the form: the old code cleared exactly this value');
  assert.equal(after.placeholder, false, 'the control must not have been reset to its placeholder');
  assert.equal(after.marked, null, 'a landed control carries no unverified-choice mark');
});

test('withdrawRefusedChoice still clears a control confirmed to be holding the WRONG answer', async () => {
  // The safety net only ever rescues a CONFIRMED match. A control holding the wrong row - a near
  // miss, or a row clicked for a different answer entirely - must still be taken back, whenever it
  // is read.
  await page.setContent(fixture({
    options: ["High School Diploma", 'Associate Degree', "Bachelor's Degree", 'Masters/PhD'],
    revealAfterReads: 1,
  }));
  const api = build();
  const container = page.locator('#question');
  const filled = await api.fillCustomChoice(container, 'Associate Degree');
  assert.equal(filled, true);
  // Ask the withdrawal directly, as choiceLanded would after its loop gives up, but naming a
  // DIFFERENT expected answer than the one that was actually clicked - the shape of a stored answer
  // that is not on the employer's list, refused by the near-miss rule upstream.
  const landed = await api.withdrawRefusedChoice(container, 'Associate Degree', 'Associate Degree', "Bachelor's Degree");
  const marked = await container.evaluate((element) => element.getAttribute('data-litos-unverified-choice'));
  // The fixture has no clear affordance for clearChoiceControl to press - that mechanics is covered
  // elsewhere (test/managed-browser.test.js). What this test isolates is the new gate itself: a
  // confirmed WRONG value must never be reported landed, and a withdrawal that could not physically
  // undo the click must say so rather than silently letting the wrong answer ride.
  assert.equal(landed, false, 'a confirmed wrong answer is not landed');
  assert.equal(marked, 'different', 'a wrong answer this run could not take back must still be marked');
});
