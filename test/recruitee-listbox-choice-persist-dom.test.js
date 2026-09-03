/* A BUTTON OPENER'S CHOICE THAT DID NOT PERSIST, IN BOTH OF THE WAYS THAT SENTENCE WAS TRUE.
 *
 * Measured in production 2026-08-28 on cbsconsulting.recruitee.com: the required salutation
 * control is '<button id="input-candidate.salutation-2" aria-haspopup="listbox">' labelled
 * "Allgemeine Anrede *", with its role=listbox sibling in the same parent offering
 * Herr / Frau / Kein/e. The runner clicked the "Frau" row, the backend recorded "choice value did
 * not persist after fill" with no refusal reason, and the field read empty at the readiness check.
 * The same failure class is stored against a Greenhouse row (Flow Traders). Two separate defects
 * hide inside that one report, and this file fixtures each of them against the REAL extracted
 * chooser in a real browser:
 *
 *   1. THE COMMIT WAS SWALLOWED. A document-level mousedown handler closes the list whenever the
 *      press lands outside the OPENER, and a row is outside the opener, so the widget unmounts its
 *      rows between the real click's mousedown and its click. The pointer sequence finishes over
 *      whatever now sits at those coordinates, the row's click handler never runs, and the control
 *      is left holding nothing while the runner records a clicked row. Nothing throws.
 *
 *   2. THE COMMIT LANDED AND COULD NOT BE READ BACK. The committed value is the closed button's
 *      own rendered text and nowhere else. readChoiceState only recognises a React Select, so the
 *      widget reads 'unknown', and what 'unknown' hands over is the whole block's text, which
 *      carries the label and every closed-menu row and can never equal the answer. A correct fill
 *      was reported lost while sitting on the form.
 *
 * The asymmetry the negative case pins: a commit that is GENUINELY lost, because the row's
 * handlers were delegated to an ancestor that no longer contains it, must stay reported lost. The
 * redelivery may complete a click the menu's own close swallowed; it may never invent a success.
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
  'formRefusedChoiceReason', 'formStillRequiresChoice', 'nudgeChoiceControl',
  'choiceLanded',
  'CLEAR_CONTROL_RE', 'CHOICE_CONTROLS', 'CLEAR_CONTROLS',
  'fillCustomChoice',
];
const SRC = CHOOSER_NAMES.map((name) => constSource(name, 4))
  // Optional on purpose: a runner from before the opener read has no such helper, and this file
  // must still EXECUTE that runner so the behavioural assertions below are what fail on it.
  .concat(constSource('readCommittedOpenerText', 4, false))
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
      state: () => ({
        lastClickedOptionText, lastClickedOptionAnswer, lastChooserTierAnswer,
        lastChoiceRefusal, choiceRefusals, lastChoiceControlOpened, lastChoiceUnreadable,
      }),
    };
  `)(page);
}

/* The measured Recruitee shape: one question block holding the label, the aria-haspopup=listbox
 * BUTTON, and the same-parent role=listbox. The committed value is the button's own rendered
 * text; there is no input, no select__* class, no hidden mirror this runner can reach.
 *
 * `closeOnDocumentMousedown`: the live swallow. A document-level mousedown handler closes the
 * list whenever the press lands outside the BUTTON, which every row is, so the very click that
 * chooses a row unmounts that row between its own mousedown and its click.
 * `rowsStayMounted`: the readback shape. The rows stay in the DOM behind display:none when the
 * list is closed, so the question block's textContent always carries every option next to the
 * label, and only the button itself says what is committed.
 * `delegatedRows`: the genuinely-lost shape. The commit handler lives on the LIST, by
 * delegation, so once the close has removed a row from it no event on that row can ever commit.
 */
function recruiteeSalutation({ closeOnDocumentMousedown = false, rowsStayMounted = false, delegatedRows = false } = {}) {
  return `<!doctype html><html><body>
  <form>
  <div class="question">
    <label for="input-candidate.salutation-2">Allgemeine Anrede *</label>
    <button type="button" id="input-candidate.salutation-2" aria-haspopup="listbox" aria-expanded="false">Auswählen</button>
    <ul role="listbox" id="salutation-listbox" style="display:none;list-style:none;margin:0;padding:0"></ul>
  </div>
  </form>
  <script>
  (() => {
    window.__commits = [];
    const button = document.getElementById('input-candidate.salutation-2');
    const list = document.getElementById('salutation-listbox');
    const OPTIONS = ['Herr', 'Frau', 'Kein/e'];
    const CLOSE_ON_DOC_MOUSEDOWN = ${JSON.stringify(Boolean(closeOnDocumentMousedown))};
    const ROWS_STAY_MOUNTED = ${JSON.stringify(Boolean(rowsStayMounted))};
    const DELEGATED_ROWS = ${JSON.stringify(Boolean(delegatedRows))};
    let value = '';
    let open = false;
    function commit(text) {
      window.__commits.push(text);
      value = text;
      open = false;
      render();
    }
    function makeRow(text) {
      const row = document.createElement('li');
      row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', text === value ? 'true' : 'false');
      row.textContent = text;
      if (!DELEGATED_ROWS) row.addEventListener('click', () => commit(text));
      return row;
    }
    function render() {
      button.textContent = value || 'Auswählen';
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      list.style.display = open ? 'block' : 'none';
      list.innerHTML = '';
      if (open || ROWS_STAY_MOUNTED) {
        for (const text of OPTIONS) list.appendChild(makeRow(text));
      }
    }
    if (DELEGATED_ROWS) {
      list.addEventListener('click', (event) => {
        const row = event.target.closest('[role="option"]');
        if (row && list.contains(row)) commit(row.textContent);
      });
    }
    button.addEventListener('click', () => { open = !open; render(); });
    if (CLOSE_ON_DOC_MOUSEDOWN) {
      document.addEventListener('mousedown', (event) => {
        if (open && !button.contains(event.target)) { open = false; render(); }
      });
    }
    render();
  })();
  </script></body></html>`;
}

/* THE SAME SWALLOW, ON THE HIGHEST-VOLUME RENDERING. Recorded the same day against Akuna's
 * job-boards.greenhouse.io form (application 41f0b79d, 2026-08-28): the disclaimer Yes/No choice
 * control read back "required and is still empty" after a fill the run believed it made. A
 * Greenhouse react-select commits on its row's CLICK on these builds, and the page closes the
 * menu on any document-level mousedown that lands outside the CONTROL - the menu is the control's
 * sibling, so every row is outside it. Identical race, select__* clothes: the menu unmounts
 * between the choosing click's mousedown and its click, nothing commits, nothing throws. The
 * readback needs no new arm here (readChoiceState already reads select__single-value); what this
 * case pins is that the redelivery is generic across renderings, not Recruitee-shaped. */
function greenhouseDisclaimerSelect() {
  return `<!doctype html><html><body>
  <form>
  <div class="gh-question">
    <label for="disclaimer-select">Disclaimer: I agree to the above *</label>
    <div class="select__container">
      <div class="select__control">
        <div class="select__value-container">
          <div class="select__placeholder">Select...</div>
        </div>
        <div class="select__input-container">
          <input id="disclaimer-select" role="combobox" aria-haspopup="listbox" aria-expanded="false">
        </div>
      </div>
    </div>
  </div>
  </form>
  <script>
  (() => {
    window.__commits = [];
    const shell = document.querySelector('.select__container');
    const control = document.querySelector('.select__control');
    const valueContainer = document.querySelector('.select__value-container');
    const input = document.getElementById('disclaimer-select');
    const OPTIONS = ['Yes', 'No'];
    let menu = null;
    function close() { if (menu) menu.remove(); menu = null; input.setAttribute('aria-expanded', 'false'); }
    function commit(text) {
      window.__commits.push(text);
      valueContainer.innerHTML = '<div class="select__single-value">' + text + '</div>';
      close();
    }
    function open() {
      if (menu) return;
      menu = document.createElement('div');
      menu.className = 'select__menu';
      for (const text of OPTIONS) {
        const row = document.createElement('div');
        row.setAttribute('role', 'option');
        row.className = 'select__option';
        row.textContent = text;
        row.addEventListener('click', () => commit(text));
        menu.appendChild(row);
      }
      shell.appendChild(menu);
      input.setAttribute('aria-expanded', 'true');
    }
    input.addEventListener('mousedown', open);
    input.addEventListener('click', open);
    document.addEventListener('mousedown', (event) => {
      if (menu && !control.contains(event.target)) close();
    });
  })();
  </script></body></html>`;
}

async function run(markup, answer, { containerSelector = '.question', readbackSelector = '#input-candidate\\.salutation-2' } = {}) {
  await page.setContent(markup);
  const api = build();
  // The same container the fill branch resolves for each markup: the nearest ancestor holding
  // the choice control, which is the question block for the Recruitee shape and the widget's own
  // select__container shell for the Greenhouse one.
  const container = page.locator(containerSelector);
  const filled = await api.fillCustomChoice(container, answer);
  const landed = filled ? await api.choiceLanded(container, answer) : false;
  const after = await page.evaluate((selector) => {
    const control = document.querySelector(selector);
    return {
      commits: window.__commits,
      buttonText: control ? control.textContent.trim() : '',
      expanded: control ? control.getAttribute('aria-expanded') : null,
    };
  }, readbackSelector);
  return { filled, landed, ...after, state: api.state() };
}

test('a click whose own mousedown closes the menu still commits, and the commit is read back off the opener', async () => {
  // The production packet's exact sentence came from this shape: the row WAS clicked
  // (lastClickedOptionText carries it), nothing threw, and the salutation was never on the form.
  const result = await run(recruiteeSalutation({ closeOnDocumentMousedown: true }), 'Frau');
  assert.equal(result.filled, true, 'the chooser must still report a row click it made');
  assert.deepEqual(result.commits, ['Frau'], 'the widget must receive exactly one commit, never two');
  assert.equal(result.buttonText, 'Frau', 'the committed value must actually be on the form');
  assert.equal(result.landed, true, 'a commit the redelivery completed must be reported landed');
  assert.equal(result.state.lastChoiceUnreadable, false,
    'a commit the opener itself renders is a read value, not an unreadable one');
});

test('a commit that lands as the closed button\'s own rendered text verifies, even when the block text can never equal it', async () => {
  // No swallow here: the widget commits on the first real click. The block's textContent is
  // "Allgemeine Anrede * Frau Herr Frau Kein/e" because the closed rows stay mounted, so the
  // old block-text equality could never hold and this exact fill was reported lost in production.
  const result = await run(recruiteeSalutation({ rowsStayMounted: true }), 'Frau');
  assert.equal(result.filled, true);
  assert.deepEqual(result.commits, ['Frau']);
  assert.equal(result.buttonText, 'Frau');
  assert.equal(result.expanded, 'false', 'the menu must be closed before the committed reading counts');
  assert.equal(result.landed, true, 'a committed value the opener renders must verify');
  assert.equal(result.state.lastChoiceUnreadable, false);
});

test('the same swallowed click commits on a Greenhouse react-select disclaimer control, read back off select__single-value', async () => {
  // The Akuna shape: the redelivery must be generic across renderings. The commit lands as the
  // widget's own select__single-value node, so readChoiceState calls it 'chosen' and the ordinary
  // verifier path accepts it; no opener read is involved on this rendering.
  const result = await run(greenhouseDisclaimerSelect(), 'Yes', {
    containerSelector: '.select__container',
    readbackSelector: '.select__single-value',
  });
  assert.equal(result.filled, true, 'the chooser must still report the row click it made');
  assert.deepEqual(result.commits, ['Yes'], 'the widget must receive exactly one commit, never two');
  assert.equal(result.buttonText, 'Yes', 'the committed value must actually be on the form');
  assert.equal(result.landed, true, 'a commit the redelivery completed must be reported landed');
  assert.equal(result.state.lastChoiceUnreadable, false);
});

test('a commit that is genuinely lost stays reported lost: redelivery may finish a swallowed click, never invent one', async () => {
  // Delegated handlers on the list plus the swallow: once the close has removed the row, no event
  // redelivered ON the row can reach the list's handler, so nothing can commit. The button still
  // says Auswählen and the run must say the value is not there, exactly as before this fix.
  const result = await run(
    recruiteeSalutation({ closeOnDocumentMousedown: true, delegatedRows: true }),
    'Frau',
  );
  assert.equal(result.filled, true, 'the chooser still made its click; that is what the report is about');
  assert.deepEqual(result.commits, [], 'nothing committed, and nothing may pretend to');
  assert.equal(result.buttonText, 'Auswählen');
  assert.equal(result.landed, false, 'a value that is not on the form must never be reported landed');
});

test('the opener read hands back evidence only where it can be attributed and only when the conversation is over', async () => {
  const source = constSource('readCommittedOpenerText', 4, false);
  assert.ok(source, 'readCommittedOpenerText must exist in the sandbox runner');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const read = async (markup, selector) => {
    await page.setContent(`<!doctype html><html><body>${markup}</body></html>`);
    const container = page.locator(selector);
    return new AsyncFunction('container', `
      ${source}
      return readCommittedOpenerText(container);
    `)(container);
  };
  // The committed Recruitee shape: closed button, value as its rendered text.
  assert.equal(await read(
    '<div class="q"><button aria-haspopup="listbox" aria-expanded="false">Frau</button></div>', '.q',
  ), 'Frau');
  // An OPEN menu means the interaction is unfinished, whatever the button says right now.
  assert.equal(await read(
    '<div class="q"><button aria-haspopup="listbox" aria-expanded="true">Frau</button></div>', '.q',
  ), null);
  // Two openers are two questions: evidence that cannot be attributed proves nothing.
  assert.equal(await read(
    '<div class="q"><button aria-haspopup="listbox" aria-expanded="false">Frau</button>'
    + '<button aria-haspopup="listbox" aria-expanded="false">Ja</button></div>', '.q',
  ), null);
  // An opener holding a real input publishes its choice in that input, and the committed-input
  // read already owns that shape; this one must stand aside rather than double-read it.
  assert.equal(await read(
    '<div class="q"><div role="combobox" aria-expanded="false">Frau<input value="Frau"></div></div>', '.q',
  ), null);
  // A native select is never a bare opener, whatever roles a board paints onto it.
  assert.equal(await read(
    '<div class="q"><select role="combobox"><option selected>Frau</option></select></div>', '.q',
  ), null);
});

/* SOURCE PINS, in the style of the committed-search-input pins one file over: the opener
 * acceptance must stay gated on the unknown state, on a click this call actually made, on
 * byte-for-byte equality with that whole clicked row, and on the held row itself being the
 * answer (or a list-shaped tier's recorded commit). And the redelivery must stay a TAIL: it may
 * only ever run when the row provably missed its click, and may only repeat the mousedown when
 * the row never saw one, so a widget that commits on mousedown is never pressed twice. */
test('the verifier weighs the opener text against the clicked row, gated exactly, and the redelivery stays a tail', () => {
  const start = SANDBOX_RUNNER.indexOf('const verifyChoiceInContainer');
  const end = SANDBOX_RUNNER.indexOf('const markChoice');
  assert.ok(start !== -1 && end > start, 'verifyChoiceInContainer must precede markChoice');
  const verifier = SANDBOX_RUNNER.slice(start, end);
  assert.match(verifier, /readCommittedOpenerText\(container\)/);
  assert.match(verifier, /state\.kind === 'unknown' && clean\(clickedOptionText \|\| ''\)\s*\n\s*&& typeof readCommittedOpenerText === 'function'/);
  assert.match(verifier, /heldRow === clean\(clickedOptionText\)\.toLowerCase\(\)/);
  assert.match(verifier, /holdsAnswer\(shownOnOpener, expected\) \|\| declineMatches\(shownOnOpener, expected\)/);
  const clicker = constSource('clickIfPresent', 6);
  assert.match(clicker, /if \(!saw\.click\) \{/);
  assert.match(clicker, /if \(!sawMousedown\) \{/);
  assert.match(clicker, /await first\.click\(\);/, 'the real trusted click must remain the first delivery');
});
