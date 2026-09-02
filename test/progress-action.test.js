import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeManagedBrowserProgress } from '../src/managed-browser.js';
import { managedRunProgressLogSummary } from '../src/run-log-summary.js';

const base = {
  version: 1,
  phase: 0,
  stage: 'phase_started',
  submitPressed: false,
  applicationSubmitPressed: false,
  verificationSubmitPressed: false,
  submitKind: null,
  policyVersion: null,
};

test('the action in flight rides on the progress and on its log summary', () => {
  const action = { index: 11, type: 'fillByLabelText', label: 'question:select country calling code' };
  const progress = normalizeManagedBrowserProgress({ ...base, action });
  assert.deepEqual(progress.action, action);
  const summary = managedRunProgressLogSummary(progress);
  assert.deepEqual(summary.action, action);
});

test('a malformed action is dropped, never a reason to reject the progress', () => {
  for (const action of [null, 'fill', { index: -1, type: 'fill', label: '' }, { index: 2 }, { index: 2, type: 'x'.repeat(41), label: '' }]) {
    const progress = normalizeManagedBrowserProgress({ ...base, action });
    assert.ok(progress, 'progress still normalizes');
    assert.equal('action' in progress, false);
  }
  assert.equal('action' in managedRunProgressLogSummary(normalizeManagedBrowserProgress(base)), false);
});
