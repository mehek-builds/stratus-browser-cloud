/* A PAGE RELOADING ITSELF IS NOT A STEP TOWARD THE EMPLOYER.
 *
 * Celerant Tech (Paylocity), 2026-09-05: the public-apply bundle calls window.location.reload()
 * when one of its own fetches returns an opaque redirect, and the locked containment refused that
 * main-frame GET of the page the run was already on as 'navigation transport'. These drive the
 * extracted handler exactly as captcha-widget-frame.test.js does, against a page that knows its
 * own URL, and pin the bound and every neighbouring refusal.
 */

import assert from 'node:assert/strict';
import test from 'node:test';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

function extractHandler(from) {
  const anchor = SANDBOX_RUNNER.indexOf(from);
  assert.notEqual(anchor, -1, `${from} must still be in the runner`);
  const start = SANDBOX_RUNNER.indexOf('containment.handler = async (route) => {', anchor);
  assert.notEqual(start, -1, 'the containment handler must still be an inline arrow');
  const open = SANDBOX_RUNNER.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SANDBOX_RUNNER.length; i += 1) {
    const ch = SANDBOX_RUNNER[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return SANDBOX_RUNNER.slice(start, i + 1).replace(/^containment\.handler = /, '');
    }
  }
  assert.fail('the containment handler never closed');
}

const MAIN_FRAME = { name: 'main' };
const CHILD_FRAME = { name: 'child' };
const APPLY_URL = 'https://recruiting.paylocity.com/recruiting/jobs/Apply/2950251/Celerant-Tech/Software-Developer-Intern';
const PAGE = { mainFrame: () => MAIN_FRAME, url: () => APPLY_URL };

function fakeRequest({ url, method = 'GET', resourceType = 'document', navigation = true, mainFrame = true }) {
  return {
    url: () => url,
    method: () => method,
    resourceType: () => resourceType,
    isNavigationRequest: () => navigation,
    frame: () => (mainFrame ? MAIN_FRAME : CHILD_FRAME),
    postData: () => null,
    allHeaders: async () => ({}),
  };
}

function fakeRoute(request) {
  const calls = [];
  return {
    calls,
    request: () => request,
    fallback: async () => { calls.push('fallback'); },
    abort: async (reason) => { calls.push(`abort:${reason}`); },
  };
}

// The same canonicalizer the runner uses, reduced to what these URLs exercise: hash dropped,
// query kept, everything else byte for byte.
const canonicalPageUrl = (value) => { const parsed = new URL(value); parsed.hash = ''; return parsed.toString(); };

function makeHandler(containment, blocked) {
  const source = extractHandler('const transportTypes = new Set([');
  const names = [
    'containment', 'transportTypes', 'block', 'ashbyPublicBoardRead', 'ashbyFormValueWrite',
    'ashbyFileBindWrite', 'ashbyFileUploadHandleRequest', 'teamtailorCookieChoiceWrite',
    'captureAshbyOneShotUploadTarget', 'ashbyOneShotUploadTargetMatches', 'boardResumeStorageUpload',
    'employerBoundTransport', 'canonicalPageUrl', 'page', 'captchaWidgetFrame',
  ];
  return new Function(...names, `return ${source};`)(
    containment,
    new Set(['fetch', 'xhr', 'eventsource', 'websocket', 'ping', 'worker', 'serviceworker']),
    async (route, reason) => { blocked.push(reason); return route.abort('blockedbyclient'); },
    () => false, () => false, () => false, () => false, () => false,
    async (route) => route.fallback(), () => false, () => false, () => false,
    canonicalPageUrl,
    PAGE,
    () => false,
  );
}

function lockedContainment() {
  return {
    mode: 'locked',
    allowedNavigationUrl: null,
    selfReloadsAdmitted: 0,
    blockedAttemptCount: 0,
    blockedReason: null,
    blockedThirdPartyCount: 0,
    uploadActionArmed: false,
    ashbyOneShotUpload: null,
    ashbyFileBindWriteAdmitted: false,
  };
}

async function run(handler, request) {
  const route = fakeRoute(request);
  await handler(route);
  return route.calls;
}

test('the page the run is on may reload itself, twice, and the third time is refused', async () => {
  const containment = lockedContainment();
  const blocked = [];
  const handler = makeHandler(containment, blocked);
  assert.deepEqual(await run(handler, fakeRequest({ url: APPLY_URL })), ['fallback']);
  assert.deepEqual(await run(handler, fakeRequest({ url: `${APPLY_URL}#step-2` })), ['fallback'], 'a hash is not a different page');
  assert.equal(containment.selfReloadsAdmitted, 2);
  assert.deepEqual(blocked, []);
  assert.deepEqual(await run(handler, fakeRequest({ url: APPLY_URL })), ['abort:blockedbyclient'], 'a board reloading in a loop is stopped, not fed');
  assert.deepEqual(blocked, ['navigation transport']);
});

test('the same host, a different page, is still a navigation the run never authorized', async () => {
  const blocked = [];
  const handler = makeHandler(lockedContainment(), blocked);
  const details = 'https://recruiting.paylocity.com/recruiting/jobs/Details/2950251/Celerant-Tech/Software-Developer-Intern';
  assert.deepEqual(await run(handler, fakeRequest({ url: details })), ['abort:blockedbyclient']);
  assert.deepEqual(await run(handler, fakeRequest({ url: `${APPLY_URL}?step=2` })), ['abort:blockedbyclient'], 'a query string is identity, not noise');
  assert.deepEqual(blocked, ['navigation transport', 'navigation transport']);
});

test('a write to the same URL and a subframe load of it keep their refusals', async () => {
  const blocked = [];
  const handler = makeHandler(lockedContainment(), blocked);
  assert.deepEqual(await run(handler, fakeRequest({ url: APPLY_URL, method: 'POST' })), ['abort:blockedbyclient'], 'a POST is a write however familiar its URL');
  assert.deepEqual(await run(handler, fakeRequest({ url: APPLY_URL, mainFrame: false })), ['abort:blockedbyclient'], 'a subframe is not the page');
  assert.deepEqual(blocked, ['navigation transport', 'navigation transport']);
});

test('a page that cannot say where it is admits nothing', async () => {
  const blocked = [];
  const containment = lockedContainment();
  const source = extractHandler('const transportTypes = new Set([');
  const names = [
    'containment', 'transportTypes', 'block', 'ashbyPublicBoardRead', 'ashbyFormValueWrite',
    'ashbyFileBindWrite', 'ashbyFileUploadHandleRequest', 'teamtailorCookieChoiceWrite',
    'captureAshbyOneShotUploadTarget', 'ashbyOneShotUploadTargetMatches', 'boardResumeStorageUpload',
    'employerBoundTransport', 'canonicalPageUrl', 'page', 'captchaWidgetFrame',
  ];
  const handler = new Function(...names, `return ${source};`)(
    containment,
    new Set(['fetch', 'xhr']),
    async (route, reason) => { blocked.push(reason); return route.abort('blockedbyclient'); },
    () => false, () => false, () => false, () => false, () => false,
    async (route) => route.fallback(), () => false, () => false, () => false,
    canonicalPageUrl,
    { mainFrame: () => MAIN_FRAME },
    () => false,
  );
  assert.deepEqual(await run(handler, fakeRequest({ url: APPLY_URL })), ['abort:blockedbyclient']);
  assert.equal(containment.selfReloadsAdmitted, 0);
});
