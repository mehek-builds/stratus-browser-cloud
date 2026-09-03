/* A BARE "NO OPTION MATCHED" MUST CARRY WHAT THE OPTION READ SAW, because the one that did not
 * could never be diagnosed.
 *
 * Measured in production 2026-08-28 on cbsconsulting.recruitee.com (application cda445c1, the
 * required "Allgemeine Anrede" salutation): the post-PR-114 run ended with exactly
 * 'no option matched "Frau", left for you to choose', and no record anywhere of what the chooser
 * had compared. The review-time snapshot held the reviewed inventory (Herr / Frau / Kein/e), not
 * the failing run's read; actionDiagnostics exist only for Greenhouse question_N ids; the Vercel
 * runtime log window had closed; and this exact chooser, replayed against the live control the
 * same day, matched and committed "Frau". So whether that run faced a menu that never opened, an
 * empty list, or rows whose bytes differ from the snapshot is unrecoverable, by construction.
 * This file closes the construction: the refusal now records the offered rows it read (employer
 * list labels, verbatim, bounded) or says plainly that no list ever showed.
 *
 * The fixture is the REAL hydrated markup recovered from the live form on 2026-08-28, not a
 * simplification: a button opener with aria-haspopup="listbox" and NO aria-controls, a
 * popper-positioned sibling listbox named only by its own aria-labelledby, rows that are
 * div[role="option"] with the label in aria-label AND nested two divs deep, and a closed state
 * that keeps every row mounted behind a display:none wrapper. The choice-persist suite one file
 * over pinned this control's commit and readback on simplified rows; this one pins the read.
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
  'withdrawRefusedChoice', 'blurDrivenChoiceControl',
  // choiceLanded's form confirmation and the sentence it speaks. Both are reached from
  // choiceLanded itself, so a harness that omits them executes a different function.
  'formRefusedChoiceReason', 'formStillRequiresChoice',
  'choiceLanded',
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
    let lastChoiceRejectedByForm = false;
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

/* The hydrated CBS Recruitee salutation block, verbatim in structure: recovered from the live
 * cbsconsulting.recruitee.com form, 2026-08-28. `hydrated: false` renders the identical DOM with
 * no listeners attached, which is the page the runner faces if it arrives before the framework
 * wires the opener: the button click bounces off, aria-expanded stays false, and no row ever
 * gets a client rect. That is one concrete way to produce the production run's exact bare
 * refusal, and the shape the new evidence must name rather than stay silent about. */
function cbsSalutation({ hydrated = true } = {}) {
  return `<!doctype html><html><body>
  <form>
  <div class="sc-1ntuzce-3 bbTZgC"><div>
    <label for="input-candidate.salutation-2" class="sc-deem66-0 hqamvD">Allgemeine Anrede<span aria-hidden="true"> <span title="Dieses Feld ist erforderlich und darf nicht leer gelassen werden." class="sc-deem66-1 kcyjFr">*</span></span></label>
    <button aria-live="polite" type="button" id="input-candidate.salutation-2" aria-haspopup="listbox" aria-expanded="false" style="min-width:240px" aria-label="Allgemeine Anrede" aria-invalid="false" class="sc-j2mrs8-0 jBtzTL sc-19gswe1-4 sc-8x4ing-0 dImmBj"><div class="sc-19gswe1-5 fqCOBJ"><div class="sc-19gswe1-7 kdEfDZ">Auswählen</div><span aria-hidden="true" class="sc-19gswe1-6 bTtSC"><span direction="right" class="sc-1rd450u-0 hCnuYE"><svg width="12" height="6" viewBox="0 0 10 5"><path d="M0 0l5 5 5-5z" fill="currentColor"></path></svg></span></span></div></button>
    <div aria-multiselectable="false" aria-expanded="false" id="downshift-0-menu" role="listbox" aria-labelledby="input-candidate.salutation-2" tabindex="-1" style="position:absolute;inset:0px auto auto 0px;min-width:440px;z-index:1002;transform:translate(64px,120px)">
      <div class="sc-8x4ing-1 gifqfF" style="display:none">
        <ul class="sc-8x4ing-2 hRyzJN" style="list-style:none;margin:0;padding:0">
          <li class="sc-8x4ing-3 hjwmfo"><div role="option" aria-selected="false" id="downshift-0-item-0" aria-label="Herr" class="sc-19gswe1-3 sc-8x4ing-4 eUFJca"><div class="sc-8x4ing-5 dxVAme"><div class="sc-8x4ing-6 eEDrZR">Herr</div></div></div></li>
          <li class="sc-8x4ing-3 hjwmfo"><div role="option" aria-selected="false" id="downshift-0-item-1" aria-label="Frau" class="sc-19gswe1-3 sc-8x4ing-4 eUFJca"><div class="sc-8x4ing-5 dxVAme"><div class="sc-8x4ing-6 eEDrZR">Frau</div></div></div></li>
          <li class="sc-8x4ing-3 hjwmfo"><div role="option" aria-selected="false" id="downshift-0-item-2" aria-label="Kein/e" class="sc-19gswe1-3 sc-8x4ing-4 eUFJca"><div class="sc-8x4ing-5 dxVAme"><div class="sc-8x4ing-6 eEDrZR">Kein/e</div></div></div></li>
        </ul>
      </div>
    </div>
    <div role="alert" id="input-candidate.salutation-2-error" class="sc-1xbat0c-1 cVaFVn"></div>
  </div></div>
  </form>
  <script>
  (() => {
    if (!${JSON.stringify(Boolean(hydrated))}) return;
    window.__commits = [];
    const button = document.getElementById('input-candidate.salutation-2');
    const menu = document.getElementById('downshift-0-menu');
    const wrapper = menu.firstElementChild;
    const valueNode = button.querySelector('.kdEfDZ');
    let open = false;
    function render() {
      button.setAttribute('aria-expanded', open ? 'true' : 'false');
      menu.setAttribute('aria-expanded', open ? 'true' : 'false');
      wrapper.style.display = open ? 'block' : 'none';
    }
    button.addEventListener('click', () => { open = !open; render(); });
    for (const row of menu.querySelectorAll('[role="option"]')) {
      row.addEventListener('click', () => {
        window.__commits.push(row.getAttribute('aria-label'));
        valueNode.textContent = row.getAttribute('aria-label');
        for (const other of menu.querySelectorAll('[role="option"]')) {
          other.setAttribute('aria-selected', other === row ? 'true' : 'false');
        }
        open = false;
        render();
      });
    }
    render();
  })();
  </script></body></html>`;
}

async function run(markup, answer) {
  await page.setContent(markup);
  const api = build();
  // The exact container the fill action's custom_choice route resolves for this target.
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
      buttonText: button.textContent.trim(),
      expanded: button.getAttribute('aria-expanded'),
    };
  });
  return { filled, landed, reason: api.unmatchedReason(answer), ...after, state: api.state() };
}

test('the real CBS salutation markup is answerable: aria-label rows, popper menu, no aria-controls', async () => {
  // The live replay of 2026-08-28 in fixture form. If a chooser change breaks any of the three
  // reads this control depends on (the role query over aria-label rows, the container scope with
  // no declared menu, the committed-opener readback), this is the assertion that names it.
  const result = await run(cbsSalutation(), 'Frau');
  assert.equal(result.filled, true, 'the chooser must click the aria-label row');
  assert.deepEqual(result.commits, ['Frau'], 'exactly one commit, never two');
  assert.match(result.buttonText, /^Frau/, 'the committed value must be on the opener');
  assert.equal(result.landed, true, 'and the opener readback must verify it');
});

test('an opener the framework never wired produces the refusal WITH its evidence: no list ever showed', async () => {
  // One concrete mechanism for the production run's exact bare sentence: the click lands, nothing
  // opens, every row keeps a zero-area rect, and every tier correctly finds nothing. The verdict
  // stays a refusal; what changes is that it now says what the read saw.
  const result = await run(cbsSalutation({ hydrated: false }), 'Frau');
  assert.equal(result.filled, false, 'nothing may be clicked on a dead opener');
  assert.equal(result.state.lastChoiceControlOpened, true, 'the opener itself was found and pressed');
  assert.equal(result.state.lastChoiceRefusal, '', 'no tier saw anything to refuse over');
  assert.equal(
    result.reason,
    'no option matched "Frau" (the control opened but never showed an options list to read), left for you to choose',
    'the refusal must say the list never showed instead of implying the answer was absent from it'
  );
});

test('an answer genuinely absent from the list is refused WITH the rows read, verbatim', async () => {
  // The other half of the diagnosis: rows were readable and none was the answer. The offered
  // texts are the employer's own list labels, recorded before any typing, so the next cda445c1
  // arrives with the exact bytes the chooser compared instead of a snapshot from another pass.
  const result = await run(cbsSalutation(), 'Frau Dr.');
  assert.equal(result.filled, false, 'no row may be guessed for an answer the list does not offer');
  assert.deepEqual(result.commits, [], 'and nothing may be committed while refusing');
  assert.equal(
    result.reason,
    'no option matched "Frau Dr." (the list offered: "Herr", "Frau", "Kein/e"), left for you to choose',
    'the refusal must carry the offered rows it judged'
  );
});

test('a block with no drivable control says so, and the offers read is bounded at eight rows', async () => {
  await page.setContent('<!doctype html><html><body><div class="q"><p>Keine Auswahl hier</p></div></body></html>');
  const api = build();
  const filled = await api.fillCustomChoice(page.locator('.q'), 'Frau');
  assert.equal(filled, false);
  assert.equal(api.state().lastChoiceControlOpened, false);
  assert.equal(
    api.unmatchedReason('Frau'),
    'no option matched "Frau" (no options list could be opened to read), left for you to choose'
  );
  // The bound, pinned in source rather than replayed with a 250-row country list: eight rows of
  // sixty characters plus a count of the remainder is a diagnosis; the whole taxonomy is a page.
  assert.match(SANDBOX_RUNNER, /offers\.slice\(0, 8\)/);
  assert.match(SANDBOX_RUNNER, /\.slice\(0, 60\)\);/);
  assert.match(SANDBOX_RUNNER, /', plus ' \+ \(lastChoiceOffersEvidence\.total - rows\.length\) \+ ' more'/);
});
