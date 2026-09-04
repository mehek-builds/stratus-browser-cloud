/* WHETHER AN ENTER HAS A JOB WHERE IT IS AIMED, RUN AGAINST REAL MARKUP IN A REAL BROWSER.
 *
 * WHY A BROWSER AND NOT A STUB. Every question here is a question about live DOM relationships:
 * what element.closest('form') answers, whether aria-controls resolves to a node that exists,
 * how many [role="option"] rows a listbox is holding right now, whether isContentEditable is set.
 * A stub answers those by reimplementing them, and a stub that reimplements them the same way the
 * rule does agrees with the rule whatever the rule says. The sibling suites in this repo were
 * written this way for the same reason, after a faked option list agreed with five real defects.
 *
 * WHY THE HARNESS BUILDS ITS OWN 'target'. enterHasNothingToTake is shipped as
 * 'async (target) => await target.evaluate(fn)', and in production 'target' is a Playwright locator
 * or a JSHandle. Here it is a shim whose evaluate runs the SAME arrow body against a real element
 * on a real page, so the assertions execute the shipped source rather than a copy of it.
 *
 * THE MARKUP IS THE MEASUREMENT. Every case below is a state read off the live Hudson River Trading
 * Greenhouse form (job-boards.greenhouse.io/embed/job_app?for=wehrtyou&token=8052083), read-only,
 * on 2026-09-04, and each carries the number that was read:
 *
 *   menu shut ................ no listbox in the document at all
 *   menu open ................ listbox present, 3 rows, exactly one marked --is-focused
 *   menu open after ArrowDown  listbox present, 3 rows, the marker moved one row down
 *   menu open, no match ...... listbox present, 0 rows, the menu reading "No options"
 *
 * An Enter in that last state ran the employer's whole validator and rendered 13 messages; an Enter
 * in '#first_name' with twenty fields correctly filled rendered 7. Both are the picture the
 * applicant is shown and asked to approve, and neither is retracted when the fields are filled.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* Pulled out of the shipped runner string rather than copied. Required, not tolerant: this file
 * exists only to execute this one declaration, so a runner without it must fail loudly here rather
 * than quietly assert nothing. */
function constSource(name, indent) {
  const pad = ' '.repeat(indent);
  const start = SANDBOX_RUNNER.indexOf(`\n${pad}const ${name} = `);
  assert.notEqual(start, -1, `${name} must exist in the sandbox runner`);
  const rest = SANDBOX_RUNNER.slice(start + 1);
  const next = rest.search(new RegExp(`\\n${pad}(?:const|let|var|for|if|return|await|fs\\.)`));
  return rest.slice(0, next === -1 ? rest.length : next);
}

const { enterHasNothingToTake } = Function(
  `${constSource('enterHasNothingToTake', 4)}\nreturn { enterHasNothingToTake };`
)();

const FIXTURE = `<!doctype html><meta charset="utf-8"><title>Enter targets</title>
<form id="application-form" action="/apply" method="post">
  <label for="first_name">First Name*</label>
  <input id="first_name" type="text">

  <label for="cover">Cover letter</label>
  <textarea id="cover"></textarea>

  <div id="rich" contenteditable="true">notes</div>

  <!-- Menu shut: no listbox anywhere. -->
  <div class="select-shell" id="shut-shell">
    <div class="select__control"><input id="shut" role="combobox" aria-expanded="false" aria-controls="shut-listbox"></div>
  </div>

  <!-- Menu open, three rows, one of them focused. Enter takes it. -->
  <div class="select-shell" id="open-shell">
    <div class="select__control"><input id="open" role="combobox" aria-expanded="true" aria-controls="open-listbox"></div>
    <div class="select__menu"><div id="open-listbox" role="listbox">
      <div role="option" class="select__option select__option--is-focused">Yes</div>
      <div role="option" class="select__option">No</div>
      <div role="option" class="select__option">I don't wish to answer</div>
    </div></div>
  </div>

  <!-- Menu open on "No options": the exact state a fill attempt that matched no row leaves behind. -->
  <div class="select-shell" id="empty-shell">
    <div class="select__control"><input id="empty" role="combobox" aria-expanded="true" aria-controls="empty-listbox"></div>
    <div class="select__menu"><div id="empty-listbox" role="listbox">
      <div class="select__menu-notice">No options</div>
    </div></div>
  </div>

  <!-- Open, and aria-controls names a node that is not in the document. -->
  <div class="select-shell" id="dangling-shell">
    <div class="select__control"><input id="dangling" role="combobox" aria-expanded="true" aria-controls="listbox-that-does-not-exist"></div>
  </div>

  <!-- Open, and the widget names its menu with aria-owns instead. -->
  <div class="select-shell" id="owns-shell">
    <div class="select__control"><input id="owns" role="combobox" aria-expanded="true" aria-owns="owns-listbox"></div>
    <div class="select__menu"><div id="owns-listbox" role="listbox"><div role="option">Python</div></div></div>
  </div>
</form>

<!-- Outside every form: an Enter here has no validator to run and no form to send. -->
<input id="loose" type="text">
<div class="select-shell" id="loose-shut-shell">
  <input id="loose-shut" role="combobox" aria-expanded="false">
</div>`;

let browser;
let page;
test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
  await page.setContent(FIXTURE);
});
test.after(async () => { await browser?.close(); });

// The shipped call shape, aimed at one element on a real page.
const at = (selector) => enterHasNothingToTake({
  evaluate: async (fn) => page.$eval(selector, fn),
});
// The unaimed press's target: whatever document.activeElement is, handed over as an element.
const atActiveElement = () => enterHasNothingToTake({
  evaluate: async (fn) => page.evaluate(fn, await page.evaluateHandle(() => document.activeElement)),
});

test('a plain control inside the application form keeps its Enter', async () => {
  /* THE MEASURED HARM, in one assertion. On the live form this keystroke took a page with zero
   * validation messages to seven, one on every required control that had not been reached yet, and
   * the form never took any of them back. The six the applicant photographed are those seven minus
   * the one field that had already been filled when the keystroke landed. */
  assert.equal(await at('#first_name'), 'inside the application form');
});

test('a textarea and a contenteditable keep theirs, because Enter is a newline there', async () => {
  // The keystroke does the field's own job and reaches nothing outside it. Withholding it here
  // would be a guard costing an answer for no safety at all.
  assert.equal(await at('#cover'), null);
  assert.equal(await at('#rich'), null);
});

test('a control outside every form has nothing to validate and nothing to send', async () => {
  assert.equal(await at('#loose'), null);
});

test('a choice control with its menu shut is refused, and says which shape it is', async () => {
  // The rule choiceControlIsClosed already carries for an AIMED press. It is restated here because
  // the unaimed arm asks only this function, and a hole in one arm is a hole.
  assert.equal(await at('#shut'), 'a choice control with no menu open');
  // Even outside a form: with no menu there is no option to take, so the press has no job.
  assert.equal(await at('#loose-shut'), 'a choice control with no menu open');
});

test('a choice control offering rows keeps its Enter', async () => {
  /* This is the case the guard must not break. A menu holding rows has a highlighted one, Enter
   * takes it, and that is the whole reason the caller queues the keystroke. Measured on the live
   * control: 3 rows on open with the marker on "Yes", 3 after ArrowDown with the marker on "No",
   * and ArrowDown+Enter committed "No" with the page's validation-message count still at zero. */
  assert.equal(await at('#open'), null);
  // aria-owns is the same statement in the other spelling, and a widget may use either.
  assert.equal(await at('#owns'), null);
});

test('a choice control whose open menu is offering nothing is refused', async () => {
  /* THE STATE A FAILED FILL LEAVES BEHIND. Type a filter no option matches and the widget keeps
   * aria-expanded="true" while its listbox empties to zero rows. There is no highlighted option, so
   * Enter is not consumed: it reaches the form. One Enter in this state took the live form from 0
   * validation messages to 13. The packet this was measured for reports exactly this state in its
   * own record - 'no option matched "3.89" (the list offered: "No options")'. */
  assert.equal(await at('#empty'), 'a choice control whose open menu is offering nothing to take');
});

test('a menu named by an id that resolves to nothing is refused rather than trusted', async () => {
  // Fails toward withholding: an offer that cannot be read is not an offer.
  assert.equal(await at('#dangling'), 'a choice control whose open menu is offering nothing to take');
});

test('a block that holds one choice control is judged by the control inside it', async () => {
  // A caller may aim at the widget rather than at the input, which is how several boards' durable
  // selectors are shaped, so the container has to resolve to its own control.
  assert.equal(await at('#open-shell'), null);
  assert.equal(await at('#empty-shell'), 'a choice control whose open menu is offering nothing to take');
  assert.equal(await at('#shut-shell'), 'a choice control with no menu open');
});

test('an unaimed press with focus nowhere does not adopt the first combobox on the page', async () => {
  /* THE FAILURE THIS RULE'S 'container' TEST EXISTS FOR. document.activeElement is <body> when
   * nothing is focused, and a descendant search from <body> finds '#shut' - the first combobox in
   * the document - and would report a keystroke aimed at nothing as a keystroke aimed at somebody
   * else's field. An Enter on <body> reaches no form control, so there is nothing to withhold and
   * nothing to blame it on. */
  await page.evaluate(() => document.activeElement?.blur());
  assert.equal(await atActiveElement(), null);
});

test('an unaimed press is judged by the control that actually holds focus', async () => {
  // The arm that ran no guard at all until now: the one press shape nobody can aim was also the one
  // shape nothing checked.
  await page.focus('#first_name');
  assert.equal(await atActiveElement(), 'inside the application form');
  await page.focus('#empty');
  assert.equal(await atActiveElement(), 'a choice control whose open menu is offering nothing to take');
  await page.focus('#open');
  assert.equal(await atActiveElement(), null);
});
