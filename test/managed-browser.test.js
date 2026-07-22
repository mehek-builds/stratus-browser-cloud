import test from 'node:test';
import assert from 'node:assert/strict';
import { browserlessConfiguration, executeManagedRun, FREE_MANAGED_LIMITS, normalizeManagedActions } from '../src/managed-browser.js';

test('managed free limits are explicit and do not claim paid capacity', () => {
  assert.deepEqual(FREE_MANAGED_LIMITS, { concurrentBrowsers: 2, monthlyUnits: 1000, maxRunSeconds: 60, persistedDays: 1 });
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

test('provider configuration stays server-side', () => {
  assert.deepEqual(browserlessConfiguration({}), { configured: false, token: undefined, endpoint: 'https://production-sfo.browserless.io' });
  assert.equal(browserlessConfiguration({ BROWSERLESS_TOKEN: 'secret' }).configured, true);
});

test('managed run sends trusted function code and returns provider data', async () => {
  let captured;
  const fetchImpl = async (url, options) => {
    captured = { url: url.toString(), options, body: JSON.parse(options.body) };
    return new Response(JSON.stringify({ data: { title: 'Example Domain', url: 'https://example.com/', screenshot: 'abc' } }), { status: 200 });
  };
  const urlValidator = async (value) => new URL(value);
  const result = await executeManagedRun({ url: 'https://example.com', actions: [{ type: 'extract', selector: 'h1' }] }, { env: { BROWSERLESS_TOKEN: 'provider-secret' }, fetchImpl, urlValidator });
  assert.equal(result.title, 'Example Domain');
  assert.match(captured.url, /^https:\/\/production-sfo\.browserless\.io\/function\?token=provider-secret$/);
  assert.equal(captured.body.context.url, 'https://example.com/');
  assert.equal(captured.body.context.actions[0].type, 'extract');
  assert.match(captured.body.code, /export default async function/);
});

test('managed run reports missing provider configuration clearly', async () => {
  await assert.rejects(executeManagedRun({ url: 'https://example.com' }, { env: {} }), (error) => error.status === 503 && error.code === 'PROVIDER_NOT_CONFIGURED');
});
