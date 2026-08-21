/* ONE PROTECTED ATTEMPT MUST COMMIT A REACT SELECT ON ITS OWN, run against real widget-shaped
 * markup in a real browser.
 *
 * THE MEASURED CASE. On Greenhouse each reviewed question costs ~14 runner actions against the
 * backend's 120-action ceiling, so on a 14-question form (Optiver, live, 2026-08-19) the trimmer
 * strips every question to ONE fillByLabelText. That action resolves the question's block and its
 * first typeable input, which on a react-select is the widget's SEARCH box, and the follow-on
 * actions that used to commit the option are exactly what the trimmer removed. Raising the ceiling
 * is ruled out (portalSubmission.ts:4626, final), so the single action has to finish the widget:
 * open it, resolve the stored answer against the control's OWN menu, click the row, and read the
 * committed value back. This suite drives fillCustomChoice + choiceLanded, the exact pair the
 * fillByLabelText combobox arm calls for that one action, out of the shipped runner's own source.
 *
 * WHY A BROWSER AND NOT A STUB: same reason as option-click-dom.test.js. Everything here turns on
 * what Playwright locators resolve against live DOM - the shell found DOWNWARD from a question
 * block, a menu portalled to <body> reached only through aria-controls, hidden rows dropped by
 * offeredRows - and a stub that reimplements those agrees with the defects instead of finding them.
 *
 * THE ASYMMETRY, unchanged: a refusal costs the applicant a minute; a wrong commit is a wrong
 * statement on a real application under her name. So the two-statement refusal cases here are as
 * load-bearing as the commits.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';
import { constSource, CHOOSER_NAMES } from './chooser-source.mjs';

/* Everything fillCustomChoice and choiceLanded reach for, pulled out of the shipped runner string
 * in source order. The chooser stack comes from chooser-source.mjs, THE single manifest for it. */
const SUPPORT_NAMES = [
  'optionMatches', 'optionMatchesExactly',
  'readChoiceState', 'readCommittedSearchInputValue', 'refuseChoice', 'nearMissChoiceReason',
  'verifyChoiceInContainer',
  'CHOICE_SHELL_CLASSES', 'markChoice', 'unmarkChoice', 'clearChoiceControl',
  'withdrawRefusedChoice', 'choiceLanded',
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

/* The run-level state the runner declares outside these helpers is declared here, fresh per build,
 * so one test's click hints can never verify another test's control. */
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
      verifyChoiceInContainer,
      readChoiceState,
      state: () => ({ lastClickedOptionText, lastClickedOptionAnswer, lastChooserTierAnswer, lastChoiceRefusal, choiceRefusals, lastChoiceControlOpened })
    };
  `)(page);
}

/* A react-select the way Greenhouse renders one, inside a QUESTION BLOCK - the container the
 * fillByLabelText path hands in, with the widget shell as a DESCENDANT. The menu renders after a
 * delay sized past the old flat 150ms pause and inside the bounded wait (the live School and
 * Discipline menus measured 555-563ms); `portalled` reproduces the R-076 Remix shape, where the
 * shell never holds a row and the menu lands in <body> named only by the open control's
 * aria-controls. Committing removes the placeholder and renders select__single-value, exactly the
 * nodes readChoiceState reads; Escape drops any uncommitted search text, which is the blur
 * behaviour that made the live typed-but-never-committed attempts end empty. */
function fixture({ options, portalled = false, renderDelayMs = 400, roleless = false }) {
  return `<!doctype html><html><body>
  <div id="question">
    <label id="q-label">Assessment and proctoring*</label>
    <div class="select-shell remix-css-fixture-container">
      <div class="select__control">
        <div class="select__value-container">
          <div class="select__placeholder">Select...</div>
          <div class="select__input-container">
            <input id="combo" class="select__input" type="text"
              ${roleless ? '' : 'role="combobox" aria-expanded="false" aria-autocomplete="none"'} autocomplete="off">
          </div>
        </div>
      </div>
    </div>
  </div>
  <script>
    /* An IIFE, not top-level declarations: setContent keeps the same Window, so a second fixture's
       top-level consts would be redeclarations and the whole script would die unexecuted. */
    (() => {
    window.__clicked = [];
    const input = document.getElementById('combo');
    const shell = document.querySelector('.select-shell');
    const valueBox = document.querySelector('.select__value-container');
    const OPTIONS = ${JSON.stringify(options)};
    const PORTALLED = ${JSON.stringify(portalled)};
    const DELAY = ${JSON.stringify(renderDelayMs)};
    let menu = null;
    let opening = false;
    let query = '';
    function close() {
      if (menu) menu.remove();
      menu = null;
      opening = false;
      input.setAttribute('aria-expanded', 'false');
      input.removeAttribute('aria-controls');
      input.value = '';
      query = '';
    }
    function commit(text) {
      window.__clicked.push(text);
      const placeholder = valueBox.querySelector('.select__placeholder');
      if (placeholder) placeholder.remove();
      let single = valueBox.querySelector('.select__single-value');
      if (!single) {
        single = document.createElement('div');
        single.className = 'select__single-value';
        valueBox.insertBefore(single, valueBox.querySelector('.select__input-container'));
      }
      single.textContent = text;
      close();
    }
    function renderRows() {
      if (!menu) return;
      const list = menu.querySelector('[role="listbox"]');
      list.innerHTML = '';
      const shown = OPTIONS.filter((text) => text.toLowerCase().includes(query.toLowerCase()));
      if (!shown.length) {
        const notice = document.createElement('div');
        notice.className = 'select__menu-notice select__menu-notice--no-options';
        notice.textContent = 'No options';
        list.appendChild(notice);
        return;
      }
      for (const text of shown) {
        const row = document.createElement('div');
        row.className = 'select__option';
        row.setAttribute('role', 'option');
        row.textContent = text;
        row.addEventListener('click', () => commit(text));
        list.appendChild(row);
      }
    }
    function open() {
      if (menu || opening) return;
      opening = true;
      setTimeout(() => {
        if (!opening) return;
        opening = false;
        menu = document.createElement('div');
        menu.className = PORTALLED ? 'select__menu-portal' : 'select__menu';
        const list = document.createElement('div');
        list.id = 'fixture-menu-listbox';
        list.className = 'select__menu-list';
        list.setAttribute('role', 'listbox');
        menu.appendChild(list);
        (PORTALLED ? document.body : shell).appendChild(menu);
        input.setAttribute('aria-expanded', 'true');
        input.setAttribute('aria-controls', 'fixture-menu-listbox');
        renderRows();
      }, DELAY);
    }
    input.addEventListener('mousedown', open);
    input.addEventListener('click', open);
    input.addEventListener('input', () => { query = input.value; open(); renderRows(); });
    input.addEventListener('keydown', (event) => { if (event.key === 'Escape') close(); });
    })();
  </script></body></html>`;
}

/* The single protected attempt, as the fillByLabelText combobox arm makes it: one fillCustomChoice
 * over the question's block, then the SAME verified read-back every call site goes through. */
async function protectedAttempt(markup, answer) {
  await page.setContent(markup);
  const api = build();
  const container = page.locator('#question');
  const filled = await api.fillCustomChoice(container, answer);
  const landed = filled ? await api.choiceLanded(container, answer) : false;
  const after = await page.evaluate(() => ({
    clicked: window.__clicked,
    shown: document.querySelector('.select__single-value')?.textContent ?? null,
    placeholder: Boolean(document.querySelector('.select__placeholder')),
    searchText: document.getElementById('combo').value,
    menusLeftInBody: document.querySelectorAll('body > .select__menu-portal, body > .select__menu').length
  }));
  return { filled, landed, ...after, state: api.state() };
}

test('a one-statement consent react-select is committed by the single protected attempt', async () => {
  /* Read off the live Optiver form: the control offers exactly "I consent to the above." and the
     stored answer is "Yes", which no name tier can match. The sole-option tier is what commits it,
     through the same chooseOptionIndex every other rendering already uses. */
  const result = await protectedAttempt(
    fixture({ options: ['I consent to the above.'] }),
    'Yes'
  );
  assert.equal(result.filled, true, 'the one action must commit, there is no follow-on action left to do it');
  assert.equal(result.landed, true, 'and the committed value must be read back and verified in the same action');
  assert.deepEqual(result.clicked, ['I consent to the above.']);
  assert.equal(result.shown, 'I consent to the above.', 'the widget is holding the committed row');
  assert.equal(result.state.lastChooserTierAnswer, 'Yes', 'the tier click carries its provenance for the verifier');
});

test('the same commit works when the menu is portalled to <body> (the R-076 Remix shape)', async () => {
  /* The shell never holds a row; the only route to the menu is the aria-controls the OPENED
     control declares. This is the exact shape that made the graduation-range control end empty on
     the live DV Trading board, now reached from the fillByLabelText container too. */
  const result = await protectedAttempt(
    fixture({ options: ['I consent to the above.'], portalled: true }),
    'Yes'
  );
  assert.equal(result.filled, true, 'the portalled menu is reachable through the control\'s own declaration');
  assert.equal(result.landed, true);
  assert.deepEqual(result.clicked, ['I consent to the above.']);
  assert.equal(result.shown, 'I consent to the above.');
});

test('an exact role-less Greenhouse input commits through its widget shell', async () => {
  await page.setContent(fixture({
    options: ["Bachelor's Degree", "Master's Degree", 'PhD'],
    roleless: true,
  }));
  const api = build();
  const input = page.locator('#combo');
  const shell = input.locator('xpath=ancestor::*[contains(@class,"select__control")][1]');
  const filled = await api.fillCustomChoice(shell, "Bachelor's Degree", input);
  const landed = filled ? await api.choiceLanded(shell, "Bachelor's Degree") : false;
  assert.equal(filled, true);
  assert.equal(landed, true);
  assert.deepEqual(await page.evaluate(() => window.__clicked), ["Bachelor's Degree"]);
  assert.equal(await page.locator('.select__single-value').textContent(), "Bachelor's Degree");
});

test('a role-less Greenhouse wrapper verifies only one closed committed value', async () => {
  await page.setContent(`<!doctype html><html><body>
    <div id="question-block">
      <label for="question_67595191">What degree are you currently pursuing?</label>
      <div id="question-root">
        <div id="question-placeholder" style="display:none">Select...</div>
        <input id="question_67595191" type="text" value="">
        <div id="question-value">Bachelor's Degree</div>
      </div>
    </div>
    <div id="question-menu" role="listbox" style="display:none">
      <div role="option">Bachelor's Degree</div>
    </div>
  </body></html>`);
  const api = build();
  const block = page.locator('#question-block');
  const input = page.locator('#question_67595191');
  const verify = async () => api.verifyChoiceInContainer(
    block,
    "Bachelor's Degree",
    "Bachelor's Degree",
    "Bachelor's Degree",
    '',
    input,
  );

  assert.equal(await verify(), true, 'one exact committed value with a closed menu verifies');

  await page.locator('#question-placeholder').evaluate((node) => { node.style.display = 'block'; });
  assert.equal(await verify(), false, 'a visible Select placeholder means the choice is not committed');

  await page.locator('#question-placeholder').evaluate((node) => { node.style.display = 'none'; });
  await page.locator('#question-root').evaluate((root) => {
    const duplicate = document.createElement('div');
    duplicate.id = 'question-value-duplicate';
    duplicate.textContent = "Bachelor's Degree";
    root.appendChild(duplicate);
  });
  assert.equal(await verify(), false, 'two matching rendered values are ambiguous');

  await page.locator('#question-value-duplicate').evaluate((node) => node.remove());
  await input.evaluate((node) => node.setAttribute('aria-controls', 'question-menu'));
  await page.locator('#question-menu').evaluate((node) => { node.style.display = 'block'; });
  assert.equal(await verify(), false, 'a still-open owned menu is not a committed choice');

  await page.setContent(`<!doctype html><html><body>
    <div id="ordinary-block">
      <label for="question_67595192">If yes, please explain.</label>
      <div><input id="question_67595192" value="Bachelor's Degree"></div>
    </div>
  </body></html>`);
  assert.equal(await api.verifyChoiceInContainer(
    page.locator('#ordinary-block'),
    "Bachelor's Degree",
    "Bachelor's Degree",
    "Bachelor's Degree",
    '',
    page.locator('#question_67595192'),
  ), false, 'typed text cannot satisfy the closed-choice readback');
});

test('a graded band and a date part commit through the same single attempt', async () => {
  const band = await protectedAttempt(
    fixture({ options: ['3.00 - 3.49', '3.50 - 4.00'] }),
    '3.89/4.0'
  );
  assert.equal(band.filled, true);
  assert.equal(band.landed, true, 'a band that does not contain the answer text still verifies as the tier\'s own pick');
  assert.deepEqual(band.clicked, ['3.50 - 4.00']);
  const year = await protectedAttempt(
    fixture({ options: ['2026', '2027', '2028'], portalled: true }),
    'May 2028'
  );
  assert.equal(year.filled, true);
  assert.equal(year.landed, true);
  assert.deepEqual(year.clicked, ['2028']);
});

test('a two-statement list is refused, and the form is left exactly as it was found', async () => {
  /* The first-preference control on the same live form. Choosing between two statements is a claim
     about which is true of her, and no wording heuristic may make it: the sole-option tier is a
     LENGTH check and must never see a filtered list that fabricates a single option. */
  const result = await protectedAttempt(
    fixture({
      options: [
        'I am NOT currently in process for another Optiver role',
        'I am currently in process for another Optiver role',
      ],
    }),
    'Yes'
  );
  assert.equal(result.filled, false, 'two statements are the applicant\'s choice, not Litos\'s');
  assert.deepEqual(result.clicked, [], 'nothing was clicked, not even transiently');
  assert.equal(result.shown, null);
  assert.equal(result.placeholder, true, 'the control still shows Select...');
  assert.equal(result.searchText, '', 'no uncommitted search text is left sitting in the widget');
});

test('a non-affirmative answer never commits a sole statement row', async () => {
  /* The sole-option tier is bounded by the stored answer being an affirmative. A profile value
     that is anything else - a fact, a refusal, a city - leaves a one-statement control alone. */
  const result = await protectedAttempt(
    fixture({ options: ['I consent to the above.'] }),
    'Decline to self-identify'
  );
  assert.equal(result.filled, false);
  assert.deepEqual(result.clicked, []);
  assert.equal(result.placeholder, true);
});

/* ---------------------------------------------------------------------------------------------
 * Shape pins on the routing itself, so the behaviour above cannot be quietly re-plumbed.
 * ------------------------------------------------------------------------------------------- */

test('the list-shaped tiers run once per control, on the unfiltered menu, and never from searchFor', () => {
  assert.match(SANDBOX_RUNNER, /const chooseFromOfferedRows = async \(wanted\) =>/);
  assert.match(
    SANDBOX_RUNNER,
    /if \(await chooseFromOfferedRows\(wanted\)\) return true;\n\s+if \(await searchFor\(control, wanted\)\) return true;/,
    'after the name tiers, before any typing filters the list'
  );
  assert.equal(
    (SANDBOX_RUNNER.match(/await chooseFromOfferedRows\(/g) || []).length,
    1,
    'exactly ONE call site: a filtered menu can fabricate a sole option'
  );
});

test('the tier pass is scoped to the control\'s own menu, never the page', () => {
  const start = SANDBOX_RUNNER.indexOf('const chooseFromOfferedRows');
  const end = SANDBOX_RUNNER.indexOf('const total = await controls.count()', start);
  const body = SANDBOX_RUNNER.slice(start, end);
  assert.match(body, /const root = menuRoot\(\);/);
  assert.match(body, /if \(!root\) return false;/, 'no declared menu and no shell means nowhere this may look');
  assert.doesNotMatch(body, /page\.locator/, 'an unscoped [role="option"] on a live Greenhouse form returns 244 country rows');
  assert.match(body, /chooseOptionIndex\(texts, wanted\)/, 'the one chooser every rendering shares, ambiguity guards included');
  assert.match(body, /offeredRows\(rows\)/, 'hidden and aria-hidden rows are dropped before the list is judged');
});

test('the widget shell is found in both directions from the container', () => {
  // The fill path hands in a node INSIDE the shell; fillByLabelText hands in the question block
  // ABOVE it. Ancestor-only reading left scopedMenu unset on the label path, which disabled the
  // bounded menu wait, the portal detection and the widened root all at once.
  assert.match(SANDBOX_RUNNER, /const shellDown = container\.locator\('xpath=\(descendant::\*\[' \+ CHOICE_SHELL_CLASSES \+ '\]\)\[1\]'\);/);
  assert.match(SANDBOX_RUNNER, /const shellUp = container\.locator\('xpath=ancestor-or-self::\*\[' \+ CHOICE_SHELL_CLASSES \+ '\]\[1\]'\);/);
});

test('a search input recognised only by its shell still routes to the choice arm', () => {
  // The live Optiver input announced role=combobox; older react-selects announce nothing on the
  // input at all, and typing into them is a fill that verifies against its own search box.
  assert.match(SANDBOX_RUNNER, /const fieldInChoiceShell = shape\.tag === 'input'/);
  assert.match(SANDBOX_RUNNER, /shape\.ariaAutocomplete === 'list' \|\| fieldInChoiceShell\) \{/);
});

test('a tier commit verifies as the whole clicked row, and only with tier provenance', () => {
  const start = SANDBOX_RUNNER.indexOf('const verifyChoiceInContainer');
  const end = SANDBOX_RUNNER.indexOf('/* A REFUSED ROW IS STILL SELECTED', start);
  const body = SANDBOX_RUNNER.slice(start, end);
  assert.match(body, /clean\(chooserTierAnswer \|\| ''\) && holdsAnswer\(chooserTierAnswer, expected\)/);
  assert.match(body, /state\.kind === 'chosen' && row && shown && row === shown/,
    'the WHOLE row, published as the chosen value; fragments keep their treatment');
  /* And the near-miss refusal still runs before the CHOSEN-path tier rule. The unknown-state arm
   * above it cannot sit behind nearMiss - on an unknown widget `text` is the block's own text,
   * which contains the answer beside its label, so nearMiss fires on every correct fill - and it
   * embeds the same refusal instead: the held row must BE the answer under holdsAnswer, so a
   * near-missing commit ("South Asian" for "Asian") fails the gate a chosen widget fails. */
  assert.ok(body.indexOf('if (nearMiss(text, expected))')
    < body.indexOf("state.kind === 'chosen' && row && shown"),
    'a near miss still refuses before the chosen-path tier rule may accept');
  assert.match(body, /holdsAnswer\(committed, expected\) \|\| declineMatches\(committed, expected\)/,
    'the unknown-state arm accepts only a held row that is itself the answer');
  assert.match(body, /heldRow === clean\(clickedOptionText\)\.toLowerCase\(\)/,
    'and only when it is byte-for-byte the whole row this call clicked');
});

/* A REMOTE-SEARCHED LOCATION FIELD, whose "no rows" is a live geocoder answering the wrong query -
 * not a closed list saying the option does not exist. Measured live on IMC Trading's Greenhouse
 * form, 2026-08-20: her stored city answer "Dubai, U.A.E." (correct and required verbatim on every
 * plain free-text city field) returns zero results from the real widget; "Dubai" alone returns
 * "Dubai, United Arab Emirates" as its one and only result. fixture()'s substring filter reproduces
 * that shape exactly: the full comma string matches nothing, the text before the comma does. */
test('a remote-searched combobox retries with the city alone when the full stored value renders nothing', async () => {
  const result = await protectedAttempt(
    fixture({ options: ['Dubai, United Arab Emirates'] }),
    'Dubai, U.A.E.'
  );
  assert.equal(result.filled, true, 'the narrowed query is the only one the live geocoder ever answers');
  assert.equal(result.landed, true, 'the clicked row does not contain the stored text and needs chooserTierAnswer provenance to verify, exactly like a band or a sole-consent row');
  assert.deepEqual(result.clicked, ['Dubai, United Arab Emirates']);
  assert.equal(result.shown, 'Dubai, United Arab Emirates');
});

test('a comma-bearing value that the full query already answers is never narrowed', async () => {
  // Ordinary exact-match consent and taxonomy rows carry commas too ("Yes, I agree"). Narrowing
  // must be gated on the untouched query returning NOTHING, never merely on a comma being present.
  const result = await protectedAttempt(
    fixture({ options: ['Assessment, Test'] }),
    'Assessment, Test'
  );
  assert.equal(result.filled, true);
  assert.deepEqual(result.clicked, ['Assessment, Test'], 'the exact tier took it; the narrowed retry was never reached');
});

test('an ambiguous narrowed query refuses rather than guessing among several rows', async () => {
  const result = await protectedAttempt(
    fixture({ options: ['Dubai Marina, UAE', 'Dubai, UAE Downtown'] }),
    'Dubai, U.A.E.'
  );
  assert.equal(result.filled, false, 'two rows both start with the narrowed city; picking either would be a guess');
  assert.deepEqual(result.clicked, [], 'nothing was clicked, not even transiently');
});

test('a narrowed match that does not start with the searched city is refused, not merely contains it', async () => {
  const result = await protectedAttempt(
    fixture({ options: ['Old Dubai District'] }),
    'Dubai, U.A.E.'
  );
  assert.equal(result.filled, false, '"Old Dubai District" contains "Dubai" but is not a match for it');
  assert.deepEqual(result.clicked, []);
});

test('a comma value with no answer under either query is left alone', async () => {
  const result = await protectedAttempt(
    fixture({ options: ['Somewhere Else'] }),
    'Nowhere, Real'
  );
  assert.equal(result.filled, false);
  assert.deepEqual(result.clicked, []);
});
