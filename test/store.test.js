import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/store.js';
import { isPrivateIp } from '../src/security.js';
import { redact } from '../src/utils.js';

test('default project exposes the required capacity contract', () => {
  const store = new Store(':memory:');
  const usage = store.usage();
  assert.equal(usage.concurrentLimit, 100);
  assert.equal(usage.browserHoursAllowance, 500);
  store.db.close();
});

test('scheduler accepts exactly 100 reservations and rejects the 101st', () => {
  const store = new Store(':memory:');
  for (let index = 0; index < 100; index++) store.reserveSession({ userMetadata: { index } });
  assert.equal(store.runningCount(), 100);
  assert.throws(() => store.reserveSession(), (error) => error.code === 'CONCURRENCY_LIMIT' && error.status === 429);
  store.db.close();
});

test('release transitions are idempotent and usage is bounded', () => {
  const store = new Store(':memory:');
  const session = store.reserveSession();
  store.updateSession(session.id, { status: 'RUNNING', startedAt: new Date(Date.now() - 3_600_000).toISOString() });
  store.updateSession(session.id, { status: 'COMPLETED', endedAt: new Date().toISOString() });
  const usage = store.usage();
  assert.equal(usage.concurrent, 0);
  assert.ok(usage.browserHoursUsed >= 0.999 && usage.browserHoursUsed <= 1.001);
  store.db.close();
});

test('security helpers block local ranges and redact credentials', () => {
  assert.equal(isPrivateIp('127.0.0.1'), true);
  assert.equal(isPrivateIp('169.254.169.254'), true);
  assert.equal(isPrivateIp('8.8.8.8'), false);
  assert.deepEqual(redact({ apiKey: 'sk_secretvalue123', nested: { authorization: 'Bearer token' } }), { apiKey: '[REDACTED]', nested: { authorization: '[REDACTED]' } });
});

test('persistent contexts are created with isolated state files', () => {
  const store = new Store(':memory:');
  const context = store.createContext('Buyer identity');
  assert.match(context.id, /^ctx_/);
  assert.equal(store.listContexts()[0].name, 'Buyer identity');
  store.db.close();
});
