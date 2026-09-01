import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');

/* The managed-mutation transport containment flips to 'locked' the moment the initial navigation
 * settles, and every SPA board fetches its form config right after that moment. Counting those
 * GET data reads as violations killed 100% of managed fills in production on 2026-09-01. These
 * pins keep the carve-out exactly read-only data fetches, nothing wider. */

test('locked-mode containment lets read-only data fetches through', () => {
  assert.match(source, /const readOnlyDataFetch = readOnlyMethod\s*\n?\s*&& \(request\.resourceType\(\) === 'xhr' \|\| request\.resourceType\(\) === 'fetch'\);/);
  assert.match(source, /if \(!readOnlyDataFetch && !ashbyPublicBoardRead\(request\)\) \{\s*\n\s*return block\(route, request\.resourceType\(\) \+ ' transport'\);/);
});

test('everything else in the contained set stays blocked', () => {
  // The read-write channels are still in the contained resource set, whatever their method.
  assert.match(source, /'fetch', 'xhr', 'eventsource', 'websocket', 'ping', 'worker', 'serviceworker'/);
  // A write-shaped method outside the resource set still hits the method block.
  assert.match(source, /if \(!readOnlyMethod\) return block\(route, method \+ ' transport'\);/);
  // And the violation assert itself is untouched: one counted block still fails the run.
  assert.match(source, /A non-submit action attempted employer transport without exact final authority/);
});

test('only employer-bound blocked transport is run-fatal; third-party blocks are aborted quietly', () => {
  // The fatality discriminator is a registrable-suffix match against the application page's host,
  // fail-closed: an unparseable target counts as employer-bound.
  assert.match(source, /const employerBoundTransport = \(request\) => \{/);
  assert.match(source, /if \(!applicationTransportSite\) return true;/);
  assert.match(source, /\} catch \{ return true; \}/);
  // A third-party block is still aborted, and tracked, but does not increment the fatal counter.
  assert.match(source, /containment\.blockedThirdPartyCount \+= 1;/);
  assert.match(source, /if \(employerBoundTransport\(request\)\) \{\s*\n\s*containment\.blockedAttemptCount \+= 1;/);
  // The violation sentence names the blocked request so a 502 is diagnosable from logs alone.
  assert.match(source, /\+ \(detail \? ' \(' \+ detail \+ '\)' : ''\)/);
});
