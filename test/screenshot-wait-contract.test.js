import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeManagedRun } from '../src/managed-browser.js';

const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');

/* The runner captures the preview AFTER publishing the terminal result, so a host read races the
 * writer. The wait for that artifact is OPT-IN (litos-api's prepare, which hard-fails without it),
 * bounded, for clean absence only, and never for a pressed submission. These pins hold the
 * contract so no future caller inherits a wait it did not ask for, and no pressed receipt is ever
 * delayed by one. */

test('screenshotWait is opt-in by the literal true and rides normalization', async () => {
  const base = {
    url: 'https://example.com/apply',
    actions: [{ type: 'extract', selector: 'body' }],
  };
  assert.equal((await normalizeManagedRun({ ...base })).screenshotWait, false);
  assert.equal((await normalizeManagedRun({ ...base, screenshotWait: 'yes' })).screenshotWait, false);
  assert.equal((await normalizeManagedRun({ ...base, screenshotWait: 1 })).screenshotWait, false);
  assert.equal((await normalizeManagedRun({ ...base, screenshotWait: true })).screenshotWait, true);
});

test('a pressed result never waits, an unpressed screenshotWait result does', () => {
  assert.match(source, /const screenshotWaitMsForResult = \(screenshotWait, result\) => \(\s*\n\s*screenshotWait === true && !result\?\.submitOutcome\?\.pressed \? SCREENSHOT_ARTIFACT_WAIT_MS : 0\s*\n\);/);
});

test('every result-then-screenshot read path resolves its wait from the same rule', () => {
  const sites = source.split('screenshotWaitMsForResult(').length - 1;
  assert.equal(sites, 3, 'exactly the three read paths');
  assert.match(source, /screenshotWaitMsForResult\(context\.screenshotWait, result\)/);
  assert.match(source, /screenshotWaitMsForResult\(continuation\.screenshotWait, result\)/);
  assert.match(source, /screenshotWaitMsForResult\(screenshotWait, result\)/);
});

test('the wait retries clean absence only; a failed read resolves immediately', () => {
  assert.match(source, /if \(!sandboxNotFound\(error\)\) return null;/);
  assert.match(source, /if \(screenshotBuffer \|\| readFailed \|\| Date\.now\(\) >= screenshotDeadline\) break;/);
});
