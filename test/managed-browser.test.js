import test from 'node:test';
import assert from 'node:assert/strict';
import { executeManagedRun, FREE_MANAGED_LIMITS, normalizeManagedActions, SANDBOX_RUNNER } from '../src/managed-browser.js';

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
});

test('fillByLabelText dispatches on the control type', () => {
  // Everything used to fall through to fill(), which throws on a checkbox or radio.
  assert.match(SANDBOX_RUNNER, /shape\.tag === 'select'/);
  assert.match(SANDBOX_RUNNER, /shape\.type === 'checkbox' \|\| shape\.type === 'radio'/);
  assert.match(SANDBOX_RUNNER, /await option\.check\(\)/);
});

test('choice matching is scoped to the question container, never the page', () => {
  // Unscoped, an answer as short as "Yes" could tick a consent or legal acknowledgement elsewhere
  // on the form, which the applicant cannot undo.
  assert.match(SANDBOX_RUNNER, /const choices = container\.locator\('input\[type=checkbox\], input\[type=radio\]'\)/);
  // And an answer that matches no option leaves the control alone rather than guessing.
  assert.match(SANDBOX_RUNNER, /if \(!matched\) continue;/);
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
