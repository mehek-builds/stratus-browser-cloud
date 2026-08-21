/* A VERIFIED CHOICE CAN STILL BE AN UNFINISHED ONE, ON A CONTROL THAT ONLY FINISHES ON BLUR.
 *
 * Measured live against a real Deepgram jobs.ashbyhq.com posting, 2026-08-21, re-run end to end
 * (packet-audit -> acknowledge -> submit-request -> the real application-submission-runner cron,
 * triggered manually): the review's own required-field scan says '"Current Location" is required
 * and is still empty', and the SAME review's filled_fields array, from the SAME run, contains
 * "location". One API response, one run - not stale data, an internal contradiction between two
 * verification mechanisms. The dashboard's own screenshot of the filled form shows the control
 * still reading its untouched placeholder, "Start typing...".
 *
 * PR #97 (regression tests only, no fix) proved discovery and labelling both work correctly for
 * this control - fillCustomChoice finds the Ashby location combobox, resolves "Dubai" against its
 * one geocoder-offered row "Dubai, United Arab Emirates" through the ordinary widened tier, and
 * that finding stands. It did not explain why choiceLanded then verified a value that was never on
 * the real page. This file supersedes that theory with the mechanism, reproduced against a fixture
 * built from Ashby's own measured markup: an anonymous '<input role="combobox">' with no id, no
 * name and no select__/select2 class anywhere, so readChoiceState calls it 'unknown' both before
 * and after a real selection, and a popup whose rows carry Ashby's own class names
 * ('ashby-application-form-input-autocomplete-popup-result') and role="option" - confirmed from
 * Ashby's production bundle, where the role is written as a template literal
 * (role:`option`), which is why a naive `role=["']option["']` grep on that bundle finds nothing.
 *
 * THE MECHANISM, and it is the one this file already has a fix pattern for. #96 (Rescue blurred
 * Greenhouse choice fills, the commit immediately before this one) found the live Jump degree
 * control reading back correctly WHILE FOCUSED and then Greenhouse's own blur validation clearing
 * it, because the click had driven the DOM's visible state without ever driving whatever
 * bookkeeping a real user interaction leaves behind. #96 fixed that for Greenhouse's ROLE-LESS
 * TEXT search input specifically. It never reached choiceLanded, the shared verifier every OTHER
 * custom-combobox portal goes through - Ashby's location field among them - so every one of them
 * kept trusting a single read taken before the one event this runner always sends next: moving on
 * to fill the following field, which blurs this one. A Google-Places-style widget that refocuses
 * the input after a click-driven selection (ordinary autocomplete UX, so a user can keep tabbing
 * through the form) and cannot tell "this blur followed a real selection" from "this blur followed
 * nothing" clears itself on exactly that next blur, and nothing before this fix ever asked again.
 *
 * These cases run the REAL fillCustomChoice + choiceLanded, extracted from the shipped runner
 * (never copied), against that shape.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';
import { constSource, CHOOSER_NAMES } from './chooser-source.mjs';

const SUPPORT_NAMES = [
  'optionMatches', 'optionMatchesExactly',
  'readChoiceState', 'readCommittedSearchInputValue', 'refuseChoice', 'nearMissChoiceReason',
  'verifyChoiceInContainer',
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
    ${SRC}
    return {
      fillCustomChoice,
      choiceLanded,
      state: () => ({
        lastClickedOptionText, lastClickedOptionAnswer, lastChooserTierAnswer,
        lastChoiceRefusal, choiceRefusals, lastChoiceControlOpened, lastChoiceUnreadable,
      }),
    };
  `)(page);
}

/* Ashby's own field markup, as measured: '[data-field-path="_systemfield_location"]' wraps a
 * label and a narrower autocomplete shell; the anonymous combobox input and its popup live inside
 * that shell, not the outer field wrapper, which is exactly what fillCustomChoice's own
 * ancestor-of-the-combobox container resolution (managed-browser.js, the 'fill' action's combobox
 * branch) climbs to - the shell, not the field wrapper, so the label never contaminates what this
 * function reads back. A small visually-hidden caption mirrors the committed selection inside that
 * same shell (an ordinary accessibility echo for a homegrown combobox with no visible "chosen"
 * chip of its own): without it readChoiceState's 'unknown' text is only ever the shell's own
 * layout, carries no evidence of a commit at all, and choiceLanded correctly marks the control
 * unreadable rather than landed - that variant is pinned below too, because a fix that only works
 * when Ashby happens to expose this caption must not become the only shape this test can catch.
 *
 * `revertsOnBlur` models the suspected, unverified defect: the widget refocuses the input after a
 * click-driven selection (ordinary autocomplete UX), and its blur handler cannot distinguish "this
 * blur followed a real selection" from "this blur followed nothing", so it clears both the input
 * and the caption on the very next blur - which is exactly the blur this runner's own action loop
 * sends when it moves on to the next field.
 */
function fixture({ options, withCaption, revertsOnBlur }) {
  return `<!doctype html><html><body>
  <div data-field-path="_systemfield_location">
    <label>Current Location*</label>
    <div class="ashby-application-form-input-autocomplete-container">
      <input role="combobox" aria-haspopup="listbox" aria-autocomplete="list"
        aria-expanded="false" placeholder="Start typing...">
      ${withCaption ? '<span class="ashby-application-form-input-autocomplete-sr-value" style="position:absolute;width:1px;height:1px;overflow:hidden"></span>' : ''}
    </div>
  </div>
  <script>
  (() => {
    window.__clicked = [];
    const input = document.querySelector('[data-field-path="_systemfield_location"] input');
    const wrap = document.querySelector('.ashby-application-form-input-autocomplete-container');
    const caption = document.querySelector('.ashby-application-form-input-autocomplete-sr-value');
    const OPTIONS = ${JSON.stringify(options)};
    const REVERTS = ${JSON.stringify(Boolean(revertsOnBlur))};
    let menu = null;
    let query = '';
    let committedByClick = false;
    function close() {
      if (menu) menu.remove();
      menu = null;
      input.setAttribute('aria-expanded', 'false');
    }
    function commit(text) {
      window.__clicked.push(text);
      input.value = text;
      if (caption) caption.textContent = text;
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
        row.className = 'ashby-application-form-input-autocomplete-popup-result';
        row.setAttribute('role', 'option');
        row.textContent = text;
        row.addEventListener('click', () => commit(text));
        menu.appendChild(row);
      }
    }
    function open() {
      if (menu) return;
      menu = document.createElement('div');
      menu.className = 'ashby-application-form-input-autocomplete-popup';
      wrap.appendChild(menu);
      input.setAttribute('aria-expanded', 'true');
      renderRows();
    }
    input.addEventListener('mousedown', open);
    input.addEventListener('click', open);
    input.addEventListener('input', () => { query = input.value; open(); renderRows(); });
    input.addEventListener('blur', () => {
      if (REVERTS && committedByClick) {
        input.value = '';
        if (caption) caption.textContent = '';
        committedByClick = false;
      }
    });
  })();
  </script></body></html>`;
}

async function run(markup, answer) {
  await page.setContent(markup);
  const api = build();
  const input = page.locator('[role="combobox"]');
  const container = input.locator(
    'xpath=ancestor::*[(self::div or self::fieldset) and (.//*[@role="combobox"] or .//*[@aria-haspopup="listbox"] or .//*[@aria-haspopup="true"])][1]'
  );
  const filled = await api.fillCustomChoice(container, answer);
  const landed = filled ? await api.choiceLanded(container, answer) : false;
  const after = await page.evaluate(() => ({
    clicked: window.__clicked,
    finalInputValue: document.querySelector('[data-field-path="_systemfield_location"] input').value,
  }));
  return { filled, landed, ...after, state: api.state() };
}

test('the resolved container is the narrow shell, never the field wrapper carrying the label', async () => {
  await page.setContent(fixture({ options: ['Dubai, United Arab Emirates'], withCaption: true }));
  const input = page.locator('[role="combobox"]');
  const container = input.locator(
    'xpath=ancestor::*[(self::div or self::fieldset) and (.//*[@role="combobox"] or .//*[@aria-haspopup="listbox"] or .//*[@aria-haspopup="true"])][1]'
  );
  assert.equal(
    await container.evaluate((el) => el.className),
    'ashby-application-form-input-autocomplete-container',
  );
});

test('a control that reverts on the runner\'s own next-field blur is not reported landed', async () => {
  // THE FAILING CASE THIS FILE EXISTS FOR. Before the fix this returned landed: true while the
  // real input ended up empty - the exact contradiction measured on the live Deepgram run.
  const result = await run(
    fixture({ options: ['Dubai, United Arab Emirates'], withCaption: true, revertsOnBlur: true }),
    'Dubai',
  );
  assert.equal(result.filled, true, 'the widened tier still finds and clicks the one geocoder row');
  assert.equal(result.landed, false, 'a selection that empties itself on blur must not be reported filled');
  assert.equal(result.finalInputValue, '', 'the real control is empty, matching the live screenshot');
  assert.equal(result.state.lastChoiceUnreadable, true, 'told as "please confirm", not silently dropped');
});

test('a durable commit that survives the same blur still verifies landed', async () => {
  // THE CONTROL CASE. Without this, "always report unreadable after blurring" would pass the test
  // above by brute force and mark every correctly-answered Ashby location field for manual review.
  const result = await run(
    fixture({ options: ['Dubai, United Arab Emirates'], withCaption: true, revertsOnBlur: false }),
    'Dubai',
  );
  assert.equal(result.filled, true);
  assert.equal(result.landed, true, 'a commit that holds up under the same blur must still verify');
  assert.equal(result.finalInputValue, 'Dubai, United Arab Emirates');
  assert.equal(result.state.lastChoiceUnreadable, false);
});

test('a control with no committed-value signal at all is marked unreadable, not landed, either way', async () => {
  // Without ANY caption or select__-shaped node, readChoiceState stays 'unknown' with nothing but
  // the shell's own layout text, and the committed-search-input-value gate requires the input to
  // hold the answer BYTE FOR BYTE - "Dubai, United Arab Emirates" never satisfies "Dubai" there.
  // This is the honest "please confirm" outcome, and it must hold regardless of the blur fix,
  // because there is no evidence here for a post-blur reread to lose in the first place.
  const result = await run(
    fixture({ options: ['Dubai, United Arab Emirates'], withCaption: false, revertsOnBlur: false }),
    'Dubai',
  );
  assert.equal(result.filled, true);
  assert.equal(result.landed, false);
  assert.equal(result.state.lastChoiceUnreadable, true);
});

test('the post-blur reread is a fixed cost, not a retry loop, and never fires on an unverified read', () => {
  const start = SANDBOX_RUNNER.indexOf('const choiceLanded = async (container, expected, directControl = null) => {');
  const end = SANDBOX_RUNNER.indexOf('withdrawRefusedChoice now gets one more look', start);
  assert.ok(start !== -1 && end > start, 'choiceLanded must precede its own withdrawal comment');
  const body = SANDBOX_RUNNER.slice(start, end);
  assert.match(body, /await blurDrivenChoiceControl\(container, directControl\);/);
  // Exactly one blur call in the whole function: it only runs after a verified read, never on
  // every 50ms poll tick, and never a second time inside the same call.
  assert.equal((body.match(/await blurDrivenChoiceControl\(/g) || []).length, 1);
  assert.equal((body.match(/await verifyChoiceInContainer\(/g) || []).length, 2,
    'the ordinary poll read and exactly one post-blur reread, nothing looser');
});
