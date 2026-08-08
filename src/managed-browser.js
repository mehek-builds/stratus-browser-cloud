import { assertPublicUrl } from './security.js';
import { Sandbox } from '@vercel/sandbox';

export const FREE_MANAGED_LIMITS = Object.freeze({
  concurrentBrowsers: 10,
  monthlyCpuHours: 5,
  maxRunSeconds: 60,
  persistedDays: 30
});

const ALLOWED_ACTIONS = new Set(['click', 'fill', 'fillByLabelText', 'upload', 'waitForSelector', 'press', 'select', 'extract', 'discover']);
const MAX_ACTIONS = 120;
const MAX_VALUE_LENGTH = 10_000;
const MAX_FILE_BASE64_LENGTH = 6_000_000;

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
const { chromium } = require('playwright');

(async () => {
  const input = JSON.parse(fs.readFileSync('stratus-input.json', 'utf8'));
  const startedAt = Date.now();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const browserContext = await browser.newContext({ viewport: input.viewport || { width: 1440, height: 900 } });
    const page = await browserContext.newPage();
    const waitUntil = input.waitUntil === 'networkidle2' || input.waitUntil === 'networkidle0' ? 'networkidle' : input.waitUntil;
    await page.goto(input.url, { waitUntil, timeout: 45000 });
    const extracted = [];
    const filledFields = [];
    const skipped = [];
    const discovered = [];
    // Filled by the pre-submit gate, and merged into 'blockers' after the loop. It has to be
    // declared up here because the gate runs mid-loop, before the final click, while 'blockers' is
    // only assembled once every action has run.
    const submitGateBlockers = [];
    const clean = (value) => String(value == null ? '' : value).replace(/\s+/g, ' ').trim();
    const normalized = (value) => clean(value).toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const answerOptions = (value) => {
      const base = clean(value);
      const lower = base.toLowerCase();
      const options = [base];
      if (/^yes$/.test(lower)) options.push('yes', 'i agree', 'agree', 'true');
      if (/^no$/.test(lower)) options.push('no', 'false');
      if (/decline|self-identify|prefer not|do not wish|don't wish|not wish/i.test(base)) {
        options.push(
          'decline to self-identify',
          'i do not wish to answer',
          "i don't wish to answer",
          'i do not wish to disclose',
          'prefer not to answer',
          'prefer not to say'
        );
      }
      return [...new Set(options.filter(Boolean))];
    };
    const optionMatches = (candidate, wanted) => {
      const a = normalized(candidate);
      if (!a) return false;
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
    const readSubmitReadiness = () => page.evaluate(() => {
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
      /* The question a control sits under, when the control itself is labelled with nothing useful.
       *
       * Restored here from the end-of-run scan this gate replaced, where it was the only reason an
       * Ashby datepicker blocker read "Are you currently enrolled in a degree program? If so,
       * expected graduation date?" instead of "Pick date...". Losing it would have made the blocker
       * name the widget rather than the question, which is the same defect as naming a UUID.
       */
      const genericControlText = (value) => /^(pick|select|choose)\s+(date|option)|^(type|enter|write)\s+(your\s+)?(answer\s+)?here/i.test(clean(value));
      const nearestQuestionText = (start) => {
        let block = start && start.parentElement;
        for (let depth = 0; block && depth < 6; depth += 1, block = block.parentElement) {
          if (!block.matches || !block.matches('div, section, li, fieldset')) continue;
          const candidate = block.querySelector('label, legend, .question, h3, h4');
          const text = clean((candidate && candidate.textContent) || '');
          if (text && !genericControlText(text)) return text;
        }
        return '';
      };
      const labelOf = (widget, element) => {
        const labelledBy = (widget && widget.getAttribute('aria-labelledby'))
          || (element && element.getAttribute('aria-labelledby'));
        const referenced = labelledBy && document.getElementById(labelledBy.split(/\s+/)[0]);
        const byFor = element && element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
        const legend = widget && widget.querySelector('legend');
        const own = widget && widget.querySelector('label, .label, .upload-label, legend');
        for (const candidate of [
          referenced && referenced.textContent,
          byFor && byFor.textContent,
          legend && legend.textContent,
          own && own.textContent,
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
      for (const element of document.querySelectorAll(
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
      for (const marker of document.querySelectorAll('label[class*="_required_"], legend[class*="_required_"]')) {
        const widget = widgetOf(marker);
        if (!widget || !isVisible(widget)) continue;
        // The control this label speaks for. 'for=' first, because Ashby sets it even where the input
        // it names has no id of its own (the location combobox), in which case the lookup misses and
        // the block's first real control is the right answer. A file input is excluded from the
        // fallback for the same reason hasAnswer treats uploads specially: the widget, not the input,
        // is what holds the evidence of an upload.
        const named = marker.getAttribute('for');
        const target = (named && widget.querySelector('#' + CSS.escape(named)))
          || widget.querySelector('input:not([type="hidden"]):not([type="file"]), textarea, select, [role="combobox"]')
          || widget;
        if (target.disabled) continue;
        note(widget, target, 'required');
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
      for (const element of document.querySelectorAll('*')) {
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
    }).catch(() => ({ blocking: [], stale: [], unmatched: [] }));
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
    for (const action of input.actions || []) {
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
      if (action.type === 'click') {
        await locator.click();
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
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
        await locator.fill(action.value || '');
        await locator.evaluate((element) => {
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
        }).catch(() => undefined);
        if (action.label && await verifyFilled(locator, action.value || '')) filledFields.push(action.label);
        else if (action.label) skipped.push(action.label + ': value did not persist after fill');
      }
      if (action.type === 'fillByLabelText') {
        const label = page.getByText(action.text, { exact: false }).first();
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
          // Scoped to THIS question's container, never the whole page. That scoping is what makes
          // matching an answer as short as "Yes" safe: an unscoped label match could tick a consent
          // or legal acknowledgement elsewhere on the form, which the applicant cannot undo.
          const wanted = String(action.value || '').trim();
          const choices = container.locator('input[type=checkbox], input[type=radio]');
          const total = await choices.count();
          let matched = false;
          for (let choice = 0; choice < total; choice += 1) {
            const option = choices.nth(choice);
            const optionText = await option.evaluate((element) => {
              const byFor = element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
              const wrapping = element.closest('label');
              return ((byFor && byFor.textContent) || (wrapping && wrapping.textContent) || element.getAttribute('aria-label') || element.value || '').trim();
            });
            if (optionText && optionMatches(optionText, wanted)) {
              await option.check();
              matched = true;
              break;
            }
          }
          // Before the single-checkbox heuristic below, because on Ashby that heuristic is precisely
          // the wrong move: the one checkbox in the block is the display:none mirror of a pill pair,
          // so checking it neither drives React nor distinguishes Yes from No. See pickOptionPill.
          if (!matched && await pickOptionPill(container, wanted)) {
            matched = true;
          }
          if (!matched && total === 1 && /^yes$/i.test(wanted)) {
            await choices.first().check();
            matched = true;
          }
          // No exact option match means the answer does not belong to this control. Leaving it
          // unticked is correct: it surfaces as a required-field blocker for the applicant, which is
          // far cheaper than guessing a checkbox on their behalf.
          if (!matched) continue;
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
        if (action.label && await verifyFilled(field, action.value || '')) filledFields.push(action.label);
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
    const readiness = await readSubmitReadiness();
    blockers.push(...readiness.blocking);
    const title = await page.title();
    const url = page.url();
    const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 50000));
    const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map((link) => ({ text: (link.innerText || link.textContent || '').trim().slice(0, 500), href: link.href })));
    if (input.screenshot) await page.screenshot({ path: 'stratus-screenshot.png', fullPage: Boolean(input.fullPage) });
    // 'skipped' is reported, never swallowed: an optional action that failed is something the
    // caller should be able to see and act on, and a silent skip is how a half-filled form starts
    // looking like a fully-filled one.
    fs.writeFileSync('stratus-result.json', JSON.stringify({ title, url, text, links, extracted, discovered, filledFields: [...new Set(filledFields)], blockers: [...new Set(blockers)], skipped: [...new Set(skipped)], elapsedMs: Date.now() - startedAt }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
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
    if (action.type === 'extract' && action.attribute != null) {
      if (typeof action.attribute !== 'string' || action.attribute.length > 100) {
        throw inputError('Extract attributes must be strings no longer than 100 characters', 'INVALID_ATTRIBUTE');
      }
      normalized.attribute = action.attribute;
    }
    return normalized;
  });
}

export async function normalizeManagedRun(input = {}, { urlValidator = assertPublicUrl } = {}) {
  if (!input || typeof input !== 'object') throw inputError('Request body must be a JSON object');
  const url = await urlValidator(input.url);
  const viewport = input.viewport || {};
  const width = Math.min(Math.max(Number(viewport.width) || 1440, 320), 1920);
  const height = Math.min(Math.max(Number(viewport.height) || 900, 240), 1080);
  return {
    url: url.toString(),
    actions: normalizeManagedActions(input.actions),
    screenshot: input.screenshot !== false,
    fullPage: Boolean(input.fullPage),
    waitUntil: ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'].includes(input.waitUntil) ? input.waitUntil : 'networkidle2',
    viewport: { width, height }
  };
}

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

export async function executeSandboxRun(input, { urlValidator = assertPublicUrl, sandboxApi = Sandbox } = {}) {
  const context = await normalizeManagedRun(input, { urlValidator });
  let sandbox;
  try {
    const template = sandboxApi === Sandbox
      ? await ensureSandboxTemplate()
      : await sandboxApi.get({ name: SANDBOX_NAME, resume: false });
    sandbox = await sandboxApi.fork({
      sourceSandbox: template.name,
      timeout: 90_000,
      resources: { vcpus: 2 },
      persistent: false,
      networkPolicy: 'allow-all'
    });
    await sandbox.writeFiles([
      { path: 'stratus-runner.cjs', content: Buffer.from(SANDBOX_RUNNER) },
      { path: 'stratus-input.json', content: Buffer.from(JSON.stringify(context)) }
    ]);
    const command = await sandbox.runCommand('node', ['stratus-runner.cjs']);
    if (command.exitCode !== 0) {
      throw Object.assign(new Error((await command.stderr()).trim() || 'Sandbox browser run failed'), { status: 502, code: 'SANDBOX_RUN_FAILED' });
    }
    const resultBuffer = await sandbox.readFileToBuffer({ path: 'stratus-result.json' });
    if (!resultBuffer) throw Object.assign(new Error('Sandbox browser did not produce a result'), { status: 502, code: 'SANDBOX_RESULT_MISSING' });
    const result = JSON.parse(resultBuffer.toString('utf8'));
    if (context.screenshot) {
      const screenshot = await sandbox.readFileToBuffer({ path: 'stratus-screenshot.png' });
      result.screenshot = screenshot?.toString('base64') || null;
    }
    return result;
  } catch (error) {
    if (error?.code) throw error;
    throw Object.assign(new Error(`Vercel Sandbox browser request failed: ${error.message}`), { status: 502, code: 'SANDBOX_UNAVAILABLE' });
  } finally {
    if (sandbox) await sandbox.stop().catch(() => {});
  }
}

export async function executeManagedRun(input, { urlValidator = assertPublicUrl, sandboxExecutor = executeSandboxRun } = {}) {
  return sandboxExecutor(input, { urlValidator });
}
