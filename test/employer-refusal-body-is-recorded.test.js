/* THE EMPLOYER'S REFUSAL IS RECORDED IN ITS OWN WORDS.
 *
 * Measured 2026-09-04: two live Greenhouse sends both ended
 * POST https://boards.greenhouse.io/embed/<board>/jobs/<id> -> HTTP 428, one page rendering
 * "There was an error processing your application. Please try again." Greenhouse's own client
 * (job-boards.cdn.greenhouse.io/assets/entry.client-*.js) decides what to show the applicant
 * purely from the JSON body of that response - code "captcha-failed" with a
 * security_code_recipient means the emailed security-code field, "captcha-failed" with no
 * recipient means a captcha message, "captcha-retry" means the generic failure, and
 * "invalid-attributes" or an expired/exceeded code carry their own message. The submit network
 * witness (test/submit-network-witness.test.js) recorded only { method, url, status, failure } per
 * entry, so nobody downstream could tell WHICH of those refusals the employer actually returned -
 * the applicant was asked a generic "I found it there / It is not there" instead of being told the
 * employer's own reason.
 *
 * This only records more evidence. It does not change what a request is admitted, blocked,
 * replayed or fulfilled as, it does not touch reCAPTCHA handling, and it does not change any
 * submit-outcome logic - every route.fulfill in settleHeldRoute still ships the exact status,
 * headers and body it always did.
 *
 * These cases run the shipped statements extracted from SANDBOX_RUNNER - never copied by hand -
 * against fake bodies and fake Playwright response objects, the same way
 * test/out-of-band-transport-origin.test.js and
 * test/post-submit-observation-survives-blocked-transport.test.js do. On origin/main (before this
 * change) case (a) fails outright: SANDBOX_RUNNER does not contain the
 * EMPLOYER-REFUSAL-BODY-EXCERPT markers this file extracts by, so extraction itself throws before
 * any assertion about body_excerpt can even run - there is no code path that reads a submit
 * response's body at all. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

const BEGIN_MARKER = '// EMPLOYER-REFUSAL-BODY-EXCERPT:BEGIN';
const END_MARKER = '// EMPLOYER-REFUSAL-BODY-EXCERPT:END';

// Fails loudly (rather than silently slicing the wrong span) the moment either marker goes
// missing or is duplicated, exactly as instructed: uniqueness is asserted, not assumed.
function uniqueMarkerIndex(marker) {
  const first = SANDBOX_RUNNER.indexOf(marker);
  assert.notEqual(first, -1, 'the runner must contain the marker: ' + marker);
  const second = SANDBOX_RUNNER.indexOf(marker, first + 1);
  assert.equal(second, -1, 'the marker must be unique in the runner: ' + marker);
  return first;
}

function excerptHelpersSource() {
  const start = uniqueMarkerIndex(BEGIN_MARKER);
  const end = uniqueMarkerIndex(END_MARKER);
  assert.ok(end > start, 'the end marker must follow the begin marker');
  return SANDBOX_RUNNER.slice(start, end);
}

// The pure body-excerpt builder and the guarded live reader, lifted whole out of the runner. Both
// only ever reference Node/ES globals (Buffer, Promise, RegExp, setTimeout) that a Function
// constructed this way already has, exactly like the harness in
// test/out-of-band-transport-origin.test.js.
function loadExcerptHelpers() {
  const source = excerptHelpersSource();
  // eslint-disable-next-line no-new-func
  const factory = new Function(source
    + '\nreturn { buildSubmitResponseBodyExcerpt, readLiveSubmitResponseBodyExcerpt };');
  return factory();
}

test('the extraction markers exist exactly once in the shipped runner', () => {
  // Re-asserts what uniqueMarkerIndex already enforces, as an explicit, named case: if either
  // marker were duplicated or renamed, every other test below would be extracting the wrong slice
  // (or none at all) without saying so.
  assert.doesNotThrow(excerptHelpersSource);
});

test('(a) a captcha-retry refusal is recorded as body_excerpt with its content type', () => {
  const { buildSubmitResponseBodyExcerpt } = loadExcerptHelpers();
  const body = Buffer.from(JSON.stringify({ code: 'captcha-retry' }), 'utf8');
  const info = buildSubmitResponseBodyExcerpt('application/json; charset=utf-8', body);
  assert.equal(info.content_type, 'application/json; charset=utf-8');
  assert.equal(info.body_unavailable_reason, null);
  assert.ok(info.body_excerpt, 'a JSON refusal body must produce a body_excerpt');
  assert.ok(
    info.body_excerpt.includes('captcha-retry'),
    'the employer\'s own refusal code must be readable in the excerpt: ' + info.body_excerpt
  );
});

test('(a) a captcha-failed refusal with a security_code_recipient is distinguishable from a bare captcha-failed', () => {
  const { buildSubmitResponseBodyExcerpt } = loadExcerptHelpers();
  const withRecipient = buildSubmitResponseBodyExcerpt(
    'application/json',
    Buffer.from(JSON.stringify({ code: 'captcha-failed', security_code_recipient: 'a***@example.com' }), 'utf8')
  );
  const withoutRecipient = buildSubmitResponseBodyExcerpt(
    'application/json',
    Buffer.from(JSON.stringify({ code: 'captcha-failed' }), 'utf8')
  );
  assert.ok(withRecipient.body_excerpt.includes('security_code_recipient'));
  assert.ok(!withoutRecipient.body_excerpt.includes('security_code_recipient'));
  assert.notEqual(
    withRecipient.body_excerpt,
    withoutRecipient.body_excerpt,
    'the two refusals Greenhouse\'s own client tells apart must not collapse into the same excerpt'
  );
});

test('(b) an oversized text body is capped at 2048 bytes', () => {
  const { buildSubmitResponseBodyExcerpt } = loadExcerptHelpers();
  // 'x,' repeating (rather than one giant run of 'a') keeps every alphanumeric run at 1 character,
  // so this exercises the 2048-byte cap on its own, without also tripping the redaction pass
  // (case (c), below) that runs afterward on whatever the cap already produced.
  const unit = 'x,';
  const body = Buffer.from(unit.repeat(1024 * 1024), 'utf8'); // 2MB, well over the cap
  const info = buildSubmitResponseBodyExcerpt('text/plain', body);
  assert.equal(info.body_excerpt.length, 2048);
  assert.equal(info.body_excerpt, unit.repeat(1024));
  assert.equal(info.body_unavailable_reason, null);
});

test('(c) an email address and a long token are redacted from the excerpt', () => {
  const { buildSubmitResponseBodyExcerpt } = loadExcerptHelpers();
  const token = 'sk-live-ABCDEFGHIJKLMNOPQRSTUVWX'; // 32 chars, well over the 24-char floor
  const body = Buffer.from(JSON.stringify({
    message: 'A confirmation was sent to mehek@example.com',
    token
  }), 'utf8');
  const info = buildSubmitResponseBodyExcerpt('application/json', body);
  assert.ok(!info.body_excerpt.includes('mehek@example.com'), 'the email must not survive redaction');
  assert.ok(!info.body_excerpt.includes(token), 'the token must not survive redaction');
  assert.ok(info.body_excerpt.includes('[redacted-email]'), 'a redaction placeholder must replace the email');
  assert.ok(info.body_excerpt.includes('[redacted-token]'), 'a redaction placeholder must replace the token');
  // A short, ordinary identifier is not a bearer-length token and must survive untouched.
  assert.ok(buildSubmitResponseBodyExcerpt('application/json',
    Buffer.from(JSON.stringify({ code: 'captcha-retry' }), 'utf8')).body_excerpt.includes('captcha-retry'));
});

test('(d) a binary content type records body_excerpt null with a reason', () => {
  const { buildSubmitResponseBodyExcerpt } = loadExcerptHelpers();
  const info = buildSubmitResponseBodyExcerpt('image/png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]));
  assert.equal(info.body_excerpt, null);
  assert.equal(info.content_type, 'image/png');
  assert.ok(
    typeof info.body_unavailable_reason === 'string' && info.body_unavailable_reason.length > 0,
    'a binary content type must still explain why there is no excerpt'
  );
});

test('(d) an HTML document larger than the cap is skipped, not guessed at', () => {
  const { buildSubmitResponseBodyExcerpt } = loadExcerptHelpers();
  const html = '<!doctype html><body>' + 'x'.repeat(4000) + '</body>';
  const info = buildSubmitResponseBodyExcerpt('text/html; charset=utf-8', Buffer.from(html, 'utf8'));
  assert.equal(info.body_excerpt, null);
  assert.ok(info.body_unavailable_reason);
});

test('(d) a small HTML document is cheap enough to read as visible text', () => {
  const { buildSubmitResponseBodyExcerpt } = loadExcerptHelpers();
  const html = '<!doctype html><title>Submission redirect blocked</title>'
    + '<p>Stratus blocked a write-preserving submit redirect.</p>';
  const info = buildSubmitResponseBodyExcerpt('text/html; charset=utf-8', Buffer.from(html, 'utf8'));
  assert.ok(info.body_excerpt.includes('Stratus blocked a write-preserving submit redirect'));
  assert.ok(!info.body_excerpt.includes('<p>'), 'tags must be stripped from the visible-text excerpt');
});

test('(e) a body that never resolves is recorded as unavailable without delaying past its timeout', async () => {
  const { readLiveSubmitResponseBodyExcerpt } = loadExcerptHelpers();
  const hangingResponse = {
    headers: () => ({ 'content-type': 'application/json' }),
    body: () => new Promise(() => {}) // never settles
  };
  const startedAt = Date.now();
  const info = await readLiveSubmitResponseBodyExcerpt(hangingResponse);
  const elapsedMs = Date.now() - startedAt;
  assert.ok(elapsedMs < 5000, 'a hanging body read must be bounded by its own small timeout, took ' + elapsedMs + 'ms');
  assert.equal(info.body_excerpt, null);
  assert.ok(info.body_unavailable_reason, 'a body that never resolves must still explain why there is no excerpt');
});

test('(e) a body that throws synchronously (already consumed) never throws out of the reader', async () => {
  const { readLiveSubmitResponseBodyExcerpt } = loadExcerptHelpers();
  const alreadyConsumedResponse = {
    headers: () => ({ 'content-type': 'application/json' }),
    body: () => { throw new Error('Response body is unavailable for redirect responses'); }
  };
  const info = await readLiveSubmitResponseBodyExcerpt(alreadyConsumedResponse);
  assert.equal(info.body_excerpt, null);
  assert.ok(info.body_unavailable_reason);
});

test('(e) a body that rejects, with headers() itself unreadable, never throws out of the reader', async () => {
  const { readLiveSubmitResponseBodyExcerpt } = loadExcerptHelpers();
  const brokenResponse = {
    headers: () => { throw new Error('headers unavailable'); },
    body: () => Promise.reject(new Error('stream error'))
  };
  const info = await readLiveSubmitResponseBodyExcerpt(brokenResponse);
  assert.equal(info.body_excerpt, null);
  assert.equal(info.content_type, null);
  assert.ok(info.body_unavailable_reason);
});

test('(e) a normal response still resolves through the live reader', async () => {
  const { readLiveSubmitResponseBodyExcerpt } = loadExcerptHelpers();
  const okResponse = {
    headers: () => ({ 'content-type': 'application/json; charset=utf-8' }),
    body: async () => Buffer.from(JSON.stringify({ code: 'captcha-retry' }), 'utf8')
  };
  const info = await readLiveSubmitResponseBodyExcerpt(okResponse);
  assert.equal(info.content_type, 'application/json; charset=utf-8');
  assert.ok(info.body_excerpt.includes('captcha-retry'));
  assert.equal(info.body_unavailable_reason, null);
});

/* WIRING. Both transport paths the runner has for the press must feed the same witness: the
 * native-replay path (settleHeldRoute, which already holds the body as a Buffer the moment it
 * decides what to fulfil the route with) records synchronously before every route.fulfill, and the
 * page.on('response') listener prefers that precomputed record over reading the response again,
 * falling back to the guarded live reader only when nothing was precomputed - which is exactly the
 * activation-mode passthrough case, where Chromium made the request and settleHeldRoute never ran. */
test('every route.fulfill in the native-replay path records a body excerpt first', () => {
  const start = uniqueMarkerIndex('const settleHeldRoute = async (record, decision) => {');
  const end = SANDBOX_RUNNER.indexOf('const armSubmitTransportGate = async (binding) => {', start);
  assert.ok(end > start, 'settleHeldRoute must still precede armSubmitTransportGate');
  const settleHeldRouteSource = SANDBOX_RUNNER.slice(start, end);
  const fulfillCalls = (settleHeldRouteSource.match(/record\.route\.fulfill\(/g) || []).length;
  const recordCalls = (settleHeldRouteSource.match(/recordSubmitResponseBodyInfo\(/g) || []).length;
  assert.equal(fulfillCalls, 6, 'settleHeldRoute is expected to fulfil the route at exactly 6 sites');
  assert.equal(recordCalls, fulfillCalls,
    'every route.fulfill in settleHeldRoute must be preceded by a recordSubmitResponseBodyInfo call');
  // And never the reverse order within the same statement group - a naive grep-based count match
  // does not prove ordering, so pin the one case most likely to regress silently: the real
  // employer-response fulfil, which is the one this whole change exists to observe.
  assert.match(
    settleHeldRouteSource,
    /recordSubmitResponseBodyInfo\(record\.request, response\.headers\['content-type'\], response\.body\);\s*\n\s*await record\.route\.fulfill\(\{\s*\n\s*status: response\.status,/
  );
});

test('the response listener prefers the precomputed excerpt and falls back to a live read', () => {
  const start = uniqueMarkerIndex("const armSubmitNetworkWatch = () => {");
  const end = SANDBOX_RUNNER.indexOf('const managedTransportViolation = (message) =>', start);
  assert.ok(end > start, 'armSubmitNetworkWatch must still precede managedTransportViolation');
  const watchSource = SANDBOX_RUNNER.slice(start, end);
  assert.match(watchSource, /const precomputed = submitResponseBodyInfo\.get\(response\.request\(\)\);/);
  assert.match(watchSource, /readLiveSubmitResponseBodyExcerpt\(response\)/);
});

test('transport_disposition is only ever one of the three response-unavailable values', () => {
  // Reuses the SAME predicate the containment already defines for exactly this question, rather
  // than a second hand-maintained list that could drift from it.
  assert.match(
    excerptHelpersSource(),
    /if \(submitTransportResponseUnavailable\(\)\) info\.transport_disposition = submitTransportDisposition;/
  );
});

test('privacy: the request body is never read, only the response body', () => {
  const source = excerptHelpersSource();
  assert.doesNotMatch(source, /\.postData/, 'the excerpt helpers must never touch a request body');
  assert.doesNotMatch(source, /requestBody/i);
});

test('this change never touches reCAPTCHA handling or the containment admit/block decisions', () => {
  // The full source, not just the extracted slice: proves nothing outside the excerpt/witness
  // machinery moved. captchaWidgetFrame, isCaptchaWidgetFrameRequest and the containment's
  // route.fallback()/route.abort() decisions are unchanged in shape and untouched by this file.
  const fullSource = SANDBOX_RUNNER;
  assert.match(fullSource, /if \(containment\.mode === 'activation'\) return route\.fallback\(\);/);
  assert.match(fullSource, /return captchaWidgetFrame\(request\)\s*\n\s*\? route\.fallback\(\)\s*\n\s*: block\(route, 'navigation transport'\);/);
});
