import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import {
  ATOMIC_SUBMIT_POLICY,
  CLAIM_CONTINUATION_SCRIPT,
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
    defaultTtlSeconds: 180,
    minTtlSeconds: 15,
    maxTtlSeconds: 240,
    ttlStartsAt: 'challenge',
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
          title: 'Continue',
          url: input.url,
          text: 'Check your inbox',
          humanVerification: { kind: 'security_code', fieldCount: 8, sentTo: 'applicant@example.com' }
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
      // The wait now watches SEVERAL paths - a result or a recorded crash - and reports which one
      // it found on stdout, so the fake answers the same way the sandbox does.
      const wanted = args.slice(3);
      const found = wanted.find((path) => this.files.has(path));
      return found ? { exitCode: 0, stdout: async () => found } : { exitCode: 3, stdout: async () => '' };
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

test('the continuation claim script allows one concurrent winner and rejects wrong-project and expired claims', async () => {
  const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-claim-'));
  const tokenHash = digest('receipt-observation-token');
  const projectHash = digest('project-a');
  const markerPath = path.join(workDir, 'stratus-continuation.json');
  const readyPath = path.join(workDir, 'stratus-continuation-ready.json');
  const usedPath = path.join(workDir, 'stratus-continuation-used.json');
  const writeMarker = (expiresAt) => {
    fs.rmSync(usedPath, { force: true });
    fs.writeFileSync(markerPath, JSON.stringify({ tokenHash, projectHash, expiresAt, used: false }));
    fs.writeFileSync(readyPath, '{}');
  };
  const claim = (claimedProjectHash = projectHash) => new Promise((resolve) => {
    const child = spawn(process.execPath, ['-e', CLAIM_CONTINUATION_SCRIPT, tokenHash, claimedProjectHash], {
      cwd: workDir,
      stdio: 'ignore',
    });
    child.on('close', resolve);
  });

  writeMarker(new Date(Date.now() + 15_000).toISOString());
  assert.equal(await claim(digest('project-b')), 5, 'a token from another project must not be consumed');
  assert.equal(fs.existsSync(markerPath), true);

  writeMarker(new Date(Date.now() - 1).toISOString());
  assert.equal(await claim(), 6, 'the short receipt token must refuse a claim after expiry');
  assert.equal(fs.existsSync(markerPath), true);

  writeMarker(new Date(Date.now() + 15_000).toISOString());
  const outcomes = await Promise.all([claim(), claim()]);
  assert.equal(outcomes.filter((code) => code === 0).length, 1, `exactly one claim may win: ${outcomes}`);
  assert.equal(outcomes.filter((code) => code !== 0).length, 1, `the racing claim must fail: ${outcomes}`);
  assert.equal(fs.existsSync(markerPath), false, 'the winner atomically consumes the only marker');
  assert.equal(fs.existsSync(usedPath), true);
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
  // The tick itself. check() first because the input is usually actionable, then the label, because
  // a board that clips the input out of the layout still paints words a person can click.
  assert.match(SANDBOX_RUNNER, /await match\.check\(\{ timeout: 5000 \}\)/);
  assert.match(SANDBOX_RUNNER, /\(byFor \|\| element\.closest\('label'\) \|\| element\)\.click\(\)/);
});

test('fills are reported only after the page keeps the value', () => {
  assert.match(SANDBOX_RUNNER, /const verifyFilled = async \(field, expected\) =>/);
  assert.match(SANDBOX_RUNNER, /const verifyChoiceInContainer = async \(container, expected, clickedOptionText\) =>/);
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

test('a widget that renders its answer shorter than the row that set it is not a lost answer', () => {
  /* THE LARGEST ANSWER-LOSS CLASS IN THE CORPUS, and it was never a lost answer.
   *
   * 45 of this user's 133 stored packets carry "choice value did not persist after fill"; 43 of them
   * are one control. Greenhouse's phone Country React Select is chosen from the menu row "United
   * Arab Emirates +971" and then renders what it holds as a flag element plus "+971", so verifying
   * that against the requested "United Arab Emirates" found nothing in common. Reproduced on 23 of
   * the 24 live employer forms behind those reports on 2026-08-09, and executed end to end in
   * test/managed-runner-replay.mjs case 10 against the live markup.
   *
   * The widening is verified against the row that was CLICKED, so it needs that row recorded.
   */
  assert.match(SANDBOX_RUNNER, /let lastClickedOptionText = '';/);
  assert.match(SANDBOX_RUNNER, /lastClickedOptionText = clean\(await byRole\.textContent\(\)\.catch\(\(\) => ''\)\);/);
  assert.match(SANDBOX_RUNNER, /lastClickedOptionText = clean\(await byText\.textContent\(\)\.catch\(\(\) => ''\)\);/);
  // Cleared at the top of every fill, so a row left over from an earlier control can never stand in
  // for one this control never showed.
  assert.match(SANDBOX_RUNNER, /const fillCustomChoice = async \(container, wanted\) => \{\n(?:.*\n)*?\s+lastClickedOptionText = '';/);
  // Both halves are required: the row had to carry the answer, and the control has to be showing
  // part of that same row.
  assert.match(SANDBOX_RUNNER, /if \(!row \|\| shown\.length < 2 \|\| !row\.includes\(shown\)\) return false;/);
  // Compared on the CLEANED text, not the normalised text. Normalising strips punctuation and "+1"
  // would then read as a substring of "united arab emirates 971".
  assert.match(SANDBOX_RUNNER, /const row = clean\(clickedOptionText \|\| ''\)\.toLowerCase\(\);/);
  assert.match(SANDBOX_RUNNER, /const shown = clean\(text\)\.toLowerCase\(\);/);
  // And the two call sites that have a row to offer are the only ones that pass one.
  assert.match(SANDBOX_RUNNER, /verifyChoiceInContainer\(container, action\.value \|\| '', lastClickedOptionText\)/);
});

test('a choice option that is not on the list names the answer that went looking', () => {
  // Measured 2026-08-09 on the live DV Trading form, one of the two packets that report this: the
  // "Graduation Date" React Select offers ranges - "January 2028 - July 2028", "August 2028 -
  // December 2028" - and the stored answer is the month "May 2028". The verdict is right and
  // unchanged; the bare "choice option not found" simply never told the applicant what to fix.
  // The emission, not the words: the sentence survives in the comment that explains why it went.
  assert.doesNotMatch(SANDBOX_RUNNER, /': choice option not found'/);
  assert.match(SANDBOX_RUNNER, /const unmatched = await readChoiceState\(container\);/);
  assert.match(SANDBOX_RUNNER, /no option matched "' \+ clean\(action\.value \|\| ''\) \+ '", left for you to choose/);
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

test('an opt-out is matched by what it means, not by how the employer spelled it', () => {
  // The two option vocabularies Litos has ever recorded, read out of stored Greenhouse label blobs
  // on 2026-08-09. Both word their opt-out their own way, and the stored answer is the plain
  // "Decline to self-identify" for both.
  const { optionMatches } = choiceHelpers();
  const stored = 'Decline to self-identify';
  assert.equal(optionMatches('I decline to self-identify for protected veteran status', stored), true);
  // "want", not "wish". No spelling on the enumerated synonym list could reach it.
  assert.equal(optionMatches('I do not want to answer', stored), true);
  assert.equal(optionMatches('I would rather not disclose this', stored), true);
  assert.equal(optionMatches("I don't wish to answer", stored), true);
  // And the answers on those same two lists that are CLAIMS about her are never read as refusals.
  assert.equal(optionMatches('I am not a protected veteran', stored), false);
  assert.equal(optionMatches('No, I do not have a disability and have not had one in the past', stored), false);
  assert.equal(optionMatches('Yes, I have a disability, or have had one in the past', stored), false);
  assert.equal(
    optionMatches('I identify as one or more of the classifications of protected veteran listed above', stored),
    false,
  );
  // Intent matching is decline-to-decline only: a refusal on the list does not answer a question
  // she gave a real answer to.
  assert.equal(optionMatches('I do not want to answer', 'Female'), false);
  assert.equal(optionMatches('I do not want to answer', 'Yes'), false);
});

test('a text fill that does not stick is retried as the choice it turned out to be', () => {
  // Measured on production packet 13bccb2d (Skydio, Ashby): "gender" and "veteran status" were both
  // resolved from the stored profile, both fell through to the plain text branch because the shape
  // read gave no role and no aria-haspopup to dispatch on, and both reported "value did not persist
  // after fillByLabelText". A real text input keeps what you type; one that does not is a widget.
  assert.match(SANDBOX_RUNNER, /let persisted = await verifyFilled\(field, action\.value \|\| ''\);/);
  assert.match(SANDBOX_RUNNER, /if \(!persisted\) \{\n\s+if \(await pickOptionPill\(container, action\.value \|\| ''\)\) persisted = true;/);
  // The row hint travels on this path too: a widget reached this way abbreviates its chosen value
  // exactly as readily as one reached through the two branches above.
  assert.match(SANDBOX_RUNNER, /else if \(await fillCustomChoice\(container, action\.value \|\| ''\)\) \{\n(?:.*\n)*?\s+persisted = await verifyChoiceInContainer\(container, action\.value \|\| '', lastClickedOptionText\);/);
  // Still only ever reported as filled once the page can be read back, and still reported as the
  // applicant's work when it cannot.
  assert.match(SANDBOX_RUNNER, /if \(action\.label && persisted\) filledFields\.push\(action\.label\);/);
  assert.match(SANDBOX_RUNNER, /value did not persist after fillByLabelText/);
});

test('choice matching is scoped to the question container, never the page', () => {
  // Unscoped, an answer as short as "Yes" could tick a consent or legal acknowledgement elsewhere
  // on the form, which the applicant cannot undo. The scope is now the question's OWN option block
  // rather than whatever container the anchor happened to land in; see D-02 and the test below.
  assert.match(SANDBOX_RUNNER, /const scope = await questionOptionBlock\(label, container\);/);
  assert.match(SANDBOX_RUNNER, /const choices = scope\.locator\('input\[type=checkbox\], input\[type=radio\]'\)/);
  // And an answer that matches no option leaves the control alone rather than guessing - and says
  // so, which it used to do silently.
  assert.match(SANDBOX_RUNNER, /no option matched "' \+ clean\(wanted\) \+ '", left for you to choose/);
  assert.match(SANDBOX_RUNNER, /total === 1 && \/\^yes\$\/i\.test\(wanted\)/);
  assert.match(SANDBOX_RUNNER, /actual === 'checked' && \/\^yes\$\/i\.test\(clean\(expected\)\)/);
});

test('a radio is reported from the radio that was clicked, not from the first one in the block', () => {
  /* D-02, the reporting half. Measured against the live Skydio Ashby form on 2026-08-09 with the
   * runner at 41d3095: all four EEO questions came back "value did not persist after
   * fillByLabelText" and filled_fields was empty, while the gender control was visibly holding an
   * answer. The branch ticked option n and then fell through to verifyFilled(field), where field is
   * the FIRST input in the block, so every answer that was not option 0 read back unchecked.
   *
   * The option now reports on itself and the arm ends there. Nothing about a choice reaches the
   * text verification at the bottom of fillByLabelText. */
  assert.match(SANDBOX_RUNNER, /const isChecked = async \(\) => await match\.evaluate\(\(element\) => element\.checked === true\)/);
  assert.match(SANDBOX_RUNNER, /return await isChecked\(\) \? 'checked' : 'not-checked';/);
  assert.match(SANDBOX_RUNNER, /if \(outcome === 'checked'\) \{\n\s+if \(action\.label\) filledFields\.push\(action\.label\);\n\s+continue;/);
  // A click that did not take is the applicant's to finish, and is named as such.
  assert.match(SANDBOX_RUNNER, /the option was clicked and did not stay selected/);
});

test('a question is anchored on the element that names it, not on prose that mentions it', () => {
  /* D-02, the placement half, and the more damaging of the two. On the live Skydio Ashby form the
   * first element containing "gender" is the equal-opportunity preamble - "...without regard to
   * race, color, religion, sex, gender identity..." - three questions above any control. Its
   * nearest ancestor holding an input is the whole self-identification section, eleven radios
   * across two questions, so the Race answer "Decline to self-identify" matched GENDER's
   * "Decline to self-identify" first in DOM order and set it. Measured end to end: the gender
   * control finished holding a decline on a run whose packet said Female, and Race was left blank.
   *
   * A whole-string match is tried first, so an element whose entire text IS the question wins over
   * prose that merely contains it. Containment stays as the fallback. */
  assert.match(SANDBOX_RUNNER, /const wholeLabel = wantedLabel/);
  assert.match(SANDBOX_RUNNER, /const exactLabel = wholeLabel \? page\.getByText\(wholeLabel\)\.first\(\) : null;/);
  assert.match(SANDBOX_RUNNER, /: page\.getByText\(action\.text, \{ exact: false \}\)\.first\(\);/);
  // And the option block is walked up from that anchor, through the four ways a board says "these
  // options belong together".
  assert.match(SANDBOX_RUNNER, /const questionOptionBlock = async \(anchor, fallback\) =>/);
  assert.match(SANDBOX_RUNNER, /self::fieldset or @data-field-path or @role="radiogroup" or @role="group"/);
  // Two named radio groups in one block are two questions, and answering either is a guess.
  assert.match(SANDBOX_RUNNER, /const radioGroupNames = async \(scope\) =>/);
  assert.match(SANDBOX_RUNNER, /if \(groups\.length > 1\) \{/);
  assert.match(SANDBOX_RUNNER, /could have landed on another question, left for you to choose/);
});

test('the label anchor is a whole-string match, so prose containing the question word loses', () => {
  // The regex the anchor is built from, exercised directly. "gender" is the stored question text
  // from packet 13bccb2d; "Gender" is Ashby's capitalisation, and the preamble sentence is the
  // element that used to win.
  const wholeLabel = (text) =>
    new RegExp('^\\s*' + text.replace(/[.*+?^$()|[\]\\{}]/g, '\\$&') + '\\s*[*:]?\\s*$', 'i');
  const gender = wholeLabel('gender');
  assert.equal(gender.test('Gender'), true, 'the question label, in the board\'s own capitalisation');
  assert.equal(gender.test('Gender *'), true, 'a required label carries an asterisk');
  assert.equal(gender.test('Gender:'), true);
  assert.equal(
    gender.test('Skydio provides equal employment opportunities to applicants and employees without'
      + ' regard to race, color, religion, sex, gender identity, sexual orientation'),
    false,
    'the preamble that used to be the anchor',
  );
  assert.equal(gender.test('Input gender'), false, 'the control description under the label');
  assert.equal(gender.test('What gender identity do you most closely identify with?'), false);
  // A question with regex metacharacters in it is matched literally, not compiled.
  const parens = wholeLabel('Do you live with a disability (as outlined by the ADA)?');
  assert.equal(parens.test('Do you live with a disability (as outlined by the ADA)?'), true);
  assert.equal(parens.test('Do you live with a disability as outlined by the ADA?'), false);
});

test('fillByLabelText climbs to a container that actually owns controls', () => {
  assert.match(
    SANDBOX_RUNNER,
    /ancestor::\*\[\(self::div or self::fieldset\) and \(\.\/\/textarea or \.\/\/input\[not\(@type="file"\) and not\(@type="hidden"\)\] or \.\/\/select or \.\/\/\*\[@role="combobox"\] or \.\/\/\*\[@aria-haspopup="listbox"\]\)\]\[1\]/,
  );
});

test('a date control is recognised from the control, not from the answer', () => {
  // Ashby date pickers expose a visible "Pick date..." text control while the required date state
  // stays empty, and the answer they are handed is routinely NOT already date-shaped: production
  // packet 59fb48ae was handed the string "2028". The old gate was
  // (answer matches YYYY-MM-DD) AND (placeholder mentions a date), which can only recognise a date
  // control on a run that had been given a date to begin with, so it is gone.
  assert.doesNotMatch(SANDBOX_RUNNER, /dateLikeAnswer/);
  assert.doesNotMatch(SANDBOX_RUNNER, /dateLikeField/);
  assert.match(SANDBOX_RUNNER, /const dateControlPrecisionOf = async \(field\)/);
  assert.match(SANDBOX_RUNNER, /react-datepicker-wrapper/);
  // The commit is a real Tab keypress: react-datepicker parses on nothing else. See
  // test/date-control-dom.test.js, which runs this against a real DOM rather than reading it.
  assert.match(SANDBOX_RUNNER, /field\.press\('Tab'\)/);
  // Both fill branches route through the one helper, so neither can describe a date failure in
  // words the other does not use.
  assert.equal(SANDBOX_RUNNER.split('await fillDateControl(').length - 1, 2);
  assert.equal(SANDBOX_RUNNER.split('recordDateFill(result,').length - 1, 2);
});

test('a fill selector that names a question fills the one control inside it', () => {
  // Production packet 59fb48ae: 'Expected Graduation Year' is the only question on that Ashby form
  // whose input carries no id and no name, so its selector is the field-entry DIV and
  // locator.fill() threw against it. Exactly one candidate, or none: a wrapper holding two controls
  // speaks for two questions.
  assert.match(SANDBOX_RUNNER, /const fillTargetWithin = async \(locator\)/);
  assert.match(SANDBOX_RUNNER, /\(await inside\.count\(\)\.catch\(\(\) => 0\)\) === 1 \? inside\.first\(\) : null/);
  assert.doesNotMatch(SANDBOX_RUNNER, /await locator\.fill\(fillValue/);
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

test('atomic required confirmation owns the submit and accepts only contract v2', () => {
  const actions = normalizeManagedActions([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' }
  ]);
  assert.deepEqual(actions[0], { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' });
  assert.throws(
    () => normalizeManagedActions([{ type: 'confirmAndSubmit', selector: 'button', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 1, submitKind: 'application' }]),
    (error) => error.code === 'INVALID_CONFIRM_AND_SUBMIT_VERSION'
  );
  assert.throws(
    () => normalizeManagedActions([{ type: 'confirmAndSubmit', selector: 'button', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' }]),
    (error) => error.code === 'INVALID_CONFIRM_AND_SUBMIT_SELECTOR'
  );
  assert.throws(
    () => normalizeManagedActions([{ ...actions[0], submitKind: 'application', securityCode: 'ABCD1234' }]),
    (error) => error.code === 'INVALID_SUBMIT_KIND'
  );
  assert.equal(ATOMIC_SUBMIT_POLICY.name, 'litos-final-submit');
  assert.equal(ATOMIC_SUBMIT_POLICY.version, 2);
  assert.equal(ATOMIC_SUBMIT_POLICY.grammarHash, '3302786c27e20fc2dd0a7396078e286db37051962893b554e92b8fd9db6816e9');
  assert.equal(
    crypto.createHash('sha256').update(`${ATOMIC_SUBMIT_POLICY.finalPattern}\n${ATOMIC_SUBMIT_POLICY.exclusionPattern}`).digest('hex'),
    ATOMIC_SUBMIT_POLICY.grammarHash
  );
  const applicationFinal = new RegExp(ATOMIC_SUBMIT_POLICY.finalPattern, 'i');
  const excluded = new RegExp(ATOMIC_SUBMIT_POLICY.exclusionPattern, 'i');
  const chooserCases = [
    ['Submit', true],
    ['Apply', true],
    ['Apply now', true],
    ['Submit application', true],
    ['Submit your application', true],
    ['Submit my application', true],
    ['Submit the application', true],
    ['Send this application', true],
    ['Send your application', true],
    ['Submit application with attachments', true],
    ['Submit your application with cover letter', true],
    ['Send application from your profile', true],
    ['Send application from your saved details', true],
    ['Submit application for review', true],
    ['Finish & apply', true],
    ['Submit your application - Contact Center Agent', true],
    ['Submit application - Acme Corp', true],
    ['Apply with LinkedIn', false],
    ['Apply With Indeed', false],
    ['Continue with Google', false],
    ['Sign in with Apple', false],
    ['Apply now with our recruiting partner', false],
    ['Import profile', false],
    ['Autofill with resume service', false],
    ['Quick apply', false],
    ['One-click apply', false],
    ['Submit feedback', false],
    ['Submit a support request', false],
    ['Submit your question', false],
    ['Submit application via Wellfound', false],
    ['Submit application with recruiting partner', false],
    ['Submit application feedback', false],
    ['Complete application', false],
    ['Finish application', false],
    ['Continue', false],
    ['Next', false],
    ['Finish', false],
    ['Sign in with Google', false],
    ['Start application', false],
    ['Submit application using Career Services', false],
    ['Send application from recruiting partner', false]
  ];
  for (const [label, expected] of chooserCases) {
    assert.equal(applicationFinal.test(label) && !excluded.test(label), expected, label);
  }
  const score = (label) => {
    if (!applicationFinal.test(label) || excluded.test(label)) return null;
    if (/\b(?:submit|send)\s+(?:your\s+|my\s+|the\s+|this\s+)?application\b/i.test(label)) return 3;
    if (/\bfinish\s+(?:and|&)\s+apply\b|^\s*apply\s+now\s*$/i.test(label)) return 2;
    return 1;
  };
  assert.equal(score('Submit application'), 3);
  assert.equal(score('Send your application'), 3);
  assert.equal(score('Finish and apply'), 2);
  assert.equal(score('Apply now'), 2);
  assert.equal(score('Submit'), 1);
  assert.equal(score('Apply'), 1);
  assert.equal(score('Submit with attachments'), 1);
  assert.equal(score('Apply with LinkedIn'), null);
  const { chooserPolicy: _chooserPolicy, ...missingPolicy } = actions[0];
  assert.throws(
    () => normalizeManagedActions([missingPolicy]),
    (error) => error.code === 'INVALID_CONFIRM_AND_SUBMIT_POLICY'
  );
  assert.throws(
    () => normalizeManagedActions([{ ...actions[0], chooserPolicy: { ...ATOMIC_SUBMIT_POLICY, finalPattern: `${ATOMIC_SUBMIT_POLICY.finalPattern} ` } }]),
    (error) => error.code === 'INVALID_CONFIRM_AND_SUBMIT_POLICY'
  );
  assert.throws(
    () => normalizeManagedActions([{ ...actions[0], chooserPolicy: { ...ATOMIC_SUBMIT_POLICY, grammarHash: '0'.repeat(64) } }]),
    (error) => error.code === 'INVALID_CONFIRM_AND_SUBMIT_POLICY'
  );
  assert.throws(
    () => normalizeManagedActions([actions[0], { ...actions[0], submitKind: 'verification' }]),
    (error) => error.code === 'MULTIPLE_ATOMIC_SUBMITS'
  );
  assert.match(SANDBOX_RUNNER, /requiredFieldConfirmation/);
  assert.match(SANDBOX_RUNNER, /confirmAndSubmitPass/);
  assert.match(SANDBOX_RUNNER, /await submitHandle\.click[\s\S]*finalSubmitPressed = true;/);
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
  assert.match(SANDBOX_RUNNER, /const discoveryCapabilities = currentInput\.actions\.some/);
  assert.match(SANDBOX_RUNNER, /inputType: el\.tagName === 'TEXTAREA'/);
  assert.match(SANDBOX_RUNNER, /role: el\.getAttribute\('role'\) \|\| null/);
  assert.match(SANDBOX_RUNNER, /\? \['discovery-control-role-v1'\]/);
  assert.match(SANDBOX_RUNNER, /\.\.\.\(discoveryCapabilities \? \{ capabilities: discoveryCapabilities \} : \{\}\)/);
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

const choiceHelpers = () => sandboxScope(['clean', 'normalized', 'DECLINE_TO_STATE', 'answerOptions', 'optionMatches', 'readChoiceState', 'verifyChoiceInContainer', 'choiceControlIsClosed']);

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

/* THE PHASED-SUBMIT REGRESSION, measured on production packet 13bccb2d (Skydio, Ashby, 2026-08-09).
 *
 * A fake sandbox that never produces a phase-0 result, so the only thing under test is what the
 * caller does about it. On origin/main this waits 60 seconds and reports "Managed browser
 * continuation timed out" on a run that requested no continuation of anything.
 */
function silentSandboxApi({ crash = null, result = null } = {}) {
  const template = { name: 'stratus-browser-runtime', currentSnapshotId: 'snapshot' };
  const calls = [];
  class Fake {
    constructor(name) { this.name = name; this.files = new Map(); this.stopped = false; }
    async writeFiles(files) { for (const file of files) this.files.set(file.path, Buffer.from(file.content)); }
    async runCommand(command, args) {
      if (typeof command === 'object') {
        if (crash) this.files.set('stratus-error.json', Buffer.from(JSON.stringify({ message: crash })));
        if (result) this.files.set('stratus-result-0.json', Buffer.from(JSON.stringify(result)));
        return { exitCode: null };
      }
      const timeoutMs = Number(args[2]);
      const wanted = args.slice(3);
      calls.push({ timeoutMs, wanted });
      const found = wanted.find((path) => this.files.has(path));
      return found ? { exitCode: 0, stdout: async () => found } : { exitCode: 3, stdout: async () => '' };
    }
    async readFileToBuffer({ path }) { return this.files.get(path) || null; }
    async stop() { this.stopped = true; }
  }
  const sandboxes = [];
  return {
    calls,
    sandboxes,
    api: {
      async get({ name }) { return name === template.name ? template : sandboxes.find((entry) => entry.name === name); },
      async fork({ name }) { const sandbox = new Fake(name); sandboxes.push(sandbox); return sandbox; }
    }
  };
}

const urlOnly = async (value) => new URL(value);

test('a submit run that produces nothing is a RUN timeout, on the run\'s own budget', async () => {
  const fake = silentSandboxApi();
  await assert.rejects(
    executeSandboxRun({ url: 'https://example.com/apply', actions: [], allowSubmit: true, requestContinuation: true },
      { sandboxApi: fake.api, urlValidator: urlOnly }),
    (error) => {
      // Not CONTINUATION_EXPIRED. The applicant was told her application had hit a continuation
      // problem on a form that has never issued a security code in its life.
      assert.equal(error.code, 'RUN_TIMED_OUT');
      assert.match(error.message, /run timed out before it produced a result/);
      return true;
    }
  );
  // Requesting a continuation must not shorten the run. 90_000 is what a managed run gets when it
  // does not request one; this used to be 60_000, and a 67-second Skydio submit died inside it.
  assert.equal(fake.calls[0].timeoutMs, 90_000, 'phase 0 gets the full run budget: ' + JSON.stringify(fake.calls));
  assert.deepEqual(fake.calls[0].wanted, ['stratus-result-0.json', 'stratus-error.json']);
});

test('a detached runner that crashes reports the crash, not a timeout', async () => {
  const fake = silentSandboxApi({ crash: 'page.goto: net::ERR_CONNECTION_REFUSED' });
  await assert.rejects(
    executeSandboxRun({ url: 'https://example.com/apply', actions: [], allowSubmit: true, requestContinuation: true },
      { sandboxApi: fake.api, urlValidator: urlOnly }),
    (error) => {
      // Detaching the run took stderr away from the caller, so every crash arrived as "the run took
      // too long" after the full budget - a wrong cause and a slow one.
      assert.equal(error.code, 'SANDBOX_RUN_FAILED');
      assert.match(error.message, /ERR_CONNECTION_REFUSED/);
      return true;
    }
  );
});

test('the runner decides whether a continuation is held open, not the caller\'s text sweep', async () => {
  // An employer's own post-submit confirmation says "check your email", which is exactly what the
  // caller's regex reads as a security-code challenge. The runner saw the page and said no.
  const fake = silentSandboxApi({
    result: {
      title: 'Skydio',
      url: 'https://jobs.ashbyhq.com/skydio/x/application',
      text: 'Success. Thank you for submitting your application. Please check your email for a confirmation code.',
      humanVerification: null,
      continuationOffered: false,
      submitOutcome: { pressed: true, state: 'confirmed', source: 'ats_state', evidence: '.ashby-application-form-success-container' }
    }
  });
  const result = await executeSandboxRun({ url: 'https://example.com/apply', actions: [], allowSubmit: true, requestContinuation: true },
    { sandboxApi: fake.api, urlValidator: urlOnly });
  assert.equal('continuationToken' in result, false, 'no challenge means no continuation to offer');
  assert.equal(fake.sandboxes[0].stopped, true, 'and the sandbox is released rather than left idling');
  assert.equal(result.submitOutcome.state, 'confirmed');
});

test('only a phase-zero pressed unknown outcome adds the short receipt observation capability', () => {
  assert.match(SANDBOX_RUNNER, /const pressedUnknown = phase === 0\s*&& submitOutcome\.pressed === true\s*&& submitOutcome\.state === 'unknown'/s);
  assert.match(
    SANDBOX_RUNNER,
    /continuationOffered = input\.requestContinuation === true\s*&& \(Boolean\(humanVerification\) \|\| input\.continuationCheckpoint === true \|\| pressedUnknown\)/s,
  );
  assert.match(SANDBOX_RUNNER, /receiptObservationOnly\s*\? 15\s*: Math\.max/s);
  assert.match(SANDBOX_RUNNER, /if \(phase > 0 \|\| !continuationOffered\) break/);
});

test('the runner reads the submit outcome off the page and reports it', () => {
  // Ashby's published state hooks, read out of the live Skydio posting's own bundle on 2026-08-09.
  // Keying on the container rather than the sentence is the point: the sentence is the employer's
  // own applicationSubmittedSuccessMessage and differs per org, the container does not.
  assert.match(SANDBOX_RUNNER, /ashby-application-form-success-container/);
  assert.match(SANDBOX_RUNNER, /ashby-application-form-failure-container/);
  // The failure container is checked FIRST. A page that rendered both would otherwise be read as a
  // submitted application.
  assert.ok(
    SANDBOX_RUNNER.indexOf('for (const selector of REJECTED_CONTAINERS)') < SANDBOX_RUNNER.indexOf('for (const selector of CONFIRMED_CONTAINERS)'),
    'a refusal must outrank a confirmation'
  );
  // Only on a run that pressed the button, and the press is recorded before the wait that can lose
  // it. "Was it pressed" is the fact the applicant's next move depends on.
  assert.match(SANDBOX_RUNNER, /if \(isFinalSubmitAction\(action\)\) finalSubmitPressed = true;/);
  assert.match(SANDBOX_RUNNER, /const submitOutcome = finalSubmitPressed/);
  // Body text alone cannot confirm anything while the form is still sitting there filled.
  assert.match(SANDBOX_RUNNER, /if \(!formStillPresent && CONFIRMED_TEXT\.test\(body\)\)/);
});
