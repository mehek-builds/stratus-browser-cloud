/* THE WIDGET THE CONTAINMENT WAS KILLING, PINNED AGAINST THE SHIPPED DECISION.
 *
 * Litos never solves, bypasses or auto-completes a challenge, and nothing here moves that line. The
 * subject is whether the employer's own widget is allowed to LOAD. It was not, and the applicant's
 * evidence screenshot for the Hudson River Trading Greenhouse packet carried Google's own fault
 * sentence under the Submit button because of it.
 *
 * MEASURED ON THE LIVE FORM, 2026-09-03. Loading
 * job-boards.greenhouse.io/embed/job_app?for=wehrtyou&token=8052083 makes exactly one request the
 * locked containment refused: GET https://www.recaptcha.net/recaptcha/enterprise/anchor?ar=1&k=...
 * with resourceType "document", isNavigationRequest() true, and a frame that is not the main frame.
 * Four blocking shapes were run against that page and only this one renders "Could not connect to
 * the reCAPTCHA service. Please check your internet connection and reload to get a reCAPTCHA
 * challenge." Blocking the gstatic bundle is silent; blocking the whole www.recaptcha.net host,
 * which is what a real egress failure looks like, is silent too. So these cases are written from
 * the measured request, not from a sketch of one.
 *
 * THE DECISION IS EXTRACTED FROM THE RUNNER, NOT COPIED, for the same reason as
 * test/captcha-dom.test.js: a copy keeps passing while the shipped handler drifts, and that is the
 * one failure mode a containment test cannot afford. Both containments are driven, because a widget
 * that loads on a fill run and not on a submit run is still a form that cannot mint a token.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAPTCHA_WIDGET_FRAME_ORIGINS,
  isCaptchaWidgetFrameRequest,
  SANDBOX_RUNNER
} from '../src/managed-browser.js';

/* The exact URL Chromium requested on the live board, kept whole. The query carries the site key
 * and the base64 origin, and a case that trimmed them would stop exercising the parse. */
const LIVE_ANCHOR_URL = 'https://www.recaptcha.net/recaptcha/enterprise/anchor'
  + '?ar=1&k=6LfmcbcpAAAAAChNTbhUShzUOAMj_wY9LQIvLFX0'
  + '&co=aHR0cHM6Ly9qb2ItYm9hcmRzLmdyZWVuaG91c2UuaW86NDQz&hl=en&v=8x-4t2pegToiW8KmThtO4AQt'
  + '&size=invisible&anchor-ms=20000&execute-ms=15000&cb=4cuh5mcwbftu';
const LIVE_ANCHOR = Object.freeze({
  method: 'GET',
  resourceType: 'document',
  url: LIVE_ANCHOR_URL,
  mainFrame: false
});

// ---------------------------------------------------------------------------------------------
// The predicate on its own.
// ---------------------------------------------------------------------------------------------

test('every widget frame measured on a live board is admitted', () => {
  // Greenhouse, HRT. The exact request that was aborted.
  assert.equal(isCaptchaWidgetFrameRequest(LIVE_ANCHOR), true);
  for (const url of [
    // Ashby, the live OpenAI posting: the same vendor, the non-enterprise path.
    'https://www.recaptcha.net/recaptcha/api2/anchor?ar=1&k=6LeFb_YUAAAAALUD5h-BiQEp8JaFChe0e0A6r49Y',
    // Lever, the live Match Group posting: hCaptcha, six of these on one page load.
    'https://newassets.hcaptcha.com/captcha/v1/3115eb7fbcf7e72ba1ba0f0894c95450cb2c797e/static/hcaptcha.html',
    // The same vendor's google.com spellings, and the bframe half of each pair.
    'https://www.google.com/recaptcha/api2/anchor?ar=1&k=abc&size=invisible',
    'https://www.google.com/recaptcha/api2/bframe?hl=en&k=abc',
    'https://recaptcha.google.com/recaptcha/api2/bframe?hl=en&k=abc',
    'https://recaptcha.net/recaptcha/enterprise/bframe?hl=en&k=abc'
  ]) {
    assert.equal(isCaptchaWidgetFrameRequest({ ...LIVE_ANCHOR, url }), true, url);
  }
});

test('the grant is a read-only subframe document and nothing else', () => {
  // A write of any shape, on the same host and path.
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', '']) {
    assert.equal(isCaptchaWidgetFrameRequest({ ...LIVE_ANCHOR, method }), false, method);
  }
  // Only a document. Everything else reCAPTCHA loads (script, stylesheet, image, font, worker) is
  // already outside the contained set or already read-allowed, so widening past 'document' would
  // grant something nothing needs.
  for (const resourceType of ['xhr', 'fetch', 'websocket', 'worker', 'serviceworker', 'script', '']) {
    assert.equal(isCaptchaWidgetFrameRequest({ ...LIVE_ANCHOR, resourceType }), false, resourceType);
  }
  // The main frame can never take this door, and an absent answer is refused rather than assumed.
  for (const mainFrame of [true, undefined, null, 0, 'false']) {
    assert.equal(isCaptchaWidgetFrameRequest({ ...LIVE_ANCHOR, mainFrame }), false, String(mainFrame));
  }
  assert.equal(isCaptchaWidgetFrameRequest(), false);
  assert.equal(isCaptchaWidgetFrameRequest({}), false);
});

test('hosts are exact and the path prefix is what keeps www.google.com narrow', () => {
  // A look-alike, a subdomain, a parent domain, and a path traversal all refuse.
  for (const url of [
    'https://www.google.com.evil.example/recaptcha/api2/anchor',
    'https://evil.example/recaptcha/api2/anchor',
    'https://notwww.google.com/recaptcha/api2/anchor',
    'https://mail.google.com/recaptcha/api2/anchor',
    'https://google.com/recaptcha/api2/anchor',
    'https://www.gstatic.com/recaptcha/releases/abc/recaptcha__en.js'
  ]) {
    assert.equal(isCaptchaWidgetFrameRequest({ ...LIVE_ANCHOR, url }), false, url);
  }
  // The listed hosts are not general navigation targets: only /recaptcha/ opens.
  for (const url of [
    'https://www.google.com/search?q=anything',
    'https://www.google.com/',
    'https://www.google.com/recaptchaXX/api2/anchor',
    'https://www.recaptcha.net/other/anchor'
  ]) {
    assert.equal(isCaptchaWidgetFrameRequest({ ...LIVE_ANCHOR, url }), false, url);
  }
  // Plaintext and non-http schemes refuse, and so does an unparseable target.
  for (const url of [
    'http://www.google.com/recaptcha/api2/anchor',
    'data:text/html,<b>x</b>',
    'not a url',
    ''
  ]) {
    assert.equal(isCaptchaWidgetFrameRequest({ ...LIVE_ANCHOR, url }), false, url);
  }
  // hCaptcha's host carries hCaptcha's prefix and not reCAPTCHA's, so the table cannot be read as
  // one shared prefix that happens to fit.
  assert.equal(isCaptchaWidgetFrameRequest({
    ...LIVE_ANCHOR, url: 'https://newassets.hcaptcha.com/recaptcha/api2/anchor'
  }), false);
  assert.equal(isCaptchaWidgetFrameRequest({
    ...LIVE_ANCHOR, url: 'https://www.recaptcha.net/captcha/v1/x/static/hcaptcha.html'
  }), false);
  // The table itself stays a table of challenge vendors' own hosts. An employer or board host on it
  // would hand the run a general navigation channel under a challenge's name.
  assert.deepEqual(CAPTCHA_WIDGET_FRAME_ORIGINS.map((e) => `${e.host}${e.pathPrefix}`).sort(), [
    'newassets.hcaptcha.com/captcha/',
    'recaptcha.google.com/recaptcha/',
    'recaptcha.net/recaptcha/',
    'www.google.com/recaptcha/',
    'www.recaptcha.net/recaptcha/'
  ]);
  for (const entry of CAPTCHA_WIDGET_FRAME_ORIGINS) {
    assert.ok(!/greenhouse|lever|ashbyhq|workable|breezy|rippling/i.test(entry.host), entry.host);
  }
});

// ---------------------------------------------------------------------------------------------
// The shipped handlers, extracted from the runner string and run.
// ---------------------------------------------------------------------------------------------

/* Same brace-balancing extraction test/captcha-dom.test.js uses. `from` disambiguates the two
 * `containment.handler = async (route) => {` sites, which are otherwise identical text. */
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
  throw new Error('could not find the end of the containment handler');
}

/* The admission helper comes out of the runner too, so a drift in either half reaches these cases.
 * A hand-written stand-in here would keep every assertion green while the shipped predicate rotted,
 * which is the same trap the extraction above exists to avoid. */
const CAPTCHA_WIDGET_FRAME = new Function('page', `
  const CAPTCHA_WIDGET_FRAME_ORIGINS = ${JSON.stringify(CAPTCHA_WIDGET_FRAME_ORIGINS)};
  const isCaptchaWidgetFrameRequest = ${isCaptchaWidgetFrameRequest.toString()};
  return (request) => isCaptchaWidgetFrameRequest({
    method: request.method(),
    resourceType: request.resourceType(),
    url: request.url(),
    mainFrame: request.frame() === page.mainFrame()
  });
`);

const MAIN_FRAME = { name: 'main' };
const CHILD_FRAME = { name: 'child' };
const PAGE = { mainFrame: () => MAIN_FRAME };

function fakeRequest({
  url,
  method = 'GET',
  resourceType = 'document',
  navigation = true,
  mainFrame = false
}) {
  return {
    url: () => url,
    method: () => method,
    resourceType: () => resourceType,
    isNavigationRequest: () => navigation,
    frame: () => (mainFrame ? MAIN_FRAME : CHILD_FRAME),
    postData: () => null,
    allHeaders: async () => ({})
  };
}

function fakeRoute(request) {
  const calls = [];
  return {
    calls,
    request: () => request,
    fallback: async () => { calls.push('fallback'); },
    abort: async (reason) => { calls.push(`abort:${reason}`); }
  };
}

/* Every collaborator the handler closes over. The four board-specific allowances answer false so
 * nothing but the widget rule can produce an admission, and `block` records instead of throwing so
 * a refusal is a value rather than a stack. */
const MUTATION_DEPENDENCIES = {
  transportTypes: new Set(['fetch', 'xhr', 'eventsource', 'websocket', 'ping', 'worker', 'serviceworker']),
  ashbyPublicBoardRead: () => false,
  ashbyFormValueWrite: () => false,
  boardResumeStorageUpload: () => false,
  employerBoundTransport: () => false,
  canonicalPageUrl: (value) => String(value),
  page: PAGE
};

function runMutationHandler(request, containmentOverrides = {}) {
  const containment = {
    mode: 'locked',
    allowedNavigationUrl: null,
    blockedAttemptCount: 0,
    blockedReason: null,
    blockedThirdPartyCount: 0,
    uploadActionArmed: false,
    ...containmentOverrides
  };
  const blocked = [];
  const source = extractHandler('const transportTypes = new Set([');
  const names = [
    'containment', 'transportTypes', 'block', 'ashbyPublicBoardRead', 'ashbyFormValueWrite',
    'boardResumeStorageUpload', 'employerBoundTransport', 'canonicalPageUrl', 'page',
    'captchaWidgetFrame'
  ];
  const handler = new Function(...names, `return ${source};`)(
    containment,
    MUTATION_DEPENDENCIES.transportTypes,
    async (route, reason) => { blocked.push(reason); return route.abort('blockedbyclient'); },
    MUTATION_DEPENDENCIES.ashbyPublicBoardRead,
    MUTATION_DEPENDENCIES.ashbyFormValueWrite,
    MUTATION_DEPENDENCIES.boardResumeStorageUpload,
    MUTATION_DEPENDENCIES.employerBoundTransport,
    MUTATION_DEPENDENCIES.canonicalPageUrl,
    PAGE,
    CAPTCHA_WIDGET_FRAME(PAGE)
  );
  const route = fakeRoute(request);
  return handler(route).then(() => ({ calls: route.calls, blocked }));
}

test('the locked mutation containment admits the live anchor frame', async () => {
  const admitted = await runMutationHandler(fakeRequest({ url: LIVE_ANCHOR_URL }));
  assert.deepEqual(admitted.blocked, [], 'the widget frame must not be counted as a blocked transport');
  assert.deepEqual(admitted.calls, ['fallback']);
});

test('the locked mutation containment still refuses every neighbouring navigation', async () => {
  // The employer's own subframe navigation: unchanged, still a blocked navigation transport.
  const employer = await runMutationHandler(fakeRequest({
    url: 'https://job-boards.greenhouse.io/embed/job_app?for=wehrtyou&token=8052083'
  }));
  assert.deepEqual(employer.blocked, ['navigation transport']);
  assert.deepEqual(employer.calls, ['abort:blockedbyclient']);

  // A main-frame navigation to the widget host cannot ride the admission.
  const mainFrame = await runMutationHandler(fakeRequest({ url: LIVE_ANCHOR_URL, mainFrame: true }));
  assert.deepEqual(mainFrame.blocked, ['navigation transport']);

  // A POST to the same frame and host is a write and stays blocked.
  const write = await runMutationHandler(fakeRequest({ url: LIVE_ANCHOR_URL, method: 'POST' }));
  assert.deepEqual(write.blocked, ['navigation transport']);

  // A look-alike host is not the widget.
  const lookAlike = await runMutationHandler(fakeRequest({
    url: 'https://www.google.com.evil.example/recaptcha/api2/anchor'
  }));
  assert.deepEqual(lookAlike.blocked, ['navigation transport']);

  // And the contained transport set is untouched: a POST xhr on the widget host is still refused,
  // because the admission is a document rule, not a host rule.
  const xhr = await runMutationHandler(fakeRequest({
    url: 'https://www.recaptcha.net/recaptcha/enterprise/reload?k=abc',
    method: 'POST',
    resourceType: 'xhr',
    navigation: false
  }));
  assert.deepEqual(xhr.blocked, ['xhr transport']);
});

function runV4Handler(request, mode) {
  const containment = { mode, blockedTransportObserved: false };
  const source = extractHandler('blockedTransportObserved: false,');
  const names = [
    'containment', 'canonicalPageUrl', 'resolvedManagedExactPageUrl', 'v4InitialNavigationBoundary',
    'input', 'page', 'captchaWidgetFrame'
  ];
  const handler = new Function(...names, `return ${source};`)(
    containment,
    (value) => String(value),
    () => null,
    'https://job-boards.greenhouse.io/embed/job_app',
    { url: 'https://job-boards.greenhouse.io/embed/job_app' },
    PAGE,
    CAPTCHA_WIDGET_FRAME(PAGE)
  );
  const route = fakeRoute(request);
  return handler(route).then(() => ({ calls: route.calls, containment }));
}

test('the v4 pre-submit containment admits the widget frame in both of its closed modes', async () => {
  for (const mode of ['initial_navigation', 'locked']) {
    const admitted = await runV4Handler(fakeRequest({ url: LIVE_ANCHOR_URL }), mode);
    assert.deepEqual(admitted.calls, ['fallback'], mode);
    /* And it is not recorded as an out-of-band transport. reCAPTCHA re-requests its anchor after a
     * refusal, so under the old rule that retry set blockedTransportObserved, which
     * decideSubmitTransportGate reads as submit_transport_unpinned and refuses the send. The page
     * was reloading a widget this runner had just killed, and the send died for it. */
    assert.equal(admitted.containment.blockedTransportObserved, false, mode);
  }
});

test('the v4 pre-submit containment still refuses everything else it always did', async () => {
  const employer = await runV4Handler(fakeRequest({
    url: 'https://job-boards.greenhouse.io/other'
  }), 'locked');
  assert.deepEqual(employer.calls, ['abort:blockedbyclient']);
  assert.equal(employer.containment.blockedTransportObserved, true);

  const write = await runV4Handler(fakeRequest({ url: LIVE_ANCHOR_URL, method: 'POST' }), 'locked');
  assert.deepEqual(write.calls, ['abort:blockedbyclient']);
  assert.equal(write.containment.blockedTransportObserved, true);

  const mainFrame = await runV4Handler(
    fakeRequest({ url: LIVE_ANCHOR_URL, mainFrame: true }),
    'initial_navigation'
  );
  assert.deepEqual(mainFrame.calls, ['abort:blockedbyclient']);
});
