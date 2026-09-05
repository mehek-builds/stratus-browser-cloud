import test from 'node:test';
import assert from 'node:assert/strict';
import { runTimeoutMsFor } from '../src/local-managed-runner.js';

const NOW = Date.parse('2026-09-01T22:41:00.000Z');

test('the host waits until the runner\'s own deadline has passed, plus a return margin', () => {
  // litos-api grants a prepare fill 280s; the runner stops at 270s; the host waits 285s.
  assert.equal(runTimeoutMsFor(new Date(NOW + 280_000).toISOString(), NOW), 285_000);
});

test('a short or absent deadline keeps the flat 150s the host always had', () => {
  assert.equal(runTimeoutMsFor(undefined, NOW), 150_000);
  assert.equal(runTimeoutMsFor('not a timestamp', NOW), 150_000);
  assert.equal(runTimeoutMsFor(new Date(NOW + 60_000).toISOString(), NOW), 150_000);
  // Already expired: the runner refuses at once and the flat wait is more than enough.
  assert.equal(runTimeoutMsFor(new Date(NOW - 5_000).toISOString(), NOW), 150_000);
});

test('a malformed far-future deadline cannot hold a run slot for an hour', () => {
  assert.equal(runTimeoutMsFor(new Date(NOW + 3_600_000).toISOString(), NOW), 480_000);
});
