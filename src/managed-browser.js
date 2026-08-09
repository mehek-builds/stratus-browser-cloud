import { assertPublicUrl } from './security.js';
import { Sandbox } from '@vercel/sandbox';
import crypto from 'node:crypto';

export const FREE_MANAGED_LIMITS = Object.freeze({
  concurrentBrowsers: 10,
  monthlyCpuHours: 5,
  maxRunSeconds: 60,
  persistedDays: 30
});

export const ATOMIC_SUBMIT_POLICY = Object.freeze({
  name: 'litos-final-submit',
  version: 1,
  candidateSelector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
  applicationFinalPattern: '^(?:submit|send)\\s+(?:(?:your|my|the)\\s+)?application$',
  verificationFinalPattern: '^(?:verify(?:\\s+(?:code|email|identity|application))?|confirm\\s+(?:code|email|identity|application)|submit\\s+(?:verification|code)|(?:submit|send)\\s+(?:(?:your|my|the)\\s+)?application)$',
  handoffVerbProviderPattern: '\\b(?:apply|autofill|continue|import)\\s+(?:handshake|symplicity|linkedin|indeed|seek|glassdoor|ziprecruiter|monster|xing|stepstone|google|facebook|github|apple|greenhouse|workday|workable|ashby|smartrecruiters|okta|microsoft|sso)\\b',
  thirdPartyHandoffPattern: '\\b(?:apply|submit|send|autofill|sign\\s?in|log\\s?in|continue|register|import)\\b(?:\\s+\\w+){0,4}\\s+(?:with|using|via|from)\\s+(?!(?:(?:the|your|my|a|an)\\s+)?(?:attachments?|resumes?|cvs?|cover\\s+letters?|documents?|files?|e-?signature|profiles?|accounts?|saved\\s+(?:details|information))\\b)|\\bquick apply\\b|\\bone[-\\s]?click apply\\b|\\bpowered\\s+by\\b',
  supportWidgetPattern: '\\bapplication\\s+(?:feedback|survey|issue|question|review|experience)\\b|\\bfeedback\\s+on\\s+your\\s+application\\b|^(?!.*\\bapplication\\b).*\\b(?:feedback|request|ticket|comment|search|report|question|issue|review|rating|survey|contact|bug)\\b'
});
const ATOMIC_SUBMIT_SELECTOR = ATOMIC_SUBMIT_POLICY.candidateSelector;
const ALLOWED_ACTIONS = new Set(['click', 'fill', 'fillByLabelText', 'upload', 'waitForSelector', 'press', 'select', 'extract', 'discover', 'confirmAndSubmit']);
const MAX_ACTIONS = 120;
const MAX_VALUE_LENGTH = 10_000;
const MAX_FILE_BASE64_LENGTH = 6_000_000;
export const MANAGED_CONTINUATION_CONTRACT = Object.freeze({
  requestField: 'requestContinuation',
  checkpointField: 'continuationCheckpoint',
  ttlField: 'continuationTtlSeconds',
  tokenField: 'continuationToken',
  expiresAtField: 'continuationExpiresAt',
  defaultTtlSeconds: 120,
  minTtlSeconds: 15,
  maxTtlSeconds: 120,
  maxContinuations: 1
});

const SANDBOX_NAME = 'stratus-browser-runtime';
const SANDBOX_DEPENDENCIES = [
  'nss', 'dbus-libs', 'atk', 'at-spi2-atk', 'cups-libs', 'libxcb', 'libxkbcommon',
  'at-spi2-core', 'libX11', 'libXcomposite', 'libXdamage', 'libXext', 'libXfixes',
  'libXrandr', 'mesa-libgbm', 'cairo', 'pango', 'alsa-lib'
];

// Exported so tests can pin the load-bearing branches of the runner. It ships to the sandbox as a
// string, so a regression here is invisible until a real portal run fails on a real application.
export const SANDBOX_RUNNER = String.raw`
const fs = require('node:fs');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

(async () => {
  const input = JSON.parse(fs.readFileSync('stratus-input.json', 'utf8'));
  const startedAt = Date.now();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const browserContext = await browser.newContext({ viewport: input.viewport || { width: 1440, height: 900 } });
    const page = await browserContext.newPage();
    // A RUN THAT WAS NOT ASKED TO SUBMIT MUST BE STRUCTURALLY UNABLE TO SUBMIT.
    //
    // Measured on 2026-08-08: three Greenhouse packets (Redwood Materials, Scale AI, Cresta) reached
    // 'ready_for_final_approval' with submission_claimed_at, submission_authorization and
    // browser_session_id all null - so the authorized submit path provably never ran - while
    // Greenhouse emailed the applicant a security code at the exact minute of each FILL run. The
    // fill run had submitted a real application to a real employer with nobody's authorization.
    //
    // The mechanism at the time was a keystroke: 'press' ignored its selector and fired
    // page.keyboard.press('Enter'), and an Enter inside a form is implicit submission. PR #19 and
    // #20 aimed the press and withhold Enter on a closed choice control, which closes that
    // particular door. This closes the DOORWAY. Aiming a keystroke does not make it safe: an aimed
    // Enter on a plain text input still submits the form, and so does any click that lands on
    // something submit-shaped. The caller declares intent once, here, and the page is then
    // physically incapable of contradicting it.
    //
    // addInitScript rather than an evaluate after goto, because a guard installed into one document
    // dies at the first navigation, and a form post navigates. This one is reinstalled by the
    // browser into every document the run ever loads.
    //
    // WHAT IT DOES NOT COVER, said out loud: a page that posts with fetch/XHR from its own click
    // handler never dispatches a submit event and never calls form.submit(), so nothing here sees
    // it. This is a floor, not a proof. 'blockedSubmits' in the result is the measurement that says
    // whether the floor was ever reached.
    if (input.allowSubmit !== true) {
      await page.addInitScript(() => {
        window.__litosBlockedSubmits = 0;
        // Capture phase on document, so this runs before any framework handler and before the
        // browser's own default. stopImmediatePropagation is what stops React's onSubmit, which is
        // attached lower down the tree and would otherwise still fire its own fetch.
        document.addEventListener('submit', (event) => {
          window.__litosBlockedSubmits += 1;
          event.preventDefault();
          event.stopImmediatePropagation();
        }, true);
        // form.submit() dispatches no submit event at all, by specification, so the listener above
        // cannot see it. requestSubmit() does dispatch one and is therefore already covered.
        const nativeSubmit = HTMLFormElement.prototype.submit;
        HTMLFormElement.prototype.submit = function litosBlockedSubmit() {
          window.__litosBlockedSubmits += 1;
          return undefined;
        };
        // Kept referenced so a minifier or a future edit cannot quietly drop the original and leave
        // no way back for a run that IS allowed to submit.
        HTMLFormElement.prototype.submit.nativeSubmit = nativeSubmit;
      }).catch(() => undefined);
    }
    const waitUntil = input.waitUntil === 'networkidle2' || input.waitUntil === 'networkidle0' ? 'networkidle' : input.waitUntil;
    await page.goto(input.url, { waitUntil, timeout: 45000 });
    // Continuations may keep the exact page and context alive, but they may not turn that context
    // into a general browser. Only main-frame navigations are host locked, so ordinary assets and
    // employer-owned CDN requests continue to work.
    if (input.requestContinuation) {
      await browserContext.route('**/*', async (route) => {
        const request = route.request();
        if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return route.continue();
        try {
          const targetHost = new URL(request.url()).hostname.toLowerCase();
          if (targetHost !== input.allowedHost) return route.abort('blockedbyclient');
        } catch {
          return route.abort('blockedbyclient');
        }
        return route.continue();
      });
    }
    const extracted = [];
    const filledFields = [];
    const skipped = [];
    const discovered = [];
    // Filled by the pre-submit gate, and merged into 'blockers' after the loop. It has to be
    // declared up here because the gate runs mid-loop, before the final click, while 'blockers' is
    // only assembled once every action has run.
    const submitGateBlockers = [];
    // What happened to a code the caller supplied, or null when it never supplied one. Written by
    // the final-submit branch and reported verbatim: whether the code was typed, whether the form
    // was sent again, and whether the challenge was still standing afterwards. The caller cannot
    // work any of that out from the outside, and guessing it is how an application ends up recorded
    // as sent when it is still sitting behind a human check.
    let securityCodeAttempt = null;
    /* WAS THE BUTTON PRESSED. Separate from everything the page says afterwards, because the two
     * answer different questions and the run has to be able to say "pressed, and I do not know what
     * happened next" without either half contaminating the other. Production packet
     * 13bccb2d (Skydio, Ashby, 2026-08-09) is the case: the run was killed while this was the only
     * fact anybody needed, and it was not recorded anywhere. */
    let finalSubmitPressed = false;
    let requiredFieldConfirmation = null;
    const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const normalized = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    /* A REFUSAL TO STATE, RECOGNISED BY WHAT IT MEANS RATHER THAN BY HOW IT IS SPELLED.
     *
     * Tested against normalized() output, where punctuation is already spaces, so "don't" arrives
     * as "don t" and "self-identify" as "self identify".
     *
     * The enumerated synonym list below could not reach the wording that actually shipped. Both of
     * the option vocabularies Litos has ever recorded, read out of stored Greenhouse label blobs on
     * 2026-08-09, word their opt-out their own way:
     *   "I decline to self-identify for protected veteran status"
     *   "I do not want to answer"                     <- want, not wish. No synonym on the list.
     * Enumerating spellings is a losing game on this family: an opt-out is the one entry on an EEO
     * list an employer can word however it likes, because it means the same thing regardless.
     */
    const DECLINE_TO_STATE = new RegExp([
      'declines? to (?:self identify|answer|state|say|specify|disclose|respond|provide)',
      '(?:do not|do nt|don t|dont|would rather not|rather not|prefer not|prefers not|choose not|chooses not)'
        + ' (?:to )?(?:want|wish|like)? ?(?:to )?(?:answer|say|state|specify|disclose|self identify|identify|respond|provide)',
      'not (?:want|wish|choose|prefer)(?:ing)? to (?:answer|say|state|specify|disclose|self identify|identify|respond|provide)',
      '^(?:declined?|declines|i decline|no answer|not disclosed|not specified|undisclosed)$'
    ].join('|'));
    const answerOptions = (value) => {
      const base = clean(value);
      const lower = base.toLowerCase();
      const options = [base];
      if (/^yes$/.test(lower)) options.push('yes', 'i agree', 'agree', 'true');
      if (/^no$/.test(lower)) options.push('no', 'false');
      if (DECLINE_TO_STATE.test(normalized(base))) {
        options.push(
          'decline to self-identify',
          'i decline to self-identify',
          'i do not wish to answer',
          "i don't wish to answer",
          'i do not want to answer',
          "i don't want to answer",
          'i do not wish to disclose',
          'choose not to disclose',
          'prefer not to answer',
          'prefer not to say'
        );
      }
      return [...new Set(options.filter(Boolean))];
    };
    const optionMatches = (candidate, wanted) => {
      const a = normalized(candidate);
      if (!a) return false;
      // Intent before spelling, and only ever decline-to-decline. Two texts that both refuse to
      // state say the same thing however each one is worded, so an option list that offers any
      // refusal can carry a stored refusal. Nothing else is matched this way: every other answer on
      // an EEO list is a claim about her, and a claim has to match the words.
      if (DECLINE_TO_STATE.test(a) && DECLINE_TO_STATE.test(normalized(wanted))) return true;
      return answerOptions(wanted).some((option) => {
        const b = normalized(option);
        return a === b || (b.length > 6 && a.includes(b)) || (a.length > 6 && b.includes(a));
      });
    };
    const verifyFilled = async (field, expected) => {
      const actual = await field.evaluate((element) => {
        if (element instanceof HTMLInputElement && element.type === 'file') return element.files?.length ? 'file' : '';
        if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) return element.checked ? 'checked' : '';
        if (element instanceof HTMLSelectElement) {
          const selected = element.selectedOptions && element.selectedOptions[0];
          return selected ? (selected.textContent || selected.value || '') : element.value || '';
        }
        return 'value' in element ? String(element.value || '') : (element.textContent || '');
      }).catch(() => '');
      if (!clean(expected)) return Boolean(clean(actual));
      if (actual === 'checked' && /^yes$/i.test(clean(expected))) return true;
      return optionMatches(actual, expected) || normalized(actual) === normalized(expected);
    };
    /* IS THE NEXT QUESTION STILL REACHABLE, or is something sitting on top of it.
     *
     * Measured on the live Deepgram Ashby form: filling 'Expected Graduation Year' opens a May 2028
     * calendar that does NOT close when the value is committed, and it renders over the question
     * below it - over the control AND over its label. document.elementFromPoint at the centre of the
     * following control returns the calendar, so anything aimed there afterwards hits the calendar
     * instead of the field, and the screenshot of the 'filled' form shows the applicant a question
     * she cannot read.
     *
     * The measurement is deliberately 'is the next control reachable' and not 'is a calendar open'.
     * Which widget it is does not matter and there is no list of them worth keeping.
     *
     * Three narrowings, and each one is a false positive this would otherwise have:
     *   - Only text-entry controls count as 'the next question'. A checkbox, radio or file input is
     *     routinely 1px or opacity:0 with its real chrome painted by a sibling, so hit-testing one
     *     reports 'covered' on a page where nothing is covering anything.
     *   - The thing on top has to be FLOATING - inside an absolute, fixed or sticky ancestor. That is
     *     what an overlay IS, and it is what separates a picker from ordinary layout.
     *   - A control outside the viewport is answered 'no' rather than guessed at. elementFromPoint
     *     has nothing to say about it.
     */
    const nextControlIsCovered = async (field) => await field.evaluate((element) => {
      const TEXT_ENTRY = 'input:not([type]), input[type="text"], input[type="tel"], input[type="email"],'
        + ' input[type="url"], input[type="number"], input[type="search"], input[type="password"],'
        + ' input[type="date"], input[type="month"], input[type="week"], textarea, select, [role="combobox"]';
      const root = element.closest('form') || element.ownerDocument.body;
      const controls = Array.prototype.slice.call(root.querySelectorAll(TEXT_ENTRY));
      const index = controls.indexOf(element);
      if (index < 0) return false;
      const floating = (node) => {
        for (let at = node; at && at !== element.ownerDocument.body; at = at.parentElement) {
          const position = getComputedStyle(at).position;
          if (position === 'absolute' || position === 'fixed' || position === 'sticky') return true;
        }
        return false;
      };
      for (let i = index + 1; i < controls.length; i += 1) {
        const next = controls[i];
        if (next === element || element.contains(next) || next.contains(element)) continue;
        const box = next.getBoundingClientRect();
        if (box.width === 0 || box.height === 0) continue;
        const x = box.left + box.width / 2;
        const y = box.top + box.height / 2;
        if (x < 0 || y < 0 || x > window.innerWidth || y > window.innerHeight) return false;
        const over = element.ownerDocument.elementFromPoint(x, y);
        if (!over) return false;
        if (over === next || next.contains(over) || over.contains(next)) return false;
        return floating(over);
      }
      return false;
    }).catch(() => false);
    /* DISMISSING THAT OVERLAY, AND WHY IT IS NOT A KEYSTROKE AT THE PAGE.
     *
     * There is recorded history here. An unaimed global 'press Enter', queued to commit a value,
     * reached the FORM instead and submitted it: five bounced applications and five emailed
     * Greenhouse security codes. So a dismissal has to satisfy two things at once. It has to reach
     * the overlay, and it has to be incapable of sending the application even if it lands somewhere
     * unintended.
     *
     * Escape aimed at the field satisfies both. It is delivered to one named element rather than to
     * whatever happens to hold focus; every picker measured here and live closes on it; and Escape
     * has no submitting behaviour on any control in any browser - there is no arrangement of focus
     * in which this key sends a form. Blur is the second attempt for the same two reasons: aimed at
     * the one element, and incapable of submitting. Nothing here CLICKS. A click needs a point to
     * land on, and any point on a real employer's page may turn out to be a control.
     *
     * The run-level submit guard above would catch a stray submit anyway. It is deliberately not
     * leaned on: a guard is a net, and the thing over the net should still be the right thing.
     *
     * An overlay that survives both is REPORTED rather than fought. Telling the applicant the form
     * was left with something covering a question is a true statement she can act on, and it is
     * better than escalating to a blind click at coordinates.
     *
     * Costs ZERO actions. It runs inside the fill that opened the overlay, so it cannot displace a
     * field at the MANAGED_ACTION_LIMIT boundary.
     */
    const dismissOverlayAfterFill = async (field, label) => {
      if (!(await nextControlIsCovered(field))) return;
      await field.press('Escape').catch(() => undefined);
      await page.waitForTimeout(80);
      if (!(await nextControlIsCovered(field))) return;
      await field.evaluate((element) => { if (typeof element.blur === 'function') element.blur(); }).catch(() => undefined);
      await page.waitForTimeout(80);
      if (await nextControlIsCovered(field) && label) {
        skipped.push(label + ': a picker overlay stayed open over the next question after Escape and blur');
      }
    };
    /* THE DIAL CODE THE FORM ALREADY HAS, read off the form rather than assumed from the board.
     *
     * Cresta's live form rejected '+971 567417451' with 'Phone number is too short' while the
     * country control beside it already read +971. Combining a selector holding +971 with a field
     * that also holds +971 gives a string no numbering plan parses, and the phone-input libraries
     * these forms use report that as a length error. The application could not be submitted.
     *
     * The rule is NOT 'this board strips'. It was exactly that, for exactly one board, and the same
     * defect then turned up on another. It is: when the phone field has a SEPARATE control already
     * showing THIS number's own dial code, the field is for the national number and the dial code
     * does not go in it. Both halves are required, and the second half is what keeps the
     * mirror-image defect away. A form with no country control, or one showing a different country,
     * or one showing a country NAME and no dial code, still receives the full international number,
     * because stripping the country off a number nothing else carries would be the worse of the two
     * bugs: it produces a number the employer cannot dial and nothing on the page says so.
     *
     * The decision this feeds is phoneForPortalField in the backend, and it is pinned there by
     * src/lib/phoneCountryControl.test.ts. This is the same rule at the one place that has a live
     * DOM to ask; the runner is a standalone script and cannot import it.
     */
    const separateDialCodesFor = async (field) => await field.evaluate((element) => {
      const attr = (name) => element.getAttribute(name) || '';
      const type = attr('type').toLowerCase();
      const hint = (attr('name') + ' ' + attr('id') + ' ' + attr('aria-label') + ' ' + attr('placeholder') + ' ' + attr('autocomplete')).toLowerCase();
      // Narrow on purpose. A broad match here would rewrite an unrelated numeric answer that
      // happened to sit next to something with a plus sign in it.
      if (type !== 'tel' && !/phone|mobile|(^|[^a-z])tel([^a-z]|$)/.test(hint)) return [];
      const dialCodesIn = (control) => {
        if (control === element || control.contains(element) || element.contains(control)) return [];
        let text = '';
        if (control.tagName === 'SELECT') {
          const selected = control.selectedOptions && control.selectedOptions[0];
          text = String(control.value || '') + ' ' + (selected ? String(selected.textContent || '') : '');
        } else {
          text = String(control.getAttribute('aria-label') || '') + ' '
            + String(control.value || '') + ' ' + String(control.textContent || '');
        }
        const found = [];
        const pattern = /\+\s?(\d{1,4})/g;
        let match = pattern.exec(text);
        while (match) { found.push(match[1]); match = pattern.exec(text); }
        return found;
      };
      // Nearest group outwards, stopping at the first level that holds a dial code, and never
      // crossing the form or the page. A phone field's country control sits beside it in its own
      // group; a dial code found past that boundary belongs to some other field.
      let node = element.parentElement;
      for (let depth = 0; node && depth < 4 && !/^(?:BODY|FORM|MAIN|SECTION|ARTICLE|HTML)$/.test(node.tagName); depth += 1) {
        const found = [];
        const controls = node.querySelectorAll(
          'select, [class*="select__single-value"], [class*="PhoneInputCountry"], [class*="iti__selected"], [role="combobox"], button'
        );
        for (let i = 0; i < controls.length; i += 1) {
          const codes = dialCodesIn(controls[i]);
          for (let j = 0; j < codes.length; j += 1) found.push(codes[j]);
        }
        if (found.length > 0) return found;
        node = node.parentElement;
      }
      return [];
    }).catch(() => []);
    const phoneValueForField = async (field, value) => {
      const wanted = String(value === undefined || value === null ? '' : value).trim();
      // No leading '+' means there is no dial code in the value to remove and no claim to act on.
      if (wanted.charAt(0) !== '+') return value;
      const digits = wanted.replace(/\D/g, '');
      if (!digits) return value;
      const codes = await separateDialCodesFor(field);
      const dial = codes
        // '>' and not '>=': a value that is nothing BUT its dial code would otherwise be stripped to
        // an empty field, which is a worse answer than an odd one.
        .filter((code) => code && digits.length > code.length && digits.indexOf(code) === 0)
        .sort((a, b) => b.length - a.length)[0];
      if (!dial) return value;
      return digits.slice(dial.length);
    };
    // Three states, not two, and the third one is the point. 'chosen' means the widget is showing an
    // answer and we can read it; 'empty' means it is positively showing its placeholder, so we KNOW
    // nothing is answered; 'unknown' means this is not a widget whose answered state can be read, and
    // no conclusion may be drawn from it either way.
    const readChoiceState = async (container) => await container.evaluate((element) => {
      const widget = element.closest('[class*="select__container"], [class*="select-shell"]')
        || (element.closest('[class*="select__control"]') || {}).parentElement
        || element;
      // The chosen value is rendered as its own node, and reading it beats reading the widget:
      // the widget's textContent also carries the question label, and a label is quite capable of
      // containing the answer word ("...currently enrolled in a degree program?" contains "no").
      const chosen = widget.querySelector('[class*="select__single-value"], [class*="select__multi-value__label"]');
      if (chosen) return { kind: 'chosen', value: chosen.textContent || '' };
      // Still showing "Select...", so nothing was chosen. Saying so rather than falling through to
      // textContent stops the label from being mistaken for an answer.
      if (widget.querySelector('[class*="select__placeholder"]')) return { kind: 'empty', value: '' };
      return { kind: 'unknown', value: element.textContent || '' };
    }).catch(() => ({ kind: 'unknown', value: '' }));
    // READS THE ANSWER THE EMPLOYER WOULD SEE, not the container the fill happened to be scoped to.
    // The container handed in by the 'fill' branch is resolved as the nearest ancestor holding a
    // combobox, and on a React Select that is '.select__input-container' - a div whose only child is
    // the invisible search input. Its textContent is the empty string no matter how correctly the
    // control was answered, so this reported "choice value did not persist after fill" for controls
    // that were visibly and correctly set. Measured on the live Redwood Materials Greenhouse form
    // (2026-08-08): four questions answered No/Yes/Yes/Yes, all four verified false.
    // A verification that reads a different place from the one the value lands in is worse than no
    // verification, because it turns a good fill into a reported failure and a real failure into
    // noise indistinguishable from it.
    const verifyChoiceInContainer = async (container, expected) => {
      const state = await readChoiceState(container);
      if (state.kind === 'empty') return false;
      const text = state.value;
      return optionMatches(text, expected) || answerOptions(expected).some((option) => normalized(text).includes(normalized(option)));
    };
    /* AN ANSWER THAT IS A BUTTON, not an input.
     *
     * D-01, the fill half. Ashby renders every yes/no question as two plain buttons -
     * '<button>Yes</button><button>No</button>' - beside one input[type=checkbox] that is
     * display:none and holds the value. Nothing about that markup is an option: the buttons have no
     * role, no value and no aria-checked, and the checkbox's label is the QUESTION rather than an
     * answer. So the checkbox arm of fillByLabelText read the one input in the block, compared the
     * whole question text against "Yes", found no match, and left the control untouched. Measured on
     * production packet 245c827a: both work-eligibility questions had answers resolved from the
     * stored profile and neither reached the page. The extension's own Ashby adapter records the
     * same finding from live testing and answers these by clicking the pill.
     *
     * Scoped to ONE question's container, always. Matching a string as short as "Yes" anywhere on a
     * page is how a legal acknowledgement elsewhere on the form gets agreed to, which is the one
     * mistake here the applicant cannot undo.
     *
     * Pointer events before the click because the pills are React-controlled and a bare click can be
     * reverted by the next re-render, and the retry is gated on the selected-state signal so a press
     * that DID take is never pressed a second time and toggled back off.
     */
    const SELECTED_PILL_CLASS = /_active_|_selected_|_checked_/;
    const pickOptionPill = async (container, wanted) => {
      if (!clean(wanted)) return false;
      // Not filtered by type. A <button> with no type attribute reports type "submit" by HTML
      // default, and that is exactly what these pills are; the real submit control is excluded by
      // the text list instead.
      const pills = container.locator('button');
      const total = await pills.count();
      if (total === 0) return false;
      const ACTION_TEXT = /upload|replace|drag|drop|submit|browse|remove|delete|\bsave\b|cancel|\+\s*add/i;
      let match = null;
      for (let index = 0; index < total; index += 1) {
        const pill = pills.nth(index);
        if (!await pill.isVisible().catch(() => false)) continue;
        const text = clean(await pill.textContent().catch(() => ''));
        if (!text || text.length > 40 || ACTION_TEXT.test(text)) continue;
        if (optionMatches(text, wanted)) { match = pill; break; }
      }
      if (!match) return false;
      const press = async () => {
        await match.evaluate((element) => {
          const options = { bubbles: true, cancelable: true, view: window };
          try { element.dispatchEvent(new PointerEvent('pointerdown', options)); } catch (error) { /* older engines */ }
          element.dispatchEvent(new MouseEvent('mousedown', options));
          element.dispatchEvent(new MouseEvent('mouseup', options));
          element.click();
        }).catch(() => undefined);
        await page.waitForTimeout(200).catch(() => undefined);
      };
      await press();
      const stuck = async () => await match.evaluate((element, source) => {
        const test = new RegExp(source);
        return test.test(String(element.className || ''))
          || element.getAttribute('aria-pressed') === 'true'
          || element.getAttribute('aria-checked') === 'true'
          || element.getAttribute('aria-selected') === 'true'
          || /^(?:on|true|active|selected|checked)$/i.test(element.getAttribute('data-state') || '');
      }, SELECTED_PILL_CLASS.source).catch(() => false);
      if (!await stuck()) await press();
      // The caller records a filled field only on a selection it can still read back, for the same
      // reason verifyChoiceInContainer exists: a press that did not take must not be reported as an
      // answer, because the required-field gate is what should then speak for it.
      return await stuck();
    };
    /* AN ANSWER THAT IS A RADIO BUTTON, and the group it is allowed to touch.
     *
     * D-02. Measured on the live Skydio Ashby form (jobs.ashbyhq.com/skydio, 2026-08-09), the same
     * board and the same four questions as production packet 13bccb2d. Ashby renders each EEO
     * question as a real radio group:
     *
     *   <fieldset><label for="_systemfield_eeoc_gender">Gender</label>
     *     <div><span><input type="radio" id="...-labeled-radio-0" name="...eeoc_gender"></span>
     *          <label for="...-labeled-radio-0">Male</label></div>
     *     ... Female, Decline to self-identify
     *
     * Two separate things were wrong and both are fixed here, because either one alone still loses
     * the answer.
     *
     *  1. THE BLOCK THE ANSWER LANDED IN WAS NOT THE QUESTION'S BLOCK. The anchor was
     *     page.getByText(text).first(), and the first element on that page containing the word
     *     "gender" is the EEO preamble - "Skydio provides equal employment opportunities ... without
     *     regard to race, color, religion, sex, gender identity ...". Its nearest ancestor holding an
     *     input is the whole self-identification SECTION, which on the measured form carries eleven
     *     radios spanning two questions: Gender's three and Race's eight. So the Race answer
     *     "Decline to self-identify" matched Gender's "Decline to self-identify" first, in DOM order,
     *     and set the GENDER control - overwriting the gender answer set moments earlier and leaving
     *     Race untouched. An answer landing on a question it was not written for is the worst outcome
     *     available here, and it was happening on every Ashby EEO block in the corpus.
     *
     *  2. THE ANSWER WAS VERIFIED AGAINST A CONTROL NOBODY HAD TOUCHED. After ticking option n, the
     *     branch fell through to verifyFilled(field), and that field is the FIRST input in the block.
     *     For any answer that is not option 0 that reads back unchecked, so a radio that WAS ticked
     *     was reported "value did not persist after fillByLabelText" - the exact line all four Skydio
     *     fields came back with. Same defect class as verifyChoiceInContainer: a verification that
     *     reads a different place from the one the value lands in turns a good fill into a reported
     *     failure.
     *
     * So the option is clicked and read back ON ITSELF, and nothing else is consulted.
     */
    const optionTextOf = async (option) => await option.evaluate((element) => {
      const byFor = element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
      const wrapping = element.closest('label');
      return ((byFor && byFor.textContent) || (wrapping && wrapping.textContent) || element.getAttribute('aria-label') || element.value || '').trim();
    }).catch(() => '');
    /* Ashby paints the radio with a sibling span and leaves the input itself 24x24 and clickable, so
     * check() is enough there. The label click is the fallback for boards that clip the input out of
     * the layout, where check() cannot reach it but a person clicks the words. */
    const pickRadioOption = async (scope, wanted) => {
      if (!clean(wanted)) return 'no-answer';
      const choices = scope.locator('input[type=checkbox], input[type=radio]');
      const total = await choices.count();
      let match = null;
      for (let index = 0; index < total; index += 1) {
        const option = choices.nth(index);
        const optionText = await optionTextOf(option);
        if (optionText && optionMatches(optionText, wanted)) { match = option; break; }
      }
      if (!match) return 'no-option';
      const isChecked = async () => await match.evaluate((element) => element.checked === true).catch(() => false);
      await match.check({ timeout: 5000 }).catch(() => undefined);
      if (!await isChecked()) {
        await match.evaluate((element) => {
          const byFor = element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
          (byFor || element.closest('label') || element).click();
        }).catch(() => undefined);
        await page.waitForTimeout(150).catch(() => undefined);
      }
      return await isChecked() ? 'checked' : 'not-checked';
    };
    /* THE BLOCK THAT OWNS ONE QUESTION'S OPTIONS.
     *
     * Walked up from the question's own label rather than down from a container, because the
     * container is exactly what went wrong above. fieldset, data-field-path, role=radiogroup and
     * role=group are the four ways a board says "these options belong together"; Ashby uses the first
     * two, Greenhouse and Lever use the last two, and a board that says nothing falls back to the
     * container the caller already resolved.
     */
    const questionOptionBlock = async (anchor, fallback) => {
      const block = anchor.locator(
        'xpath=ancestor-or-self::*[(self::fieldset or @data-field-path or @role="radiogroup" or @role="group"'
        + ' or contains(@class,"_fieldEntry_")) and .//input[@type="radio" or @type="checkbox"]][1]'
      ).first();
      if ((await block.count()) > 0) return block;
      return fallback;
    };
    /* Two named radio groups inside one block are TWO QUESTIONS. Radios in one question share a name
     * - that is what makes them mutually exclusive - so more than one name is proof the block is not
     * a single question, and an option list read across it can answer the wrong one. Checkboxes are
     * deliberately not counted: Greenhouse gives every checkbox in a multi-select its own name, so
     * counting them would refuse a control that is working.
     */
    const radioGroupNames = async (scope) => await scope.evaluate((element) => {
      const names = new Set();
      for (const input of element.querySelectorAll('input[type="radio"]')) {
        if (input.name) names.add(input.name);
      }
      return [...names];
    }).catch(() => []);
    // Whether a keystroke aimed at this element can still do the job it was queued for. Only ever
    // asked about Enter on a choice control: see the press branch below.
    const choiceControlIsClosed = async (target) => await target.evaluate((element) => {
      const combobox = element.getAttribute('role') === 'combobox'
        ? element
        : (element.closest('[role="combobox"]') || element.querySelector('[role="combobox"]'));
      if (!combobox) return false;
      return combobox.getAttribute('aria-expanded') !== 'true';
    }).catch(() => false);
    // A control that already holds a matching answer is left alone, and a control that holds ANY
    // answer is never emptied on the way to looking for a better one.
    //
    // A caller sends several candidate values for one control on purpose: a stored major sentence,
    // then the individual fields of study inside it, because only the page knows which of them its
    // taxonomy actually contains. That is only safe if a later, weaker candidate cannot undo an
    // earlier correct one, and until now it could, in two separate ways. Measured on the live Five
    // Rings Greenhouse form (2026-08-08), where "Discipline" was correctly set to "Computer Science"
    // and then emptied again before the run ended:
    //   1. control.fill(''). On a React Select the search box is empty whenever a value is
    //      selected, so Playwright's empty fill lands as a backspace on an empty input, and React
    //      Select's backspaceRemovesValue deletes the selected value. Verified directly: an empty fill
    //      turned "Computer Science" back into the placeholder; typing the next candidate straight
    //      in, with no empty fill first, did not.
    //   2. The clear button. The control list below deliberately includes plain buttons, and a React
    //      Select renders its "Clear selections" indicator as one, sitting inside the same container
    //      as the combobox. Clicking it wiped the answer. Verified directly on the same form.
    // This is one of the two ways '"Discipline" is required and is still empty' was reaching real
    // applications: the right answer was selected and then thrown away by a candidate that matched
    // nothing. The other is the unscoped option click documented inside fillCustomChoice below.
    const CLEAR_CONTROL_RE = /\bclear\b|\bremove\b|\bdeselect\b|\breset\b/;
    const fillCustomChoice = async (container, wanted) => {
      const alreadyAnswered = await readChoiceState(container);
      if (alreadyAnswered.kind === 'chosen' && optionMatches(alreadyAnswered.value, wanted)) return true;
      const controls = container.locator('[role="combobox"], [aria-haspopup="listbox"], .select2-choice, .select2-container, [class*="select2-choice"], [class*="select2-container"], button, [role="button"]');
      // Wait for the menu THIS control owns, then only ever click inside it.
      //
      // The old fallback locator swept the whole page for 'li, [data-value]' and clicked the first
      // node containing the answer text. Measured live on 2026-08-08, opening Discipline on the DRW
      // and Virtu Greenhouse forms with the answer "Computer Science":
      //   DRW   clicked <li>Are pursuing a bachelor's, master's or PhD in mathematics, economics,
      //         physics, statistics, computer science or any engin...</li>
      //   Virtu clicked <li>Excellent academic background in Computer Science, Electrical
      //         Engineering or related field</li>
      // Both are bullet points in the JOB DESCRIPTION. Both made this function return true, so the
      // caller recorded the field as answered, and both controls were still showing "Select..." when
      // the employer's own validator ran. That is where '"Discipline" is required and is still empty'
      // came from on those two boards, with the right option sitting unclicked in the open menu.
      //
      // Two things went wrong together and both are fixed here. The scope was the page rather than
      // the menu; and the correctly scoped attempt was made as an instantaneous count() 150ms after
      // the click, before the menu had rendered, so the page-wide sweep was reached every time. The
      // menu now gets the same bounded grace the optional pre-check already gives asynchronous
      // controls, and there is no page-wide sweep left to fall through to.
      const menuScope = container.locator(
        'xpath=ancestor-or-self::*[contains(@class,"select__container") or contains(@class,"select-shell") or contains(@class,"select2-container")][1]'
      );
      const scopedMenu = (await menuScope.count()) > 0 ? menuScope : undefined;
      // Anything that is genuinely part of an option list. A bare 'li' still qualifies, but only
      // inside a listbox or a select2 results panel, never loose in the page.
      const OPTION_NODES = '[role="option"], [class*="select__option"], [role="listbox"] li,'
        + ' [role="listbox"] [class*="option"], .select2-result, .select2-results li, [class*="select2-result"]';
      const optionsRoot = () => (scopedMenu ?? page).locator(OPTION_NODES);
      // Bounded, and only spent where it can buy something. With a recognisable widget the wait is
      // for THAT widget's own menu and ends the moment it renders. With no recognisable widget there
      // is nothing specific to wait for, so this keeps the old flat pause rather than charging every
      // control on the form the full timeout for a menu that was never coming.
      const waitForMenu = async (timeout) => {
        if (!scopedMenu) {
          await page.waitForTimeout(150).catch(() => undefined);
          return;
        }
        await optionsRoot().first().waitFor({ state: 'visible', timeout }).catch(() => undefined);
      };
      const clickMatchingOption = async (target) => {
        for (const option of answerOptions(target)) {
          const byRole = scopedMenu
            ? scopedMenu.getByRole('option', { name: option, exact: false }).first()
            : page.getByRole('option', { name: option, exact: false }).first();
          if ((await byRole.count()) > 0 && await byRole.isVisible().catch(() => false)) {
            await byRole.click();
            return true;
          }
          const byText = optionsRoot().filter({ hasText: option }).first();
          if ((await byText.count()) > 0 && await byText.isVisible().catch(() => false)) {
            await byText.click();
            return true;
          }
        }
        return false;
      };
      const searchFor = async (control, target) => {
        for (const option of answerOptions(target)) {
          // Only blank the search box when the widget is holding nothing. See (1) above.
          if ((await readChoiceState(container)).kind !== 'chosen') {
            await control.fill('').catch(() => undefined);
          }
          await control.fill(option).catch(async () => {
            await page.keyboard.press('Control+A').catch(() => undefined);
            await page.keyboard.press('Backspace').catch(() => undefined);
            await page.keyboard.type(option, { delay: 5 }).catch(() => undefined);
          });
          // A flat settle here rather than waitForMenu: after typing, the menu is usually ALREADY
          // showing the pre-filter list, so waiting for "a visible option" would return instantly and
          // match against rows the search is about to replace.
          await page.waitForTimeout(1200).catch(() => undefined);
          if (await clickMatchingOption(target)) return true;
        }
        return false;
      };
      const total = await controls.count();
      for (let index = 0; index < total; index += 1) {
        const control = controls.nth(index);
        if (!await control.isVisible().catch(() => false)) continue;
        // See (2) above. A control whose job is to erase the answer can never be the control that
        // sets it, so there is nothing to lose by never touching it.
        const clears = await control.evaluate((element) => {
          const hay = ['aria-label', 'title', 'class', 'data-testid', 'name']
            .map((attribute) => element.getAttribute(attribute) || '')
            .join(' ')
            .toLowerCase();
          return hay;
        }).catch(() => '');
        if (CLEAR_CONTROL_RE.test(clears)) continue;
        await control.click().catch(() => undefined);
        // Sized on measurement, not a guess: on a live Greenhouse education form the asynchronously
        // loaded School and Discipline menus arrived 563ms and 555ms after the control was touched.
        // The old flat 150ms expired before either, which is how the page-wide sweep was reached.
        await waitForMenu(1200);
        if (await clickMatchingOption(wanted)) return true;
        if (await searchFor(control, wanted)) return true;
        await page.keyboard.press('Escape').catch(() => undefined);
      }
      // Belt and braces for anything the two rules above did not anticipate: if this control was
      // answered when we arrived and is not answered now, put the answer back. A candidate that
      // matched nothing must leave the form exactly as it found it.
      if (alreadyAnswered.kind === 'chosen') {
        const now = await readChoiceState(container);
        if (now.kind !== 'chosen') {
          for (let index = 0; index < total; index += 1) {
            const control = controls.nth(index);
            if (!await control.isVisible().catch(() => false)) continue;
            await control.click().catch(() => undefined);
            await page.waitForTimeout(150).catch(() => undefined);
            if (await searchFor(control, alreadyAnswered.value)) break;
            await page.keyboard.press('Escape').catch(() => undefined);
          }
        }
      }
      return false;
    };
    // THE PRE-SUBMIT GATE.
    //
    // Reads the form the way the EMPLOYER's own validator reads it, immediately before the final
    // click, and separates two things that look identical in a screenshot:
    //
    //   1. a required control that is genuinely still empty. This must stop the submit. Pressing
    //      submit here either bounces off client-side validation or, worse, sends an application
    //      with blank answers under the applicant's name.
    //   2. error text left over from an EARLIER validation pass. Measured on the live Redwood
    //      Materials Greenhouse form on 2026-08-08: one stray Enter ran the employer's validator
    //      while the form was half filled, six "is required" messages rendered, and not one of them
    //      cleared when the fields were subsequently filled correctly - "Phone is required." was
    //      still on screen underneath a filled phone number, and the four React Selects still said
    //      "This field is required." underneath their correct answers. Submitting that form then
    //      passed validation cleanly with zero errors.
    //
    // So error TEXT alone is never a reason to refuse. A message blocks only when the control it
    // belongs to is also empty. Refusing on text alone would have thrown away a complete, correct
    // application, which is the same harm as sending a broken one and harder to notice.
    /* ─── the emailed security code ───────────────────────────────────────────────────────────
     *
     * Greenhouse answers an unauthenticated applicant's submit by emailing an 8-character code and
     * rendering a code field on the form: "A verification code was sent to <address>. To submit
     * your application, enter the 8-character code to confirm you're a human." The application is
     * NOT filed until that code is entered and the form is submitted again. Measured on the Cresta
     * preview screenshot of 2026-08-08, and against three code emails from
     * no-reply@us.greenhouse-mail.io timestamped to the same minute as three runs.
     *
     * READ OFF THE CONTROL, NEVER OFF PROSE. Two rules, and both are paid for:
     *   - the trigger is the code INPUT GROUP. A sentence on the page is not evidence: this repo
     *     already shipped a pre-submit gate that keyed on validation TEXT and, on a form carrying
     *     stale "is required" messages over filled fields, would have refused a complete
     *     application. Text is a description of a state, not the state.
     *   - and it is emphatically not the '* indicates a required field' legend, which is on every
     *     Greenhouse form ever rendered, including every form with no challenge at all.
     *
     * The address IS read from prose, and only from the prose inside the control's own group, and
     * only once the control has already been found. It is a detail carried by a state that
     * something else established, never the thing that establishes it.
     */
    const readSecurityCodeChallenge = () => page.evaluate(() => {
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };
      const CODE_NAME = /security\s*code|verification\s*code|one[\s-]*time\s*(code|passcode)|passcode|\botp\b/i;
      const accessibleName = (element) => {
        const labelledBy = element.getAttribute('aria-labelledby');
        const referenced = labelledBy && document.getElementById(labelledBy.split(/\s+/)[0]);
        const own = element.labels && element.labels[0];
        const parts = [
          element.getAttribute('aria-label'),
          referenced && referenced.textContent,
          own && own.textContent,
          element.getAttribute('placeholder'),
          element.getAttribute('name'),
          element.id
        ];
        return parts.map((part) => (part || '').replace(/\s+/g, ' ').trim()).filter(Boolean).join(' ');
      };
      const typed = [...document.querySelectorAll('input')].filter((element) => (
        isVisible(element) && !/checkbox|radio|file|hidden|submit|button|image|reset/.test(element.type || 'text')
      ));
      // (a) The control says what it is. autocomplete="one-time-code" is the platform's own name for
      //     this, and it is what assistive technology and password managers key on too.
      let boxes = typed.filter((element) => /one-time-code/i.test(element.getAttribute('autocomplete') || ''));
      // (b) The boxed pattern: a run of single-character inputs sharing a parent. Four is the
      //     smallest real code length in the wild; Greenhouse renders eight. maxLength === 1 is the
      //     structural signature and no ordinary form field carries it.
      if (boxes.length === 0) {
        const byParent = new Map();
        for (const element of typed) {
          if (element.maxLength !== 1) continue;
          const parent = element.parentElement;
          if (!parent) continue;
          if (!byParent.has(parent)) byParent.set(parent, []);
          byParent.get(parent).push(element);
        }
        for (const group of byParent.values()) {
          if (group.length >= 4 && group.length > boxes.length) boxes = group;
        }
      }
      // (c) A single field that names itself. Last, because it is the weakest signal: it is the only
      //     branch that reads words rather than shape, and it reads only the control's OWN
      //     accessible name, never the page around it.
      if (boxes.length === 0) {
        const named = typed.filter((element) => CODE_NAME.test(accessibleName(element)));
        if (named.length === 1) boxes = named;
      }
      if (boxes.length === 0) return null;
      // Sized off the control when it is a box group, and off its maxlength when it is one field.
      // Never off the sentence, which says "8-character" on Greenhouse today and is free to stop
      // saying it tomorrow.
      const fieldCount = boxes.length > 1 ? boxes.length : (boxes[0].maxLength > 0 ? boxes[0].maxLength : 0);
      // Where the code went. Scoped to the group the control lives in - the nearest ancestor that
      // also holds the explanatory sentence - so an unrelated address elsewhere on the page (a
      // recruiting contact, an anti-fraud notice) cannot be reported as the applicant's.
      let scope = boxes[0].parentElement;
      let address = '';
      for (let depth = 0; depth < 6 && scope; depth += 1) {
        // The label repeats in groups so the trailing sentence stop cannot be eaten as part of the
        // domain: "...sent to mehekmandal05@gmail.com." must not yield an address ending in a dot,
        // which is an address that does not exist and would be shown to the applicant as hers.
        const match = (scope.innerText || '').match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/);
        if (match) { address = match[0]; break; }
        scope = scope.parentElement;
      }
      return {
        kind: 'security_code',
        fieldCount,
        sentTo: address || null,
        // The control's own accessible name, bounded. Diagnostic only: nothing branches on it.
        label: accessibleName(boxes[0]).slice(0, 120) || null
      };
    }).catch(() => null);

    /* WHAT THE PAGE SAID AFTER THE SUBMIT CLICK, READ OFF THE STATE THE ATS RENDERS.
     *
     * Until now nothing in this runner read the answer to "did it go through". The caller scraped
     * the whole body for a confirmation-ish sentence (RECEIPT_PROOF_RE, which matches the bare word
     * "success"), and a run that could not scrape one was reported as unverifiable. That is the
     * wrong instrument twice over: an unsubmitted application page carries plenty of encouraging
     * prose, and a submitted one can confirm without using any of the words in the list.
     *
     * ASHBY, measured 2026-08-09 from the live Skydio posting's own bundle
     * (cdn.ashbyprd.com/frontend_non_user/87a4960/assets/index-BFELy06m.js). On success Ashby mounts
     *
     *     <div class="ashby-application-form-success-container">
     *       <div role="status" aria-live="polite"> Success <p>{applicationSubmittedSuccessMessage}</p>
     *
     * and on refusal the sibling 'ashby-application-form-failure-container', headed "We couldn't
     * submit your application". Both class names are Ashby's published styling hooks - they are
     * enumerated in the bundle as a public API for customer CSS - which is what makes them a
     * legitimate thing to key off rather than a scrape of today's markup. The success SENTENCE is
     * the org's own 'theme.applicationSubmittedSuccessMessage', which for Skydio is "Thank you for
     * submitting your application..." and for an org that has not set one is Ashby's default "Your
     * application was successfully submitted." - so the sentence is per-employer and the CONTAINER
     * is not. The container is what this keys on; the sentence is carried along as the evidence a
     * person can read.
     *
     * The order is strongest evidence first, and every arm names what it saw. An arm that cannot
     * see anything returns 'unknown' rather than guessing, because "we do not know" is a state this
     * system is allowed to be in and a wrong "submitted" is not. */
    const readSubmitOutcome = () => page.evaluate(() => {
      const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
      /* VISIBLE MEANS A PERSON COULD SEE IT, and every cheap approximation of that has already been
       * caught lying here. Requiring width AND height to both be zero passes a container collapsed
       * to zero height with hidden overflow, which is what a React success panel looks like for the
       * whole of its mount-then-animate-open, and for the entire life of one that never opens.
       * Either dimension being zero is enough to disqualify. Zero opacity and a node parked at a
       * large negative offset are the other two ways this markup hides, and all three were measured
       * being reported as confirmed submissions over a live form. */
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) return false;
        if (rect.bottom < 0 || rect.right < 0) return false;
        if (rect.left > (document.documentElement.clientWidth || 0)) return false;
        const style = getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        if (Number(style.opacity) === 0) return false;
        return true;
      };
      const visibleOne = (selector) => [...document.querySelectorAll(selector)].find(isVisible) || null;
      // Published ATS state hooks. One entry per confirmed reading; nothing speculative belongs
      // here, because a wrong entry here writes 'submitted' onto an application nobody received.
      const CONFIRMED_CONTAINERS = ['.ashby-application-form-success-container'];
      const REJECTED_CONTAINERS = ['.ashby-application-form-failure-container'];
      const CONFIRMED_TEXT = /thank you for (?:submitting|applying)|thanks for (?:applying|your application)|your application (?:has been |was )?(?:successfully )?(?:submitted|received)|application (?:has been )?(?:submitted|received)|we(?:'| ha)ve received your application/i;
      const REJECTED_TEXT = /we could ?n[o']?t submit your application|your application could not be submitted|there was a problem (?:submitting|with your application)/i;
      /* THE FORM IS THE COUNTER-WITNESS, so it has to be hard to miss. Probing only for file, email
       * and textarea controls missed a form whose email field is type="text", which is common, and
       * that single miss let the weakest arm below confirm a submission with the Submit button still
       * on the page. A live submit control is the least ambiguous evidence that nothing was sent. */
      const formStillPresent = Boolean(visibleOne([
        'input[type=file]', 'input[type=email]', 'textarea',
        'form button[type=submit]', 'form input[type=submit]',
      ].join(', ')));
      for (const selector of REJECTED_CONTAINERS) {
        const node = visibleOne(selector);
        if (node) return { state: 'rejected', source: 'ats_state', evidence: selector, message: clean(node.innerText).slice(0, 600), formStillPresent };
      }
      /* A CONTAINER IS NOT A CONFIRMATION. Ashby's success container is mounted by the same React
       * tree that renders the form, and an empty one over a live form was being read as a filed
       * application: the worst output this system can produce, because she is told it went and never
       * follows up. Three things have to agree before this arm speaks, and all three were observed
       * disagreeing: the container is visible, it actually says something, and the form it replaces
       * is gone. Any other combination falls through to 'unknown', which is a state the caller now
       * knows how to carry. */
      for (const selector of CONFIRMED_CONTAINERS) {
        const node = visibleOne(selector);
        if (!node) continue;
        const message = clean(node.innerText).slice(0, 600);
        if (!message || formStillPresent) {
          return { state: 'unknown', source: 'ats_state_unconfirmed', evidence: selector, message: message || null, formStillPresent };
        }
        return { state: 'confirmed', source: 'ats_state', evidence: selector, message, formStillPresent };
      }
      // A live region is the page telling assistive technology that something just happened, which
      // is a far narrower claim than "these words appear somewhere on the page". aria-live="off"
      // is the value that means DO NOT announce, so a node carrying it is not the page saying
      // anything; it was matched by the bare [aria-live] selector and confirmed a live form once.
      for (const node of [...document.querySelectorAll('[role=status], [role=alert], [aria-live]:not([aria-live="off"])')]) {
        if (!isVisible(node)) continue;
        const text = clean(node.innerText);
        if (!text) continue;
        if (REJECTED_TEXT.test(text)) return { state: 'rejected', source: 'live_region', evidence: node.getAttribute('role') || 'aria-live', message: text.slice(0, 600), formStillPresent };
        // Gated on the form being gone for the same reason the body-text arm is: an announcement
        // over a form that is still there, still filled and still submittable has not confirmed it.
        if (CONFIRMED_TEXT.test(text) && !formStillPresent) return { state: 'confirmed', source: 'live_region', evidence: node.getAttribute('role') || 'aria-live', message: text.slice(0, 600), formStillPresent };
      }
      /* THE WEAKEST ARM, AND IT IS GATED ON THE FORM BEING GONE. Body text alone was the old
       * instrument and it is the one that has to be able to say no: a confirmation sentence over a
       * form that is still sitting there, still filled, still submittable is not a confirmation. */
      const body = clean(document.body ? document.body.innerText : '');
      if (!formStillPresent && CONFIRMED_TEXT.test(body)) {
        const sentence = (body.match(CONFIRMED_TEXT) || [''])[0];
        return { state: 'confirmed', source: 'page_text', evidence: 'body', message: clean(body.slice(Math.max(0, body.indexOf(sentence)), body.indexOf(sentence) + 400)), formStillPresent };
      }
      return { state: 'unknown', source: null, evidence: null, message: null, formStillPresent };
    }).catch(() => ({ state: 'unknown', source: null, evidence: null, message: null, formStillPresent: null }));

    /* Type a code the applicant supplied into the control found above, and say what happened.
     *
     * Focus-and-type first, because a boxed group auto-advances on input and typing is the one
     * thing every implementation of that widget is built to handle. Per-box filling is the fallback
     * for a group that does not auto-advance, and the whole-value fill is for a single field.
     *
     * NEVER GUESSES A CODE. It types the one it was handed or it reports that it could not. */
    const enterSecurityCode = async (code) => {
      const marked = await page.evaluate(() => {
        const isVisible = (element) => {
          const rect = element.getBoundingClientRect();
          return (rect.width > 0 || rect.height > 0) && getComputedStyle(element).visibility !== 'hidden';
        };
        const typed = [...document.querySelectorAll('input')].filter((element) => (
          isVisible(element) && !/checkbox|radio|file|hidden|submit|button|image|reset/.test(element.type || 'text')
        ));
        let boxes = typed.filter((element) => /one-time-code/i.test(element.getAttribute('autocomplete') || ''));
        if (boxes.length === 0) {
          const byParent = new Map();
          for (const element of typed) {
            if (element.maxLength !== 1) continue;
            const parent = element.parentElement;
            if (!parent) continue;
            if (!byParent.has(parent)) byParent.set(parent, []);
            byParent.get(parent).push(element);
          }
          for (const group of byParent.values()) {
            if (group.length >= 4 && group.length > boxes.length) boxes = group;
          }
        }
        if (boxes.length === 0) return 0;
        boxes.forEach((element, index) => element.setAttribute('data-litos-security-code-box', String(index)));
        return boxes.length;
      }).catch(() => 0);
      if (marked === 0) return 'no_control';
      const first = page.locator('[data-litos-security-code-box="0"]');
      await first.click().catch(() => undefined);
      await page.keyboard.type(code, { delay: 30 }).catch(() => undefined);
      const readBack = () => page.evaluate(() => [...document.querySelectorAll('[data-litos-security-code-box]')]
        .map((element) => element.value || '').join('')).catch(() => '');
      if ((await readBack()) !== code) {
        for (let index = 0; index < marked; index += 1) {
          const value = marked === 1 ? code : (code[index] || '');
          const box = page.locator('[data-litos-security-code-box="' + index + '"]');
          await box.fill(value).catch(() => undefined);
          await box.evaluate((element) => {
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }).catch(() => undefined);
        }
      }
      return (await readBack()) === code ? 'entered' : 'not_entered';
    };

    const readSubmitReadiness = (scope = null) => {
      const scan = (root = document) => {
      const clean = (value) => (value || '').replace(/\s+/g, ' ').trim().replace(/[\s*:]+$/, '');
      const isVisible = (element) => {
        if (!element) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden';
      };
      // The block that owns one question: its label, its control, and its error line.
      //
      // The two Ashby entries are new and are what let this gate see an Ashby question at all. Ashby
      // renders every question as '<div class="_fieldEntry_<hash> ashby-application-form-field-entry"
      // data-field-path="...">', which matches none of the classic selectors above, so widgetOf fell
      // back to element.parentElement - the pill row or the input wrapper - and labelOf then found no
      // <label> inside it and reported the question as unlabelled. 'data-field-path' is Ashby's own
      // per-question attribute and is the more durable of the two; the hashed class is kept because a
      // board serving an older bundle carries the class and not the attribute.
      const widgetOf = (element) => element.closest(
        '[class*="select__container"], .field, .field-wrapper, .file-upload, fieldset, [role="group"],'
        + ' [data-field-path], [class*="_fieldEntry_"]'
      ) || element.parentElement || element;
      /* THE LABEL THAT WRAPS ITS CONTROL AND NEVER NAMES IT.
       *
       * '<label>First name<input required></label>' is a legal HTML label association and carries no
       * "for" attribute, so the byFor lookup below finds nothing, widgetOf falls back to the label
       * itself, and its querySelector('label') then finds no label INSIDE it. Greenhouse's
       * first-name, last-name and resume fields are all built this way. Without this candidate the
       * walk below is all that is left, and it answers with the block's FIRST label, so all three
       * fields came back named "First name" and the message dedupe then collapsed them into one:
       * two genuinely empty required fields vanished from the blocker list entirely.
       *
       * Disqualified when the label wraps MORE than one control, because a label speaking for
       * several controls speaks for none in particular. The legend and aria-labelledby candidates
       * already serve that case.
       */
      const wrappingLabelTextOf = (element) => {
        const wrapper = element && element.closest && element.closest('label');
        if (!wrapper) return '';
        if (wrapper.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"]').length > 1) return '';
        return wrapper.textContent;
      };
      /* The question a control sits under, when the control itself is labelled with nothing useful.
       *
       * Restored here from the end-of-run scan this gate replaced, where it was the only reason an
       * Ashby datepicker blocker read "Are you currently enrolled in a degree program? If so,
       * expected graduation date?" instead of "Pick date...". Losing it would have made the blocker
       * name the widget rather than the question, which is the same defect as naming a UUID.
       *
       * A BLOCK HOLDING MORE THAN ONE CONTROL IS REJECTED, because its first label is then somebody
       * else's. Measured against the SmartRecruiters fixture, whose resume input sits bare inside an
       * <spl-dropzone> with no label of any kind: without this test the walk reached the form's
       * field grid and reported the missing resume as "First Name", so the applicant was told a
       * field she had already filled was empty and never told the resume was missing. A wrong name
       * is worse than no name, so an ambiguous block yields nothing.
       */
      const genericControlText = (value) => /^(pick|select|choose)\s+(date|option)|^(type|enter|write)\s+(your\s+)?(answer\s+)?here/i.test(clean(value));
      const nearestQuestionText = (start) => {
        let block = start && start.parentElement;
        for (let depth = 0; block && depth < 6; depth += 1, block = block.parentElement) {
          if (!block.matches || !block.matches('div, section, li, fieldset')) continue;
          if (block.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"]').length > 1) return '';
          const candidate = block.querySelector('label, legend, .question, h3, h4');
          const text = clean((candidate && candidate.textContent) || '');
          if (text && !genericControlText(text)) return text;
        }
        return '';
      };
      const labelOf = (widget, element) => {
        const labelledBy = (widget && widget.getAttribute('aria-labelledby'))
          || (element && element.getAttribute('aria-labelledby'));
        const referenced = labelledBy && root.querySelector('#' + CSS.escape(labelledBy.split(/\s+/)[0]));
        const byFor = element && element.id && root.querySelector('label[for="' + CSS.escape(element.id) + '"]');
        const legend = widget && widget.querySelector('legend');
        const own = widget && widget.querySelector('label, .label, .upload-label, legend');
        for (const candidate of [
          referenced && referenced.textContent,
          byFor && byFor.textContent,
          legend && legend.textContent,
          own && own.textContent,
          wrappingLabelTextOf(element),
          element && element.getAttribute('aria-label'),
          widget && widget.getAttribute('aria-label'),
          nearestQuestionText(element)
        ]) {
          const text = clean(candidate);
          if (!text) continue;
          if (genericControlText(text)) continue;
          // A machine identifier is not a label. Greenhouse names custom questions with UUIDs and
          // numeric tokens, and "question_19302464004 is required" tells the applicant nothing.
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) continue;
          if (!/[a-z]/i.test(text)) continue;
          return text.slice(0, 120);
        }
        return '';
      };
      // Does the control that was flagged required have an answer? Asked of THE CONTROL, and widened
      // to what surrounds it only where the answer genuinely does not live on the control itself.
      //
      // R-103. This used to be asked of the enclosing WIDGET, and its first check was "does anything
      // inside you render a React Select value". On Greenhouse the phone number input and its
      // country select share one <fieldset class="phone-input">, so an answered country made the
      // whole fieldset read as answered and an empty required #phone was invisible to this gate.
      // Measured live and read-only on the Redwood Materials form, 2026-08-08, with the form
      // otherwise complete: clearing #first_name or #email was caught by name, and clearing #phone
      // produced ZERO blockers. "Phone is required." is one of the six messages from the incident
      // this gate was built for, so the gate was blind to the field it exists to catch. Any required
      // control sharing a block with an answered choice control has the same shape; Greenhouse's
      // phone field is simply the one that ships on every form.
      const CHOICE_SHELL = '[class*="select__container"], [class*="select-shell"]';
      // The value a React Select renders, scoped to that select's OWN shell rather than to the block
      // around it, which is the whole of the fix. Returns null when the element is not a choice
      // control at all, so the caller can fall through rather than treat "not a select" as "empty".
      const chosenValueOf = (element) => {
        const shell = element.closest(CHOICE_SHELL)
          || (element.closest('[class*="select__control"]') || {}).parentElement;
        if (!shell) return null;
        if (shell.querySelector('[class*="select__single-value"], [class*="select__multi-value__label"]')) return true;
        // Still showing "Select...", so nothing was chosen. Returning false rather than falling
        // through stops the question label from being mistaken for an answer.
        if (shell.querySelector('[class*="select__placeholder"]')) return false;
        return null;
      };
      // Greenhouse's uploader REMOVES the file input once the upload finishes and replaces it with a
      // filename chip, so "no input[type=file] with files" is true of a block already given a file.
      // On the embed form the input survives instead and carries the file, so both are checked.
      const uploadHasFile = (scope) => {
        if (!scope) return false;
        if (scope.querySelector('.file-upload__filename, [class*="file-upload__filename"], [aria-label="Remove file" i]')) return true;
        for (const input of scope.querySelectorAll('input[type="file"]')) {
          if (input.files && input.files.length > 0) return true;
        }
        return false;
      };
      /* An option chosen from a row of PLAIN BUTTONS, which is how Ashby renders every yes/no
       * question: '<button>Yes</button><button>No</button>' plus one 'input[type=checkbox]' that is
       * 'display:none' and carries the value. Neither the buttons nor the checkbox has a role, a
       * value or an aria-checked, so nothing above this can tell "No" apart from "unanswered" - the
       * checkbox is unchecked in both cases.
       *
       * The selected pill is marked by a class, and that is the only signal Ashby gives. Verified in
       * Ashby's own stylesheet, 2026-08-09: '._active_1svni_57{background-color:var(--colorPrimary900)
       * ...}' sits in the same CSS module as '._option_1svni_32', the pill class, and is the rule
       * that paints the chosen pill. The hash changes between bundles, so match the module-name
       * fragment rather than the whole class. '_selected_'/'_checked_' and the ARIA states are
       * accepted alongside it because other boards spell the same state those ways, and reading a
       * state that is genuinely set can only make this gate quieter, never louder.
       *
       * Returns null - not false - when the block has no pills at all, so a caller falls through to
       * the real controls instead of treating "not a pill group" as "empty".
       */
      const PILL_SELECTED = /_active_|_selected_|_checked_/;
      const chosenPillOf = (scope) => {
        if (!scope || !scope.querySelectorAll) return null;
        const pills = [...scope.querySelectorAll('button')].filter((button) => {
          const text = clean(button.textContent);
          // Same exclusion list the extension's own Ashby adapter uses: the block also holds upload,
          // remove and submit controls, and a "Submit application" button is not an answer.
          return text.length > 0 && text.length <= 40
            && !/upload|replace|drag|drop|submit|browse|remove|delete|\bsave\b|cancel|\+\s*add/i.test(text);
        });
        if (pills.length === 0) return null;
        return pills.some((pill) => PILL_SELECTED.test(String(pill.className || ''))
          || pill.getAttribute('aria-pressed') === 'true'
          || pill.getAttribute('aria-checked') === 'true'
          || pill.getAttribute('aria-selected') === 'true'
          || /^(?:on|true|active|selected|checked)$/i.test(pill.getAttribute('data-state') || ''));
      };
      const hasAnswer = (element) => {
        if (!element) return false;
        if (['INPUT', 'TEXTAREA', 'SELECT'].includes(element.tagName)) {
          // A combobox input holds the SEARCH text, which react-select clears on selection. Its
          // emptiness says nothing about whether an option was chosen, so read what the select
          // renders instead - but only for THIS select.
          if (element.getAttribute('role') === 'combobox' || element.closest('[class*="select__control"]')) {
            const chosen = chosenValueOf(element);
            if (chosen !== null) return chosen;
          }
          if (element.type === 'hidden') return false;
          if (element.type === 'file') return uploadHasFile(element.parentElement);
          if (element.type === 'checkbox' || element.type === 'radio') {
            if (element.checked) return true;
            // Ashby's hidden yes/no checkbox is unchecked whether the applicant picked "No" or picked
            // nothing, so the pills beside it are the only place the answer is legible. Asked before
            // the peer-group walk because that walk reads the same unchecked inputs.
            const pill = chosenPillOf(widgetOf(element));
            if (pill !== null) return pill;
            if (!element.name) return false;
            // One answered radio answers its whole group, and only the checked member carries it.
            for (const peer of (element.form || document).querySelectorAll('input[name="' + CSS.escape(element.name) + '"]')) {
              if (peer.checked) return true;
            }
            return false;
          }
          return Boolean(clean(element.value));
        }
        // Not a form control at all. Greenhouse marks its uploader required with a
        // <div role="group" aria-required="true"> and leaves the file input itself unmarked, so the
        // flagged element is a container. This is the one case where widening is the right answer,
        // because a container has no value of its own to read.
        if (uploadHasFile(element)) return true;
        const chosen = chosenValueOf(element);
        if (chosen !== null) return chosen;
        const pill = chosenPillOf(element);
        if (pill !== null) return pill;
        for (const control of element.querySelectorAll('input:not([type="hidden"]), textarea, select')) {
          if (hasAnswer(control)) return true;
        }
        return false;
      };
      const required = [];
      const seen = new Set();
      // Keyed on the CONTROL, not the block, so a block holding two required controls can report
      // both. Greenhouse's phone fieldset holds exactly that: the country select and the number.
      // The error scan below hands back the same element object the required scan flagged, so the
      // two still do not report one field twice.
      // A checkbox or radio GROUP is one question wearing many inputs, and every one of them is
      // "required and still empty" until one is chosen. Reporting each separately turned three
      // unanswered Greenhouse questions into seventeen blockers named after their options, and on
      // Lever's 34-language checkbox list it turns one question into thirty-four. The end-of-run
      // scan this gate replaced deduped on the group name for exactly that reason; keying 'seen' on
      // the control alone lost it, so the group name is carried here too.
      const reportedGroups = new Set();
      const note = (widget, element, why) => {
        const key = element || widget;
        if (!key || seen.has(key)) return;
        seen.add(key);
        if (!isVisible(widget)) return;
        // After the visibility test, so an invisible member cannot claim the group and silence the
        // visible one beside it.
        const groupName = element
          && (element.type === 'checkbox' || element.type === 'radio')
          && element.name
          ? element.name
          : '';
        if (groupName) {
          if (reportedGroups.has(groupName)) return;
          reportedGroups.add(groupName);
        }
        if (hasAnswer(element)) return;
        const label = labelOf(widget, element);
        required.push({
          label,
          why,
          message: label
            ? '"' + label + '" is required and is still empty'
            : 'A required field on the form has no label Litos can read, and is still empty'
        });
      };
      // Native required, plus aria-required. React Select's input carries aria-required="true" and
      // no a "required" attribute at all, so a gate built only on [required] cannot see an unanswered
      // Greenhouse screener question - which is precisely the control this gate exists to catch.
      for (const element of root.querySelectorAll(
        'input[required], textarea[required], select[required], [aria-required="true"]'
      )) {
        if (element.disabled) continue;
        if (!isVisible(element) && !isVisible(widgetOf(element))) continue;
        note(widgetOf(element), element, 'required');
      }
      /* D-01. THE REQUIRED MARKER THAT IS NEITHER AN ATTRIBUTE NOR AN ARIA STATE.
       *
       * Measured on the live Deepgram Ashby posting, 2026-08-09, the form behind the packet that
       * shipped as "Done - 5 checked" with three required fields empty: SIX controls carry the
       * 'required' attribute and ZERO carry aria-required. The three empty ones - "Current Location",
       * and the two work-eligibility yes/no questions - carry neither, so both loops above are blind
       * to them and the run reported no blockers at all.
       *
       * Ashby marks a required question with a class on the question's own <label>, and paints the
       * asterisk from it: '._required_f7cvd_91:after{color:var(--colorNegative600);content:"*"}',
       * read out of Ashby's stylesheet on the same day. Three hashed variants of that rule ship in
       * one bundle ('_required_f7cvd_91', '_required_1e3gg_37', '_required_kyg4m_26'), so the match
       * is on the module-name fragment, not on a whole class name.
       *
       * WHY THIS IS NOT THE 2026-08-08 MISTAKE. An earlier pre-submit gate matched the form's own
       * legend text, "* indicates a required field", and so would have refused EVERY Greenhouse
       * submission there is (see LEGEND_TEXT below, which is what remains of it). This reads no page
       * text whatsoever. It reads a class on ONE specific question's label element, which is the same
       * kind of per-control machine signal as 'required' and 'aria-required' - the employer's own
       * markup saying "this field, in particular". It cannot fire on a page-level notice because a
       * page-level notice is not a field label, and it cannot fire on a form that does not use this
       * convention because the class simply is not there. Greenhouse, Lever, Workable, SmartRecruiters
       * and the rest render no '_required_' class at all, so on those families this loop finds nothing
       * and the two above continue to do all the work.
       *
       * note() dedupes on the control, so a field caught by BOTH the attribute loop and this one is
       * still reported once.
       */
      // Shared by both marker loops: the control a marked label speaks for, handed to note().
      // 'for=' first, because Ashby sets it even where the input it names has no id of its own (the
      // location combobox), in which case the lookup misses and the block's first real control is
      // the right answer. A file input is excluded from the fallback for the same reason hasAnswer
      // treats uploads specially: the widget, not the input, is what holds the evidence of an
      // upload. widgetFallback is the block itself, and is passed only by the class arm below.
      const noteMarkedLabel = (marker, widgetFallback) => {
        const widget = widgetOf(marker);
        if (!widget || !isVisible(widget)) return;
        const named = marker.getAttribute('for');
        const target = (named && widget.querySelector('#' + CSS.escape(named)))
          || widget.querySelector('input:not([type="hidden"]):not([type="file"]), textarea, select, [role="combobox"]')
          || (widgetFallback ? widget : null);
        if (!target || target.disabled) return;
        note(widget, target, 'required');
      };
      for (const marker of root.querySelectorAll('label[class*="_required_"], legend[class*="_required_"]')) {
        // An Ashby question block with no readable control still has to block, which is where PR #22
        // measured this arm.
        noteMarkedLabel(marker, true);
      }
      /* AND THE SAME MARK ON GREENHOUSE, WHERE IT IS A LITERAL ASTERISK IN THE LABEL TEXT.
       *
       * Ashby's asterisk is a ':after' pseudo-element and appears in no label text, which is why the
       * arm above reads a class. Greenhouse prints the character itself: measured read-only on the
       * live zscaler posting, 19 of its 30 labels carry a standalone "*", and on yugabyte 3 of 23.
       * So the same employer statement, "this field in particular", is spelled two different ways
       * and a gate that knows only one of them is blind on the other family. Both are per-control:
       * this reads the text of ONE <label> or <legend> that speaks for ONE control, never the page.
       *
       * THE 2026-08-08 MISTAKE IS THE ONE NOT TO REPEAT. The form's own legend, "* indicates a
       * required field", was the ONLY thing an early gate found on a complete application, and
       * refusing there would have blocked every Greenhouse submission there is. A page-level notice
       * is a <p>, not a label, so it cannot reach this loop at all; ASTERISK_LEGEND excludes the
       * same sentence a second time for the boards that do print it inside a label block.
       *
       * No widget fallback here, because "a <label> somewhere carries a star and I could not find
       * its control" is not evidence that an application is incomplete.
       *
       * The asterisk test is labelMarksRequired's, character for character (the backend's
       * questionDiscovery.ts), so discovery and this gate cannot disagree about which fields the
       * employer marked required.
       *
       * MEASURED CONTRIBUTION, read-only against live forms on 2026-08-09. On the zscaler and
       * yugabyte Greenhouse postings this loop adds ZERO blockers: every field it finds already
       * carries 'required' or aria-required, so the whole gate returns the same 21 and 3 messages it
       * returned without it. On the Deepgram, Ramp and Linear Ashby forms it matches ZERO labels,
       * because Ashby prints no asterisk anywhere. It earns its place on the one shape neither
       * attribute loop can see: a Greenhouse screener question marked with a red asterisk and
       * nothing else.
       */
      const ASTERISK_MARK = /\*(?:\s|$)|(?:^|\s)\*/;
      const ASTERISK_LEGEND = /\*\s*(?:indicates|denotes|means|marks|=)/i;
      for (const marker of root.querySelectorAll('label, legend')) {
        const markerText = (marker.textContent || '').replace(/\s+/g, ' ').trim();
        if (!ASTERISK_MARK.test(markerText) || ASTERISK_LEGEND.test(markerText)) continue;
        noteMarkedLabel(marker, false);
      }
      // Visible validation messages, matched back to the control they accuse. An unmatched message,
      // or one over an empty control, blocks; one over a filled control is stale and is only
      // reported.
      const stale = [];
      const unmatched = [];
      const ERROR_TEXT = /\bis required\b|\brequired field\b|\bplease (?:select|enter|complete|choose|provide)\b|\bcannot be blank\b/i;
      // A form's own legend says "* indicates a required field", and it matched the line above.
      // Measured on the live Redwood Materials form: that legend was the ONLY thing the gate found
      // on a completely and correctly filled application, so the gate would have refused to submit
      // every Greenhouse application there is. A gate that blocks everything is not caution.
      const LEGEND_TEXT = /\bindicates?\b|\bdenotes?\b|\bfields?\s+marked\b|\ball fields\b/i;
      for (const element of root.querySelectorAll('*')) {
        if (element.children.length > 0) continue;
        const text = clean(element.textContent);
        if (!text || text.length > 160 || !ERROR_TEXT.test(text) || LEGEND_TEXT.test(text)) continue;
        if (!isVisible(element)) continue;
        // The label of a required question reads "... *", never "is required", so this does not pick
        // up labels. It picks up the error line the form renders under the control.
        const widget = widgetOf(element);
        if (!widget || widget === element) { unmatched.push(text); continue; }
        // A message sitting in a block that holds no control at all is not a field error. It is the
        // form's legend or a page-level notice, and attributing it to a field invents a blocker.
        const controls = [...widget.querySelectorAll('input:not([type="hidden"]), textarea, select, [role="combobox"]')];
        if (controls.length === 0) continue;
        // WHICH control does the message accuse? A block can hold several: Greenhouse's phone field
        // is a fieldset holding the country select and the number, and its uploader holds both the
        // resume and the cover letter. Reading the block as a whole gets this wrong in both
        // directions, so prefer a control that says it is required and is still empty.
        const marked = controls.filter((candidate) => candidate.required || candidate.getAttribute('aria-required') === 'true');
        let culprit = null;
        if (marked.length > 0) {
          culprit = marked.find((candidate) => !hasAnswer(candidate)) || null;
        } else if (!controls.some((candidate) => hasAnswer(candidate))) {
          // Nothing here claims to be required, so the message is the only signal there is. It may
          // block, but only when NOTHING in the block has been answered. Blaming an empty OPTIONAL
          // control (a cover letter sitting beside a filled resume) for someone else's message is
          // how a complete application gets refused, which is the harm this gate exists to avoid.
          culprit = controls[0];
        }
        if (!culprit) { stale.push(text); continue; }
        // note() keys on the control, and this is the same element object the required scan flags,
        // so a field already reported is not reported twice for carrying the matching error line.
        note(widget, culprit, 'error');
      }
      return {
        // Deduped by message, because keying on the control means one React Select can be flagged
        // twice: an unanswered one carries aria-required on BOTH its combobox input and the hidden
        // input react-select keeps beside it, and the two resolve to the same question and the same
        // label. Measured on the empty live Redwood form: 15 entries covering 8 distinct fields.
        blocking: [...new Set(required.map((entry) => entry.message))],
        stale: [...new Set(stale)],
        unmatched: [...new Set(unmatched.filter((text) => !stale.includes(text)))]
      };
      };
      const failed = { blocking: ['Required-field readiness scan failed'], stale: [], unmatched: [] };
      return scope ? scope.evaluate(scan).catch(() => failed) : page.evaluate(scan).catch(() => failed);
    };
    /* Commit answers that the page paints as filled while its own validation still calls them
     * unanswered. This action does not search for a convenient place to click. It marks the exact
     * affected control in the current DOM, commits that control using events appropriate to its
     * field type, then reads the same validation state back. An unresolved control is proof of
     * failure and the following submit is withheld. */
    const confirmAndSubmitPass = async (action) => {
      const choices = await page.locator(action.selector).evaluateAll((elements, submitKind) => elements.map((element, index) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        const visible = (rect.width > 0 || rect.height > 0) && style.display !== 'none' && style.visibility !== 'hidden';
        const form = element.closest('form');
        const text = String(element.innerText || element.value || element.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
        const formText = String((form && (form.id + ' ' + form.className + ' ' + form.getAttribute('action'))) || '').toLowerCase();
        const normalizedText = text.toLowerCase();
        const handoffVerbProvider = /\b(?:apply|autofill|continue|import)\s+(?:handshake|symplicity|linkedin|indeed|seek|glassdoor|ziprecruiter|monster|xing|stepstone|google|facebook|github|apple|greenhouse|workday|workable|ashby|smartrecruiters|okta|microsoft|sso)\b/.test(normalizedText);
        const thirdPartyHandoff = /\b(?:apply|submit|send|autofill|sign\s?in|log\s?in|continue|register|import)\b(?:\s+\w+){0,4}\s+(?:with|using|via|from)\s+(?!(?:(?:the|your|my|a|an)\s+)?(?:attachments?|resumes?|cvs?|cover\s+letters?|documents?|files?|e-?signature|profiles?|accounts?|saved\s+(?:details|information))\b)|\bquick apply\b|\bone[-\s]?click apply\b|\bpowered\s+by\b/.test(normalizedText);
        const supportWidget = /\bapplication\s+(?:feedback|survey|issue|question|review|experience)\b|\bfeedback\s+on\s+your\s+application\b|^(?!.*\bapplication\b).*\b(?:feedback|request|ticket|comment|search|report|question|issue|review|rating|survey|contact|bug)\b/.test(normalizedText);
        const handoff = handoffVerbProvider || thirdPartyHandoff || supportWidget;
        const finalApplication = /^(?:submit|send)\s+(?:(?:your|my|the)\s+)?application$/.test(normalizedText);
        const finalVerification = /^(?:verify(?:\s+(?:code|email|identity|application))?|confirm\s+(?:code|email|identity|application)|submit\s+(?:verification|code)|(?:submit|send)\s+(?:(?:your|my|the)\s+)?application)$/.test(normalizedText);
        const finalIntent = submitKind === 'verification' ? finalVerification : finalApplication;
        let score = 0;
        if (finalIntent) score += 100;
        if (/application|apply|job|career|greenhouse|lever|ashby/.test(formText)) score += 40;
        if (/newsletter|subscribe|search|login|sign in|coupon/.test(normalizedText + ' ' + formText)) score -= 100;
        element.setAttribute('data-litos-submit-candidate-v2', String(index));
        return { index, visible, disabled: Boolean(element.disabled || element.getAttribute('aria-disabled') === 'true'), hasForm: Boolean(form), finalIntent, handoff, text, formText, score };
      }), action.submitKind).catch(() => null);
      const viable = Array.isArray(choices) ? choices.filter((choice) => choice.visible && !choice.disabled && choice.hasForm && choice.finalIntent && !choice.handoff) : [];
      viable.sort((a, b) => b.score - a.score || a.index - b.index);
      const selected = viable[0];
      const ambiguous = !selected || (viable[1] && viable[1].score === selected.score);
      if (ambiguous) throw new Error('Atomic submit control was missing or ambiguous');
      const submitLocator = page.locator('[data-litos-submit-candidate-v2="' + selected.index + '"]');
      const submitHandle = await submitLocator.elementHandle();
      const scope = submitLocator.locator('xpath=ancestor::form[1]');
      if (!submitHandle || await scope.count() !== 1) throw new Error('Atomic submit control had no exact application form');
      const formHandle = await scope.elementHandle();
      const binding = await submitHandle.evaluate((element) => {
        const form = element.closest('form');
        const formShape = {
          id: form.id || null,
          action: form.getAttribute('action') || null,
          method: form.getAttribute('method') || null,
          controls: [...form.querySelectorAll('input, textarea, select, button, [role="button"]')].map((control) => ({
            tag: control.tagName.toLowerCase(), id: control.id || null, name: control.getAttribute('name') || null,
            type: control.getAttribute('type') || null, label: control.getAttribute('aria-label') || null
          }))
        };
        const submitShape = { tag: element.tagName.toLowerCase(), id: element.id || null, name: element.getAttribute('name') || null, type: element.getAttribute('type') || null, text: String(element.innerText || element.value || '').replace(/\s+/g, ' ').trim() };
        return { formShape, submitShape };
      });
      const formFingerprint = crypto.createHash('sha256').update(JSON.stringify(binding.formShape)).digest('hex');
      const submitFingerprint = crypto.createHash('sha256').update(formFingerprint + ':' + JSON.stringify(binding.submitShape)).digest('hex');
      const candidates = await scope.evaluate((root, boundFingerprint) => {
        const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
        const isVisible = (element) => {
          if (!element) return false;
          const rect = element.getBoundingClientRect();
          const style = getComputedStyle(element);
          return (rect.width > 0 || rect.height > 0) && style.display !== 'none' && style.visibility !== 'hidden';
        };
        const widgetOf = (element) => element.closest(
          '[class*="select__container"], .field, .field-wrapper, fieldset, [role="group"],'
          + ' [data-field-path], [class*="_fieldEntry_"]'
        ) || element.parentElement || element;
        const labelOf = (element, widget) => {
          const labelledBy = element.getAttribute && element.getAttribute('aria-labelledby');
          const referenced = labelledBy && document.getElementById(labelledBy.split(/\s+/)[0]);
          const byFor = element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
          const wrapping = element.closest && element.closest('label');
          const own = widget.querySelector && widget.querySelector('legend, label, .question, h3, h4');
          return clean(
            (referenced && referenced.textContent)
            || (byFor && byFor.textContent)
            || (wrapping && wrapping.textContent)
            || element.getAttribute?.('aria-label')
            || (own && own.textContent)
          ).slice(0, 120);
        };
        const chosenValue = (element, widget) => {
          if (element instanceof HTMLInputElement && (element.type === 'radio' || element.type === 'checkbox')) {
            if (element.checked) return true;
            if (element.name) {
              return [...(element.form || document).querySelectorAll('input[name="' + CSS.escape(element.name) + '"]')]
                .some((peer) => peer.checked);
            }
            return false;
          }
          if (element instanceof HTMLSelectElement) return Boolean(clean(element.value));
          if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
            if (element instanceof HTMLInputElement && element.type === 'file') return Boolean(element.files && element.files.length > 0);
            const shell = element.closest('[class*="select__container"], [class*="select-shell"]');
            if (shell && shell.querySelector('[class*="select__single-value"], [class*="select__multi-value__label"]')) return true;
            return Boolean(clean(element.value));
          }
          const uploadedFile = element.querySelector && element.querySelector('input[type="file"]');
          if (uploadedFile && uploadedFile.files && uploadedFile.files.length > 0) return true;
          if (element.querySelector && element.querySelector('.file-upload__filename, [class*="file-upload__filename"], [aria-label="Remove file" i]')) return true;
          return Boolean(widget.querySelector(
            'input:checked, [aria-checked="true"], [aria-selected="true"], [aria-pressed="true"],'
            + ' [class*="select__single-value"], [class*="select__multi-value__label"],'
            + ' button[class*="_active_"], button[class*="_selected_"], button[class*="_checked_"]'
          ));
        };
        const errorText = (widget) => [...widget.querySelectorAll('*')].some((node) => {
          if (node.children.length > 0 || !isVisible(node)) return false;
          const text = clean(node.textContent);
          return text.length <= 160 && /\bis required\b|\brequires an answer\b|\brequired field\b|\bplease (?:select|enter|complete|choose|provide)\b|\bcannot be blank\b/i.test(text);
        });
        const affected = (element, widget) => {
          const nativeMissing = Boolean(element.validity && element.validity.valueMissing);
          return nativeMissing || element.getAttribute?.('aria-invalid') === 'true' || errorText(widget);
        };
        const controls = new Set(root.querySelectorAll(
          'input[required], textarea[required], select[required], [aria-required="true"]'
        ));
        for (const marker of root.querySelectorAll('label[class*="_required_"], legend[class*="_required_"]')) {
          const block = widgetOf(marker);
          const named = marker.getAttribute('for');
          const control = (named && document.getElementById(named))
            || block.querySelector('input:not([type="hidden"]), textarea, select, [role="combobox"]')
            || block;
          if (control && root.contains(control)) controls.add(control);
        }
        const ASTERISK_MARK = /\*(?:\s|$)|(?:^|\s)\*/;
        const ASTERISK_LEGEND = /\*\s*(?:indicates|denotes|means|marks|=)/i;
        for (const marker of root.querySelectorAll('label, legend')) {
          const text = clean(marker.textContent);
          if (!ASTERISK_MARK.test(text) || ASTERISK_LEGEND.test(text)) continue;
          const block = widgetOf(marker);
          const named = marker.getAttribute('for');
          const control = (named && document.getElementById(named))
            || block.querySelector('input:not([type="hidden"]), textarea, select, [role="combobox"]')
            || block;
          if (control && root.contains(control)) controls.add(control);
        }
        const out = [];
        let index = 0;
        const seenGroups = new Set();
        for (const element of controls) {
          const widget = widgetOf(element);
          if (!isVisible(widget)) continue;
          const groupName = element instanceof HTMLInputElement && /radio|checkbox/.test(element.type) && element.name
            ? element.name
            : '';
          if (groupName && seenGroups.has(groupName)) continue;
          if (groupName) seenGroups.add(groupName);
          index += 1;
          const marker = 'litos-required-confirm-' + index;
          element.setAttribute('data-litos-required-confirm', marker);
          const rawType = element instanceof HTMLInputElement ? (element.type || 'text').toLowerCase() : '';
          const type = element.getAttribute?.('role') === 'combobox'
            ? 'combobox'
            : element instanceof HTMLSelectElement
            ? 'select'
            : element instanceof HTMLInputElement
              ? rawType === 'radio' || rawType === 'checkbox' || rawType === 'file'
                ? rawType
                : /^(?:date|month|week|time|datetime-local)$/.test(rawType)
                  ? 'date'
                  : 'text'
              : element instanceof HTMLTextAreaElement
                ? 'text'
                : element.querySelector?.('input[type="file"]')
                  ? 'file'
                  : 'custom';
          const ownId = element.id && /^[A-Za-z_][\w:-]*$/.test(element.id) ? '#' + element.id : null;
          const ownName = element.getAttribute?.('name');
          const pathOwner = element.closest?.('[data-field-path]');
          const fieldPath = pathOwner && pathOwner.getAttribute('data-field-path');
          const quotedSelector = (attribute, value) => {
            if (!value || /[\r\n]/.test(value)) return null;
            if (!value.includes('"')) return '[' + attribute + '="' + value + '"]';
            if (!value.includes("'")) return '[' + attribute + "='" + value + "']";
            return null;
          };
          const nameSelector = quotedSelector('name', ownName);
          const pathSelector = quotedSelector('data-field-path', fieldPath);
          let durableSelector = ownId && root.querySelectorAll(ownId).length === 1
            ? ownId
            : nameSelector && root.querySelectorAll(nameSelector).length === 1
              ? nameSelector
              : pathSelector && root.querySelectorAll(pathSelector).length === 1
                ? pathSelector
                : null;
          if (!durableSelector) {
            // The fallback identity is opaque but deterministic for this exact form scan. It is
            // bound to the form fingerprint and DOM-order index, so it cannot be mistaken for a
            // portal-owned selector or silently reused after the form shape changes.
            const stableId = 'v2-' + boundFingerprint.slice(0, 24) + '-' + index;
            element.setAttribute('data-litos-stable-id-v1', stableId);
            const stableSelector = '[data-litos-stable-id-v1="' + stableId + '"]';
            if (root.querySelectorAll(stableSelector).length === 1) durableSelector = stableSelector;
          }
          out.push({
            marker,
            selector: durableSelector,
            label: labelOf(element, widget) || null,
            fieldType: type === 'combobox' ? 'react-select' : type,
            answered: chosenValue(element, widget),
            affected: affected(element, widget)
          });
        }
        return out;
      }, formFingerprint).catch(() => null);
      if (!Array.isArray(candidates)) throw new Error('Atomic required-field scan failed');
      const requiredControls = candidates.filter((candidate) => candidate.selector).map((candidate) => ({
        selector: candidate.selector,
        label: candidate.label,
        fieldType: candidate.fieldType,
        matchCount: 1
      }));
      const attempts = [];
      const unresolved = [];
      let retries = 0;
      for (const candidate of candidates) {
        const runtimeSelector = '[data-litos-required-confirm="' + candidate.marker + '"]';
        const target = page.locator(runtimeSelector).first();
        const proofSelector = candidate.selector || '';
        const fieldType = candidate.fieldType;
        if (!proofSelector) {
          unresolved.push(candidate.label || 'Selectorless required field');
          continue;
        }
        if (await target.count() !== 1) {
          attempts.push({ selector: proofSelector, label: candidate.label, fieldType, outcome: 'failed', attemptCount: 1, reason: 'required control selector did not resolve exactly once' });
          unresolved.push(candidate.label || proofSelector);
          continue;
        }
        if (!candidate.answered) {
          attempts.push({ selector: proofSelector, label: candidate.label, fieldType, outcome: 'failed', attemptCount: 1, reason: 'required field is empty' });
          unresolved.push(candidate.label || proofSelector);
          continue;
        }
        if (!candidate.affected) {
          attempts.push({ selector: proofSelector, label: candidate.label, fieldType, outcome: 'already_committed', attemptCount: 1 });
          continue;
        }
        let outcome = 'still_requires_answer';
        const maxAttempts = 1 + action.maxRetries;
        let attemptNumber = 0;
        for (; attemptNumber < maxAttempts; attemptNumber += 1) {
          let answerPreserved = true;
          if (fieldType === 'radio') {
            await target.evaluate((element) => {
              const selected = element.checked ? element : (element.form || document).querySelector('input[name="' + CSS.escape(element.name) + '"]:checked');
              const label = selected && selected.id && document.querySelector('label[for="' + CSS.escape(selected.id) + '"]');
              (label || selected)?.click();
              selected?.blur();
            }).catch(() => undefined);
          } else if (fieldType === 'react-select') {
            await target.click({ timeout: 2000 }).catch(() => undefined);
            await target.press('Escape').catch(() => undefined);
            await target.evaluate((element) => element.blur()).catch(() => undefined);
          } else if (fieldType === 'custom') {
            answerPreserved = await target.evaluate((element) => {
              const selected = element.querySelector(
                '[aria-checked="true"], [aria-selected="true"], [aria-pressed="true"],'
                + ' button[class*="_active_"], button[class*="_selected_"], button[class*="_checked_"]'
              );
              if (!selected) return false;
              const semanticText = String(selected.textContent || '').replace(/\s+/g, ' ').trim();
              selected.setAttribute('data-litos-confirm-custom-option', '1');
              const remainsSelected = () => {
                const current = element.querySelector('[data-litos-confirm-custom-option="1"]');
                if (!current) return false;
                const selectedState = current.getAttribute('aria-checked') === 'true'
                  || current.getAttribute('aria-selected') === 'true'
                  || current.getAttribute('aria-pressed') === 'true'
                  || /_active_|_selected_|_checked_/.test(String(current.className || ''));
                return selectedState && String(current.textContent || '').replace(/\s+/g, ' ').trim() === semanticText;
              };
              selected.focus();
              selected.click();
              if (!remainsSelected()) selected.click();
              selected.blur();
              return remainsSelected();
            }).catch(() => false);
          } else if (fieldType === 'file') {
            answerPreserved = await target.evaluate((element) => {
              const input = element.matches?.('input[type="file"]') ? element : element.querySelector?.('input[type="file"]');
              if (input && input.files && input.files.length > 0) return true;
              return Boolean(element.querySelector?.('.file-upload__filename, [class*="file-upload__filename"], [aria-label="Remove file" i]'));
            }).catch(() => false);
          } else {
            await target.evaluate((element) => {
              element.focus();
              element.dispatchEvent(new Event('input', { bubbles: true }));
              element.dispatchEvent(new Event('change', { bubbles: true }));
              element.blur();
            }).catch(() => undefined);
          }
          await page.waitForTimeout(150).catch(() => undefined);
          const stillAffected = !answerPreserved || await target.evaluate((element) => {
            const clean = (value) => String(value || '').replace(/\s+/g, ' ').trim();
            const visible = (node) => {
              const rect = node.getBoundingClientRect();
              const style = getComputedStyle(node);
              return (rect.width > 0 || rect.height > 0) && style.display !== 'none' && style.visibility !== 'hidden';
            };
            const widget = element.closest(
              '[class*="select__container"], .field, .field-wrapper, fieldset, [role="group"],'
              + ' [data-field-path], [class*="_fieldEntry_"]'
            ) || element.parentElement || element;
            const hasError = [...widget.querySelectorAll('*')].some((node) => {
              if (node.children.length > 0 || !visible(node)) return false;
              const text = clean(node.textContent);
              return text.length <= 160 && /\bis required\b|\brequires an answer\b|\brequired field\b|\bplease (?:select|enter|complete|choose|provide)\b|\bcannot be blank\b/i.test(text);
            });
            return Boolean((element.validity && element.validity.valueMissing) || element.getAttribute('aria-invalid') === 'true' || hasError);
          }).catch(() => true);
          if (!stillAffected) { outcome = 'confirmed'; break; }
          if (attemptNumber + 1 < maxAttempts) retries = 1;
        }
        if (outcome === 'confirmed') {
          attempts.push({ selector: proofSelector, label: candidate.label, fieldType, outcome: 'confirmed', attemptCount: attemptNumber + 1 });
        } else {
          attempts.push({ selector: proofSelector, label: candidate.label, fieldType, outcome: 'failed', attemptCount: maxAttempts, reason: 'This requires an answer' });
          unresolved.push(candidate.label || proofSelector);
        }
      }
      // The same exhaustive detector used by prepare-time readiness is read again against this
      // exact bound form. No newsletter, search, or login form can contribute a blocker here.
      const scopedReadiness = await readSubmitReadiness(scope);
      unresolved.push(...scopedReadiness.blocking, ...scopedReadiness.unmatched.map(
        (text) => 'The bound application form still shows an unmatched validation error: ' + text
      ));
      const sameNode = Boolean(formHandle) && await submitHandle.evaluate(
        (element, boundForm) => element.isConnected && element.closest('form') === boundForm,
        formHandle
      ).catch(() => false);
      let blockerReason = null;
      if (!sameNode) {
        blockerReason = 'submit_node_replaced';
        unresolved.push('Bound submit control or application form was replaced before submission');
      } else {
        const currentBinding = await submitHandle.evaluate((element) => {
          const form = element.closest('form');
          return {
            formShape: {
              id: form.id || null,
              action: form.getAttribute('action') || null,
              method: form.getAttribute('method') || null,
              controls: [...form.querySelectorAll('input, textarea, select, button, [role="button"]')].map((control) => ({
                tag: control.tagName.toLowerCase(), id: control.id || null, name: control.getAttribute('name') || null,
                type: control.getAttribute('type') || null, label: control.getAttribute('aria-label') || null
              }))
            },
            submitShape: { tag: element.tagName.toLowerCase(), id: element.id || null, name: element.getAttribute('name') || null, type: element.getAttribute('type') || null, text: String(element.innerText || element.value || '').replace(/\s+/g, ' ').trim() }
          };
        }).catch(() => null);
        const currentFormFingerprint = currentBinding && crypto.createHash('sha256').update(JSON.stringify(currentBinding.formShape)).digest('hex');
        const currentSubmitFingerprint = currentBinding && crypto.createHash('sha256').update(currentFormFingerprint + ':' + JSON.stringify(currentBinding.submitShape)).digest('hex');
        if (currentFormFingerprint !== formFingerprint || currentSubmitFingerprint !== submitFingerprint) {
          blockerReason = 'form_identity_changed';
          unresolved.push('Bound application form or submit identity changed during confirmation');
        }
      }
      const blocked = unresolved.length > 0;
      if (!blocked) await submitHandle.click({ timeout: action.timeout || 10_000 });
      return {
        pass: {
          submitKind: action.submitKind,
          scope: {
            formFingerprint,
            submitFingerprint,
            formMatchCount: 1,
            submitMatchCount: 1,
            requiredControlCount: requiredControls.length,
            sameNode
          },
          requiredControls,
          attempts,
          retries,
          unresolved: [...new Set(unresolved)],
          ...(blockerReason ? { blockerReason } : {}),
          submissionOutcome: blocked ? 'blocked' : 'clicked'
        }
      };
    };
    // A click is the final submit when the caller says so, or when it targets a submit control.
    // Both, rather than either, because the label is the caller's declared intent and the selector
    // is what actually gets pressed, and a gate that can be walked around by omitting a label is
    // not a gate.
    const isFinalSubmitAction = (action) => action.type === 'click' && (
      action.label === 'final_submit'
      || /\[\s*type\s*[~^$*|]?=\s*["']?submit/i.test(action.selector || '')
    );
    // R-100. The optional pre-check is 'await locator.count() === 0', an instantaneous DOM snapshot
    // with no auto-wait, and it used to apply to waitForSelector too. That cancelled the one action
    // whose entire job is to wait, by answering "not there" before its timeout ever started. Two
    // callers depend on that wait:
    //   - 'greenhouse_application_form_ready', an optional waitForSelector on the email and resume
    //     fields, queued right after clicking 'Apply for this job' because Greenhouse renders the
    //     application form a beat later. Skipped instantly, the run typed into a form that did not
    //     exist yet, which is what a run recording filled_fields: 0 looks like;
    //   - jobExtract's render delay, an optional waitForSelector on a selector that can never match,
    //     deliberately, so the run burns its full 5s and a client-rendered board can paint. Skipped
    //     instantly, page.goto's 'domcontentloaded' is all the run ever waits for, and 'extract' on
    //     body falls back from innerText to textContent and returns the inline stylesheet. Measured
    //     2026-08-08 on three live Ashby postings: 18,547 / 10,989 / 4,970 characters beginning
    //     "You need to enable JavaScript to run this app. body { overflow: hidden; }", none of them
    //     containing one word of the posting. Honoured, the same three return the real description.
    // So waitForSelector is exempt, and nothing else changes. An earlier version of this fix also
    // gave every OTHER optional action a 1500ms settle grace against a 5000ms run-wide budget, on
    // the theory that a control rendered a moment late deserved the same courtesy. Measured against
    // both branches on two live Greenhouse forms (Redwood Materials and DRW, 2026-08-08, the second
    // chosen because it has the asynchronously loaded education comboboxes the grace was justified
    // by), the grace produced identical filled_fields and identical blockers to no grace at all, and
    // cost +4336ms and +4298ms doing it: the whole budget went on speculative fallback selectors
    // that were never going to be on the page. A wait long enough to matter is the caller's to
    // declare with waitForSelector, which now works.
    let phase = 0;
    let currentInput = input;
    while (true) {
    extracted.length = 0;
    filledFields.length = 0;
    skipped.length = 0;
    discovered.length = 0;
    submitGateBlockers.length = 0;
    requiredFieldConfirmation = null;
    for (const action of currentInput.actions || []) {
     try {
      const locator = action.selector ? page.locator(action.selector).first() : null;
      // waitForSelector is exempt outright: its own timeout is the caller's declared, already-bounded
      // intent (normalizeManagedActions clamps it to 100-20000ms), and a pre-check that can answer
      // 'not there' before that timeout starts is the bug itself. An optional one that times out
      // lands in the catch below and is reported in 'skipped'.
      if (locator && action.optional && action.type !== 'waitForSelector' && await locator.count() === 0) {
        // Reported, not silent. The pre-check used to skip in complete silence, which is how several
        // deploys went by with fields quietly left empty and nothing in the run saying so. On a real
        // 70-action Greenhouse run this turns 19 reported skips into 63.
        skipped.push((action.label || action.type) + ': nothing matched ' + action.selector);
        continue;
      }
      if (isFinalSubmitAction(action)) {
        const validConfirmation = requiredFieldConfirmation
          && requiredFieldConfirmation.version === 1
          && requiredFieldConfirmation.status === 'confirmed'
          && Array.isArray(requiredFieldConfirmation.requiredControls)
          && Array.isArray(requiredFieldConfirmation.attempts)
          && Array.isArray(requiredFieldConfirmation.unresolved)
          && requiredFieldConfirmation.requiredControls.length === requiredFieldConfirmation.attempts.length
          && requiredFieldConfirmation.unresolved.length === 0
          && await page.locator(action.selector).count() === 1;
        if (!validConfirmation) {
          const failed = (requiredFieldConfirmation?.attempts || [])
            .filter((attempt) => attempt.outcome === 'failed')
            .map((attempt) => attempt.label ? '"' + attempt.label + '" could not be confirmed' : 'A selectorless required field could not be confirmed');
          if (failed.length === 0 && requiredFieldConfirmation?.unresolved) failed.push(...requiredFieldConfirmation.unresolved);
          if (failed.length === 0) failed.push('Required-field confirmation proof is missing or malformed');
          submitGateBlockers.push(...failed);
          skipped.push((action.label || 'final_submit') + ': submit withheld because required-field confirmation failed');
          continue;
        }
        const readiness = await readSubmitReadiness();
        const blocking = [...readiness.blocking, ...readiness.unmatched.map(
          (text) => 'The form is still showing "' + text + '" and Litos could not tell which field it belongs to'
        )];
        if (readiness.stale.length > 0) {
          // Recorded, never acted on. This is the line that explains a preview screenshot covered in
          // red over a form that is actually complete.
          skipped.push('pre_submit_gate: ignored ' + readiness.stale.length
            + ' stale validation message(s) left over from an earlier pass, over fields that are now filled');
        }
        if (blocking.length > 0) {
          // NOT pressed, and the run says why. Sending here is the one failure that cannot be
          // undone: an employer keeps the first application it receives.
          submitGateBlockers.push(...blocking);
          skipped.push((action.label || 'final_submit')
            + ': submit withheld, ' + blocking.length + ' required field(s) on the form are still empty');
          continue;
        }
      }
      if (action.type === 'discover') {
        // Scans the LIVE page for text-shaped custom questions (R-055 on the managed path: this
        // runner is the only place with an actual Page object mid-run, since /api/run is otherwise
        // stateless and one-shot). Ported from student-outreach-backend's DISCOVER_QUESTIONS_SCRIPT
        // and the extension's own candidateInputs()/questionLabel() - keep the three in sync by
        // hand.
        //
        // D-01. This used to scan text-shaped inputs ONLY, on the reasoning that the caller never
        // clicks a choice control so there was nothing useful to report. That reasoning was already
        // stale - the caller does answer choice questions, through fillByLabelText's select, radio
        // and checkbox arms - and the cost was measured on production packet 245c827a: Deepgram's
        // two work-eligibility questions render as Ashby pill groups, so discovery never saw them,
        // no question record was ever written for them, and the resolver was never given the chance
        // to answer them from the stored work_authorized and needs_sponsorship booleans it holds. A
        // question that is never discovered cannot be answered and cannot be asked; it is simply
        // absent, which is how a required field ends up empty with nothing complaining.
        //
        // ONE ENTRY PER QUESTION, not per control. A radio or checkbox group is one question wearing
        // several inputs, and reporting each input separately is what once turned three unanswered
        // Greenhouse questions into seventeen blockers named after their options.
        const found = await page.evaluate(() => {
          function clean(s) {
            return (s == null ? '' : s).replace(/[​‌‍﻿ ]/g, ' ').replace(/\s+/g, ' ').trim();
          }
          function isVisible(el) {
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return false;
            const style = getComputedStyle(el);
            return style.display !== 'none' && style.visibility !== 'hidden';
          }
          function isHoneypot(el) {
            const name = (el.getAttribute('name') || '').toLowerCase();
            const id = (el.id || '').toLowerCase();
            if (/\b(honeypot|hp_|bot[-_]?field|hidden[-_]?field)\b/.test(name + ' ' + id)) return true;
            const style = getComputedStyle(el);
            const rect = el.getBoundingClientRect();
            return style.opacity === '0' || (rect.width <= 1 && rect.height <= 1);
          }
          function questionLabel(el) {
            function genericControlText(value) {
              return /^(pick|select|choose)\s+(date|option)|^(type|enter|write)\s+(your\s+)?(answer\s+)?here/.test(clean(value).toLowerCase());
            }
            function nearestQuestionText(start) {
              let block = start.parentElement;
              for (let depth = 0; block && depth < 6; depth += 1, block = block.parentElement) {
                if (!block.matches('div, section, li, fieldset')) continue;
                const candidate = block.querySelector('label, legend, .question, h3, h4');
                const text = clean((candidate && candidate.textContent) || '').toLowerCase();
                if (text && !genericControlText(text)) return text;
              }
              return '';
            }
            const fieldset = el.closest('fieldset');
            const legend = fieldset ? fieldset.querySelector('legend') : null;
            const legendText = legend && legend.textContent ? legend.textContent.trim() : '';
            if (legendText) return legendText.toLowerCase();
            const group = el.closest('[role="group"], [role="radiogroup"]');
            const groupLabel = group ? group.getAttribute('aria-label') : null;
            if (groupLabel) return groupLabel.toLowerCase();
            const labelEl = (el.labels && el.labels[0]) || (el.id ? document.querySelector('label[for="' + CSS.escape(el.id) + '"]') : null);
            const labelText = labelEl && labelEl.textContent ? labelEl.textContent : '';
            const ariaLabel = el.getAttribute('aria-label') || '';
            // A radio or checkbox is labelled with its OPTION - "Male", "Yes", "Hispanic or Latino" -
            // and the applicant is answering the QUESTION above it. The pre-submit gate already
            // prefers the group's own text for exactly this reason; discovery has to agree with it,
            // or the same control is called two different things by two halves of one run.
            if (el.type === 'radio' || el.type === 'checkbox') {
              const owner = blockOf(el);
              // A label that speaks for ONE option is disqualified, however it says so: by wrapping
              // the input, or by naming a choice input in its "for". What is left is the block's own
              // heading. Without this test the search finds a SIBLING option's label and calls the
              // question "Female" - a group of options is full of labels that are not the question.
              const ownerLabel = owner && [...owner.querySelectorAll('label, legend')].find((candidate) => {
                if (candidate.querySelector('input, textarea, select')) return false;
                const named = candidate.getAttribute && candidate.getAttribute('for');
                if (!named) return true;
                const target = document.getElementById(named);
                return !(target && (target.type === 'radio' || target.type === 'checkbox'));
              });
              const ownerText = clean((ownerLabel && ownerLabel.textContent) || '').toLowerCase();
              if (ownerText && !genericControlText(ownerText)) return ownerText;
            }
            /* WHEN THE CONTROL CARRIES NO LABEL OF ITS OWN, the block's label beats the placeholder.
             *
             * The line below joins label + aria-label + placeholder + name + id and takes whatever
             * comes out, which is right on Greenhouse (real <label for>, so the join opens with the
             * question and the trailing name and id are how labelMarksRequired reads the employer's
             * "*" and how the education comboboxes are recognised by their "--0" handles) and wrong
             * wherever the control is anonymous. Both Ashby cases measured on packet 245c827a are
             * anonymous: the location combobox has no id, no name and no aria-label, so the join
             * produced its placeholder, "start typing...", as the question; and the yes/no mirror
             * input has only a name, so the join produced a bare UUID.
             *
             * Applied ONLY when the control has neither a <label for> nor an aria-label, so no form
             * that labels its inputs properly can be relabelled by this.
             */
            if (!clean(labelText) && !clean(ariaLabel)) {
              const owner = blockOf(el);
              const ownerLabel = owner && owner.querySelector('label, legend');
              const ownerText = clean((ownerLabel && ownerLabel.textContent) || '').toLowerCase();
              if (ownerText && !genericControlText(ownerText)) return ownerText;
            }
            const parts = [labelText || '', ariaLabel, el.getAttribute('placeholder') || '', el.getAttribute('name') || '', el.id || ''];
            const own = clean(parts.join(' ')).toLowerCase();
            const fallbackText = nearestQuestionText(el);
            if (own && !genericControlText(own)) return own;
            return fallbackText || own;
          }
          // The block that owns one question. Kept in step with widgetOf in the pre-submit gate: the
          // two Ashby entries are what make a pill group resolve to its question rather than to the
          // row of buttons.
          function blockOf(el) {
            return el.closest(
              'fieldset, [role="group"], [role="radiogroup"], [data-field-path],'
              + ' [class*="_fieldEntry_"], [class*="select__container"], .field, .field-wrapper'
            ) || el.parentElement || el;
          }
          /* Whether the EMPLOYER marks this question required, read three ways because the three
           * ATS families spell it three different ways and a gate that knows only one of them is
           * blind to the other two:
           *   - the HTML attribute, which Greenhouse and Lever set;
           *   - aria-required, which React Select sets on its own input;
           *   - a CSS-module class on the question's label, which is all Ashby gives. Verified in
           *     Ashby's stylesheet on 2026-08-09: ._required_<hash>:after renders the asterisk, and
           *     the asterisk is therefore a pseudo-element that appears in no label text anywhere.
           *     That is why the backend's labelMarksRequired, which looks for a literal "*" in the
           *     reported label, reads every Ashby field as optional - including, on packet 245c827a,
           *     the three that were required and empty.
           * No page text is read here. Each signal names one specific control or its own label.
           */
          function marksRequired(el, block) {
            if (el.required || el.getAttribute('aria-required') === 'true') return true;
            if (block && block.getAttribute && block.getAttribute('aria-required') === 'true') return true;
            const label = block && block.querySelector('label[class*="_required_"], legend[class*="_required_"]');
            return Boolean(label);
          }
          // A stable way back to this control on a LATER page load. The marker attribute below is
          // written into this page's DOM and is gone by the time the fill run opens the form again
          // (the two are separate stateless calls), so the backend refuses it and falls back to
          // matching by label text. An id, a name, or Ashby's own data-field-path survives the
          // reload and gives that fallback something better to use.
          function durableSelectorOf(el, block) {
            if (el.id && !/^[0-9]/.test(el.id)) return '#' + CSS.escape(el.id);
            const name = el.getAttribute && el.getAttribute('name');
            if (name) return '[name="' + name.replace(/["\\]/g, '\\$&') + '"]';
            const path = block && block.getAttribute && block.getAttribute('data-field-path');
            if (path) return '[data-field-path="' + path.replace(/["\\]/g, '\\$&') + '"]';
            return null;
          }
          // The choices a closed list actually offers, so the resolver can snap a stored answer onto
          // one of them instead of typing its own phrasing at a control that does not contain it.
          function optionsOf(el, block) {
            if (el.tagName === 'SELECT') {
              return [...el.options]
                .map((option) => clean(option.textContent || option.value))
                .filter((text) => text && !/^(select|choose|please|--)/i.test(text));
            }
            if (!block) return [];
            const texts = [];
            for (const input of block.querySelectorAll('input[type="radio"], input[type="checkbox"]')) {
              const byFor = input.id && document.querySelector('label[for="' + CSS.escape(input.id) + '"]');
              const wrapping = input.closest('label');
              const text = clean((byFor && byFor.textContent) || (wrapping && wrapping.textContent) || input.getAttribute('aria-label') || '');
              // Ashby labels its hidden mirror input with the QUESTION, so a single "option" whose
              // text is the question is not an option list at all.
              if (text && text.length <= 80) texts.push(text);
            }
            for (const button of block.querySelectorAll('button')) {
              const text = clean(button.textContent);
              if (!text || text.length > 40) continue;
              if (/upload|replace|drag|drop|submit|browse|remove|delete|\bsave\b|cancel|\+\s*add/i.test(text)) continue;
              texts.push(text);
            }
            return [...new Set(texts)];
          }
          const els = Array.prototype.slice
            .call(document.querySelectorAll(
              'input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"],'
              + ' input[type="date"], input[type="radio"], input[type="checkbox"], input:not([type]), textarea, select'
            ))
            // A choice input is exempt from the visibility test and from readOnly. Ashby's yes/no
            // mirror input is display:none by design and is the only DOM node that names the
            // question; requiring it to be visible is requiring the question not to exist. Its BLOCK
            // still has to be visible, which is the honest form of the same check.
            .filter((el) => {
              if (el.closest('[id*="litos"]') || el.disabled) return false;
              const choice = el.type === 'radio' || el.type === 'checkbox';
              if (!choice && (el.readOnly || !isVisible(el))) return false;
              if (choice && !isVisible(blockOf(el))) return false;
              return !isHoneypot(el) || choice;
            });
          const out = [];
          const seenBlocks = new Set();
          let counter = 0;
          for (let i = 0; i < els.length; i += 1) {
            const el = els[i];
            const block = blockOf(el);
            const choice = el.type === 'radio' || el.type === 'checkbox';
            // One question, one entry. Keyed on the block for a pill or radio group, and on the
            // group name where several blocks share one; a text input is always its own question.
            if (choice) {
              const key = el.name || block;
              if (seenBlocks.has(key)) continue;
              seenBlocks.add(key);
            }
            const label = clean(questionLabel(el));
            if (!label) continue;
            counter += 1;
            const marker = 'data-litos-discovered-' + counter;
            el.setAttribute(marker, '1');
            const options = optionsOf(el, block);
            out.push({
              label: label,
              selector: '[' + marker + ']',
              durableSelector: durableSelectorOf(el, block),
              inputType: el.tagName === 'TEXTAREA' ? 'textarea' : (el.tagName === 'SELECT' ? 'select' : (el.type || 'text')),
              required: marksRequired(el, block),
              options: options.length > 0 ? options : null,
              maxLength: el.maxLength > 0 ? el.maxLength : null
            });
          }
          return out;
        });
        discovered.push(...found);
      }
      if (action.type === 'confirmAndSubmit') {
        const passes = [];
        if (action.securityCode) {
          const entry = await enterSecurityCode(action.securityCode);
          if (entry !== 'entered') {
            securityCodeAttempt = { supplied: true, entered: false, outcome: entry, resubmitted: false };
            throw new Error('Security code was not entered before atomic verification');
          } else {
            // A continuation already sits on the changed verification DOM. Enter first, bind the
            // current verification submit second, and click exactly once. Clicking before entry can
            // reject or rotate the code and must remain structurally impossible.
            const verification = await confirmAndSubmitPass({ ...action, securityCode: undefined });
            passes.push(verification.pass);
            if (verification.pass.submissionOutcome === 'clicked') {
              await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
            }
            const still = await readSecurityCodeChallenge();
            securityCodeAttempt = {
              supplied: true,
              entered: true,
              resubmitted: verification.pass.submissionOutcome === 'clicked',
              outcome: verification.pass.submissionOutcome !== 'clicked' ? 'not_entered' : (still ? 'rejected' : 'accepted')
            };
          }
        } else {
          const application = await confirmAndSubmitPass(action);
          passes.push(application.pass);
          if (application.pass.submissionOutcome === 'clicked') {
            await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
          }
        }
        const confirmed = passes.length === 1 && passes.every((pass) => pass.submissionOutcome === 'clicked' && pass.unresolved.length === 0 && pass.scope.sameNode === true);
        requiredFieldConfirmation = { version: 2, status: confirmed ? 'confirmed' : 'blocked', passes };
        if (!confirmed) {
          const failed = passes.flatMap((pass) => pass.attempts
            .filter((attempt) => attempt.outcome === 'failed')
            .map((attempt) => attempt.label ? '"' + attempt.label + '" could not be confirmed' : 'A required field could not be confirmed'));
          const unresolved = passes.flatMap((pass) => pass.unresolved);
          submitGateBlockers.push(...(failed.length > 0 ? failed : unresolved));
          skipped.push('confirm_and_submit: atomic confirmation blocked submission');
        }
        continue;
      }
      if (action.type === 'click') {
        await locator.click();
        // RECORDED BEFORE THE WAIT, not after. A submit click that lands and then navigates, times
        // out, or takes the sandbox down with it has still been pressed, and "was the button
        // pressed" is the one fact the applicant's next move depends on. Setting it after the wait
        // would lose it in exactly the case that matters.
        if (isFinalSubmitAction(action)) finalSubmitPressed = true;
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
        /* THE SECOND HALF OF A GREENHOUSE SUBMIT, and the reason it is HERE rather than in its own
         * action.
         *
         * Greenhouse's answer to submit is not "filed" or "rejected", it is "prove you read this
         * mailbox": it emails a code and renders a code field, and the form has to be submitted
         * AGAIN with that code in it. So finishing takes three steps that only exist relative to
         * each other - click, type, click - and the middle one cannot be queued in advance, because
         * the control it types into does not exist until the first click has happened.
         *
         * The caller therefore hands the code to the submit click it already queues, and the two
         * extra steps cost ZERO extra actions. That is not a nicety. MANAGED_ACTION_LIMIT is 120 and
         * a real Greenhouse packet reconstructs to exactly 120, with the trim already having shaved
         * preferred_first_name and preferred_last_name off the end: every action added here would
         * have displaced a field the applicant expects to see filled.
         *
         * With no code supplied this does nothing at all. The challenge is then still standing when
         * the post-run scan reads it, and the caller is told what the page is waiting for.
         */
        if (action.securityCode && isFinalSubmitAction(action)) {
          // The control renders after the round trip the click just made, so it is worth one bounded
          // wait. Same shape as greenhouse_application_form_ready: declared, short, and optional.
          await page.waitForSelector('input[autocomplete*="one-time-code" i], input[maxlength="1"]', { timeout: 8000 })
            .catch(() => undefined);
          const entry = await enterSecurityCode(action.securityCode);
          if (entry !== 'entered') {
            securityCodeAttempt = { supplied: true, entered: false, outcome: entry, resubmitted: false };
            skipped.push('security_code: the code was not typed, ' + entry);
          } else {
            // Resubmitting is the whole point: Greenhouse's own email says "After you enter the
            // code, resubmit your application." A code typed into a form nobody sends changes
            // nothing.
            await locator.click().catch(() => undefined);
            await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
            // Accepted or not is read off the CONTROL, the same way its arrival was: a challenge
            // still standing after the resubmit means the code did not clear it. Deliberately not
            // read off any success or error sentence.
            const still = await readSecurityCodeChallenge();
            securityCodeAttempt = {
              supplied: true,
              entered: true,
              resubmitted: true,
              outcome: still ? 'rejected' : 'accepted'
            };
          }
        }
      }
      if (action.type === 'fill') {
        const fillShape = await locator.evaluate((element) => ({
          role: element.getAttribute('role') || '',
          ariaHaspopup: element.getAttribute('aria-haspopup') || '',
          ariaAutocomplete: element.getAttribute('aria-autocomplete') || ''
        })).catch(() => ({ role: '', ariaHaspopup: '', ariaAutocomplete: '' }));
        if (fillShape.role === 'combobox' || fillShape.ariaHaspopup === 'true' || fillShape.ariaAutocomplete === 'list') {
          const container = locator.locator(
            'xpath=ancestor::*[(self::div or self::fieldset) and (.//*[@role="combobox"] or .//*[@aria-haspopup="listbox"] or .//*[@aria-haspopup="true"])][1]'
          );
          if (await fillCustomChoice(container, action.value || '')) {
            if (action.label && await verifyChoiceInContainer(container, action.value || '')) filledFields.push(action.label);
            else if (action.label) skipped.push(action.label + ': choice value did not persist after fill');
            continue;
          }
          // No option matched, and this is a widget whose answered state can be read. Falling
          // through to the plain fill below would type the answer into the widget's SEARCH box and
          // then read it straight back out of that same box, so verifyFilled agreed and the field
          // was reported filled while the control still said "Select...". On the live Five Rings
          // form both Discipline candidates were reported filled and the employer's own validator
          // then called the field empty. A choice we could not make belongs to the applicant.
          const state = await readChoiceState(container);
          if (state.kind !== 'unknown') {
            if (action.label) {
              skipped.push(state.kind === 'chosen'
                ? action.label + ': left the answer already on the form, "' + clean(state.value) + '"'
                : action.label + ': no option matched "' + clean(action.value || '') + '", left for you to choose');
            }
            continue;
          }
        }
        // What actually goes in the box. Identical to action.value for everything except a phone
        // field whose own group already carries this number's dial code; see phoneValueForField.
        const fillValue = await phoneValueForField(locator, action.value || '');
        await locator.fill(fillValue || '');
        await locator.evaluate((element) => {
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }).catch(() => undefined);
        // Verified against what was WRITTEN, not against what was asked for. Checking a stripped
        // phone against the international form would report a correct fill as a failed one.
        if (action.label && await verifyFilled(locator, fillValue || '')) filledFields.push(action.label);
        else if (action.label) skipped.push(action.label + ': value did not persist after fill');
        // Last, and only after the value is committed and verified: a date field commits its value
        // and leaves its calendar standing over the next question.
        await dismissOverlayAfterFill(locator, action.label);
      }
      if (action.type === 'fillByLabelText') {
        /* THE ELEMENT THAT NAMES THE QUESTION, ahead of the first prose that mentions it.
         *
         * See D-02 above. getByText(text).first() takes the first element in DOM order whose text
         * merely CONTAINS the question, and on the live Skydio Ashby form that is the EEO preamble
         * paragraph, three questions above the control. Everything downstream is resolved from this
         * anchor, so the wrong anchor silently redirects the whole action at another question's
         * options.
         *
         * A whole-string match is tried first: an element whose entire text IS the question is the
         * question's label, and prose that happens to contain the word is not. Case-insensitive
         * because the stored question text is not the board's capitalisation ("gender" in packet
         * 13bccb2d against Ashby's "Gender"), and a trailing asterisk or colon is allowed because
         * that is how a required field is marked. The old containment search is still the fallback,
         * so a board whose label carries extra words is no worse off than before.
         */
        const wantedLabel = clean(action.text);
        const wholeLabel = wantedLabel
          ? new RegExp('^\\s*' + wantedLabel.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&') + '\\s*[*:]?\\s*$', 'i')
          : null;
        const exactLabel = wholeLabel ? page.getByText(wholeLabel).first() : null;
        const label = exactLabel && (await exactLabel.count()) > 0
          ? exactLabel
          : page.getByText(action.text, { exact: false }).first();
        if (await label.count() === 0) {
          const message = 'fillByLabelText: label not found';
          if (action.optional) {
            skipped.push((action.label || action.type) + ': ' + message);
            continue;
          }
          throw new Error(message);
        }
        const container = label.locator(
          'xpath=ancestor::*[(self::div or self::fieldset) and (.//textarea or .//input[not(@type="file") and not(@type="hidden")] or .//select or .//*[@role="combobox"] or .//*[@aria-haspopup="listbox"])][1]'
        );
        const field = container.locator('textarea, input:not([type=file]):not([type=hidden]), select').first();
        if (await field.count() === 0) {
          if (await fillCustomChoice(container, action.value || '')) {
            if (action.label) filledFields.push(action.label);
            continue;
          }
          // A question whose only controls are option buttons has no field to find, by construction.
          // Asked here as well as in the checkbox arm below because a board that omits the mirror
          // input entirely never reaches that arm.
          if (await pickOptionPill(container, action.value || '')) {
            if (action.label) filledFields.push(action.label);
            continue;
          }
          const message = 'fillByLabelText: field not found';
          if (action.optional) {
            skipped.push((action.label || action.type) + ': ' + message);
            continue;
          }
          throw new Error(message);
        }
        // Dispatch on the CONTROL, not on the question. Everything used to fall through to fill(),
        // which throws on a checkbox or radio ("Input of type checkbox cannot be filled") and, before
        // the try/catch above, took the entire run with it. Callers cannot predict the control type
        // either: on a real Greenhouse form "How did you hear about this job?" reads like free text
        // and is a checkbox group.
        const shape = await field.evaluate((element) => ({
          tag: element.tagName.toLowerCase(),
          type: (element.getAttribute('type') || '').toLowerCase(),
          placeholder: element.getAttribute('placeholder') || '',
          role: element.getAttribute('role') || '',
          ariaHaspopup: element.getAttribute('aria-haspopup') || '',
          ariaAutocomplete: element.getAttribute('aria-autocomplete') || ''
        }));
        const dateLikeAnswer = /^\d{4}-\d{2}-\d{2}$/.test(String(action.value || '').trim());
        const dateLikeField = /date|pick date/i.test(shape.placeholder);
        if (shape.tag === 'select') {
          const customSelected = await fillCustomChoice(container, action.value || '');
          let selected = false;
          if (!customSelected) {
            for (const option of answerOptions(action.value || '')) {
              try {
                await field.selectOption({ label: option });
                selected = true;
                break;
              } catch {}
              try {
                await field.selectOption(option);
                selected = true;
                break;
              } catch {}
            }
          }
          if (customSelected) selected = true;
          if (!selected) continue;
        } else if (shape.role === 'combobox' || shape.ariaHaspopup === 'true' || shape.ariaAutocomplete === 'list') {
          if (await fillCustomChoice(container, action.value || '')) {
            if (action.label && await verifyChoiceInContainer(container, action.value || '')) filledFields.push(action.label);
            else if (action.label) skipped.push(action.label + ': choice value did not persist after fillByLabelText');
            continue;
          }
          if (action.label) skipped.push(action.label + ': choice option not found');
          continue;
        } else if (shape.type === 'checkbox' || shape.type === 'radio') {
          /* Scoped to THIS question's own option block, never the whole page and - since D-02 -
           * never a container that turned out to hold somebody else's options either. That scoping
           * is what makes matching an answer as short as "Yes" safe: an unscoped label match could
           * tick a consent or legal acknowledgement elsewhere on the form, which the applicant
           * cannot undo, and a container-wide match set Gender from the Race answer on every Ashby
           * EEO block Litos has ever filled.
           *
           * Every arm below ends the action. Falling through to the text verification at the bottom
           * is what reported four correctly ticked Skydio radios as lost, because that verification
           * reads the first input in the block and not the option that was clicked.
           */
          const wanted = String(action.value || '').trim();
          const scope = await questionOptionBlock(label, container);
          const groups = await radioGroupNames(scope);
          if (groups.length > 1) {
            // Refused rather than guessed. Two groups means two questions, and the only thing worse
            // than leaving this one for the applicant is answering the other one for her.
            if (action.label) {
              skipped.push(action.label + ': this block holds ' + groups.length
                + ' separate option groups, so an answer here could have landed on another question, left for you to choose');
            }
            continue;
          }
          const outcome = await pickRadioOption(scope, wanted);
          if (outcome === 'checked') {
            if (action.label) filledFields.push(action.label);
            continue;
          }
          if (outcome === 'not-checked') {
            // The option exists, it was clicked, and the page did not keep it. Said plainly, because
            // the applicant can finish it in one click and nothing else on the run can tell her.
            if (action.label) skipped.push(action.label + ': the option was clicked and did not stay selected');
            continue;
          }
          // Before the single-checkbox heuristic below, because on Ashby that heuristic is precisely
          // the wrong move: the one checkbox in the block is the display:none mirror of a pill pair,
          // so checking it neither drives React nor distinguishes Yes from No. See pickOptionPill.
          if (await pickOptionPill(scope, wanted)) {
            if (action.label) filledFields.push(action.label);
            continue;
          }
          const lone = scope.locator('input[type=checkbox], input[type=radio]');
          const total = await lone.count();
          if (total === 1 && /^yes$/i.test(wanted)) {
            await lone.first().check().catch(() => undefined);
            if (await lone.first().evaluate((element) => element.checked === true).catch(() => false)) {
              if (action.label) filledFields.push(action.label);
              continue;
            }
          }
          // No exact option match means the answer does not belong to this control. Leaving it
          // unticked is correct: it surfaces as a required-field blocker for the applicant, which is
          // far cheaper than guessing a checkbox on their behalf.
          if (action.label) skipped.push(action.label + ': no option matched "' + clean(wanted) + '", left for you to choose');
          continue;
        } else if (shape.type === 'date' || (dateLikeAnswer && dateLikeField)) {
          await field.fill(action.value || '');
          await field.evaluate((element) => {
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          });
          await field.press('Tab').catch(() => field.evaluate((element) => element.blur()));
          const committed = await field.evaluate((element) => String(element.value || '').trim()).catch(() => '');
          if (!committed) await field.fill(action.value || '');
        } else {
          await field.fill(action.value || '');
          await field.evaluate((element) => {
            element.dispatchEvent(new Event('input', { bubbles: true }));
            element.dispatchEvent(new Event('change', { bubbles: true }));
          }).catch(() => undefined);
        }
        /* A TEXT FILL THAT DOES NOT STICK IS EVIDENCE THE CONTROL IS NOT TEXT.
         *
         * Measured on production packet 13bccb2d (Skydio, Ashby, 2026-08-09): "gender" and "veteran
         * status" were both resolved from the stored profile, both dispatched down this branch, and
         * both came back "value did not persist after fillByLabelText". A real text input keeps what
         * you type into it. One that does not is a widget's own search box, or a mirror input behind
         * a set of option buttons, and this branch was reached only because the shape read gave no
         * role, no aria-haspopup and no aria-autocomplete to dispatch on - which comment (3) at the
         * top of the backend's profileFieldResolution already records as routine on this path.
         *
         * So the failed verification is the signal, and the two choice fills get their turn before
         * the field is written off. Ordered most scoped first: pickOptionPill only ever clicks a
         * button inside THIS question's container, fillCustomChoice is the react-select path that
         * the same defect class was already fixed in. Nothing here runs on a fill that worked.
         */
        let persisted = await verifyFilled(field, action.value || '');
        if (!persisted) {
          if (await pickOptionPill(container, action.value || '')) persisted = true;
          else if (await fillCustomChoice(container, action.value || '')) {
            persisted = await verifyChoiceInContainer(container, action.value || '');
          }
        }
        if (action.label && persisted) filledFields.push(action.label);
        else if (action.label) skipped.push(action.label + ': value did not persist after fillByLabelText');
      }
      if (action.type === 'upload') {
        await locator.setInputFiles({
          name: action.file.name,
          mimeType: action.file.mimeType,
          buffer: Buffer.from(action.file.base64, 'base64')
        });
        if (action.label) filledFields.push(action.label);
      }
      if (action.type === 'waitForSelector') await page.waitForSelector(action.selector, { timeout: action.timeout || 10000 });
      if (action.type === 'press') {
        // A PRESS LANDS ON THE ELEMENT IT NAMES. It used to be page.keyboard.press(), which types
        // into whatever happens to hold focus, and normalizeManagedActions dropped the selector on
        // the floor so the runner could not have aimed it even if it wanted to. Two consequences,
        // both measured:
        //   - an OPTIONAL press whose target is not on the page fired anyway, because the optional
        //     pre-check is guarded on the locator, and the locator was always null for a press. A keystroke
        //     queued for a control that does not exist was still delivered to the form.
        //   - the caller queues { press Enter, selector '#country' } to commit the phone-country
        //     React Select. On the live Redwood Materials Greenhouse form that Enter reached the
        //     form itself and ran the employer's validator with the phone, the resume and all four
        //     screener questions still empty. Six "is required" messages rendered, none of them
        //     cleared when those fields were filled a moment later, and the preview screenshot the
        //     applicant is asked to approve showed a correctly filled form covered in red.
        if (!locator) {
          await page.keyboard.press(action.value);
        } else if (/^enter$/i.test(String(action.value || '')) && await choiceControlIsClosed(locator)) {
          // Enter on a choice control means "take the highlighted option". With the menu shut there
          // is no highlighted option, so the keystroke cannot do the job it was queued for, and the
          // only thing left for it to do is trigger the form's implicit submission. Withheld, and
          // said out loud.
          skipped.push((action.label || 'press')
            + ': Enter withheld, ' + action.selector + ' is a choice control with no menu open, so the keystroke could only have submitted the form');
        } else {
          await locator.press(action.value);
        }
      }
      if (action.type === 'select') {
        await locator.selectOption(action.value);
        if (action.label) filledFields.push(action.label);
      }
      if (action.type === 'extract') {
        const value = await locator.evaluate((element, attribute) => attribute ? element.getAttribute(attribute) : (element.innerText || element.textContent || ''), action.attribute || null);
        extracted.push({ selector: action.selector, label: action.label, value });
      }
     } catch (actionError) {
      // 'optional' previously meant only "skip if the element is missing", and it was checked via
      // 'locator', which is null for fillByLabelText. So a fillByLabelText could never be optional,
      // and any throw from ANY action aborted the whole run. A single unfillable checkbox on a
      // Greenhouse form therefore discarded the name, email, phone and resume already entered, and
      // returned the caller a raw Playwright stack trace instead of a filled form.
      // An optional action that fails is now recorded and stepped over; a required one still stops
      // the run, because the caller marked it as something the run cannot proceed without.
      if (!action.optional) throw actionError;
      skipped.push((action.label || action.type) + ': ' + String(actionError?.message || actionError).split('\n')[0].slice(0, 200));
     }
    }
    // The gate's findings lead, because "we did not send this" is the first thing the caller needs
    // to know and the reason has to travel with it.
    const blockers = [...submitGateBlockers];
    if (await page.locator('iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i]').count() > 0) {
      blockers.push('CAPTCHA requires your attention');
    }
    /* THE SAME READING OF THE FORM THE PRE-SUBMIT GATE MAKES, made on every run.
     *
     * D-01. There used to be two separate answers in this file to the question "which required
     * fields are still empty": readSubmitReadiness above, built for the moment before the final
     * click, and a weaker pair of scans here whose output is what the CALLER stores and shows. The
     * weaker pair looked only at the 'required' ATTRIBUTE (plus aria-required on file upload groups),
     * and a PREPARE run queues no submit action at all, so the better reading never ran on the call
     * that decides whether a packet is offered to a person as ready to send.
     *
     * Measured on production packet 245c827a (Deepgram, Ashby, 2026-08-09): three required fields
     * empty on the filled form - Current Location, and both work-eligibility questions - and this
     * scan returned ZERO blockers, because Ashby marks none of the three with the attribute. The
     * caller read "no blockers" as "safe", wrote ready_for_final_approval, and put a green "Send it"
     * button in front of a person.
     *
     * One reading, used in both places, is the fix: whatever would withhold the click is also what
     * the run reports. The two can no longer disagree, and a required field this gate can see is now
     * visible at prepare time instead of only at the last moment.
     *
     * 'stale' and 'unmatched' are deliberately NOT folded in here. Both concern validation MESSAGES
     * rather than empty controls, they are the half of the gate with the false-positive history, and
     * a stale message over a filled field must never turn a complete application into a blocked one.
     */
    const readiness = requiredFieldConfirmation?.version === 2
      ? { blocking: [], stale: [], unmatched: [] }
      : await readSubmitReadiness();
    blockers.push(...readiness.blocking);
    // Read on EVERY run, at zero action cost, because the caller has no other way to find out. A
    // fill run that has somehow submitted looks exactly like a fill run that has not, right up
    // until the applicant is asked to approve sending an application that is already half sent.
    const humanVerification = await readSecurityCodeChallenge();
    /* THE OUTCOME OF THE CLICK, read from the page rather than inferred by the caller from a body
     * scrape. Zero actions: it is a page.evaluate inside the run, exactly like the two reads above.
     *
     * Only on a run that actually pressed the button. On a fill run there is nothing to confirm, and
     * a confirmation-shaped sentence already on an unsubmitted page (an employer's "Thank you for
     * your interest") must not be able to manufacture one. */
    const submitOutcome = finalSubmitPressed
      ? { pressed: true, ...(await readSubmitOutcome()) }
      : { pressed: false, state: 'not_attempted', source: null, evidence: null, message: null, formStillPresent: null };
    // How many submissions the guard stopped. Zero on a run that was allowed to submit, because the
    // guard is not installed there. Non-zero on a fill run is a DEFECT REPORT: something in the
    // action list tried to send a real application without authorization, and this is the only
    // place that can ever say so.
    const blockedSubmits = input.allowSubmit === true
      ? 0
      : await page.evaluate(() => window.__litosBlockedSubmits || 0).catch(() => 0);
    const title = await page.title();
    const url = page.url();
    const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 50000));
    const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map((link) => ({ text: (link.innerText || link.textContent || '').trim().slice(0, 500), href: link.href })));
    if (currentInput.screenshot) await page.screenshot({ path: 'stratus-screenshot-' + phase + '.png', fullPage: Boolean(currentInput.fullPage) });
    // 'skipped' is reported, never swallowed: an optional action that failed is something the
    // caller should be able to see and act on, and a silent skip is how a half-filled form starts
    // looking like a fully-filled one.
    /* A CONTINUATION IS OFFERED ONLY WHEN THERE IS SOMETHING TO CONTINUE.
     *
     * This used to be 'input.requestContinuation' alone, and the caller cannot know in advance
     * whether a form will ask for an emailed code, so it asks for a continuation on EVERY managed
     * submit. The consequence was that a form with no challenge - which is nearly all of them, and
     * every Ashby form Litos has ever driven - finished phase 0 and then sat here idling for the
     * full continuation TTL waiting for a second phase that was never coming, while the caller sat
     * on the other side waiting too. Nothing about that run involved a security code; it was still
     * reported as "Managed browser continuation timed out".
     *
     * The runner is the only party that can answer this, because the answer is a property of the
     * page in front of it. 'continuationOffered' travels in the result so the caller does not have
     * to re-derive it from scraped text, which is what continuationEligible was reduced to doing.
     */
    const continuationOffered = input.requestContinuation === true
      && (Boolean(humanVerification) || input.continuationCheckpoint === true);
    fs.writeFileSync('stratus-result-' + phase + '.json', JSON.stringify({ title, url, text, links, extracted, discovered, filledFields: [...new Set(filledFields)], blockers: [...new Set(blockers)], skipped: [...new Set(skipped)], humanVerification, securityCodeAttempt, submitOutcome, requiredFieldConfirmation, blockedSubmits, continuationOffered, elapsedMs: Date.now() - startedAt }));
    if (phase > 0 || !continuationOffered) break;
    fs.writeFileSync('stratus-continuation-ready.json', JSON.stringify({ expiresAt: input.continuationExpiresAt, host: input.allowedHost }));
    /* A FLOOR UNDER THE IDLE, because the TTL is counted from before the run started and phase 0
     * can legitimately eat most of it. The security boundary is untouched: the claim script checks
     * the marker's own expiresAt, so a token that has expired is still refused. All this prevents is
     * the runner exiting - and closing the browser - while a continuation the caller is still
     * allowed to make is in flight, which would report itself as a continuation timeout. */
    const expiresAt = Math.max(Date.parse(input.continuationExpiresAt), Date.now() + 30_000);
    while (!fs.existsSync('stratus-continuation-input.json') && Date.now() < expiresAt) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!fs.existsSync('stratus-continuation-input.json')) break;
    currentInput = JSON.parse(fs.readFileSync('stratus-continuation-input.json', 'utf8'));
    fs.unlinkSync('stratus-continuation-input.json');
    phase += 1;
    }
  } finally {
    await browser.close();
  }
})().catch((error) => {
  const detail = String(error?.stack || error?.message || error);
  /* WRITTEN TO A FILE, not only to stderr, because on a continuation run this process is DETACHED
   * and nobody is holding its stderr. Before this, a runner that died on its first action and a
   * runner still patiently filling a slow form looked identical from outside - an absent result
   * file - so both were reported after the full timeout as "the run timed out", and a crash whose
   * message was sitting right there went unread. The caller watches for this file alongside the
   * result and reports whichever arrives. */
  try {
    fs.writeFileSync('stratus-error.json', JSON.stringify({ message: detail.split('\n')[0].slice(0, 500), detail: detail.slice(0, 4000) }));
  } catch { /* the result of the run matters more than the record of why there is none */ }
  console.error(detail);
  process.exit(1);
});
`;

function inputError(message, code = 'INVALID_REQUEST') {
  return Object.assign(new Error(message), { status: 400, code });
}

function validateSelector(selector) {
  if (typeof selector !== 'string' || !selector.trim() || selector.length > 500) {
    throw inputError('Each selector must be a non-empty string no longer than 500 characters', 'INVALID_SELECTOR');
  }
  return selector.trim();
}

export function normalizeManagedActions(actions = []) {
  if (!Array.isArray(actions)) throw inputError('actions must be an array');
  if (actions.length > MAX_ACTIONS) throw inputError(`A run may contain at most ${MAX_ACTIONS} actions`, 'TOO_MANY_ACTIONS');
  if (actions.filter((action) => action?.type === 'confirmAndSubmit').length > 1) {
    throw inputError('A remote run may contain at most one atomic submit action', 'MULTIPLE_ATOMIC_SUBMITS');
  }
  return actions.map((action, index) => {
    if (!action || typeof action !== 'object' || !ALLOWED_ACTIONS.has(action.type)) {
      throw inputError(`Action ${index + 1} has an unsupported type`, 'INVALID_ACTION');
    }
    const normalized = { type: action.type };
    if (!['press', 'fillByLabelText', 'discover'].includes(action.type)) normalized.selector = validateSelector(action.selector);
    // A press keeps the selector it was given. It stays OPTIONAL - a caller may legitimately mean
    // "send this key wherever focus already is" and omit it - but when one is supplied, dropping it
    // here is what turned an aimed keystroke into a page-wide one, and made the optional pre-check
    // (which is guarded on the locator) unreachable for every press ever queued.
    else if (action.type === 'press' && action.selector != null) normalized.selector = validateSelector(action.selector);
    if (action.optional != null) normalized.optional = Boolean(action.optional);
    if (action.label != null) {
      if (typeof action.label !== 'string' || action.label.length > 200) throw inputError('Action labels must be strings no longer than 200 characters', 'INVALID_ACTION_LABEL');
      normalized.label = action.label;
    }
    if (['fill', 'press', 'select'].includes(action.type)) {
      if (typeof action.value !== 'string' || action.value.length > MAX_VALUE_LENGTH) {
        throw inputError(`Action ${index + 1} requires a string value no longer than ${MAX_VALUE_LENGTH} characters`, 'INVALID_ACTION_VALUE');
      }
      normalized.value = action.value;
    }
    if (action.type === 'fillByLabelText') {
      if (typeof action.text !== 'string' || !action.text.trim() || action.text.length > 500) throw inputError('Question text must be a non-empty string no longer than 500 characters', 'INVALID_ACTION_TEXT');
      if (typeof action.value !== 'string' || action.value.length > MAX_VALUE_LENGTH) throw inputError('Question answers must be strings no longer than 10000 characters', 'INVALID_ACTION_VALUE');
      normalized.text = action.text.trim();
      normalized.value = action.value;
    }
    if (action.type === 'upload') {
      const file = action.file;
      if (!file || typeof file !== 'object') throw inputError('Upload actions require a file', 'INVALID_UPLOAD');
      if (
        typeof file.name !== 'string' || !file.name.trim() || file.name.length > 255 ||
        /[\/\\\0-\x1f\x7f]/.test(file.name) || file.name.trim() === '.' || file.name.trim() === '..'
      ) throw inputError('Upload file names must be safe non-empty basenames no longer than 255 characters', 'INVALID_UPLOAD');
      if (typeof file.mimeType !== 'string' || !file.mimeType.trim() || file.mimeType.length > 200) throw inputError('Upload MIME types must be non-empty strings no longer than 200 characters', 'INVALID_UPLOAD');
      if (
        typeof file.base64 !== 'string' || !file.base64 || file.base64.length > MAX_FILE_BASE64_LENGTH ||
        file.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64)
      ) throw inputError('Upload file data must be valid non-empty base64 no longer than 6000000 characters', 'INVALID_UPLOAD');
      normalized.file = { name: file.name.trim(), mimeType: file.mimeType.trim(), base64: file.base64 };
    }
    if (action.type === 'waitForSelector') normalized.timeout = Math.min(Math.max(Number(action.timeout) || 10_000, 100), 20_000);
    // The emailed code that finishes a Greenhouse submit, carried on the submit click itself. Kept
    // to the shape of a code and nothing else: it is typed into a live employer's form, so a value
    // that is not plausibly a code is a caller bug and must not reach the page. Greenhouse issues 8
    // alphanumeric characters; the bound is wider than that and still narrow enough that no
    // sentence, selector or script fragment can pass through it.
    if (action.securityCode != null) {
      if (action.type !== 'confirmAndSubmit') throw inputError('Only an atomic submit may carry a security code', 'INVALID_SECURITY_CODE');
      if (typeof action.securityCode !== 'string' || !/^[A-Za-z0-9]{4,12}$/.test(action.securityCode)) {
        throw inputError('A security code must be 4 to 12 letters or digits', 'INVALID_SECURITY_CODE');
      }
      normalized.securityCode = action.securityCode;
    }
    if (action.type === 'extract' && action.attribute != null) {
      if (typeof action.attribute !== 'string' || action.attribute.length > 100) {
        throw inputError('Extract attributes must be strings no longer than 100 characters', 'INVALID_ATTRIBUTE');
      }
      normalized.attribute = action.attribute;
    }
    if (action.type === 'confirmAndSubmit') {
      const maxRetries = Number(action.maxRetries);
      if (!Number.isInteger(maxRetries) || maxRetries < 0 || maxRetries > 1) {
        throw inputError('confirmAndSubmit maxRetries must be 0 or 1', 'INVALID_CONFIRM_AND_SUBMIT_RETRIES');
      }
      if (action.contractVersion !== 2) throw inputError('confirmAndSubmit contractVersion must be 2', 'INVALID_CONFIRM_AND_SUBMIT_VERSION');
      if (!['application', 'verification'].includes(action.submitKind)) throw inputError('confirmAndSubmit submitKind is invalid', 'INVALID_SUBMIT_KIND');
      if (action.securityCode && action.submitKind !== 'verification') throw inputError('A security code requires a verification atomic submit', 'INVALID_SUBMIT_KIND');
      if (action.selector !== ATOMIC_SUBMIT_SELECTOR) throw inputError('confirmAndSubmit selector must be the version 2 submit candidate set', 'INVALID_CONFIRM_AND_SUBMIT_SELECTOR');
      if (
        !action.chooserPolicy || typeof action.chooserPolicy !== 'object'
        || Object.keys(action.chooserPolicy).sort().join(',') !== 'name,version'
        || action.chooserPolicy.name !== ATOMIC_SUBMIT_POLICY.name
        || action.chooserPolicy.version !== ATOMIC_SUBMIT_POLICY.version
      ) throw inputError('confirmAndSubmit chooser policy is invalid', 'INVALID_CONFIRM_AND_SUBMIT_POLICY');
      if (typeof action.label !== 'string' || !action.label.trim()) throw inputError('confirmAndSubmit requires a non-empty label', 'INVALID_CONFIRM_AND_SUBMIT_LABEL');
      if (action.optional !== false) throw inputError('confirmAndSubmit must be non-optional', 'INVALID_CONFIRM_AND_SUBMIT_OPTIONAL');
      normalized.maxRetries = maxRetries;
      normalized.contractVersion = 2;
      normalized.submitKind = action.submitKind;
      normalized.chooserPolicy = { name: ATOMIC_SUBMIT_POLICY.name, version: ATOMIC_SUBMIT_POLICY.version };
      if (action.timeout != null) normalized.timeout = Math.min(Math.max(Number(action.timeout) || 10_000, 100), 20_000);
    }
    return normalized;
  });
}

export async function normalizeManagedRun(input = {}, { urlValidator = assertPublicUrl } = {}) {
  if (!input || typeof input !== 'object') throw inputError('Request body must be a JSON object');
  if (input.continuationToken != null) throw inputError('A continuation request must not include a URL run payload', 'INVALID_CONTINUATION');
  const url = await urlValidator(input.url);
  const viewport = input.viewport || {};
  const width = Math.min(Math.max(Number(viewport.width) || 1440, 320), 1920);
  const height = Math.min(Math.max(Number(viewport.height) || 900, 240), 1080);
  const requestContinuation = Boolean(input.requestContinuation);
  const continuationTtlSeconds = Math.min(
    Math.max(Number(input.continuationTtlSeconds) || MANAGED_CONTINUATION_CONTRACT.defaultTtlSeconds, MANAGED_CONTINUATION_CONTRACT.minTtlSeconds),
    MANAGED_CONTINUATION_CONTRACT.maxTtlSeconds
  );
  return {
    url: url.toString(),
    actions: normalizeManagedActions(input.actions),
    screenshot: input.screenshot !== false,
    // DEFAULT DENY, and the default is the entire safety property. Every existing caller becomes a
    // run that cannot submit, which is what they all already believed they were, and only a caller
    // that says the word gets the ability to send a real application to a real employer. Written as
    // `=== true` rather than Boolean() so a truthy accident ('no', 0 vs '0', an object) cannot open
    // it: the one value that opens the gate is the literal true.
    allowSubmit: input.allowSubmit === true,
    fullPage: Boolean(input.fullPage),
    waitUntil: ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'].includes(input.waitUntil) ? input.waitUntil : 'networkidle2',
    viewport: { width, height },
    requestContinuation,
    continuationCheckpoint: Boolean(input.continuationCheckpoint),
    continuationTtlSeconds,
    allowedHost: url.hostname.toLowerCase()
  };
}

export function normalizeManagedContinuation(input = {}) {
  if (!input || typeof input !== 'object') throw inputError('Request body must be a JSON object');
  if (typeof input.continuationToken !== 'string' || !/^[A-Za-z0-9_-]{32,200}$/.test(input.continuationToken)) {
    throw inputError('A valid continuationToken is required', 'INVALID_CONTINUATION');
  }
  if (input.url != null) throw inputError('A continuation must not include url', 'CONTINUATION_URL_FORBIDDEN');
  if (input.requestContinuation || input.continuationCheckpoint || input.continuationTtlSeconds != null) {
    throw inputError('A continuation cannot request another continuation', 'CONTINUATION_LIMIT_REACHED');
  }
  return {
    continuationToken: input.continuationToken,
    actions: normalizeManagedActions(input.actions),
    screenshot: input.screenshot !== false,
    fullPage: Boolean(input.fullPage)
  };
}

function digest(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function continuationSandboxName(projectBinding, token) {
  return `stratus-c-${digest(`${projectBinding}:${token}`).slice(0, 40)}`;
}

/* THE RUNNER DECIDES, and this is now only the fallback for a runner that predates it.
 *
 * `continuationOffered` is written by the run itself, which is the only party that has ever seen
 * the page. The text sweep below is kept for one reason: a caller may be pointed at an older
 * runtime image mid-deploy, and silently never offering a continuation there would break the
 * emailed-code path rather than degrade it. Note what the sweep matches - "check your email",
 * "confirmation code" - and where that text lives: an employer's own post-submit confirmation
 * ("we've sent a confirmation to your email") reads as a security-code challenge to it. That
 * false positive is exactly why the runner's own answer wins.
 */
function continuationEligible(result, checkpoint) {
  if (typeof result?.continuationOffered === 'boolean') return result.continuationOffered;
  if (checkpoint) return true;
  if (result?.humanVerification?.kind === 'security_code') return true;
  const haystack = `${result?.title || ''}\n${result?.url || ''}\n${result?.text || ''}`;
  return /(?:verification|security|confirmation)\s+code|enter\s+(?:the\s+)?code|check\s+your\s+email/i.test(haystack);
}

/* THE RUN'S OWN BUDGET, and it must not shrink because a continuation was requested.
 *
 * A managed run with no continuation is `sandbox.runCommand` against a fork whose timeout is
 * 90_000, so 90 seconds is what a submit has always been allowed. Requesting a continuation
 * switched it to a detached run polled for 60_000, which quietly took a third of the budget away
 * from every managed submit - and the caller asks for a continuation on every one of them, because
 * it cannot know in advance whether a form will demand an emailed code.
 *
 * Production packet 13bccb2d (Skydio, Ashby, 2026-08-09): approved at 12:24:42.430, failure written
 * at 12:25:49.894. 67.4 seconds end to end, of which one 60-second wait, on a form with no
 * challenge and nothing to continue.
 */
const MANAGED_RUN_TIMEOUT_MS = 90_000;
const CONTINUATION_TIMEOUT_MS = 60_000;

/**
 * Wait for whichever of `paths` appears first, and return its name.
 *
 * Plural because the runner has two things it can say - a result or, since it started running
 * detached, a crash - and watching only for the good one turns every crash into a timeout report
 * after the full budget. `failure` carries the message and code for the timeout, because "the run
 * took too long" and "the continuation expired" are different facts and were being reported with
 * the same sentence.
 */
async function waitForSandboxFile(sandbox, paths, timeoutMs, failure) {
  const wanted = Array.isArray(paths) ? paths : [paths];
  const script = "const fs=require('node:fs');const end=Date.now()+Number(process.argv[1]);const ps=process.argv.slice(2);(async()=>{for(;;){const hit=ps.find((p)=>fs.existsSync(p));if(hit){process.stdout.write(hit);process.exit(0)}if(Date.now()>=end)process.exit(3);await new Promise(r=>setTimeout(r,100))}})()";
  const result = await sandbox.runCommand('node', ['-e', script, String(timeoutMs), ...wanted], { timeoutMs: timeoutMs + 5_000 });
  if (result.exitCode !== 0) throw Object.assign(new Error(failure.message), { status: failure.status, code: failure.code });
  const found = typeof result.stdout === 'function' ? String(await result.stdout()).trim() : String(result.stdout || '').trim();
  return wanted.includes(found) ? found : wanted[0];
}

/** Turn a crash the detached runner recorded into the error it would have thrown in-line. */
async function throwSandboxRunnerError(sandbox) {
  const buffer = await sandbox.readFileToBuffer({ path: 'stratus-error.json' }).catch(() => null);
  let message = 'Sandbox browser run failed';
  try {
    const parsed = JSON.parse(buffer.toString('utf8'));
    if (parsed?.message) message = String(parsed.message).slice(0, 500);
  } catch { /* a crash we cannot read is still a crash, and the generic message says so */ }
  throw Object.assign(new Error(message), { status: 502, code: 'SANDBOX_RUN_FAILED' });
}

const CLAIM_CONTINUATION_SCRIPT = "const fs=require('node:fs');const crypto=require('node:crypto');const [tokenHash,projectHash]=process.argv.slice(1);try{const marker=JSON.parse(fs.readFileSync('stratus-continuation.json','utf8'));if(!fs.existsSync('stratus-continuation-ready.json'))process.exit(4);if(marker.tokenHash!==tokenHash||marker.projectHash!==projectHash)process.exit(5);if(marker.used||Date.now()>Date.parse(marker.expiresAt))process.exit(6);fs.renameSync('stratus-continuation.json','stratus-continuation-used.json');process.exit(0)}catch{process.exit(7)}";

async function ensureSandboxTemplate() {
  const template = await Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    runtime: 'node24',
    timeout: 45 * 60 * 1000,
    resources: { vcpus: 2 },
    persistent: true,
    snapshotExpiration: 0,
    keepLastSnapshots: { count: 1, expiration: 0 },
    onCreate: async (sandbox) => {
      const dependencies = await sandbox.runCommand({ cmd: 'dnf', args: ['install', '-y', ...SANDBOX_DEPENDENCIES], sudo: true });
      if (dependencies.exitCode !== 0) throw new Error(`Sandbox browser dependency installation failed: ${await dependencies.stderr()}`);
      const npmInit = await sandbox.runCommand('npm', ['init', '-y']);
      if (npmInit.exitCode !== 0) throw new Error(`Sandbox npm initialization failed: ${await npmInit.stderr()}`);
      const playwright = await sandbox.runCommand('npm', ['install', 'playwright@1.54.1']);
      if (playwright.exitCode !== 0) throw new Error(`Sandbox Playwright installation failed: ${await playwright.stderr()}`);
      const chromium = await sandbox.runCommand('npx', ['playwright', 'install', 'chromium']);
      if (chromium.exitCode !== 0) throw new Error(`Sandbox Chromium installation failed: ${await chromium.stderr()}`);
    }
  });
  if (!template.currentSnapshotId) await template.snapshot({ expiration: 0 });
  return template;
}

export async function executeSandboxRun(input, { urlValidator = assertPublicUrl, sandboxApi = Sandbox, projectBinding = 'stratus-managed' } = {}) {
  if (input?.continuationToken != null) {
    const continuation = normalizeManagedContinuation(input);
    const sandboxName = continuationSandboxName(projectBinding, continuation.continuationToken);
    let sandbox;
    try {
      sandbox = await sandboxApi.get({ name: sandboxName, resume: true });
      const claim = await sandbox.runCommand('node', [
        '-e', CLAIM_CONTINUATION_SCRIPT, digest(continuation.continuationToken), digest(projectBinding)
      ]);
      if (claim.exitCode !== 0) {
        throw Object.assign(new Error('Continuation is expired, already used, or does not belong to this project'), { status: 409, code: 'CONTINUATION_REJECTED' });
      }
      await sandbox.writeFiles([{ path: 'stratus-continuation-input.json', content: Buffer.from(JSON.stringify(continuation)) }]);
      const produced = await waitForSandboxFile(sandbox, ['stratus-result-1.json', 'stratus-error.json'], CONTINUATION_TIMEOUT_MS, {
        message: 'Managed browser continuation timed out', status: 410, code: 'CONTINUATION_EXPIRED'
      });
      if (produced === 'stratus-error.json') await throwSandboxRunnerError(sandbox);
      const resultBuffer = await sandbox.readFileToBuffer({ path: 'stratus-result-1.json' });
      if (!resultBuffer) throw Object.assign(new Error('Sandbox browser did not produce a continuation result'), { status: 502, code: 'SANDBOX_RESULT_MISSING' });
      const result = JSON.parse(resultBuffer.toString('utf8'));
      if (continuation.screenshot) {
        const screenshot = await sandbox.readFileToBuffer({ path: 'stratus-screenshot-1.png' });
        result.screenshot = screenshot?.toString('base64') || null;
      }
      return result;
    } catch (error) {
      if (error?.code) throw error;
      throw Object.assign(new Error('Continuation is expired, already used, or does not belong to this project'), { status: 409, code: 'CONTINUATION_REJECTED' });
    } finally {
      if (sandbox) await sandbox.stop().catch(() => {});
    }
  }

  const context = await normalizeManagedRun(input, { urlValidator });
  let sandbox;
  let keepAlive = false;
  try {
    const template = sandboxApi === Sandbox
      ? await ensureSandboxTemplate()
      : await sandboxApi.get({ name: SANDBOX_NAME, resume: false });
    const continuationToken = context.requestContinuation ? crypto.randomBytes(32).toString('base64url') : null;
    const continuationExpiresAt = context.requestContinuation
      ? new Date(Date.now() + context.continuationTtlSeconds * 1000).toISOString()
      : null;
    if (continuationExpiresAt) context.continuationExpiresAt = continuationExpiresAt;
    sandbox = await sandboxApi.fork({
      sourceSandbox: template.name,
      ...(continuationToken ? { name: continuationSandboxName(projectBinding, continuationToken) } : {}),
      /* The sandbox has to outlive whatever the caller is allowed to wait for, or the wait times
         out against a box that is already gone and the run is reported as slow rather than as
         evicted. Two things can be waited on: the run itself and, after it, one continuation. */
      timeout: context.requestContinuation
        ? Math.max((context.continuationTtlSeconds + 30) * 1000, MANAGED_RUN_TIMEOUT_MS + CONTINUATION_TIMEOUT_MS + 30_000)
        : MANAGED_RUN_TIMEOUT_MS,
      resources: { vcpus: 2 },
      persistent: false,
      networkPolicy: 'allow-all'
    });
    const files = [
      { path: 'stratus-runner.cjs', content: Buffer.from(SANDBOX_RUNNER) },
      { path: 'stratus-input.json', content: Buffer.from(JSON.stringify(context)) }
    ];
    if (continuationToken) files.push({
      path: 'stratus-continuation.json',
      content: Buffer.from(JSON.stringify({
        tokenHash: digest(continuationToken),
        projectHash: digest(projectBinding),
        host: context.allowedHost,
        expiresAt: continuationExpiresAt,
        used: false
      }))
    });
    await sandbox.writeFiles(files);
    if (context.requestContinuation) {
      await sandbox.runCommand({ cmd: 'node', args: ['stratus-runner.cjs'], detached: true });
      /* THE SAME BUDGET THE RUN WOULD HAVE HAD WITHOUT A CONTINUATION, and a timeout here is named
       * for what it is. `Managed browser continuation timed out` on a form with no challenge, no
       * continuation and no phase 1 was a sentence about a feature that had not been used, and it
       * is what the Skydio packet reported to its applicant. */
      const produced = await waitForSandboxFile(sandbox, ['stratus-result-0.json', 'stratus-error.json'], MANAGED_RUN_TIMEOUT_MS, {
        message: 'Managed browser run timed out before it produced a result', status: 504, code: 'RUN_TIMED_OUT'
      });
      if (produced === 'stratus-error.json') await throwSandboxRunnerError(sandbox);
    } else {
      const command = await sandbox.runCommand('node', ['stratus-runner.cjs']);
      if (command.exitCode !== 0) {
        throw Object.assign(new Error((await command.stderr()).trim() || 'Sandbox browser run failed'), { status: 502, code: 'SANDBOX_RUN_FAILED' });
      }
    }
    const resultBuffer = await sandbox.readFileToBuffer({ path: 'stratus-result-0.json' });
    if (!resultBuffer) throw Object.assign(new Error('Sandbox browser did not produce a result'), { status: 502, code: 'SANDBOX_RESULT_MISSING' });
    const result = JSON.parse(resultBuffer.toString('utf8'));
    if (context.screenshot) {
      const screenshot = await sandbox.readFileToBuffer({ path: 'stratus-screenshot-0.png' });
      result.screenshot = screenshot?.toString('base64') || null;
    }
    if (continuationToken && continuationEligible(result, context.continuationCheckpoint)) {
      keepAlive = true;
      result.continuationToken = continuationToken;
      result.continuationExpiresAt = continuationExpiresAt;
    }
    return result;
  } catch (error) {
    if (error?.code) throw error;
    throw Object.assign(new Error(`Vercel Sandbox browser request failed: ${error.message}`), { status: 502, code: 'SANDBOX_UNAVAILABLE' });
  } finally {
    if (sandbox && !keepAlive) await sandbox.stop().catch(() => {});
  }
}

export async function executeManagedRun(input, { urlValidator = assertPublicUrl, sandboxExecutor = executeSandboxRun, projectBinding = 'stratus-managed' } = {}) {
  return sandboxExecutor(input, { urlValidator, projectBinding });
}
