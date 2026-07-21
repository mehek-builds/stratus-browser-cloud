import test from 'node:test';
import assert from 'node:assert/strict';
import { assertAuthorizedNavigation, detectProtectionChallenge, normalizeProtectionPolicy } from '../src/protection-policy.js';

test('protection policy normalizes scope and pacing', () => {
  const policy = normalizeProtectionPolicy({ allowedHosts: ['Example.com', 'example.com'], minNavigationIntervalMs: 999_999, challengeBehavior: 'pause' });
  assert.deepEqual(policy.allowedHosts, ['example.com']);
  assert.equal(policy.minNavigationIntervalMs, 60_000);
  assert.equal(policy.challengeBehavior, 'pause');
});

test('authorized navigation permits exact hosts and subdomains only', () => {
  const policy = normalizeProtectionPolicy({ allowedHosts: ['example.com'] });
  assert.equal(assertAuthorizedNavigation('https://app.example.com/path', policy).hostname, 'app.example.com');
  assert.throws(() => assertAuthorizedNavigation('https://example.net', policy), (error) => error.code === 'HOST_NOT_AUTHORIZED');
  assert.throws(() => assertAuthorizedNavigation('file:///etc/passwd', policy), (error) => error.code === 'UNSUPPORTED_NAVIGATION_SCHEME');
});

test('challenge detector reports common protection pages without solving them', () => {
  assert.equal(detectProtectionChallenge({ title: 'Verify you are human', text: 'Security check' }).type, 'human_verification');
  assert.equal(detectProtectionChallenge({ status: 429, url: 'https://example.com' }).type, 'rate_limited');
  assert.deepEqual(detectProtectionChallenge({ title: 'Normal page', text: 'Welcome' }), { detected: false });
});
