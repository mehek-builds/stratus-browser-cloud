import test from 'node:test';
import assert from 'node:assert/strict';
import { executeManagedRun, FREE_MANAGED_LIMITS, normalizeManagedActions } from '../src/managed-browser.js';

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
  assert.throws(() => normalizeManagedActions(Array.from({ length: 21 }, () => ({ type: 'click', selector: 'button' }))), (error) => error.code === 'TOO_MANY_ACTIONS');
});

test('managed run always uses the Stratus Sandbox execution system', async () => {
  const sandboxExecutor = async (input) => ({ title: 'Sandbox', url: input.url, screenshot: 'sandbox-image' });
  const result = await executeManagedRun({ url: 'https://example.com' }, { sandboxExecutor });
  assert.equal(result.title, 'Sandbox');
  assert.equal(result.screenshot, 'sandbox-image');
});
