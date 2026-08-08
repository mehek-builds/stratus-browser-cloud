import test from 'node:test';
import assert from 'node:assert/strict';
import {
  executeManagedRun,
  executeSandboxRun,
  FREE_MANAGED_LIMITS,
  MANAGED_CONTINUATION_CONTRACT,
  normalizeManagedActions,
  normalizeManagedContinuation,
  SANDBOX_RUNNER
} from '../src/managed-browser.js';

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
  // blockOf as well as questionLabel: an anonymous control (Ashby's location combobox has no id, no
  // name and no aria-label) now resolves its question from the block that owns it rather than from
  // its placeholder, so the two are built together.
  const source = extractFunctionSource('questionLabel');
  const blockOfSource = extractFunctionSource('blockOf');
  const clean = (value) => (value == null ? '' : value).replace(/[​‌‍﻿ ]/g, ' ').replace(/\s+/g, ' ').trim();
  const fakeDocument = { querySelector: () => null };
  const fakeCss = { escape: (value) => String(value) };
  return Function('clean', 'document', 'CSS', `${blockOfSource}\nreturn (${source});`)(clean, fakeDocument, fakeCss);
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

test('managed continuation contract is bounded and rejects URL or recursion', () => {
  assert.deepEqual(MANAGED_CONTINUATION_CONTRACT, {
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
  const token = 'a'.repeat(43);
  assert.deepEqual(normalizeManagedContinuation({
    continuationToken: token,
    actions: [{ type: 'click', selector: '#continue' }],
    screenshot: false
  }), {
    continuationToken: token,
    actions: [{ type: 'click', selector: '#continue' }],
    screenshot: false,
    fullPage: false
  });
  assert.throws(
    () => normalizeManagedContinuation({ continuationToken: token, url: 'https://example.com', actions: [] }),
    (error) => error.code === 'CONTINUATION_URL_FORBIDDEN'
  );
  assert.throws(
    () => normalizeManagedContinuation({ continuationToken: token, requestContinuation: true, actions: [] }),
    (error) => error.code === 'CONTINUATION_LIMIT_REACHED'
  );
});

test('sandbox continuation is project-bound and single-use without exposing a session id', async () => {
  const sandboxes = new Map();
  const template = { name: 'stratus-browser-runtime', currentSnapshotId: 'snapshot' };
  class FakeSandbox {
    constructor(name) {
      this.name = name;
      this.files = new Map();
      this.stopped = false;
    }
    async writeFiles(files) {
      for (const file of files) this.files.set(file.path, Buffer.from(file.content));
      if (this.files.has('stratus-continuation-input.json')) {
        this.files.set('stratus-result-1.json', Buffer.from(JSON.stringify({ title: 'Application received', url: 'https://example.com/thanks', text: 'received' })));
      }
    }
    async runCommand(command, args) {
      if (typeof command === 'object') {
        const input = JSON.parse(this.files.get('stratus-input.json').toString('utf8'));
        this.files.set('stratus-result-0.json', Buffer.from(JSON.stringify({
          title: 'Security code', url: input.url, text: 'Enter the security code sent to your email'
        })));
        if (input.requestContinuation) this.files.set('stratus-continuation-ready.json', Buffer.from('{}'));
        return { exitCode: null };
      }
      const script = args[1];
      if (script.includes('stratus-continuation.json')) {
        if (this.stopped || !this.files.has('stratus-continuation.json') || !this.files.has('stratus-continuation-ready.json')) return { exitCode: 7 };
        this.files.set('stratus-continuation-used.json', this.files.get('stratus-continuation.json'));
        this.files.delete('stratus-continuation.json');
        return { exitCode: 0 };
      }
      const file = args[2];
      return { exitCode: this.files.has(file) ? 0 : 3 };
    }
    async readFileToBuffer({ path }) { return this.files.get(path) || null; }
    async stop() { this.stopped = true; }
  }
  const sandboxApi = {
    async get({ name }) {
      if (name === template.name) return template;
      const sandbox = sandboxes.get(name);
      if (!sandbox) throw new Error('not found');
      return sandbox;
    },
    async fork({ name }) {
      const sandbox = new FakeSandbox(name);
      sandboxes.set(name, sandbox);
      return sandbox;
    }
  };
  const urlValidator = async (value) => new URL(value);
  const first = await executeSandboxRun({
    url: 'https://example.com/apply', actions: [], requestContinuation: true
  }, { sandboxApi, urlValidator, projectBinding: 'project-a' });
  assert.match(first.continuationToken, /^[A-Za-z0-9_-]+$/);
  assert.ok(first.continuationExpiresAt);
  assert.equal('sessionId' in first, false);
  const second = await executeSandboxRun({
    continuationToken: first.continuationToken, actions: [{ type: 'click', selector: '#continue' }]
  }, { sandboxApi, urlValidator, projectBinding: 'project-a' });
  assert.equal(second.title, 'Application received');
  await assert.rejects(
    executeSandboxRun({ continuationToken: first.continuationToken, actions: [] }, { sandboxApi, urlValidator, projectBinding: 'project-a' }),
    (error) => error.code === 'CONTINUATION_REJECTED'
  );
  await assert.rejects(
    executeSandboxRun({ continuationToken: first.continuationToken, actions: [] }, { sandboxApi, urlValidator, projectBinding: 'project-b' }),
    (error) => error.code === 'CONTINUATION_REJECTED'
  );
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
  assert.match(SANDBOX_RUNNER, /getByRole\('option', \{ name: option, exact: false \}\)/);
  assert.match(SANDBOX_RUNNER, /const customSelected = await fillCustomChoice\(container, action\.value \|\| ''\)/);
});

test('an option is only ever clicked inside an option list, never loose in the page', () => {
  // THE REGRESSION, measured live on 2026-08-08. The fallback swept the whole document for
  // 'li, [data-value]' containing the answer, so opening Discipline on the DRW and Virtu Greenhouse
  // forms with the answer "Computer Science" clicked a bullet point in the JOB DESCRIPTION
  // ("Are pursuing a bachelor's ... computer science or any engineering discipline"), reported the
  // field answered, and left the control on "Select...". Both boards then said
  // '"Discipline" is required and is still empty' with the right option unclicked in the open menu.
  assert.doesNotMatch(SANDBOX_RUNNER, /\[role="listbox"\] \*/, 'no page-wide descendant sweep');
  assert.doesNotMatch(SANDBOX_RUNNER, /\[class\*="select2-result"\], li, \[data-value\]/, 'no bare li or [data-value]');
  // A bare li still qualifies, but only inside a listbox or a select2 results panel.
  assert.match(SANDBOX_RUNNER, /\[role="listbox"\] li/);
  assert.match(SANDBOX_RUNNER, /const OPTION_NODES =/);
  assert.match(SANDBOX_RUNNER, /const optionsRoot = \(\) => \(scopedMenu \?\? page\)\.locator\(OPTION_NODES\)/);
  // And the correctly scoped attempt gets a bounded wait, because it used to be made as an instant
  // count() 150ms after the click - before the menu rendered - which is what made the page-wide
  // sweep reachable in the first place. Measured: menus arrived 555-563ms after the control was hit.
  assert.match(SANDBOX_RUNNER, /const waitForMenu = async \(timeout\) =>/);
  assert.match(SANDBOX_RUNNER, /await waitForMenu\(1200\)/);
});

test('a choice control that already holds an answer is never emptied to look for a better one', () => {
  // Litos sends several candidate values for one control on purpose (a stored major sentence, then
  // the fields of study inside it). Measured live on the Five Rings Greenhouse form: Discipline was
  // correctly set to "Computer Science" by one candidate and emptied by the next, in two ways.
  // 1. An empty fill is a backspace on a React Select's always-empty search box, and
  //    backspaceRemovesValue then deletes the selection.
  assert.match(SANDBOX_RUNNER, /if \(\(await readChoiceState\(container\)\)\.kind !== 'chosen'\) \{\n\s+await control\.fill\(''\)/);
  // 2. React Select renders its "Clear selections" indicator as a <button> inside the same
  //    container, and the control list includes buttons.
  assert.match(SANDBOX_RUNNER, /const CLEAR_CONTROL_RE =/);
  assert.match(SANDBOX_RUNNER, /if \(CLEAR_CONTROL_RE\.test\(clears\)\) continue;/);
  // An answer that already matches is left exactly as it is, with no click at all.
  assert.match(SANDBOX_RUNNER, /if \(alreadyAnswered\.kind === 'chosen' && optionMatches\(alreadyAnswered\.value, wanted\)\) return true;/);
  // And if it was somehow lost anyway, it goes back.
  assert.match(SANDBOX_RUNNER, /if \(await searchFor\(control, alreadyAnswered\.value\)\) break;/);
});

test('a choice we could not make is reported as the applicant\'s, not as filled', () => {
  // The plain fill after a failed choice typed the answer into the widget's SEARCH box, and
  // verifyFilled then read it straight back out of that same box and called the field filled while
  // the control still said "Select...". A wrong "filled" is worse than a blank: it is the reason a
  // required-and-empty blocker arrived alongside a filled_fields list that claimed the opposite.
  assert.match(SANDBOX_RUNNER, /const state = await readChoiceState\(container\);/);
  assert.match(SANDBOX_RUNNER, /if \(state\.kind !== 'unknown'\) \{/);
  assert.match(SANDBOX_RUNNER, /left for you to choose/);
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
  assert.match(SANDBOX_RUNNER, /const clickMatchingOption = async \(target\) =>/);
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
  // A checkbox reports value "on" whether or not it is ticked, so a value check treats every
  // unticked required checkbox as already satisfied and never reports it.
  //
  // The claim is unchanged; where it is enforced moved. D-01 replaced the end-of-run scan that used
  // to answer this with readSubmitReadiness, the same reading the pre-submit gate makes, so the run
  // reports exactly what would withhold the click. hasAnswer is that reading, and it is unit-tested
  // directly further down this file.
  const { hasAnswer } = gateScope();
  assert.equal(hasAnswer(control({ type: 'checkbox', checked: false })), false);
  assert.equal(hasAnswer(control({ type: 'checkbox', checked: true })), true);
  // One answered radio answers its whole group, and only the checked member carries it.
  assert.match(SANDBOX_RUNNER, /for \(const peer of \(element\.form \|\| document\)\.querySelectorAll/);
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
  //
  // Same guarantee, reached differently since D-01 unified the two readings of the form. The scan
  // keys on the CONTROL rather than the group - Greenhouse's phone fieldset holds two required
  // controls and both must be reportable - and the blocking list is then deduped by MESSAGE, so
  // several inputs resolving to one question collapse to one entry. Measured on the empty live
  // Redwood form: 15 entries covering 8 distinct fields.
  assert.match(SANDBOX_RUNNER, /blocking: \[\.\.\.new Set\(required\.map\(\(entry\) => entry\.message\)\)\]/);
  assert.match(SANDBOX_RUNNER, /const seen = new Set\(\);/);
  // And the label for a choice control prefers the group's question over the option text: labelOf
  // reads the widget's own legend or label, never the option the input sits beside.
  assert.match(SANDBOX_RUNNER, /const legend = widget && widget\.querySelector\('legend'\)/);
  assert.match(SANDBOX_RUNNER, /const own = widget && widget\.querySelector\('label, \.label, \.upload-label, legend'\)/);
});

test('required file-upload groups are reported even when the hidden input is not required', () => {
  // Greenhouse marks transcript uploads as aria-required on the file-upload GROUP while leaving the
  // hidden input itself without a required attribute, so an input[required] scan misses it.
  //
  // D-01 folded the separate file-group pass into the one required scan: [aria-required="true"]
  // matches the group, and hasAnswer widens to the container because a container has no value of
  // its own to read. That also has to keep working when the upload finished and Greenhouse REMOVED
  // the input, leaving only a filename chip.
  assert.match(SANDBOX_RUNNER, /input\[required\], textarea\[required\], select\[required\], \[aria-required="true"\]/);
  const { hasAnswer } = gateScope();
  assert.equal(hasAnswer(block({ controls: [control({ type: 'file', files: [] })] })), false);
  assert.equal(hasAnswer(block({ controls: [control({ type: 'file', files: [{}] })] })), true);
  assert.equal(hasAnswer(block({ chip: true, controls: [] })), true);
  assert.match(SANDBOX_RUNNER, /A required field on the form has no label Litos can read/);
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

test('discover scans choice controls as well as text-shaped ones', () => {
  /* This used to exclude select, radio and checkbox on the reasoning that the caller never clicks a
     choice control. That reasoning was already stale - fillByLabelText has select, radio and
     checkbox arms - and D-01 measured what it cost: Deepgram's two work-eligibility questions are
     Ashby pill groups, so discovery never saw them, no question record was ever written, and the
     backend never got the chance to answer them from the booleans it had stored. A question that is
     never discovered can neither be answered nor asked. */
  assert.match(
    SANDBOX_RUNNER,
    /input\[type="text"\], input\[type="email"\], input\[type="tel"\], input\[type="url"\], input\[type="number"\],/,
  );
  assert.match(SANDBOX_RUNNER, /input\[type="date"\], input\[type="radio"\], input\[type="checkbox"\], input:not\(\[type\]\), textarea, select/);
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

// R-100. The optional pre-check is an instantaneous snapshot with no auto-wait, and it used to
// apply to waitForSelector too, cancelling the one action whose entire job is to wait. That is the
// whole of the fix: waitForSelector is exempt and every other optional action keeps the snapshot it
// always had. An earlier version also gave the others a 1500ms settle grace against a run-wide
// budget; measured against both branches on two live Greenhouse forms (Redwood Materials and DRW,
// 2026-08-08) the grace produced identical filled_fields and identical blockers while costing
// +4336ms and +4298ms, so it is deliberately not here.
// test/managed-runner-replay.mjs proves the behaviour in a real browser; these pin the mechanism.

test('an optional waitForSelector is exempt from the pre-check entirely', () => {
  // It is the one action whose whole job is to wait, and its timeout is already clamped to
  // 100-20000ms by normalizeManagedActions, so a pre-check can only ever cancel it.
  assert.match(SANDBOX_RUNNER, /action\.optional && action\.type !== 'waitForSelector' && await locator\.count\(\) === 0/);
  assert.match(SANDBOX_RUNNER, /if \(action\.type === 'waitForSelector'\) await page\.waitForSelector\(/);
});

test('the pre-check costs nothing beyond the snapshot it always took', () => {
  // The narrowing is load-bearing, not incidental: these are what a reintroduced grace would trip.
  assert.doesNotMatch(SANDBOX_RUNNER, /OPTIONAL_SETTLE_MS/);
  assert.doesNotMatch(SANDBOX_RUNNER, /settleBudgetMs/);
  assert.doesNotMatch(SANDBOX_RUNNER, /precedingActionCouldChangeDom/);
  assert.doesNotMatch(SANDBOX_RUNNER, /locator\.waitFor\(\{ state: 'attached'/);
});

test('an optional element that never arrived is reported rather than skipped in silence', () => {
  // The pre-check used to skip in complete silence, which is how several deploys went by with
  // fields quietly left empty and nothing in the run saying so.
  assert.match(SANDBOX_RUNNER, /skipped\.push\(\(action\.label \|\| action\.type\) \+ ': nothing matched ' \+ action\.selector\)/);
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

const choiceHelpers = () => sandboxScope(['clean', 'normalized', 'answerOptions', 'optionMatches', 'readChoiceState', 'verifyChoiceInContainer', 'choiceControlIsClosed']);

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

const gateScope = () => sandboxScope(
  ['clean', 'widgetOf', 'CHOICE_SHELL', 'chosenValueOf', 'uploadHasFile', 'PILL_SELECTED', 'chosenPillOf', 'hasAnswer'],
  6,
);

// A React Select's own shell, the thing its chosen value is rendered into.
function shellOf({ chosen = '', placeholder = false } = {}) {
  return {
    querySelector(selector) {
      if (/single-value|multi-value__label/.test(selector)) return chosen ? { textContent: chosen } : null;
      if (/placeholder/.test(selector)) return placeholder ? {} : null;
      return null;
    }
  };
}

// One form control. 'shell' is the select shell this control is INSIDE, which is the distinction
// R-103 turns on: a control that merely sits near an answered select is not inside it.
function control({ tag = 'INPUT', type = 'text', value = '', role = null, checked = null, files = null, name = null, shell = null, block = null } = {}) {
  return {
    tagName: tag, type, value, checked, files, name,
    getAttribute: (attribute) => (attribute === 'role' ? role : null),
    closest(selector) {
      if (!shell) return null;
      if (/select__container|select-shell/.test(selector)) return shell;
      if (/select__control/.test(selector)) return { parentElement: shell };
      return null;
    },
    parentElement: block || { querySelector: () => null, querySelectorAll: () => [] },
    querySelector: () => null,
    querySelectorAll: () => []
  };
}

// A block that is itself flagged required: Greenhouse marks its uploader with a
// <div role="group" aria-required="true"> and leaves the file input unmarked.
function block({ chip = false, controls = [] } = {}) {
  return {
    tagName: 'DIV',
    closest: () => null,
    querySelector: (selector) => (/file-upload__filename|Remove file/.test(selector) && chip ? {} : null),
    querySelectorAll: (selector) => (/type="file"/.test(selector)
      ? controls.filter((candidate) => candidate.type === 'file')
      : controls.filter((candidate) => candidate.type !== 'hidden'))
  };
}

test('R-103: an empty required control is not answered by a choice control beside it', () => {
  const { hasAnswer } = gateScope();
  // THE REGRESSION. Greenhouse puts the phone number input and its country React Select in one
  // <fieldset class="phone-input">. The answer check used to be asked of that fieldset and returned
  // true on its first look at the country's rendered "+971", so an empty required #phone was
  // invisible. Measured live on the Redwood Materials form, 2026-08-08: with the form otherwise
  // complete, clearing #phone produced ZERO blockers while clearing #first_name or #email was caught
  // by name. "Phone is required." is one of the six messages from the incident this gate was built
  // for, so the gate was blind to the very field it exists to catch.
  const answeredCountry = shellOf({ chosen: '+971' });
  // The phone input is NOT inside the country's shell, and its own value is the answer.
  assert.equal(hasAnswer(control({ type: 'tel', value: '', shell: null })), false);
  assert.equal(hasAnswer(control({ type: 'tel', value: '+971 50 123 4567', shell: null })), true);
  // The country combobox IS inside it, and reads as answered. Both live in the same fieldset, and
  // they now give different answers, which is the whole point.
  assert.equal(hasAnswer(control({ role: 'combobox', value: '', shell: answeredCountry })), true);
});

test('the pre-submit gate reads an answer where the control actually keeps it', () => {
  const { hasAnswer } = gateScope();
  // React Select: the answer is rendered text, and the combobox input's value is search text that
  // react-select CLEARS on selection. Reading the input would call every answered question empty.
  assert.equal(hasAnswer(control({ role: 'combobox', value: '', shell: shellOf({ chosen: 'No' }) })), true);
  assert.equal(hasAnswer(control({ role: 'combobox', value: '', shell: shellOf({ placeholder: true }) })), false);
  assert.equal(hasAnswer(control({ type: 'text', value: 'Mehek' })), true);
  assert.equal(hasAnswer(control({ type: 'text', value: '' })), false);
  assert.equal(hasAnswer(control({ type: 'checkbox', checked: false })), false);
  assert.equal(hasAnswer(control({ type: 'checkbox', checked: true })), true);
  // A hidden input is not an answer the applicant gave.
  assert.equal(hasAnswer(control({ type: 'hidden', value: 'x' })), false);
  // A file input reads the block it sits in, because Greenhouse REMOVES the input once the upload
  // finishes and leaves a filename chip, so "this input holds no file" is true of an answered field.
  const empty = control({ type: 'file', files: [] });
  empty.parentElement = block({ controls: [empty] });
  assert.equal(hasAnswer(empty), false);
  const loaded = control({ type: 'file', files: [{}] });
  loaded.parentElement = block({ controls: [loaded] });
  assert.equal(hasAnswer(loaded), true);
  const chipped = control({ type: 'file', files: [] });
  chipped.parentElement = block({ chip: true, controls: [chipped] });
  assert.equal(hasAnswer(chipped), true);
});

test('a block flagged required is answered by what is inside it, since it holds no value itself', () => {
  const { hasAnswer } = gateScope();
  // Greenhouse marks its uploader required with a <div role="group" aria-required="true"> and leaves
  // the file input unmarked, so the flagged element is a container. This is the one place widening
  // is right, because a container has no value of its own to read.
  assert.equal(hasAnswer(block({ controls: [control({ type: 'file', files: [] })] })), false);
  assert.equal(hasAnswer(block({ controls: [control({ type: 'file', files: [{}] })] })), true);
  assert.equal(hasAnswer(block({ chip: true, controls: [] })), true);
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
  assert.match(SANDBOX_RUNNER, /if \(!culprit\) \{ stale\.push\(text\); continue; \}/);
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
  assert.match(SANDBOX_RUNNER, /const controls = \[\.\.\.widget\.querySelectorAll\('input:not\(\[type="hidden"\]\), textarea, select, \[role="combobox"\]'\)\];/);
  assert.match(SANDBOX_RUNNER, /if \(controls\.length === 0\) continue;/);
});

test('a message over a block of several controls accuses the required empty one, not the block', () => {
  // The same R-103 shape on the error path. Greenhouse's phone field is a fieldset holding the
  // country select and the number, and its uploader holds the resume and the cover letter. Reading
  // the block as a whole is wrong in both directions: it hides an empty required phone behind an
  // answered country, and it can blame an empty OPTIONAL cover letter for the resume's message,
  // which would refuse a complete application.
  assert.match(SANDBOX_RUNNER, /const marked = controls\.filter\(\(candidate\) => candidate\.required \|\| candidate\.getAttribute\('aria-required'\) === 'true'\);/);
  assert.match(SANDBOX_RUNNER, /culprit = marked\.find\(\(candidate\) => !hasAnswer\(candidate\)\) \|\| null;/);
  // When nothing in the block claims to be required the message is the only signal there is, and it
  // may block only if NOTHING in the block has been answered.
  assert.match(SANDBOX_RUNNER, /\} else if \(!controls\.some\(\(candidate\) => hasAnswer\(candidate\)\)\) \{/);
});

test('one unanswered React Select is not reported twice', () => {
  // Keying on the control rather than the block lets a fieldset report two empty required controls,
  // but an unanswered React Select carries aria-required on BOTH its combobox input and the hidden
  // input beside it, and the two resolve to the same question and the same label. Measured on the
  // empty live Redwood form: 15 raw entries covering 8 distinct fields.
  assert.match(SANDBOX_RUNNER, /blocking: \[\.\.\.new Set\(required\.map\(\(entry\) => entry\.message\)\)\]/);
});
