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
  'optionMatches', 'optionMatchesExactly', 'placeOpensWith',
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
    const tracksChoiceFailures = false;
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

function fixture({ options, withCaption, revertsOnBlur, portalled }) {
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
    const PORTALLED = ${JSON.stringify(Boolean(portalled))};
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
      if (PORTALLED) { menu.setAttribute('role', 'listbox'); menu.style.position = 'absolute'; document.body.appendChild(menu); } else { wrap.appendChild(menu); }
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


/* THE GEOCODER ROW THAT EXTENDS THE CITY.
 *
 * Measured live on Deepgram (Ashby) run dcc8f598, 2026-09-05T03:34Z: the runner drove the Current
 * Location typeahead with her city, "Los Angeles", and the geocoder offered two rows -
 * "Los Angeles, California, United States" and "Los Ángeles, Biobío, Chile" - and the run recorded
 * 'no option matched "Los Angeles" (the list offered: ...)', leaving the required field empty and
 * the whole application parked. A geocoder row is the city followed by its region and country; the
 * city she typed is the first comma-segment of exactly one of them, accent for accent. */
test('the one geocoder row whose first segment is the city she typed is taken', async () => {
  const result = await run(
    fixture({
      options: ['Los Angeles, California, United States', 'Los Ángeles, Biobío, Chile'],
      withCaption: true,
      revertsOnBlur: false,
    }),
    'Los Angeles',
  );
  assert.deepEqual(result.clicked, ['Los Angeles, California, United States'], JSON.stringify(result.state));
  assert.equal(result.filled, true, JSON.stringify(result.state));
  assert.equal(result.landed, true, JSON.stringify({ ...result.state, finalInputValue: result.finalInputValue }));
  assert.equal(result.finalInputValue, 'Los Angeles, California, United States');
});

test('two rows that both open with the city she typed are refused, not guessed between', async () => {
  const result = await run(
    fixture({
      options: ['Springfield, Illinois, United States', 'Springfield, Missouri, United States'],
      withCaption: true,
      revertsOnBlur: false,
    }),
    'Springfield',
  );
  assert.deepEqual(result.clicked, [], JSON.stringify(result.state));
  assert.equal(result.filled, false);
  assert.match(result.state.lastChoiceRefusal, /Springfield/);
});

test('a row that merely contains the city inside a longer first segment is not the city', async () => {
  const result = await run(
    fixture({
      options: ['East Los Angeles, California, United States'],
      withCaption: true,
      revertsOnBlur: false,
    }),
    'Los Angeles',
  );
  assert.deepEqual(result.clicked, [], JSON.stringify(result.state));
  assert.equal(result.filled, false);
});

test('the same two rows, with the popup portalled to the body as Ashby renders it', async () => {
  const result = await run(
    fixture({
      options: ['Los Angeles, California, United States', 'Los Ángeles, Biobío, Chile'],
      withCaption: true,
      revertsOnBlur: false,
      portalled: true,
    }),
    'Los Angeles',
  );
  assert.deepEqual(result.clicked, ['Los Angeles, California, United States'], JSON.stringify(result.state));
  assert.equal(result.filled, true, JSON.stringify(result.state));
  assert.equal(result.landed, true, JSON.stringify(result.state));
});
