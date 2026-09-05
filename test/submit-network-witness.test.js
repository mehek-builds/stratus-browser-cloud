/* THE NETWORK WITNESS AROUND THE FINAL PRESS RECORDS WHAT THE PAGE WOULD NOT SAY.
 *
 * Measured on the live Easy Dynamics Rippling form, twice (2026-08-20): Send pressed, the page
 * rendered neither confirmation nor rejection, and nothing recorded what the submit request
 * returned. These cases run the REAL watch (extracted from the shipped runner, never copied)
 * against pages whose write-shaped requests succeed, fail with a status, and never return at all.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

function watchSource() {
  const start = SANDBOX_RUNNER.indexOf('let submitNetwork = null;');
  const end = SANDBOX_RUNNER.indexOf("/* V4'S LAST MUTATION BOUNDARY", start);
  assert.ok(start > 0 && end > start, 'the submit network watch must exist in the sandbox runner');
  return SANDBOX_RUNNER.slice(start, end);
}

let browser;
let page;
test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

function armedWatch() {
  const reader = new Function('page', watchSource()
    + '\narmSubmitNetworkWatch();\nreturn () => submitNetwork;');
  return reader(page);
}

// setContent leaves the page on about:blank, where a relative fetch cannot resolve, so every
// case stands the page on a routed origin first.
async function standOn(markup) {
  await page.route('https://board.test/', (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><html><body>' + markup + '</body></html>',
  }));
  await page.goto('https://board.test/');
}

test('a write-shaped response is recorded with its status and without its query string', async () => {
  await page.route('**/submit*', (route) => route.fulfill({ status: 422, body: '{}' }));
  await standOn('<button id="go">Apply</button>');
  const read = armedWatch();
  await page.evaluate(() => {
    document.getElementById('go').addEventListener('click', () => {
      fetch('/submit?token=SECRET123', { method: 'POST', body: '{}' });
    });
  });
  await page.click('#go');
  await page.waitForTimeout(500);
  const entries = read();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].method, 'POST');
  assert.equal(entries[0].status, 422);
  assert.ok(entries[0].url.endsWith('/submit'), entries[0].url);
  assert.ok(!entries[0].url.includes('SECRET123'), 'query strings must never be recorded');
  await page.unroute('**/submit*');
});

test('a request that never returns is recorded as a failure, and reads are ignored', async () => {
  await page.route('**/hang', (route) => route.abort('connectionfailed'));
  await page.route('**/read', (route) => route.fulfill({ status: 200, body: '{}' }));
  await standOn('<p>form</p>');
  const read = armedWatch();
  await page.evaluate(() => {
    fetch('/hang', { method: 'POST', body: '{}' }).catch(() => {});
    fetch('/read', { method: 'GET' }).catch(() => {});
  });
  await page.waitForTimeout(500);
  const entries = read();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].status, null);
  assert.ok(entries[0].failure, 'a hung request carries its failure text');
  await page.unroute('**/hang');
  await page.unroute('**/read');
});

test('the record is bounded at twenty entries', async () => {
  await page.route('**/ping', (route) => route.fulfill({ status: 204, body: '' }));
  await standOn('<p>chatter</p>');
  const read = armedWatch();
  await page.evaluate(async () => {
    for (let i = 0; i < 30; i += 1) await fetch('/ping', { method: 'POST', body: '' });
  });
  await page.waitForTimeout(500);
  assert.equal(read().length, 20);
  await page.unroute('**/ping');
});

/* The wiring, pinned in source: armed before BOTH press paths (the atomic pass and the plain
 * final-submit click), and reported on the pressed outcome only. */
test('the watch is armed at both press sites and travels in submitOutcome', () => {
  const armSites = [...SANDBOX_RUNNER.matchAll(/armSubmitNetworkWatch\(\);/g)]
    .map((match) => match.index);
  assert.equal(armSites.length, 2, 'the watch is armed once for each final press path');
  const atomicClick = SANDBOX_RUNNER.indexOf('await submitHandle.click', armSites[0]);
  assert.ok(atomicClick > armSites[0] && atomicClick < armSites[1],
    'the atomic watch is armed before the retained submit handle is clicked');
  const legacyClick = SANDBOX_RUNNER.indexOf('await locator.click();', armSites[1]);
  assert.ok(legacyClick > armSites[1],
    'the legacy watch is armed before the final locator is clicked');
  /* This used to require readSubmitOutcome() to be reached through
   * "...(await observeForResult(...readSubmitOutcome()...))". #175 deliberately removed that
   * wrapper (see test/post-submit-observation-survives-blocked-transport.test.js): routing the
   * receipt read through observeForResult's shared disposition gate meant a blocked-transport
   * flag silently swapped a real 'confirmed' read for the gate's hardcoded unknown fallback,
   * measured live on an Exa/Ashby packet that had actually gone through. readSubmitOutcome()
   * fails closed to 'unknown' on its own and does not need that gate. The invariant this test
   * pins - submitNetwork ends up merged into submitOutcome downstream of the real DOM receipt
   * read - still holds in the new shape; only the obsolete observeForResult wrapping is gone, so
   * the pattern below asserts the direct, unwrapped call instead of re-pinning the wrapper. */
  // ROUND 3: submit_request_seen is now tri-state (true/false/null) and passed through exactly as
  // computed - no "=== true" coercion, which used to collapse the "no binding for this ATS" null
  // case into a plain false. See the long comment above submitRequestSeen's declaration.
  assert.match(
    SANDBOX_RUNNER,
    /\.\.\.\(await readSubmitOutcome\(\)\)[\s\S]*?\.\.\.\(submitNetwork \? \{ network: submitNetwork, submit_request_seen: submitRequestSeen \} : \{\}\)/,
    'submitNetwork must be spread into submitOutcome, alongside submit_request_seen, after the real DOM receipt read from readSubmitOutcome()'
  );
});

/* SUBMIT_REQUEST_SEEN IS THE FACT AN EMPTY ARRAY COULD NEVER CARRY: whether the bound submit
 * request was issued at all while the watch was armed, distinct from whether it ever answered.
 * Measured on the real incident this closes (Pony.ai on Workable, run a7876200, 2026-09-05): the
 * network record held zero entries for a press that DID reach the wire, indistinguishable from a
 * press that never left the browser at all.
 *
 * board.test carries no submit-endpoint binding (only apply.workable.com does - see
 * resolveSubmitEndpointBinding), so ROUND 3 changes what this generic write-shaped request means
 * for submitRequestSeen: it still gets RECORDED into network as evidence, but it no longer flips
 * submitRequestSeen true, because a write-shaped request on an ATS this file cannot bind by
 * endpoint proves nothing about whether the EMPLOYER'S OWN apply call ever fired. */
test('an unbound write-shaped request is recorded immediately with an unanswered outcome, but never flips submitRequestSeen', async () => {
  // Never fulfilled and never aborted: the request is issued and then simply never resolves for
  // the life of this test, which is exactly the shape a run whose observation window ends before
  // the employer answers sees.
  await page.route('**/hang-forever', () => {});
  await standOn('<p>form</p>');
  const reader = new Function('page', watchSource()
    + '\narmSubmitNetworkWatch();\nreturn () => ({ network: submitNetwork, seen: submitRequestSeen });');
  const read = reader(page);
  await page.evaluate(() => { fetch('/hang-forever', { method: 'POST', body: '{}' }).catch(() => {}); });
  await page.waitForTimeout(300);
  const { network, seen } = read();
  assert.equal(seen, null, 'no binding exists for board.test, so submitRequestSeen must stay null, never true or false');
  assert.equal(network.length, 1, 'the request must still be recorded at issue time, before any response');
  assert.equal(network[0].status, null);
  assert.equal(network[0].outcome, 'unanswered');
  assert.equal(network[0].bound, undefined, 'an unbound entry must not carry bound: true');
  assert.ok(typeof network[0].issued_at === 'string' && network[0].issued_at.length > 0);
  await page.unroute('**/hang-forever');
});

/* ROUND 3: THE SUBMIT-ENDPOINT BINDING TABLE. Workable's apply call is a fixed, public shape -
 * POST apply.workable.com/api/v1/jobs/<jobId>/apply - and the job id is read straight off the
 * page's own URL (apply.workable.com/<account>/j/<JOBID>/apply) at arm time. These cases stand a
 * real page on that route and arm the real watch against it, so the binding is proven end to end
 * rather than against a mock. */
async function standOnWorkable(markup, { jobId = 'ABCDEF1234', account = 'acmeco' } = {}) {
  const pageUrl = 'https://apply.workable.com/' + account + '/j/' + jobId + '/apply';
  await page.route(pageUrl, (route) => route.fulfill({
    status: 200, contentType: 'text/html', body: '<!doctype html><html><body>' + markup + '</body></html>',
  }));
  await page.goto(pageUrl);
  return { pageUrl, jobId, account };
}

test('a request matching the Workable submit-endpoint binding flips submitRequestSeen true and is marked bound', async () => {
  const { jobId } = await standOnWorkable('<button id="go">Apply</button>');
  await page.route('**/api/v1/jobs/' + jobId + '/apply', (route) => route.fulfill({ status: 200, body: '{}' }));
  const reader = new Function('page', watchSource()
    + '\narmSubmitNetworkWatch();\nreturn () => ({ network: submitNetwork, seen: submitRequestSeen });');
  const read = reader(page);
  await page.evaluate((id) => {
    fetch('/api/v1/jobs/' + id + '/apply', { method: 'POST', body: '{}' });
  }, jobId);
  await page.waitForTimeout(500);
  const { network, seen } = read();
  assert.equal(seen, true, 'a request matching the binding must flip submitRequestSeen true');
  assert.equal(network.length, 1);
  assert.equal(network[0].bound, true, 'a bound match must carry bound: true');
  await page.unroute('**/api/v1/jobs/' + jobId + '/apply');
});

test('an unrelated POST on a bound ATS leaves submitRequestSeen false, not true', async () => {
  const { jobId } = await standOnWorkable('<p>form</p>');
  await page.route('**/api/v1/track', (route) => route.fulfill({ status: 200, body: '{}' }));
  const reader = new Function('page', watchSource()
    + '\narmSubmitNetworkWatch();\nfinalizeSubmitNetworkWatch();'
    + '\nreturn () => ({ network: submitNetwork, seen: submitRequestSeen });');
  const read = reader(page);
  await page.evaluate(() => { fetch('/api/v1/track', { method: 'POST', body: '{}' }); });
  await page.waitForTimeout(500);
  const { network, seen } = read();
  assert.equal(seen, false,
    'a binding exists for Workable, and an unrelated write-shaped request must not satisfy it');
  assert.equal(network.length, 1, 'the unrelated request is still recorded as evidence');
  assert.equal(network[0].bound, undefined, 'an unrelated request must not be marked bound');
  void jobId;
  await page.unroute('**/api/v1/track');
});

test('a mismatched job id in the submit path is not bound', async () => {
  const { jobId } = await standOnWorkable('<p>form</p>');
  const otherJobId = jobId === 'ZZZZZZZZZZ' ? 'YYYYYYYYYY' : 'ZZZZZZZZZZ';
  await page.route('**/api/v1/jobs/' + otherJobId + '/apply', (route) => route.fulfill({ status: 200, body: '{}' }));
  const reader = new Function('page', watchSource()
    + '\narmSubmitNetworkWatch();\nfinalizeSubmitNetworkWatch();'
    + '\nreturn () => ({ network: submitNetwork, seen: submitRequestSeen });');
  const read = reader(page);
  await page.evaluate((id) => {
    fetch('/api/v1/jobs/' + id + '/apply', { method: 'POST', body: '{}' });
  }, otherJobId);
  await page.waitForTimeout(500);
  const { network, seen } = read();
  assert.equal(seen, false, 'a job id belonging to a different posting must not satisfy this run\'s binding');
  assert.equal(network[0].bound, undefined);
  await page.unroute('**/api/v1/jobs/' + otherJobId + '/apply');
});

test('a beacon-shaped request matching the binding is seen and marked bound', async () => {
  const { jobId } = await standOnWorkable('<p>form</p>');
  await page.route('**/api/v1/jobs/' + jobId + '/apply', (route) => route.fulfill({ status: 200, body: '' }));
  const reader = new Function('page', watchSource()
    + '\narmSubmitNetworkWatch();\nreturn () => ({ network: submitNetwork, seen: submitRequestSeen });');
  const read = reader(page);
  await page.evaluate((id) => {
    navigator.sendBeacon('/api/v1/jobs/' + id + '/apply', new Blob(['{}'], { type: 'application/json' }));
  }, jobId);
  await page.waitForTimeout(500);
  const { network, seen } = read();
  assert.equal(seen, true, 'a beacon matching the binding must still flip submitRequestSeen true');
  assert.ok(network.some((entry) => entry && entry.bound === true),
    'the beacon-shaped match must be recorded and marked bound: ' + JSON.stringify(network));
  await page.unroute('**/api/v1/jobs/' + jobId + '/apply');
});

test('a request that later answers is resolved in place, not duplicated, and loses its unanswered outcome', async () => {
  let resolveRoute;
  const held = new Promise((resolve) => { resolveRoute = resolve; });
  await page.route('**/slow', async (route) => {
    await held;
    await route.fulfill({ status: 201, body: '{}' });
  });
  await standOn('<p>form</p>');
  const reader = new Function('page', watchSource()
    + '\narmSubmitNetworkWatch();\nreturn () => submitNetwork;');
  const read = reader(page);
  await page.evaluate(() => { window.__p = fetch('/slow', { method: 'POST', body: '{}' }); });
  await page.waitForTimeout(200);
  // Still open: recorded once, unanswered, no status yet.
  assert.equal(read().length, 1);
  assert.equal(read()[0].status, null);
  assert.equal(read()[0].outcome, 'unanswered');
  resolveRoute();
  await page.waitForTimeout(300);
  const entries = read();
  assert.equal(entries.length, 1, 'the same request must not be recorded twice');
  assert.equal(entries[0].status, 201);
  assert.equal(entries[0].outcome, undefined, 'a resolved request must no longer carry an unanswered outcome');
  await page.unroute('**/slow');
});

test('finalizeSubmitNetworkWatch stamps waited_seconds onto whatever is still open when the run ends', async () => {
  await page.route('**/hang-forever-2', () => {});
  await standOn('<p>form</p>');
  const reader = new Function('page', watchSource()
    + '\narmSubmitNetworkWatch();\nreturn () => { finalizeSubmitNetworkWatch(); return submitNetwork; };');
  const read = reader(page);
  await page.evaluate(() => { fetch('/hang-forever-2', { method: 'POST', body: '{}' }).catch(() => {}); });
  await page.waitForTimeout(300);
  const entries = read();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].outcome, 'unanswered');
  assert.equal(typeof entries[0].waited_seconds, 'number');
  assert.ok(entries[0].waited_seconds >= 0);
  await page.unroute('**/hang-forever-2');
});

test('a fill run that never arms the watch reports submitRequestSeen as null, not false', () => {
  const reader = new Function('page', watchSource() + '\nreturn () => submitRequestSeen;');
  assert.equal(reader(page)(), null);
});
