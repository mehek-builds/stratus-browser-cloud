/* THE WIDGET WAS ALLOWED TO LOAD, AND THEN ITS OWN BLOCKED WORKER KILLED THE RUN.
 *
 * Measured on the live Hudson River Trading form 2026-09-04, first fill after the reCAPTCHA anchor
 * frame was admitted (test/captcha-widget-frame.test.js): Google's recaptcha__en.js, running
 * inside that frame (location.origin https://www.recaptcha.net, 545ms into the frame's life,
 * readyState loading), calls new Worker. The managed hook blocked it and reported it; the report
 * landed after the employer page's initial navigation had closed; the context listener counted it
 * as the employer page attempting covert transport; the run died at the next assertion, before the
 * evidence screenshot, with "A non-submit action attempted employer transport without exact final
 * authority" and no detail, because the out-of-band flag carried none.
 *
 * Nothing here admits a Worker, a popup, a socket or anything else: the hook still blocks every
 * one of them in every frame. What changes is attribution. A report now names the frame that
 * raised it, and a report from an admitted captcha widget origin is not the employer's transport.
 * The verdict is a pure exported function driven directly, and the runner string is checked for
 * carrying the same function and the origin-bearing report, so a drift between the two is a red
 * test rather than a live 502.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CAPTCHA_WIDGET_FRAME_ORIGINS,
  isCaptchaWidgetFrameOrigin,
  managedTransportConsoleVerdict,
  SANDBOX_RUNNER
} from '../src/managed-browser.js';

const HOSTS = CAPTCHA_WIDGET_FRAME_ORIGINS.map((entry) => entry.host);
const TOKEN = '__litosManagedTransport_test';
const verdict = (text, overrides = {}) => managedTransportConsoleVerdict({
  text,
  token: TOKEN,
  initialNavigationActive: false,
  fromPrimaryPage: true,
  widgetHosts: HOSTS,
  ...overrides
});

test('the measured report: a blocked Worker raised inside the reCAPTCHA anchor frame does not end the run', () => {
  const result = verdict(TOKEN + ':Worker:https://www.recaptcha.net');
  assert.equal(result.attempted, false);
  assert.equal(result.exemptedWidgetFrame, true);
  assert.equal(result.kind, 'Worker');
  assert.equal(result.origin, 'https://www.recaptcha.net');
  // Every admitted widget origin, and every hook kind, gets the same attribution.
  for (const host of HOSTS) {
    for (const kind of ['Worker', 'SharedWorker', 'WebTransport', 'WebSocketStream', 'popup', 'service_worker', 'unavailable']) {
      assert.equal(verdict(TOKEN + ':' + kind + ':https://' + host).attempted, false, host + ' ' + kind);
    }
  }
});

test('the same report from the employer page, or from any other frame, still ends the run and now says why', () => {
  const employer = verdict(TOKEN + ':Worker:https://job-boards.greenhouse.io');
  assert.equal(employer.attempted, true);
  assert.equal(employer.exemptedWidgetFrame, false);
  assert.equal(employer.detail, 'page hook: Worker from https://job-boards.greenhouse.io');
  assert.equal(verdict(TOKEN + ':popup:https://boards.greenhouse.io').attempted, true);
  assert.equal(verdict(TOKEN + ':service_worker:https://cdn.example.net').attempted, true);
  // A hook that could not install in the employer frame is still treated as it always was.
  assert.equal(verdict(TOKEN + ':unavailable:https://job-boards.greenhouse.io').attempted, true);
});

test('only a real admitted origin is exempt: lookalikes, http, paths, ports, credentials, and a missing origin are not', () => {
  for (const origin of [
    'https://www.recaptcha.net.evil.example',
    'https://evil.example/https://www.recaptcha.net',
    'http://www.recaptcha.net',
    'https://www.recaptcha.net:8443',
    'https://user:pw@www.recaptcha.net',
    'https://www.recaptcha.net/recaptcha/',
    'https://www.recaptcha.net/?x=1',
    'https://gstatic.com',
    'about:blank',
    'null',
    ''
  ]) {
    assert.equal(isCaptchaWidgetFrameOrigin(origin, HOSTS), false, origin);
    assert.equal(verdict(TOKEN + ':Worker:' + origin).attempted, true, origin);
  }
  // An older hook that reports no origin at all keeps the old, fail-closed reading.
  const legacy = verdict(TOKEN + ':Worker');
  assert.equal(legacy.attempted, true);
  assert.equal(legacy.origin, null);
  assert.equal(legacy.detail, 'page hook: Worker from an unidentified frame');
  assert.equal(isCaptchaWidgetFrameOrigin('https://www.recaptcha.net', HOSTS), true);
  assert.equal(isCaptchaWidgetFrameOrigin('https://WWW.RECAPTCHA.NET.', HOSTS), true);
  assert.equal(isCaptchaWidgetFrameOrigin('https://www.recaptcha.net', []), false);
  assert.equal(isCaptchaWidgetFrameOrigin('https://www.recaptcha.net', undefined), false);
});

test('the employer page load is trusted exactly as before, and a foreign token is never a report', () => {
  assert.equal(verdict(TOKEN + ':Worker:https://job-boards.greenhouse.io', { initialNavigationActive: true, fromPrimaryPage: true }).attempted, false);
  assert.equal(verdict(TOKEN + ':Worker:https://job-boards.greenhouse.io', { initialNavigationActive: true, fromPrimaryPage: false }).attempted, true);
  assert.equal(verdict('__someOtherToken:Worker:https://job-boards.greenhouse.io').attempted, false);
  assert.equal(verdict(TOKEN + 'Worker').attempted, false);
  assert.equal(verdict(undefined).attempted, false);
  assert.equal(managedTransportConsoleVerdict({ text: TOKEN + ':Worker:https://x.example', token: '', widgetHosts: HOSTS }).attempted, false);
});

test('the shipped runner carries the same verdict, the widget host list, and an origin-bearing report', () => {
  // The listener in the runner string must call the injected verdict, not the old prefix test.
  assert.match(SANDBOX_RUNNER, /const managedTransportConsoleVerdict = \(\{\n\s+text,\n\s+token,/u);
  assert.match(SANDBOX_RUNNER, /const isCaptchaWidgetFrameOrigin = \(origin, widgetHosts\) =>/u);
  assert.ok(SANDBOX_RUNNER.includes('const MANAGED_CAPTCHA_WIDGET_HOSTS = ' + JSON.stringify(HOSTS) + ';'));
  assert.ok(SANDBOX_RUNNER.includes("apply(consoleError, nativeConsole, [consoleToken + ':' + kind + ':' + frameOrigin])"));
  const listener = SANDBOX_RUNNER.indexOf('const verdict = managedTransportConsoleVerdict({');
  assert.ok(listener > 0, 'the context console listener consults the verdict');
  const wiring = SANDBOX_RUNNER.slice(listener, listener + 700);
  assert.ok(wiring.includes('widgetHosts: MANAGED_CAPTCHA_WIDGET_HOSTS'));
  assert.ok(wiring.includes('if (verdict.attempted) {'));
  assert.ok(wiring.includes('managedOutOfBandTransportAttempted = true;'));
  assert.ok(wiring.includes('managedOutOfBandTransportDetail = verdict.detail;'));
  // The old, origin-blind prefix test is gone from the managed listener.
  assert.ok(!SANDBOX_RUNNER.includes("if (text.startsWith(managedTransportConsoleToken + ':')\n          && !(managedInitialNavigationActive && message.page() === managedPrimaryPage)) {"));
  // And the sentence carries the out-of-band detail.
  assert.ok(SANDBOX_RUNNER.includes('managedMutationTransportContainment.blockedReason || managedOutOfBandTransportDetail'));
});

test('the injected copy behaves identically to the exported one on the measured report', () => {
  const start = SANDBOX_RUNNER.indexOf('const isCaptchaWidgetFrameOrigin = (origin, widgetHosts) =>');
  const end = SANDBOX_RUNNER.indexOf("await browserContext.routeWebSocket('**/*', async (webSocketRoute) => {", start);
  assert.ok(start > 0 && end > start);
  const source = SANDBOX_RUNNER.slice(start, end);
  const injected = new Function(source + '\nreturn managedTransportConsoleVerdict;')();
  const measured = { text: TOKEN + ':Worker:https://www.recaptcha.net', token: TOKEN, initialNavigationActive: false, fromPrimaryPage: true, widgetHosts: HOSTS };
  assert.deepEqual(injected(measured), managedTransportConsoleVerdict(measured));
  const employer = { ...measured, text: TOKEN + ':Worker:https://job-boards.greenhouse.io' };
  assert.deepEqual(injected(employer), managedTransportConsoleVerdict(employer));
});
