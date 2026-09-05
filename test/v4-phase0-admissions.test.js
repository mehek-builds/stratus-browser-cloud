import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAPTCHA_WIDGET_FRAME_ORIGINS,
  isBoardResumeStorageUploadHost,
  isCaptchaWidgetFrameRequest,
  SANDBOX_RUNNER,
  transportRegistrableSuffix
} from '../src/managed-browser.js';

/* THE V4 SEND'S FILL PHASE, measured 2026-09-05 on TWG Global (apply.workable.com). Locked mode
 * refused every request from the moment navigation settled, so Workable's client-rendered shell
 * (283 characters) never drew its form and the send died at its cookie preflight. The two
 * admissions pinned here are the fill containment's own: a same-site read-only data fetch, and the
 * armed upload window to the employer or a named board bucket. Everything else the handler refused
 * before, it refuses after, and refusals still set blockedTransportObserved. Extracted from the
 * runner, not copied, for the reason captcha-widget-frame.test.js gives. */

function extractHandler(from) {
  const anchor = SANDBOX_RUNNER.indexOf(from);
  assert.notEqual(anchor, -1, `${from} must still be in the runner`);
  const start = SANDBOX_RUNNER.indexOf('containment.handler = async (route) => {', anchor);
  assert.notEqual(start, -1);
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

const PAGE = { mainFrame: () => 'main' };
const captchaWidgetFrame = (request) => isCaptchaWidgetFrameRequest({
  method: request.method(),
  resourceType: request.resourceType(),
  url: request.url(),
  mainFrame: request.frame() === PAGE.mainFrame()
});
void CAPTCHA_WIDGET_FRAME_ORIGINS;

function fakeRequest({ url, method = 'GET', resourceType = 'xhr', navigation = false, mainFrame = false }) {
  return {
    url: () => url,
    method: () => method,
    resourceType: () => resourceType,
    isNavigationRequest: () => navigation,
    frame: () => (mainFrame ? PAGE.mainFrame() : 'sub'),
    postData: () => null
  };
}
function fakeRoute(request) {
  const calls = [];
  return {
    calls,
    request: () => request,
    fallback: async () => { calls.push('fallback'); },
    abort: async (reason) => { calls.push('abort:' + reason); }
  };
}

function runV4(request, { mode = 'locked', uploadActionArmed = false, applicationSite = 'workable.com' } = {}) {
  const containment = {
    mode, blockedTransportObserved: false, applicationSite, uploadActionArmed,
    readsAdmitted: 0, boardStoreUploadsAdmitted: 0, boardStoreUploadResponses: 0
  };
  const source = extractHandler('applicationSite: v4ApplicationSite,');
  const names = [
    'containment', 'canonicalPageUrl', 'resolvedManagedExactPageUrl', 'v4InitialNavigationBoundary',
    'input', 'page', 'captchaWidgetFrame', 'transportRegistrableSuffix', 'isBoardResumeStorageUploadHost'
  ];
  const handler = new Function(...names, `return ${source};`)(
    containment, (value) => String(value), () => null,
    'https://apply.workable.com/twgai/j/772CD136FF/apply/',
    { url: 'https://apply.workable.com/twgai/j/772CD136FF/apply/' },
    PAGE, captchaWidgetFrame, transportRegistrableSuffix, isBoardResumeStorageUploadHost
  );
  const route = fakeRoute(request);
  return handler(route).then(() => ({ calls: route.calls, containment }));
}

test('locked mode lets the board draw its own form: same-site read-only data fetches pass and are not counted as blocked transport', async () => {
  for (const url of [
    'https://apply.workable.com/api/v1/accounts/twgai?full=true',
    'https://apply.workable.com/api/v2/accounts/twgai/jobs/772CD136FF',
    'https://apply.workable.com/api/v1/jobs/772CD136FF/form'
  ]) {
    for (const resourceType of ['xhr', 'fetch']) {
      const admitted = await runV4(fakeRequest({ url, resourceType }));
      assert.deepEqual(admitted.calls, ['fallback'], url + ' ' + resourceType);
      assert.equal(admitted.containment.blockedTransportObserved, false);
      assert.equal(admitted.containment.readsAdmitted, 1);
    }
  }
});

test('a read that is not same-site, not a data fetch, or not read-only is still refused and still observed', async () => {
  const cases = [
    fakeRequest({ url: 'https://www.google-analytics.com/g/collect' }),
    fakeRequest({ url: 'https://apply.workable.com/api/v1/jobs/772CD136FF/form', resourceType: 'script' }),
    fakeRequest({ url: 'https://apply.workable.com/api/v1/jobs/772CD136FF/apply', method: 'POST' }),
    fakeRequest({ url: 'https://apply.workable.com/twgai/j/772CD136FF/apply/', navigation: true, mainFrame: true }),
    fakeRequest({ url: 'https://apply.workable.com/cdn-cgi/challenge-platform/h/g/jsd/oneshot/x', method: 'POST' }),
    fakeRequest({ url: 'https://apply.workable.com/api/v1/jobs/772CD136FF/form', resourceType: 'websocket' })
  ];
  for (const request of cases) {
    const refused = await runV4(request);
    assert.deepEqual(refused.calls, ['abort:blockedbyclient'], request.url());
    assert.equal(refused.containment.blockedTransportObserved, true, request.url());
    assert.equal(refused.containment.readsAdmitted, 0);
  }
  // A containment that knows no application site admits no read at all.
  const unknownSite = await runV4(fakeRequest({ url: 'https://apply.workable.com/api/v1/jobs/772CD136FF/form' }), { applicationSite: null });
  assert.deepEqual(unknownSite.calls, ['abort:blockedbyclient']);
});

test('the armed upload window admits the resume to the employer host or its named bucket, and nothing outside it', async () => {
  const bucket = 'https://workable-application-form.s3.us-east-1.amazonaws.com/';
  const armed = await runV4(fakeRequest({ url: bucket, method: 'POST' }), { uploadActionArmed: true });
  assert.deepEqual(armed.calls, ['fallback']);
  assert.equal(armed.containment.boardStoreUploadsAdmitted, 1);
  assert.equal(armed.containment.blockedTransportObserved, false);
  const employerPut = await runV4(fakeRequest({ url: 'https://apply.workable.com/api/v1/jobs/772CD136FF/form/upload/resume', method: 'PUT' }), { uploadActionArmed: true });
  assert.deepEqual(employerPut.calls, ['fallback']);
  assert.equal(employerPut.containment.boardStoreUploadsAdmitted, 0);
  // Disarmed: the same POST is a write outside the window.
  const disarmed = await runV4(fakeRequest({ url: bucket, method: 'POST' }));
  assert.deepEqual(disarmed.calls, ['abort:blockedbyclient']);
  assert.equal(disarmed.containment.blockedTransportObserved, true);
  // Armed, but a third party that is not a named board bucket.
  const thirdParty = await runV4(fakeRequest({ url: 'https://uploads.example.com/resume', method: 'POST' }), { uploadActionArmed: true });
  assert.deepEqual(thirdParty.calls, ['abort:blockedbyclient']);
  // Armed, but a document navigation or a websocket is not an upload.
  const nav = await runV4(fakeRequest({ url: bucket, method: 'POST', resourceType: 'document', navigation: true }), { uploadActionArmed: true });
  assert.deepEqual(nav.calls, ['abort:blockedbyclient']);
});

test('activation mode and the widget frame are untouched, and initial navigation still admits only its boundary and reads', async () => {
  const activation = await runV4(fakeRequest({ url: 'https://apply.workable.com/api/v1/jobs/772CD136FF/apply', method: 'POST' }), { mode: 'activation' });
  assert.deepEqual(activation.calls, ['fallback']);
  const initialRead = await runV4(fakeRequest({ url: 'https://apply.workable.com/api/v1/jobs/772CD136FF/form' }), { mode: 'initial_navigation' });
  assert.deepEqual(initialRead.calls, ['fallback']);
  const initialWrite = await runV4(fakeRequest({ url: 'https://apply.workable.com/api/v1/attribute/x', method: 'POST' }), { mode: 'initial_navigation' });
  assert.deepEqual(initialWrite.calls, ['abort:blockedbyclient']);
});

test('the runner arms and disarms the v4 window on the same rule as the fill window', () => {
  assert.match(SANDBOX_RUNNER, /if \(v4PreSubmitTransportContainment\) \{[\s\S]{0,400}if \(action\.type === 'upload'\) \{\s*\n\s*v4PreSubmitTransportContainment\.uploadActionArmed = true;\s*\n\s*\} else if \(!\['waitForSelector', 'extract', 'requireCapability', 'discover'\]\.includes\(action\.type\)\) \{\s*\n\s*v4PreSubmitTransportContainment\.uploadActionArmed = false;/);
  // The helpers the handler names are interpolated into the runner ahead of the v4 block (b816a61).
  assert.match(SANDBOX_RUNNER, /let v4PreSubmitTransportContainment = null;[\s\S]{0,600}const transportRegistrableSuffix = /);
  assert.match(SANDBOX_RUNNER, /let v4PreSubmitTransportContainment = null;[\s\S]{0,900}const isBoardResumeStorageUploadHost = /);
});
