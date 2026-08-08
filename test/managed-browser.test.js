import test from 'node:test';
import assert from 'node:assert/strict';
import { executeManagedRun, FREE_MANAGED_LIMITS, normalizeManagedActions, SANDBOX_RUNNER } from '../src/managed-browser.js';

function extractFunctionSource(name) {
  const start = SANDBOX_RUNNER.indexOf(`function ${name}`);
  assert.notEqual(start, -1, `${name} must exist in the sandbox runner`);
  const open = SANDBOX_RUNNER.indexOf('{', start);
  let depth = 0;
  for (let index = open; index < SANDBOX_RUNNER.length; index += 1) {
    if (SANDBOX_RUNNER[index] === '{') depth += 1;
    if (SANDBOX_RUNNER[index] === '}') {
      depth -= 1;
      if (depth === 0) return SANDBOX_RUNNER.slice(start, index + 1);
    }
  }
  throw new Error(`Could not extract ${name}`);
}

function sandboxQuestionLabel() {
  const source = extractFunctionSource('questionLabel');
  const clean = (value) => (value == null ? '' : value).replace(/[​‌‍﻿ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const fakeDocument = { querySelector: () => null };
  const fakeCss = { escape: (value) => String(value) };
  return Function('clean', 'document', 'CSS', `return (${source});`)(clean, fakeDocument, fakeCss);
}

function mockElement({ attrs = {}, textContent = '', parentElement = null, queryResult = null } = {}) {
  return {
    id: attrs.id || '',
    labels: [],
    parentElement,
    textContent,
    getAttribute(name) {
      return attrs[name] ?? null;
    },
    closest() {
      return null;
    },
    matches(selector) {
      return /div|section|li|fieldset/.test(selector);
    },
    querySelector() {
      return queryResult;
    }
  };
}

test('managed free limits are explicit and do not claim paid capacity', () => {
  assert.deepEqual(FREE_MANAGED_LIMITS, { concurrentBrowsers: 10, monthlyCpuHours: 5, maxRunSeconds: 60, persistedDays: 30 });
});

test('managed actions accept bounded declarative operations', () => {
  assert.deepEqual(normalizeManagedActions([
    { type: 'fill', selector: '#email', value: 'person@example.com' },
    { type: 'press', value: 'Enter' },
    { type: 'extract', selector: 'h1', label: 'filled_field:title' }
  ]), [
    { type: 'fill', selector: '#email', value: 'person@example.com' },
    { type: 'press', value: 'Enter' },
    { type: 'extract', selector: 'h1', label: 'filled_field:title' }
  ]);
  assert.throws(() => normalizeManagedActions([{ type: 'evaluate', value: 'process.exit()' }]), (error) => error.code === 'INVALID_ACTION');
  assert.throws(() => normalizeManagedActions(Array.from({ length: 121 }, () => ({ type: 'click', selector: 'button' }))), (error) => error.code === 'TOO_MANY_ACTIONS');
});

test('managed actions accept reviewed questions and bounded resume uploads', () => {
  assert.deepEqual(normalizeManagedActions([
    { type: 'fillByLabelText', text: 'Why this role?', value: 'I enjoy platform engineering.', label: 'question:Why this role?' },
    { type: 'upload', selector: '#resume', optional: true, label: 'resume', file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: 'cGRm' } }
  ]), [
    { type: 'fillByLabelText', text: 'Why this role?', value: 'I enjoy platform engineering.', label: 'question:Why this role?' },
    { type: 'upload', selector: '#resume', optional: true, label: 'resume', file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: 'cGRm' } }
  ]);
  assert.throws(
    () => normalizeManagedActions([{ type: 'upload', selector: '#resume', file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: 'x'.repeat(6_000_001) } }]),
    (error) => error.code === 'INVALID_UPLOAD'
  );
  assert.throws(
    () => normalizeManagedActions([{ type: 'upload', selector: '#resume', file: { name: '../resume.pdf', mimeType: 'application/pdf', base64: 'cGRm' } }]),
    (error) => error.code === 'INVALID_UPLOAD'
  );
});

test('sandbox runner is syntactically valid and returns labelled extracts', () => {
  assert.doesNotThrow(() => new Function(SANDBOX_RUNNER));
  assert.match(SANDBOX_RUNNER, /extracted\.push\(\{ selector: action\.selector, label: action\.label, value \}\)/);
});

test('managed run always uses the Stratus Sandbox execution system', async () => {
  const sandboxExecutor = async (input) => ({ title: 'Sandbox', url: input.url, screenshot: 'sandbox-image' });
  const result = await executeManagedRun({ url: 'https://example.com' }, { sandboxExecutor });
  assert.equal(result.title, 'Sandbox');
  assert.equal(result.screenshot, 'sandbox-image');
});

// The runner ships to the sandbox as a string, so nothing type-checks it and a regression only
// shows up when a real application fails on a real portal. These pin the branches that cost three
// deploys to find, against a live Greenhouse form (Aquatic Capital Management, 2026-07-23).

test('an optional action that THROWS is stepped over, not fatal to the run', () => {
  // The old guard was `if (locator && action.optional && count === 0) continue`, which only covered
  // a MISSING element and never applied to fillByLabelText at all (no selector, so locator is null).
  // One unfillable checkbox therefore discarded the name, email, phone and resume already entered.
  assert.match(SANDBOX_RUNNER, /catch \(actionError\)/);
  assert.match(SANDBOX_RUNNER, /if \(!action\.optional\) throw actionError;/);
  assert.match(SANDBOX_RUNNER, /skipped\.push\(/);
});

test('a skipped action is reported rather than swallowed', () => {
  // A silent skip is how a half-filled form starts looking like a fully-filled one.
  assert.match(SANDBOX_RUNNER, /skipped: \[\.\.\.new Set\(skipped\)\]/);
  assert.match(SANDBOX_RUNNER, /fillByLabelText: label not found/);
  assert.match(SANDBOX_RUNNER, /fillByLabelText: field not found/);
});

test('fillByLabelText dispatches on the control type', () => {
  // Everything used to fall through to fill(), which throws on a checkbox or radio.
  assert.match(SANDBOX_RUNNER, /shape\.tag === 'select'/);
  assert.match(SANDBOX_RUNNER, /shape\.type === 'checkbox' \|\| shape\.type === 'radio'/);
  assert.match(SANDBOX_RUNNER, /await option\.check\(\)/);
});

test('fills are reported only after the page keeps the value', () => {
  assert.match(SANDBOX_RUNNER, /const verifyFilled = async \(field, expected\) =>/);
  assert.match(SANDBOX_RUNNER, /const verifyChoiceInContainer = async \(container, expected\) =>/);
  assert.match(SANDBOX_RUNNER, /value did not persist after fill/);
  assert.match(SANDBOX_RUNNER, /value did not persist after fillByLabelText/);
  assert.match(SANDBOX_RUNNER, /dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
});

test('fillByLabelText can use scoped custom listbox controls', () => {
  assert.match(SANDBOX_RUNNER, /const fillCustomChoice = async \(container, wanted\) =>/);
  assert.match(SANDBOX_RUNNER, /\[role="combobox"\], \[aria-haspopup="listbox"\]/);
  assert.match(SANDBOX_RUNNER, /page\.getByRole\('option', \{ name: option, exact: false \}\)/);
  assert.match(SANDBOX_RUNNER, /\[role="option"\], \[role="listbox"\] \*, .*li, \[data-value\]/);
  assert.match(SANDBOX_RUNNER, /const customSelected = await fillCustomChoice\(container, action\.value \|\| ''\)/);
});

test('fillByLabelText handles Greenhouse Select2 controls before hidden native selects', () => {
  assert.match(SANDBOX_RUNNER, /\.select2-choice, \.select2-container/);
  assert.match(SANDBOX_RUNNER, /\.select2-result, \.select2-results li/);
  assert.match(SANDBOX_RUNNER, /const customSelected = await fillCustomChoice\(container, action\.value \|\| ''\)/);
  assert.match(SANDBOX_RUNNER, /if \(!customSelected\) \{/);
  assert.match(SANDBOX_RUNNER, /if \(customSelected\) selected = true;/);
});

test('React Select comboboxes are filled as choices, not plain text', () => {
  assert.match(SANDBOX_RUNNER, /fillShape\.role === 'combobox'/);
  assert.match(SANDBOX_RUNNER, /shape\.role === 'combobox'/);
  assert.match(SANDBOX_RUNNER, /ariaAutocomplete === 'list'/);
  assert.match(SANDBOX_RUNNER, /const clickMatchingOption = async \(\) =>/);
  assert.match(SANDBOX_RUNNER, /await control\.fill\(option\)/);
  assert.match(SANDBOX_RUNNER, /await page\.keyboard\.type\(option, \{ delay: 5 \}\)/);
  assert.match(SANDBOX_RUNNER, /waitForTimeout\(1200\)/);
  assert.match(SANDBOX_RUNNER, /choice value did not persist after fill/);
  assert.match(SANDBOX_RUNNER, /choice value did not persist after fillByLabelText/);
});

test('decline style EEO answers can match common portal option text', () => {
  assert.match(SANDBOX_RUNNER, /const answerOptions = \(value\) =>/);
  assert.match(SANDBOX_RUNNER, /i do not wish to answer/);
  assert.match(SANDBOX_RUNNER, /prefer not to answer/);
  assert.match(SANDBOX_RUNNER, /optionMatches\(optionText, wanted\)/);
});

test('choice matching is scoped to the question container, never the page', () => {
  // Unscoped, an answer as short as "Yes" could tick a consent or legal acknowledgement elsewhere
  // on the form, which the applicant cannot undo.
  assert.match(SANDBOX_RUNNER, /const choices = container\.locator\('input\[type=checkbox\], input\[type=radio\]'\)/);
  // And an answer that matches no option leaves the control alone rather than guessing.
  assert.match(SANDBOX_RUNNER, /if \(!matched\) continue;/);
  assert.match(SANDBOX_RUNNER, /total === 1 && \/\^yes\$\/i\.test\(wanted\)/);
  assert.match(SANDBOX_RUNNER, /actual === 'checked' && \/\^yes\$\/i\.test\(clean\(expected\)\)/);
});

test('fillByLabelText climbs to a container that actually owns controls', () => {
  assert.match(
    SANDBOX_RUNNER,
    /ancestor::\*\[\(self::div or self::fieldset\) and \(\.\/\/textarea or \.\/\/input\[not\(@type="file"\) and not\(@type="hidden"\)\] or \.\/\/select or \.\/\/\*\[@role="combobox"\] or \.\/\/\*\[@aria-haspopup="listbox"\]\)\]\[1\]/,
  );
});

test('fillByLabelText commits date-like answers before generic text fill', () => {
  // Ashby date pickers can expose a visible "Pick date..." text control while the required date
  // state remains empty. Date answers need the native date/input events and blur path, not only
  // a plain fill against the first input in the question container.
  assert.ok(SANDBOX_RUNNER.includes("const dateLikeAnswer = /^\\d{4}-\\d{2}-\\d{2}$/.test"));
  assert.ok(SANDBOX_RUNNER.includes("const dateLikeField = /date|pick date/i.test"));
  assert.match(SANDBOX_RUNNER, /shape\.type === 'date' \|\| \(dateLikeAnswer && dateLikeField\)/);
  assert.doesNotMatch(SANDBOX_RUNNER, /container\.locator\('input\[type=date\]/);
  assert.match(SANDBOX_RUNNER, /dispatchEvent\(new Event\('input', \{ bubbles: true \}\)\)/);
  assert.match(SANDBOX_RUNNER, /dispatchEvent\(new Event\('change', \{ bubbles: true \}\)\)/);
  assert.match(SANDBOX_RUNNER, /field\.press\('Tab'\)/);
  assert.match(SANDBOX_RUNNER, /const committed = await field\.evaluate/);
});

test('an unticked required checkbox is reported as a blocker', () => {
  // A checkbox reports value "on" whether or not it is ticked, so the old value check treated every
  // unticked required checkbox as already satisfied and never reported it.
  assert.match(SANDBOX_RUNNER, /element\.type === 'checkbox' \|\| element\.type === 'radio'/);
  assert.match(SANDBOX_RUNNER, /some\(\(member\) => member\.checked\)/);
});

test('blockers name a human label and never a machine identifier', () => {
  // The old fallback chain was aria-label -> name attribute -> the literal 'required field', which
  // produced the two strings applicants actually saw:
  //   "5a326a1d-1a9e-42b1-a918-ca74022064dc is required"   (Greenhouse names questions with UUIDs)
  //   "required field is required"                          (literal fallback, doubled)
  assert.match(SANDBOX_RUNNER, /label\[for="/);
  assert.match(SANDBOX_RUNNER, /aria-labelledby/);
  assert.match(SANDBOX_RUNNER, /\[0-9a-f\]\{8\}-/); // UUID rejection
  assert.match(SANDBOX_RUNNER, /is required and is still empty/);
  assert.match(SANDBOX_RUNNER, /no label Litos can read/);
  assert.doesNotMatch(SANDBOX_RUNNER, /\|\| 'required field';/);
});

test('a choice group is reported once, by its question, not once per option', () => {
  // Aquatic's Greenhouse form turned three unanswered questions into seventeen blockers, each
  // naming an option ("Statistics", "Putnam", "Handshake") rather than the question to answer.
  assert.match(SANDBOX_RUNNER, /const reportedGroups = new Set\(\)/);
  assert.match(SANDBOX_RUNNER, /if \(reportedGroups\.has\(groupName\)\) continue;/);
  // And the label for a choice control prefers the group's question over the option text.
  assert.match(SANDBOX_RUNNER, /const groupSources = isChoice/);
});

test('required file-upload groups are reported even when the hidden input is not required', () => {
  // Greenhouse marks transcript uploads as aria-required on the file-upload group while leaving the
  // hidden input itself without a required attribute, so the generic input[required] scan misses it.
  assert.match(SANDBOX_RUNNER, /\[role="group"\]\[aria-required="true"\]:has\(input\[type="file"\]\)/);
  assert.match(SANDBOX_RUNNER, /reportedFileGroups/);
  assert.match(SANDBOX_RUNNER, /input\.files\?\.length/);
  assert.match(SANDBOX_RUNNER, /A required file upload on the form has no label Litos can read/);
});

// R-055 on the managed path: /api/run is otherwise stateless (navigate, act, return), so this
// runner is the only place that ever has a live Page mid-run. The 'discover' action lets a caller
// (student-outreach-backend) scan the page for custom questions in the SAME sandboxed session it
// already pays for, resolve them server-side (Node, not this sandbox), and fill them in a second
// call - mirroring the direct-Playwright path's discoverPageQuestions(), not new logic.

test('discover is an allowed action and needs no selector', () => {
  assert.deepEqual(normalizeManagedActions([{ type: 'discover' }]), [{ type: 'discover' }]);
  assert.deepEqual(normalizeManagedActions([{ type: 'discover', optional: true }]), [{ type: 'discover', optional: true }]);
});

test('discover scans text-shaped controls only, matching the fill scope', () => {
  // Never select/radio/checkbox: this runner (see fillByLabelText above) already refuses to click
  // a choice control by matching an answer to option text on discovered fields, so there is nothing
  // safe to do with a discovered choice question either - it stays a blocker, same as today.
  assert.match(
    SANDBOX_RUNNER,
    /input\[type="text"\], input\[type="email"\], input\[type="tel"\], input\[type="url"\], input\[type="number"\], input\[type="date"\], input:not\(\[type\]\), textarea/,
  );
  assert.match(SANDBOX_RUNNER, /const discovered = \[\];/);
  assert.match(SANDBOX_RUNNER, /discovered, filledFields:/);
});

test('discover prefers the question text over generic Ashby date placeholders', () => {
  assert.match(SANDBOX_RUNNER, /function genericControlText\(value\)/);
  assert.match(SANDBOX_RUNNER, /if \(own && !genericControlText\(own\)\) return own;/);
  assert.match(SANDBOX_RUNNER, /return fallbackText \|\| own;/);
});

test('discover walks nested datepicker parents to find the Ashby question label', () => {
  const label = mockElement({ textContent: 'Are you currently enrolled in a degree program? If so, expected graduation date?' });
  const outer = mockElement({ queryResult: label });
  const middle = mockElement({ parentElement: outer });
  const dateWidget = mockElement({ parentElement: middle });
  const input = mockElement({ attrs: { placeholder: 'Pick date...' }, parentElement: dateWidget });
  assert.equal(sandboxQuestionLabel()(input), 'are you currently enrolled in a degree program? if so, expected graduation date?');
});

test('discover still returns placeholder-only fields when no outer question exists', () => {
  const wrapper = mockElement();
  const input = mockElement({ attrs: { placeholder: 'Enter your answer here' }, parentElement: wrapper });
  assert.equal(sandboxQuestionLabel()(input), 'enter your answer here');
});

test('discover never surfaces a honeypot field', () => {
  assert.match(SANDBOX_RUNNER, /function isHoneypot\(el\)/);
  assert.match(SANDBOX_RUNNER, /!isHoneypot\(el\)/);
});

test('required date blockers can use the enclosing question instead of Pick date', () => {
  assert.match(SANDBOX_RUNNER, /const nearestQuestionText = \(start\) =>/);
  assert.match(SANDBOX_RUNNER, /nearestQuestionText\(element\)/);
});

/* ---------------------------------------------------------------------------------------------
 * The Redwood Materials incident, 2026-08-08.
 *
 * A packet reached ready_for_final_approval with every question answered. Its stored preview
 * screenshot showed the form correctly filled AND five red "is required" messages under the very
 * controls that were visibly answered - which reads, to whoever approves it, as a form that is
 * about to be submitted blank.
 *
 * Measured on the live form, the messages were STALE. Action 14 of the run was
 * { press, value 'Enter', selector '#country' }, queued to commit the phone-country React Select.
 * normalizeManagedActions dropped the selector, the runner called page.keyboard.press(), the
 * keystroke reached the FORM, and the employer's validator ran while the phone, the resume and all
 * four screener questions were still empty. Greenhouse renders those errors once and does not clear
 * them when the fields are subsequently filled: "Phone is required." stayed on screen underneath a
 * filled phone number. Submitting the completed form passed validation with zero errors.
 *
 * Two failures, opposite directions, same root: a keystroke that went somewhere it was not aimed.
 * ------------------------------------------------------------------------------------------- */

// The runner ships as a string, so these pull the real declarations out of it and run them, rather
// than asserting that some text is present and hoping it still means what it used to.
function extractConstSource(name, indent = 4) {
  const pad = ' '.repeat(indent);
  const start = SANDBOX_RUNNER.indexOf(`\n${pad}const ${name} = `);
  assert.notEqual(start, -1, `${name} must exist in the sandbox runner`);
  const rest = SANDBOX_RUNNER.slice(start + 1);
  const next = rest.search(new RegExp(`\\n${pad}(?:const|let|var|for|if|return|await|fs\\.)`));
  return rest.slice(0, next === -1 ? rest.length : next);
}

function sandboxScope(names, indent = 4) {
  const sources = names.map((name) => extractConstSource(name, indent)).join('\n');
  return Function(`${sources}\nreturn { ${names.join(', ')} };`)();
}

const choiceHelpers = () => sandboxScope(['clean', 'normalized', 'answerOptions', 'optionMatches', 'verifyChoiceInContainer', 'choiceControlIsClosed']);

function reactSelectContainer({ chosen = '', placeholder = false, ownText = '', widgetText = '' } = {}) {
  const widget = {
    textContent: widgetText,
    querySelector(selector) {
      if (/single-value|multi-value__label/.test(selector)) return chosen ? { textContent: chosen } : null;
      if (/placeholder/.test(selector)) return placeholder ? { textContent: 'Select...' } : null;
      return null;
    }
  };
  const element = {
    textContent: ownText,
    closest: (selector) => (/select__container|select-shell/.test(selector) ? widget : null),
    querySelector: () => null
  };
  return { evaluate: async (fn) => fn(element) };
}

test('an answered React Select verifies even though the fill container is empty', async () => {
  // THE REGRESSION. The 'fill' branch scopes its container to the nearest ancestor holding a
  // combobox, which on a React Select is '.select__input-container' - a div whose textContent is
  // always ''. Reading that reported "choice value did not persist after fill" for four questions
  // that were answered No/Yes/Yes/Yes and would have submitted correctly.
  const { verifyChoiceInContainer } = choiceHelpers();
  assert.equal(await verifyChoiceInContainer(reactSelectContainer({ chosen: 'No', ownText: '' }), 'No'), true);
  assert.equal(await verifyChoiceInContainer(reactSelectContainer({ chosen: 'Yes', ownText: '' }), 'Yes'), true);
});

test('an unanswered React Select does not borrow its answer from the question label', async () => {
  // The widget's textContent carries the label, and a label is quite capable of containing the
  // answer word. Falling back to it would report an untouched control as filled, which is the one
  // mistake that puts a blank answer on a real application.
  const { verifyChoiceInContainer } = choiceHelpers();
  const untouched = reactSelectContainer({
    placeholder: true,
    widgetText: 'Have you ever worked for Redwood Materials? Select...',
    ownText: ''
  });
  assert.equal(await verifyChoiceInContainer(untouched, 'No'), false);
});

test('Enter is withheld from a choice control whose menu is shut', async () => {
  const { choiceControlIsClosed } = choiceHelpers();
  const combobox = (expanded) => ({
    evaluate: async (fn) => fn({
      getAttribute: (name) => (name === 'role' ? 'combobox' : (name === 'aria-expanded' ? expanded : null)),
      closest: () => null,
      querySelector: () => null
    })
  });
  assert.equal(await choiceControlIsClosed(combobox('false')), true);
  // Menu open: Enter has a highlighted option to take, so it still has a job to do.
  assert.equal(await choiceControlIsClosed(combobox('true')), false);
  // Not a choice control at all: leave the press alone, this guard has no opinion.
  const plainInput = { evaluate: async (fn) => fn({ getAttribute: () => null, closest: () => null, querySelector: () => null }) };
  assert.equal(await choiceControlIsClosed(plainInput), false);
});

test('a press keeps the selector it was given', () => {
  // Dropping it here is what turned every aimed keystroke into a page-wide one, and made the
  // optional pre-check - which is guarded on the locator - unreachable for every press ever queued.
  const [aimed, unaimed] = normalizeManagedActions([
    { type: 'press', value: 'Enter', selector: '#country', label: 'phone_country_select', optional: true },
    { type: 'press', value: 'Enter' }
  ]);
  assert.equal(aimed.selector, '#country');
  assert.equal(aimed.optional, true);
  // Still optional to supply one: a caller may legitimately mean "send this key wherever focus is".
  assert.equal(unaimed.selector, undefined);
  assert.equal(unaimed.value, 'Enter');
});

test('a press lands on the element it names, and is skipped when that element is absent', () => {
  assert.match(SANDBOX_RUNNER, /await locator\.press\(action\.value\)/);
  assert.match(SANDBOX_RUNNER, /if \(!locator\) \{\n\s+await page\.keyboard\.press\(action\.value\);/);
  assert.match(SANDBOX_RUNNER, /Enter withheld/);
  assert.match(SANDBOX_RUNNER, /could only have submitted the form/);
});

const gateScope = () => sandboxScope(['clean', 'widgetHasAnswer'], 6);

function widget({ chosen = '', placeholder = false, filename = false, controls = [] } = {}) {
  return {
    querySelector(selector) {
      if (/single-value|multi-value__label/.test(selector)) return chosen ? { textContent: chosen } : null;
      if (/placeholder/.test(selector)) return placeholder ? {} : null;
      if (/file-upload__filename|Remove file/.test(selector)) return filename ? {} : null;
      return null;
    },
    querySelectorAll: () => controls
  };
}

test('the pre-submit gate reads an answer where the control actually keeps it', () => {
  const { widgetHasAnswer } = gateScope();
  // React Select: the answer is rendered text, and the combobox input's value is search text that
  // react-select CLEARS on selection. Reading the input would call every answered question empty.
  assert.equal(widgetHasAnswer(widget({ chosen: 'No', controls: [{ type: 'text', value: '', getAttribute: () => 'combobox' }] })), true);
  assert.equal(widgetHasAnswer(widget({ placeholder: true, controls: [{ type: 'text', value: '', getAttribute: () => 'combobox' }] })), false);
  // Greenhouse REMOVES the file input once the upload finishes and leaves a filename chip, so
  // "no input[type=file] holding a file" is true of a widget that has already been given one.
  assert.equal(widgetHasAnswer(widget({ filename: true, controls: [] })), true);
  assert.equal(widgetHasAnswer(widget({ controls: [{ type: 'file', files: [], getAttribute: () => null }] })), false);
  assert.equal(widgetHasAnswer(widget({ controls: [{ type: 'file', files: [{}], getAttribute: () => null }] })), true);
  assert.equal(widgetHasAnswer(widget({ controls: [{ type: 'text', value: 'Mehek', getAttribute: () => null }] })), true);
  assert.equal(widgetHasAnswer(widget({ controls: [{ type: 'checkbox', checked: false, getAttribute: () => null }] })), false);
  assert.equal(widgetHasAnswer(widget({ controls: [{ type: 'checkbox', checked: true, getAttribute: () => null }] })), true);
  // A hidden input is not an answer the applicant gave.
  assert.equal(widgetHasAnswer(widget({ controls: [{ type: 'hidden', value: 'x', getAttribute: () => null }] })), false);
});

test('the pre-submit gate runs before the final click and can stop it', () => {
  assert.match(SANDBOX_RUNNER, /const isFinalSubmitAction = \(action\) =>/);
  assert.match(SANDBOX_RUNNER, /if \(isFinalSubmitAction\(action\)\) \{/);
  assert.match(SANDBOX_RUNNER, /submitGateBlockers\.push\(\.\.\.blocking\)/);
  assert.match(SANDBOX_RUNNER, /submit withheld/);
  // The gate has to be able to see a control the old blocker scan could not: React Select's input
  // carries aria-required and no required attribute, so [required] alone never sees an unanswered
  // Greenhouse screener question.
  assert.match(SANDBOX_RUNNER, /\[aria-required="true"\]/);
  // And its findings have to reach the caller.
  assert.match(SANDBOX_RUNNER, /const blockers = \[\.\.\.submitGateBlockers\]/);
});

test('the final submit is recognised by intent and by target, not one or the other', () => {
  const { isFinalSubmitAction } = sandboxScope(['isFinalSubmitAction']);
  // What the backend actually appends today.
  assert.equal(isFinalSubmitAction({ type: 'click', selector: 'button[type="submit"], input[type="submit"]' }), true);
  assert.equal(isFinalSubmitAction({ type: 'click', selector: "button[type='submit']" }), true);
  assert.equal(isFinalSubmitAction({ type: 'click', selector: '#send', label: 'final_submit' }), true);
  // A gate that can be walked around by omitting the label is not a gate; one that fires on every
  // click is not usable. Ordinary clicks pass through.
  assert.equal(isFinalSubmitAction({ type: 'click', selector: '#onetrust-accept-btn-handler' }), false);
  assert.equal(isFinalSubmitAction({ type: 'click', selector: 'a:has-text("Apply for this job")' }), false);
  assert.equal(isFinalSubmitAction({ type: 'fill', selector: 'button[type="submit"]' }), false);
});

test('stale validation text is reported but never blocks a complete form', () => {
  // Measured: filling the Redwood form correctly left six "is required" messages on screen, and
  // submitting it then passed validation with zero errors. Refusing on error TEXT would have thrown
  // away a complete, correct application - the same harm as sending a broken one, and harder to see.
  assert.match(SANDBOX_RUNNER, /if \(widgetHasAnswer\(widget\)\) \{ stale\.push\(text\); continue; \}/);
  assert.match(SANDBOX_RUNNER, /pre_submit_gate: ignored /);
  assert.match(SANDBOX_RUNNER, /stale validation message\(s\) left over from an earlier pass/);
  // An error nobody can tie back to a control is the one case where text alone is enough, because
  // "we cannot tell" is not a reason to send.
  assert.match(SANDBOX_RUNNER, /could not tell which field it belongs to/);
});

test('the form\'s own "* indicates a required field" legend is not a blocker', () => {
  // Measured on the live Redwood Materials form: this legend was the ONLY thing the gate found on a
  // completely and correctly filled application. Left in, the gate would have refused to submit
  // every Greenhouse application there is, which is not caution, it is an outage with a good excuse.
  const { LEGEND_TEXT, ERROR_TEXT } = sandboxScope(['ERROR_TEXT', 'LEGEND_TEXT'], 6);
  const isFieldError = (text) => ERROR_TEXT.test(text) && !LEGEND_TEXT.test(text);
  assert.equal(isFieldError('indicates a required field'), false);
  assert.equal(isFieldError('* indicates a required field'), false);
  assert.equal(isFieldError('All fields are required'), false);
  // and the real messages still are errors
  assert.equal(isFieldError('This field is required.'), true);
  assert.equal(isFieldError('Resume/CV is required.'), true);
  assert.equal(isFieldError('Phone is required.'), true);
  assert.equal(isFieldError('Please select an option'), true);
});

test('a message in a block holding no control is not attributed to a field', () => {
  assert.match(SANDBOX_RUNNER, /const control = widget\.querySelector\('input:not\(\[type="hidden"\]\), textarea, select, \[role="combobox"\]'\);/);
  assert.match(SANDBOX_RUNNER, /if \(!control\) continue;/);
});
