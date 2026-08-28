/* THE LISTBOX A BARE OPENER PORTALS OUT OF THE BLOCK MUST STILL BE THE ONE THE CHOOSER READS.
 *
 * Measured live 2026-08-28 on cbsconsulting.recruitee.com (application cda445c1, the required
 * "Allgemeine Anrede" salutation, options Herr / Frau / Kein/e, stored answer "Frau"): the run
 * ended with 'no option matched "Frau" (the control opened but never showed an options list to
 * read)'. The opener is '<button id="input-candidate.salutation-2" aria-haspopup="listbox">' and
 * the widget (downshift, popper-positioned) renders its '<ul role="listbox">' of role=option rows
 * in a detached popper appended near <body>, OUTSIDE the question block. No select shell exists, so
 * menuIsPortalled / menuIsBesideShell cannot fire, and menuRoot() / widenRoot() searched the
 * container the popper had already left: the control opened, the rows were on the page, and every
 * tier read zero. PR #118's replay passed only because its transcribed fixture nested the same
 * listbox as a SIBLING inside the block, where the container search still reached it.
 *
 * The live markup captured the same day off the careers form shows the two bindings the fix reads:
 * the opener carries aria-haspopup="listbox" (and aria-controls to the popup id while open), and the
 * '<ul role="listbox" aria-labelledby="{opener-id}">' names the opener back in BOTH states. These
 * fixtures put the listbox where the live widget puts it - a body-level portal, outside the block -
 * and pin: the referenced listbox is found, read and committed; a portal listbox that does NOT name
 * the opener is never touched; and two listboxes that both name the opener refuse rather than guess.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';
import { constSource, CHOOSER_NAMES } from './chooser-source.mjs';

const SUPPORT_NAMES = [
  'optionMatches', 'optionMatchesExactly',
  'readChoiceState', 'readCommittedSearchInputValue', 'refuseChoice', 'nearMissChoiceReason',
  'publishChoiceOffers', 'choiceOffersClause', 'unmatchedReason',
  'verifyChoiceInContainer', 'settleVerified',
  'CHOICE_SHELL_CLASSES', 'markChoice', 'unmarkChoice', 'clearChoiceControl',
  'withdrawRefusedChoice', 'blurDrivenChoiceControl', 'choiceLanded',
  'CLEAR_CONTROL_RE', 'CHOICE_CONTROLS', 'CLEAR_CONTROLS',
  'fillCustomChoice',
];
const SRC = CHOOSER_NAMES.map((name) => constSource(name, 4))
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
    let lastChoiceOffersEvidence = null;
    const tracksChoiceFailures = false;
    ${SRC}
    return {
      fillCustomChoice,
      choiceLanded,
      unmatchedReason,
      state: () => ({
        lastClickedOptionText, lastClickedOptionAnswer, lastChooserTierAnswer,
        lastChoiceRefusal, choiceRefusals, lastChoiceControlOpened, lastChoiceUnreadable,
        lastChoiceOffersEvidence,
      }),
    };
  `)(page);
}

/* One row of the real CBS salutation shape: a div[role="option"] carrying its label in aria-label
 * AND nested two divs deep, exactly as recovered from the live form. `sink` chooses which array the
 * click reports into, so a decoy listbox's rows are distinguishable from the referenced one's. */
function optionRow(id, label, sink = '__commits') {
  return `<li class="sc-8x4ing-3 hjwmfo"><div role="option" aria-selected="false" id="${id}"`
    + ` aria-label="${label}" data-sink="${sink}" class="sc-19gswe1-3 sc-8x4ing-4 eUFJca">`
    + `<div class="sc-8x4ing-5 dxVAme"><div class="sc-8x4ing-6 eEDrZR">${label}</div></div></div></li>`;
}

/* A downshift listbox, verbatim in structure, rendered where a body portal puts it: a
 * popper-positioned wrapper whose rows sit behind display:none until the opener is open. `labelledby`
 * is the opener id the listbox names back through aria-labelledby - the durable binding that
 * survives the closed capture with no aria-controls. */
function portalListbox({ id, labelledby, rows, sink = '__commits', open = false, top = 0 }) {
  const display = open ? 'block' : 'none';
  return `<div class="popper" data-menu="${id}" style="position:absolute;left:0;top:${top}px;z-index:1002">`
    + `<div aria-multiselectable="false" aria-expanded="${open}" id="${id}" role="listbox"`
    + ` aria-labelledby="${labelledby}" tabindex="-1" style="min-width:240px">`
    + `<div class="rows" style="display:${display}"><ul style="list-style:none;margin:0;padding:0">`
    + rows.map((row) => optionRow(row.id, row.label, sink)).join('')
    + `</ul></div></div></div>`;
}

const SAL_ROWS = [
  { id: 'downshift-0-item-0', label: 'Herr' },
  { id: 'downshift-0-item-1', label: 'Frau' },
  { id: 'downshift-0-item-2', label: 'Kein/e' },
];

/* The question block: the opener button lives here; every listbox is appended to a body-level
 * portal node OUTSIDE this block, which is the whole point - the container search can never reach
 * them, so only a document-wide resolution of the opener's own listbox can. */
function opener() {
  return `<div class="sc-1ntuzce-3 bbTZgC"><div>`
    + `<label for="input-candidate.salutation-2" class="sc-deem66-0 hqamvD">Allgemeine Anrede`
    + `<span aria-hidden="true"> <span title="erforderlich" class="sc-deem66-1 kcyjFr">*</span></span></label>`
    + `<button aria-live="polite" type="button" id="input-candidate.salutation-2" aria-haspopup="listbox"`
    + ` aria-expanded="false" style="min-width:240px" aria-label="Allgemeine Anrede" aria-invalid="false"`
    + ` class="sc-j2mrs8-0 jBtzTL sc-19gswe1-4 sc-8x4ing-0 dImmBj"><div class="sc-19gswe1-5 fqCOBJ">`
    + `<div class="sc-19gswe1-7 kdEfDZ">Auswählen</div><span aria-hidden="true" class="sc-19gswe1-6 bTtSC">`
    + `<span direction="right" class="sc-1rd450u-0 hCnuYE"><svg width="12" height="6" viewBox="0 0 10 5">`
    + `<path d="M0 0l5 5 5-5z" fill="currentColor"></path></svg></span></span></div></button>`
    + `<div role="alert" id="input-candidate.salutation-2-error"></div>`
    + `</div></div>`;
}

/* THE HYDRATION THE LIVE WIDGET RUNS, minus the framework: the opener toggles its own listbox open,
 * sets aria-controls to it while open (downshift's on-open forward binding) and clears it when
 * closed, and a row click reports into the array its data-sink names and closes. Every listbox in
 * the portal that names THIS opener toggles together; a decoy that names a different opener is
 * wired independently so a stray click on it is still observable. Ambiguous fixtures leave their
 * listboxes permanently open so both are visible at read time. */
function script({ controlledMenu = null, alwaysOpen = false } = {}) {
  return `<script>(() => {
    window.__commits = [];
    window.__other = [];
    const button = document.getElementById('input-candidate.salutation-2');
    const valueNode = button.querySelector('.kdEfDZ');
    const owned = [...document.querySelectorAll('[role="listbox"]')].filter(
      (lb) => (lb.getAttribute('aria-labelledby') || '').split(/\\s+/).includes(button.id)
    );
    let open = ${JSON.stringify(Boolean(alwaysOpen))};
    function paint() {
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      ${controlledMenu ? `if (open) button.setAttribute('aria-controls', ${JSON.stringify(controlledMenu)}); else button.removeAttribute('aria-controls');` : ''}
      for (const lb of owned) {
        lb.setAttribute('aria-expanded', open ? 'true' : 'false');
        lb.querySelector('.rows').style.display = open ? 'block' : 'none';
      }
    }
    if (!${JSON.stringify(Boolean(alwaysOpen))}) {
      button.addEventListener('click', () => { open = !open; paint(); });
    }
    for (const row of document.querySelectorAll('[role="option"]')) {
      row.addEventListener('click', () => {
        const sink = row.getAttribute('data-sink') || '__commits';
        window[sink].push(row.getAttribute('aria-label'));
        if (sink === '__commits') { valueNode.textContent = row.getAttribute('aria-label'); open = false; paint(); }
      });
    }
    paint();
  })();</script>`;
}

function pageHtml(portalInner, scriptOpts) {
  return `<!doctype html><html><body><form>${opener()}</form>`
    + `<div id="portal-root">${portalInner}</div>${script(scriptOpts)}</body></html>`;
}

async function run(markup, answer) {
  await page.setContent(markup);
  const api = build();
  const target = page.locator('[id="input-candidate.salutation-2"]');
  const container = target.locator(
    'xpath=ancestor::*[(self::div or self::fieldset) and (.//*[@role="combobox"] or .//*[@aria-haspopup="listbox"] or .//*[@aria-haspopup="true"])][1]'
  );
  const filled = await api.fillCustomChoice(container, answer);
  const landed = filled ? await api.choiceLanded(container, answer) : false;
  const after = await page.evaluate(() => {
    const button = document.getElementById('input-candidate.salutation-2');
    return {
      commits: window.__commits ?? [],
      other: window.__other ?? [],
      buttonText: button.textContent.trim(),
      expanded: button.getAttribute('aria-expanded'),
    };
  });
  return { filled, landed, reason: api.unmatchedReason(answer), ...after, state: api.state() };
}

test('a body-portal listbox the opener names is found, committed and read back', async () => {
  // The live cda445c1 shape: opener in the block, its listbox portalled to a body-level node it
  // names both ways (aria-labelledby back to the opener, aria-controls forward while open). Before
  // this fix menuRoot()/widenRoot() searched only the container the popper had left, so every tier
  // read zero and the run refused an answer that was on the page.
  const portal = portalListbox({
    id: 'downshift-0-menu', labelledby: 'input-candidate.salutation-2', rows: SAL_ROWS,
  });
  const result = await run(pageHtml(portal, { controlledMenu: 'downshift-0-menu' }), 'Frau');
  assert.equal(result.filled, true, 'the chooser must reach the portalled listbox and click Frau');
  assert.deepEqual(result.commits, ['Frau'], 'exactly one commit, from the referenced listbox');
  assert.match(result.buttonText, /^Frau/, 'the committed value must be on the opener');
  assert.equal(result.landed, true, 'and the opener readback must verify it');
  // The evidence read now reports the portal rows, where PR #118 could only say the list never showed.
  assert.deepEqual(
    (result.state.lastChoiceOffersEvidence || {}).texts, ['Herr', 'Frau', 'Kein/e'],
    'the offers evidence must carry the portal rows it read',
  );
});

test('a portal listbox that does NOT name the opener is ignored, not read', async () => {
  // Two body-level listboxes both offering "Frau": one names the opener (aria-labelledby), one names
  // a different opener and is never bound to this control. The unreferenced one commits into __other
  // so any stray click on it is visible. Only the referenced listbox may donate, so __other stays
  // empty and the referenced Frau is the one committed.
  const referenced = portalListbox({
    id: 'downshift-0-menu', labelledby: 'input-candidate.salutation-2', rows: SAL_ROWS,
  });
  const decoy = portalListbox({
    id: 'other-question-menu', labelledby: 'some-other-opener', open: true, sink: '__other', top: 600,
    rows: [
      { id: 'other-item-0', label: 'Ja' },
      { id: 'other-item-1', label: 'Frau' },
      { id: 'other-item-2', label: 'Nein' },
    ],
  });
  const result = await run(
    pageHtml(referenced + decoy, { controlledMenu: 'downshift-0-menu' }), 'Frau',
  );
  assert.equal(result.filled, true, 'the referenced listbox still answers the question');
  assert.deepEqual(result.commits, ['Frau'], 'the referenced Frau is the one committed');
  assert.deepEqual(result.other, [], 'the unreferenced portal listbox is never clicked');
  assert.match(result.buttonText, /^Frau/, 'and the opener carries the committed value');
});

test('two listboxes that both name the opener refuse rather than guess', async () => {
  // Both listboxes name this opener through aria-labelledby, so which is its popup is a guess. The
  // fix refuses before clicking anything: exactly one listbox may donate, and here two claim to be
  // it. Both stay permanently open so both are visible candidates at read time.
  const first = portalListbox({
    id: 'downshift-0-menu', labelledby: 'input-candidate.salutation-2', rows: SAL_ROWS, open: true,
  });
  const second = portalListbox({
    id: 'downshift-9-menu', labelledby: 'input-candidate.salutation-2', open: true, top: 600,
    rows: [
      { id: 'dup-item-0', label: 'Herr' },
      { id: 'dup-item-1', label: 'Frau' },
      { id: 'dup-item-2', label: 'Kein/e' },
    ],
  });
  const result = await run(pageHtml(first + second, { alwaysOpen: true }), 'Frau');
  assert.equal(result.filled, false, 'an ambiguous binding may not be guessed through');
  assert.deepEqual(result.commits, [], 'and nothing may be committed while refusing');
  assert.ok(result.state.choiceRefusals >= 1, 'the refusal is recorded');
  assert.match(
    result.reason,
    /bound to more than one options list/,
    'the refusal must name the ambiguous binding it would not guess through',
  );
});
