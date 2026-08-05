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
    { type: 'extract', selector: 'h1' }
  ]), [
    { type: 'fill', selector: '#email', value: 'person@example.com' },
    { type: 'press', value: 'Enter' },
    { type: 'extract', selector: 'h1' }
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
