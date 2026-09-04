import test from 'node:test';
import assert from 'node:assert/strict';
import { managedRunCompletionLogSummary } from '../api/run.js';
import { ALLOWED_ACTIONS } from '../src/managed-browser.js';

test('the completion line carries what the host needs and nothing from the page', () => {
  const summary = managedRunCompletionLogSummary(
    { url: 'https://acme.breezy.hr/p/1-role/apply?x=1', actions: [{ type: 'fill' }, { type: 'discover' }], screenshot: true, screenshotWait: true },
    {
      url: 'https://acme.breezy.hr/p/1-role/apply',
      title: 'Apply',
      text: 'SECRET PAGE TEXT with mehek@example.com',
      screenshot: '',
      filledFields: ['a', 'b'],
      blockers: ['CAPTCHA requires your attention'],
      skipped: [],
      humanVerification: { kind: 'security_code', fieldCount: 1, sentTo: null },
      submitOutcome: { pressed: false, state: 'not_attempted' },
      actionDiagnostics: [{ outcome: 'filled' }, { outcome: 'filled' }, { outcome: 'refused' }]
    },
    2345.6
  );
  assert.equal(summary.event, 'managed_browser_run_completed');
  assert.equal(summary.durationMs, 2346);
  assert.equal(summary.host, 'acme.breezy.hr');
  assert.equal(summary.actions, 2);
  assert.equal(summary.screenshotRequested, true);
  assert.equal(summary.screenshotWait, true);
  assert.equal(summary.screenshot, false);
  assert.equal(summary.textLength, 39);
  assert.equal(summary.filledFields, 2);
  assert.equal(summary.blockers, 1);
  assert.equal(summary.humanVerification, 'security_code');
  assert.equal(summary.submitPressed, false);
  assert.equal(summary.submitState, 'not_attempted');
  assert.deepEqual(summary.actionOutcomes, { filled: 2, refused: 1 });
  const serialised = JSON.stringify(summary);
  assert.equal(serialised.includes('SECRET'), false);
  assert.equal(serialised.includes('mehek@'), false);
  assert.equal(serialised.includes('/p/1-role'), false);
});

test('a bare run and a bad url summarise without throwing', () => {
  const summary = managedRunCompletionLogSummary({ url: 'not a url' }, {}, Number.NaN);
  assert.equal(summary.host, null);
  assert.equal(summary.durationMs, null);
  assert.equal(summary.screenshot, false);
  assert.deepEqual(summary.actionOutcomes, {});
  assert.deepEqual(summary.actionTypes, {});
  assert.equal(summary.uploadBytes, 0);
});

/* WAS THIS RUN EVEN GIVEN A RESUME.
 *
 * On 2026-09-03 that question could not be answered about packet a34e5ce2 from any record this
 * service keeps. The employer's required "CV or resume" dropzone came back empty, the result
 * claimed 'resume' in filled_fields, and the application record on the other side had
 * resume_attached false with an artifact selected. "The board refused the file" and "the run was
 * never given a file" are completely different defects in completely different repositories, and
 * 'actions: 34' distinguishes them not at all. */
test('the completion line says which action types the caller sent and how many document bytes came with them', () => {
  const summary = managedRunCompletionLogSummary(
    {
      url: 'https://dsi.recruitee.com/o/junior-automation-engineer',
      actions: [
        { type: 'fill', selector: '#name', value: 'Mehek Mandal', label: 'name' },
        { type: 'fill', selector: '#email', value: 'mehek@example.com', label: 'email' },
        { type: 'upload', selector: '#cv', label: 'resume', file: { name: 'Mehek_Mandal_Resume.pdf', mimeType: 'application/pdf', base64: 'QUJDRA==' } },
        { type: 'discover' }
      ]
    },
    {},
    10
  );
  assert.equal(summary.actions, 4);
  assert.deepEqual(summary.actionTypes, { fill: 2, upload: 1, discover: 1 });
  // 'QUJDRA==' is 8 base64 characters with two pad bytes, so four real bytes.
  assert.equal(summary.uploadBytes, 4);
  // And the values, labels, selectors and file name that were right there are still nowhere in it.
  const serialised = JSON.stringify(summary);
  for (const secret of ['Mehek', 'mehek@example.com', 'resume', '#cv', 'QUJDRA', 'junior-automation']) {
    assert.equal(serialised.includes(secret), false, 'the line must not carry ' + secret);
  }
});

test('a run with no upload action says so, which is the whole point', () => {
  const summary = managedRunCompletionLogSummary(
    { url: 'https://dsi.recruitee.com/o/role', actions: [{ type: 'fill' }, { type: 'fill' }, { type: 'confirmAndSubmit' }] },
    {},
    10
  );
  assert.equal(Object.prototype.hasOwnProperty.call(summary.actionTypes, 'upload'), false);
  assert.equal(summary.uploadBytes, 0);
});

test('an action type outside the closed vocabulary is counted, never quoted', () => {
  // The type field is caller-supplied, so it is the one place page text or an applicant value could
  // reach a log line through this counter. It cannot: an unrecognised type becomes 'unknown'.
  const summary = managedRunCompletionLogSummary(
    {
      url: 'https://dsi.recruitee.com/o/role',
      actions: [{ type: 'mehek@example.com' }, { type: 'upload', file: { base64: 'AAAA' } }, { type: null }]
    },
    {},
    10
  );
  assert.deepEqual(summary.actionTypes, { unknown: 2, upload: 1 });
  assert.equal(summary.uploadBytes, 3);
  assert.equal(JSON.stringify(summary).includes('mehek@'), false);
});

test('every action type this runner accepts is countable under its own name', () => {
  // Pinned against the runner's own set rather than a copy of it, so a new action type cannot start
  // being logged as 'unknown' without this failing.
  const summary = managedRunCompletionLogSummary(
    { url: 'https://dsi.recruitee.com/o/role', actions: [...ALLOWED_ACTIONS].map((type) => ({ type })) },
    {},
    10
  );
  assert.equal(Object.prototype.hasOwnProperty.call(summary.actionTypes, 'unknown'), false);
  assert.equal(Object.keys(summary.actionTypes).length, ALLOWED_ACTIONS.size);
});
