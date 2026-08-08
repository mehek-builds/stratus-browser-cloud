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
      const text = await container.evaluate((element) => {
        const widget = element.closest('[class*="select__container"], [class*="select-shell"]')
          || (element.closest('[class*="select__control"]') || {}).parentElement
          || element;
        // The chosen value is rendered as its own node, and reading it beats reading the widget:
        // the widget's textContent also carries the question label, and a label is quite capable of
        // containing the answer word ("...currently enrolled in a degree program?" contains "no").
        const chosen = widget.querySelector('[class*="select__single-value"], [class*="select__multi-value__label"]');
        if (chosen) return chosen.textContent || '';
        // Still showing "Select...", so nothing was chosen. Returning empty rather than falling
        // through to textContent stops the label from being mistaken for an answer.
        if (widget.querySelector('[class*="select__placeholder"]')) return '';
        return element.textContent || '';
      }).catch(() => '');
      return optionMatches(text, expected) || answerOptions(expected).some((option) => normalized(text).includes(normalized(option)));
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
    const fillCustomChoice = async (container, wanted) => {
      const controls = container.locator('[role="combobox"], [aria-haspopup="listbox"], .select2-choice, .select2-container, [class*="select2-choice"], [class*="select2-container"], button, [role="button"]');
      const clickMatchingOption = async () => {
        for (const option of answerOptions(wanted)) {
          const optionLocator = page.getByRole('option', { name: option, exact: false }).first();
          if ((await optionLocator.count()) > 0 && await optionLocator.isVisible().catch(() => false)) {
            await optionLocator.click();
            return true;
          }
          const textLocator = page
            .locator('[role="option"], [role="listbox"] *, .select2-result, .select2-results li, [class*="select2-result"], li, [data-value]')
            .filter({ hasText: option })
            .first();
          if ((await textLocator.count()) > 0 && await textLocator.isVisible().catch(() => false)) {
            await textLocator.click();
            return true;
          }
        }
        return false;
      };
      const total = await controls.count();
      for (let index = 0; index < total; index += 1) {
        const control = controls.nth(index);
        if (!await control.isVisible().catch(() => false)) continue;
        await control.click().catch(() => undefined);
        await page.waitForTimeout(150).catch(() => undefined);
        if (await clickMatchingOption()) return true;
        for (const option of answerOptions(wanted)) {
          await control.fill('').catch(() => undefined);
          await control.fill(option).catch(async () => {
            await page.keyboard.press('Control+A').catch(() => undefined);
            await page.keyboard.press('Backspace').catch(() => undefined);
            await page.keyboard.type(option, { delay: 5 }).catch(() => undefined);
          });
          await page.waitForTimeout(1200).catch(() => undefined);
          if (await clickMatchingOption()) return true;
        }
        await page.keyboard.press('Escape').catch(() => undefined);
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
      const widgetOf = (element) => element.closest(
        '[class*="select__container"], .field, .field-wrapper, .file-upload, fieldset, [role="group"]'
      ) || element.parentElement || element;
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
          widget && widget.getAttribute('aria-label')
        ]) {
          const text = clean(candidate);
          if (!text) continue;
          // A machine identifier is not a label. Greenhouse names custom questions with UUIDs and
          // numeric tokens, and "question_19302464004 is required" tells the applicant nothing.
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) continue;
          if (!/[a-z]/i.test(text)) continue;
          return text.slice(0, 120);
        }
        return '';
      };
      // Does this question have an answer? Asked of the WIDGET, because on the two control families
      // that matter here the answer does not live in an input's value at all:
      //   - a React Select renders its answer as '.select__single-value' text and shows
      //     '.select__placeholder' when it has none;
      //   - Greenhouse's uploader REMOVES the file input once the upload finishes and replaces it
      //     with a filename chip, so "no input[type=file] with files" is true of a widget that has
      //     already been given a file.
      const widgetHasAnswer = (widget) => {
        if (!widget) return false;
        if (widget.querySelector('[class*="select__single-value"], [class*="select__multi-value__label"]')) return true;
        if (widget.querySelector('[class*="select__placeholder"]')) return false;
        if (widget.querySelector('.file-upload__filename, [class*="file-upload__filename"], [aria-label="Remove file" i]')) return true;
        for (const control of widget.querySelectorAll('input, textarea, select')) {
          if (control.type === 'hidden') continue;
          if (control.type === 'file') {
            if (control.files && control.files.length > 0) return true;
            continue;
          }
          if (control.type === 'checkbox' || control.type === 'radio') {
            if (control.checked) return true;
            continue;
          }
          // A combobox input holds the SEARCH text, which react-select clears on selection. Its
          // emptiness says nothing about whether an option was chosen.
          if (control.getAttribute('role') === 'combobox') continue;
          if (clean(control.value)) return true;
        }
        return false;
      };
      const required = [];
      const seen = new Set();
      const note = (widget, element, why) => {
        if (!widget || seen.has(widget)) return;
        seen.add(widget);
        if (!isVisible(widget)) return;
        if (widgetHasAnswer(widget)) return;
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
        const control = widget.querySelector('input:not([type="hidden"]), textarea, select, [role="combobox"]');
        if (!control) continue;
        if (widgetHasAnswer(widget)) { stale.push(text); continue; }
        // note() dedupes on the widget itself, so a field already reported by the required scan is
        // not reported twice for carrying the matching error line.
        note(widget, control, 'error');
      }
      return {
        blocking: required.map((entry) => entry.message),
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
    for (const action of input.actions || []) {
     try {
      const locator = action.selector ? page.locator(action.selector).first() : null;
      if (locator && action.optional && await locator.count() === 0) continue;
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
        // hand. Deliberately excludes select/radio/checkbox, matching the caller's own fill scope:
        // it never clicks a choice control, so there is nothing useful to discover there either.
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
            const parts = [labelText || '', el.getAttribute('aria-label') || '', el.getAttribute('placeholder') || '', el.getAttribute('name') || '', el.id || ''];
            const own = clean(parts.join(' ')).toLowerCase();
            const fallbackText = nearestQuestionText(el);
            if (own && !genericControlText(own)) return own;
            return fallbackText || own;
          }
          const els = Array.prototype.slice
            .call(document.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input[type="number"], input[type="date"], input:not([type]), textarea'))
            .filter((el) => !el.closest('[id*="litos"]') && !el.disabled && !el.readOnly && isVisible(el) && !isHoneypot(el));
          const out = [];
          let counter = 0;
          for (let i = 0; i < els.length; i += 1) {
            const el = els[i];
            const label = clean(questionLabel(el));
            if (!label) continue;
            counter += 1;
            const marker = 'data-litos-discovered-' + counter;
            el.setAttribute(marker, '1');
            out.push({
              label: label,
              selector: '[' + marker + ']',
              inputType: el.tagName === 'TEXTAREA' ? 'textarea' : (el.type || 'text'),
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
    const required = page.locator('input[required], textarea[required], select[required]');
    // A checkbox or radio GROUP is one question wearing many required inputs. Reporting each input
    // separately turned three unanswered Greenhouse questions into seventeen blockers, every one of
    // them naming an option ("Statistics", "Putnam", "Handshake") rather than the question the
    // applicant actually has to answer. One entry per group, named by the question.
    const reportedGroups = new Set();
    for (let index = 0; index < await required.count(); index += 1) {
      const field = required.nth(index);
      if (!await field.isVisible().catch(() => false)) continue;
      const groupName = await field.evaluate((element) => (
        element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')
          ? element.name || ''
          : ''
      )).catch(() => '');
      if (groupName) {
        if (reportedGroups.has(groupName)) continue;
        reportedGroups.add(groupName);
      }
      const state = await field.evaluate((element) => {
        if (element instanceof HTMLInputElement && element.type === 'file') return element.files?.length ? 'filled' : '';
        if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
          // A checkbox reports value "on" whether or not it is ticked, so the old check treated
          // every unticked required checkbox as already satisfied and never reported it.
          const group = element.name ? document.getElementsByName(element.name) : [element];
          return Array.from(group).some((member) => member.checked) ? 'checked' : '';
        }
        return 'value' in element ? String(element.value || '') : '';
      });
      if (state) continue;
      // Resolve a HUMAN label. The old line fell back to the name attribute and then to the
      // literal string 'required field', which produced the two blocker texts the dashboard was
      // actually showing applicants:
      //   "5a326a1d-1a9e-42b1-a918-ca74022064dc is required"  (Greenhouse names custom questions
      //                                                        with UUIDs, so the name attr is a token)
      //   "required field is required"                        (the literal fallback, doubled)
      // Neither tells the applicant which field to go and fix, which is the entire job of a blocker.
      const label = await field.evaluate((element) => {
        const clean = (value) => (value || '').replace(/\s+/g, ' ').trim().replace(/[\s*:]+$/, '');
        const byFor = element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
        const describedBy = element.getAttribute('aria-labelledby');
        const referenced = describedBy && document.getElementById(describedBy.split(/\s+/)[0]);
        const wrapping = element.closest('label');
        const legend = element.closest('fieldset') && element.closest('fieldset').querySelector('legend');
        const genericControlText = (value) => /^(pick|select|choose)\s+(date|option)|^(type|enter|write)\s+(your\s+)?(answer\s+)?here/i.test(clean(value));
        const nearestQuestionText = (start) => {
          let block = start.parentElement;
          for (let depth = 0; block && depth < 6; depth += 1, block = block.parentElement) {
            if (!block.matches('div, section, li, fieldset')) continue;
            const candidate = block.querySelector('label, legend, .question, h3, h4');
            const text = clean((candidate && candidate.textContent) || '');
            if (text && !genericControlText(text)) return text;
          }
          return '';
        };
        // For a checkbox or radio, the per-option sources describe the OPTION ("Statistics",
        // "Putnam"), not the question the applicant has to answer. Ask the group for its question
        // first, and only fall back to the option text if the form gives nothing better.
        const isChoice = element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio');
        const groupSources = isChoice
          ? [legend && legend.textContent, element.getAttribute('description'), referenced && referenced.textContent]
          : [];
        for (const candidate of [
          ...groupSources,
          byFor && byFor.textContent,
          referenced && referenced.textContent,
          wrapping && wrapping.textContent,
          element.getAttribute('aria-label'),
          element.getAttribute('description'),
          legend && legend.textContent,
          nearestQuestionText(element),
          element.getAttribute('placeholder')
        ]) {
          const text = clean(candidate);
          // Reject machine identifiers rather than dressing one up as a label.
          if (!text) continue;
          if (genericControlText(text) && candidate !== element.getAttribute('placeholder')) continue;
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) continue;
          if (!/[a-z]/i.test(text)) continue;
          return text.slice(0, 120);
        }
        return '';
      }).catch(() => '');
      blockers.push(label ? '"' + label + '" is required and is still empty'
                          : 'A required field on the form has no label Litos can read, and is still empty');
    }
    const requiredFileGroups = page.locator('[role="group"][aria-required="true"]:has(input[type="file"])');
    const reportedFileGroups = new Set();
    for (let index = 0; index < await requiredFileGroups.count(); index += 1) {
      const group = requiredFileGroups.nth(index);
      if (!await group.isVisible().catch(() => false)) continue;
      const groupKey = await group.evaluate((element) => element.getAttribute('aria-labelledby') || element.id || '').catch(() => '');
      if (groupKey && reportedFileGroups.has(groupKey)) continue;
      if (groupKey) reportedFileGroups.add(groupKey);
      const hasFile = await group.locator('input[type="file"]').evaluateAll((inputs) => (
        inputs.some((input) => input instanceof HTMLInputElement && (input.files?.length || 0) > 0)
      )).catch(() => false);
      if (hasFile) continue;
      const label = await group.evaluate((element) => {
        const clean = (value) => (value || '').replace(/\s+/g, ' ').trim().replace(/[\s*:]+$/, '');
        const labelledBy = element.getAttribute('aria-labelledby');
        const referenced = labelledBy && document.getElementById(labelledBy.split(/\s+/)[0]);
        const label = element.querySelector('.upload-label, label, legend, .question, h3, h4');
        for (const candidate of [
          referenced && referenced.textContent,
          label && label.textContent,
          element.getAttribute('aria-label')
        ]) {
          const text = clean(candidate);
          if (!text) continue;
          if (!/[a-z]/i.test(text)) continue;
          return text.slice(0, 120);
        }
        return '';
      }).catch(() => '');
      blockers.push(label ? '"' + label + '" is required and is still empty'
                          : 'A required file upload on the form has no label Litos can read, and is still empty');
    }
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
