import test from 'node:test';
import assert from 'node:assert/strict';
import { managedRunCompletionLogSummary } from '../api/run.js';

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
});
