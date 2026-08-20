/* THE SAME SETTLE WINDOW choiceLanded GIVES A REACT SELECT, GIVEN TO EVERY OTHER CONTROL SHAPE THAT
 * READ A VERIFICATION EXACTLY ONCE, run against real markup in a real browser.
 *
 * Traced 2026-08-20, minutes after PR #77's confirm-before-clear fix for withdrawRefusedChoice went
 * live: a fresh run against the real account hit the identical product-facing symptom -
 * "answered here, still empty on the form" - on four different portals, most of them nowhere near a
 * react-select. Mytos/Lever's university field is a Select2 combobox PR #77 never touches (that gap
 * is documented in verifyChoiceInContainer's own comment and is a separate, intentional "cannot
 * confirm this" refusal, not a settle-window defect). Optiver/Greenhouse's pronouns and terms-and-
 * conditions and DGA's relocation and work-authorization controls are a different shape again:
 * native radio groups, a lone consent checkbox, and native <select> dropdowns - none of them ever
 * cleared anything on a failed read (there is no clearChoiceControl equivalent for a checkbox or a
 * select in this file, confirmed by grep: '.check(' has exactly two call sites and neither is ever
 * followed by '.uncheck('), so there was no confirm-before-clear gap to close on these paths. What
 * they shared instead was simpler and just as costly: pickRadioOption read `element.checked` back
 * exactly once after a fixed 150ms wait, the lone-checkbox arm read it back immediately with no wait
 * at all, and both native-select verification call sites ran verifyFilled exactly once. A controlled
 * component that commits its checked/selected state on a render after the one the click or
 * selectOption dispatched into is holding the right answer at the exact moment any of those single
 * reads fired, and reported the field lost.
 *
 * settleVerified generalizes choiceLanded's own bounded retry - up to 500ms across eleven reads of
 * the SAME predicate a bare read would have used once - to every one of those call sites. This is
 * deliberately not a looser check: it is the identical predicate (isChecked, verifyFilled), asked
 * again on the same schedule, so a genuinely wrong or different value that failed on read one still
 * fails on read eleven.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';
import { constSource, CHOOSER_NAMES } from './chooser-source.mjs';

const SUPPORT_NAMES = [
  'optionMatches', 'optionMatchesExactly', 'verifyFilled', 'selectNativeOption',
  'settleVerified', 'nearMissChoiceReason', 'refuseChoice', 'optionTextOf', 'pickRadioOption',
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
    let lastChoiceRefusal = '';
    let choiceRefusals = 0;
    ${SRC}
    return { pickRadioOption, selectNativeOption, verifyFilled, settleVerified };
  `)(page);
}

/* A RADIO GROUP WHOSE REAL, ENGINE-LEVEL "checkedness" LANDS ON A LATER TICK THAN THE CLICK THAT
 * CAUSED IT - the shape of a pronoun selector or a yes/no relocation toggle rendered as a controlled
 * radio group. Modelled with a real wall-clock delay rather than a read-count, unlike the
 * react-select fixture: the value under test here is the browser engine's own internal
 * "checkedness" flag, which Playwright's own check() assertion and actionability polling also read,
 * so intercepting the specific JS read pickRadioOption makes (as the react-select fixture pins
 * readChoiceState's own querySelectorAll call) would just as readily desynchronize Playwright's own
 * click verification. A capturing click listener that prevents the native default and sets the real
 * `checked` property itself, after a delay, models the same race without touching what either side
 * reads.
 */
function radioFixture({ delayMs }) {
  return `<!doctype html><html><body>
  <div id="question">
    <div role="radiogroup">
      <label><input type="radio" name="pronouns" id="opt-she" value="she"><span>She/her</span></label>
      <label><input type="radio" name="pronouns" id="opt-he" value="he"><span>He/him</span></label>
      <label><input type="radio" name="pronouns" id="opt-they" value="they"><span>They/them</span></label>
    </div>
  </div>
  <script>
    (() => {
      const target = document.getElementById('opt-they');
      let scheduled = false;
      // Every click - the check() call's own click and pickRadioOption's label-click fallback alike
      // - is prevented from taking native effect. Only the FIRST one arms a single delayed commit,
      // which is the real, unintercepted property setter: nothing about the eventual state is faked.
      target.addEventListener('click', (event) => {
        event.preventDefault();
        if (scheduled) return;
        scheduled = true;
        ${delayMs === null ? '/* never commits, on purpose */' : `
        setTimeout(() => {
          target.checked = true;
          target.dispatchEvent(new Event('change', { bubbles: true }));
        }, ${delayMs});`}
      }, true);
    })();
  </script></body></html>`;
}

test('a pronoun radio whose checked state commits 300ms after the click, inside the settle window, is reported checked', async () => {
  // 300ms is chosen deliberately: it is past the OLD code's single fixed 150ms wait (this test fails
  // on that unpatched shape) and still well inside the new 500ms settle budget.
  await page.setContent(radioFixture({ delayMs: 300 }));
  const api = build();
  const scope = page.locator('#question');
  const started = Date.now();
  const outcome = await api.pickRadioOption(scope, 'They/them');
  assert.equal(outcome, 'checked',
    'the answer commits inside the settle window and must not be reported lost');
  assert.ok(Date.now() - started >= 300, 'the settle loop must actually have waited past the commit');
  const checked = await page.locator('#opt-they').evaluate((element) => element.checked);
  assert.equal(checked, true, 'the correct radio must genuinely be checked on the form');
});

test('a pronoun radio that never commits is still reported not-checked, not stuck, once the settle window ends', async () => {
  await page.setContent(radioFixture({ delayMs: null }));
  const api = build();
  const scope = page.locator('#question');
  const started = Date.now();
  const outcome = await api.pickRadioOption(scope, 'They/them');
  const elapsed = Date.now() - started;
  assert.equal(outcome, 'not-checked',
    'a control that genuinely never committed must still be reported not-checked: no false accept');
  assert.ok(elapsed < 3000, 'the settle loop must be bounded, not an unbounded or infinite wait');
});

/* A NATIVE <select> WHOSE OWN COMMITTED SELECTION - both `.selectedOptions` and `.value` - IS
 * INVISIBLE TO READS FOR A FIXED NUMBER OF THEM, exactly the technique
 * choice-withdrawal-confirms-before-clearing.test.js uses for a react-select's chosen-value node.
 * Playwright's selectOption() sets the underlying value directly rather than going through a click
 * Playwright itself re-verifies, so unlike the radio fixture above, gating the two accessor reads
 * this specific instance exposes does not fight Playwright's own actionability machinery - nothing
 * else in this page ever reads either property.
 */
function selectFixture({ options, revealAfterReads, wrongUntilReveal = false }) {
  return `<!doctype html><html><body>
  <div id="question">
    <label for="discipline">Discipline</label>
    <select id="discipline" name="discipline">
      <option value="">Select...</option>
      ${options.map((text) => `<option value="${text}">${text}</option>`).join('')}
    </select>
  </div>
  <script>
    (() => {
    const select = document.getElementById('discipline');
    window.__reads = 0;
    window.__revealAfter = ${JSON.stringify(revealAfterReads)};
    const trueValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    const trueSelected = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'selectedOptions');
    // selectedOptions is read first in every verifyFilled call on a <select>, so it is the one place
    // the shared counter advances; value's gate just consults the same counter a read already set.
    Object.defineProperty(select, 'selectedOptions', {
      configurable: true,
      get() {
        window.__reads += 1;
        if (window.__reads < window.__revealAfter) return [];
        return trueSelected.get.call(this);
      }
    });
    Object.defineProperty(select, 'value', {
      configurable: true,
      get() {
        if (window.__reads < window.__revealAfter) return '';
        return trueValue.get.call(this);
      },
      set(v) { trueValue.set.call(this, v); }
    });
    })();
  </script></body></html>`;
}

test('a discipline select whose committed option is visible only on the last read of the settle window is reported filled, not lost', async () => {
  await page.setContent(selectFixture({
    options: ['Computer Science', 'Economics', 'Mechanical Engineering'],
    // settleVerified makes exactly eleven reads (elapsed 0, 50, ..., 500), same budget as
    // choiceLanded's own loop. Revealing on the eleventh means the first ten calls to verifyFilled
    // all see an unselected control, matching the shape choiceLanded's own fixture pins.
    revealAfterReads: 11,
  }));
  const api = build();
  const field = page.locator('#discipline');
  const selected = await api.selectNativeOption(field, 'Computer Science');
  assert.equal(selected, true, 'selectOption itself is not what is under test here and must succeed');
  await page.evaluate(() => { window.__reads = 0; });
  const persisted = await api.settleVerified(() => api.verifyFilled(field, 'Computer Science'));
  const reads = await page.evaluate(() => window.__reads);
  assert.ok(reads >= 11, 'the fixture must actually have been read past the reveal point');
  assert.equal(persisted, true,
    'the select is holding the right answer by the last read of the window, so this must be reported filled');
});

test('a discipline select revealing the WRONG option is never reported filled, however long the window runs', async () => {
  await page.setContent(selectFixture({
    options: ['Computer Science', 'Economics', 'Mechanical Engineering'],
    revealAfterReads: 3,
  }));
  const api = build();
  const field = page.locator('#discipline');
  // Select a genuinely different option than the one this run will ask verifyFilled to confirm, so
  // the eventual reveal is a real, wrong answer rather than an absence of one.
  await api.selectNativeOption(field, 'Economics');
  await page.evaluate(() => { window.__reads = 0; });
  const persisted = await api.settleVerified(() => api.verifyFilled(field, 'Computer Science'));
  assert.equal(persisted, false,
    'settleVerified must never turn a confirmed wrong answer into an accepted one: it repeats the same predicate, it does not loosen it');
});

/* A LONE "I AGREE" CHECKBOX - a terms-and-conditions acknowledgement is the measured shape - whose
 * check() commits late, run against the exact expression the lone-checkbox arm in the action loop
 * now uses: settleVerified wrapping a plain evaluate of `element.checked === true`. Same delayed-
 * commit technique as the radio fixture, for the same reason (checkedness is engine-level state
 * Playwright's own click machinery also reads).
 */
function checkboxFixture({ delayMs }) {
  return `<!doctype html><html><body>
  <div id="question">
    <label><input type="checkbox" id="tos"><span>I agree to the Terms and Conditions</span></label>
  </div>
  <script>
    (() => {
      const target = document.getElementById('tos');
      let scheduled = false;
      target.addEventListener('click', (event) => {
        event.preventDefault();
        if (scheduled) return;
        scheduled = true;
        setTimeout(() => {
          target.checked = true;
          target.dispatchEvent(new Event('change', { bubbles: true }));
        }, ${delayMs});
      }, true);
    })();
  </script></body></html>`;
}

test('a terms-and-conditions checkbox whose checked state commits 300ms after check() is reported filled, not lost', async () => {
  await page.setContent(checkboxFixture({ delayMs: 300 }));
  const api = build();
  const lone = page.locator('#tos');
  await lone.first().check().catch(() => undefined);
  const persisted = await api.settleVerified(
    () => lone.first().evaluate((element) => element.checked === true).catch(() => false)
  );
  assert.equal(persisted, true,
    'the consent checkbox commits inside the settle window and must not be reported unticked');
});
