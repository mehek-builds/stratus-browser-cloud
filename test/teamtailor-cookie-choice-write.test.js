import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SANDBOX_RUNNER,
  isTeamtailorCookieChoiceWrite,
  TEAMTAILOR_COOKIE_CHOICE_CATEGORIES,
  TEAMTAILOR_COOKIE_CHOICE_FIELDS
} from '../src/managed-browser.js';

/* MEASURED 2026-09-04 ~21:55Z on production. With volley-backend #958 deployed (an optional click
 * on dialog[data-controller="common--cookies--alert"]
 * button[data-action*="common--cookies--alert#disableAll"] as the first plan action on every
 * Teamtailor form), the fill run against
 * https://covenanthouseinternational.na.teamtailor.com/jobs/686133-intern-finance (application
 * c24e48a2-06b1-4a01-989f-b6c2c5719f18) stopped with
 *
 *   A non-submit action attempted employer transport without exact final authority
 *   (fetch transport: POST https://covenanthouseinternational.na.teamtailor.com/cookie-policy/accept)
 *
 * Teamtailor's own decline button records the choice with a POST to the employer's own tenant host
 * (see the long mechanism comment above isTeamtailorCookieChoiceWrite in src/managed-browser.js for
 * the public-bundle evidence: cookies-a135f52d0a68c93f4012.js from assets-aws.teamtailor-cdn.com,
 * confirmed byte-identical on a non-regional tenant, career.teamtailor.com, 2026-09-05). These
 * tests pin the allowance to that one body shape and, mostly, prove the thing that matters in the
 * other direction: that neither a candidate field nor the real application endpoint can ride in on
 * it. The predicate tests below call isTeamtailorCookieChoiceWrite directly; the containment-handler
 * tests further down extract the shipped statements from SANDBOX_RUNNER and execute them against
 * fake dependencies, the same technique
 * test/post-submit-observation-survives-blocked-transport.test.js uses, so they measure the actual
 * control flow rather than pinning its spelling. */

const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');

const COVENANT_HOUSE_TENANT = 'covenanthouseinternational.na.teamtailor.com';
const COOKIE_URL = 'https://' + COVENANT_HOUSE_TENANT + '/cookie-policy/accept';

const declineAllBody = (overCookiePolicy = {}) => JSON.stringify({
  cookie_policy: {
    visitor_uuid: 'a1b2c3d4-0000-4000-8000-000000000000',
    referrer: 'https://www.google.com/',
    categories: '',
    ...overCookiePolicy
  }
});

const cookieWrite = (over = {}) => ({
  applicationSite: 'teamtailor.com',
  method: 'POST',
  resourceType: 'fetch',
  url: COOKIE_URL,
  postData: declineAllBody(),
  ...over
});

test('the measured Covenant House decline-all POST is admitted', () => {
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite()), true);
});

test('the accept-all body (all three categories, comma-joined) is admitted too', () => {
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: declineAllBody({ categories: TEAMTAILOR_COOKIE_CHOICE_CATEGORIES.join(',') })
  })), true);
  for (const category of TEAMTAILOR_COOKIE_CHOICE_CATEGORIES) {
    assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
      postData: declineAllBody({ categories: category })
    })), true, category);
  }
});

test('same_site "None" (the inside-iframe shape) is admitted; any other value is not', () => {
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: declineAllBody({ same_site: 'None' })
  })), true);
  for (const badValue of ['Lax', 'Strict', '', 1, true, null]) {
    assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
      postData: declineAllBody({ same_site: badValue })
    })), false, JSON.stringify(badValue));
  }
});

test('visitor_uuid and referrer may each be absent; an absent body proves nothing', () => {
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: JSON.stringify({ cookie_policy: { categories: '' } })
  })), true);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({ postData: 'not-json' })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({ postData: null })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({ postData: '' })), false);
  assert.equal(isTeamtailorCookieChoiceWrite({}), false);
});

test('THE SAFETY PROPERTY: a candidate or job_application field cannot ride in on this allowance', () => {
  /* This is the test that has to fail if the allowance ever opens the hole it was written to keep
   * shut. The body proof is a closed allowlist of four preference keys, so nothing shaped like an
   * application field - at the top level or nested inside cookie_policy - can satisfy it. */

  // 1. An extra top-level key alongside cookie_policy.
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: JSON.stringify({
      cookie_policy: { categories: '' },
      candidate: { first_name: 'Mehek' }
    })
  })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: JSON.stringify({
      cookie_policy: { categories: '' },
      job_application: { id: '686133' }
    })
  })), false);

  // 2. A forbidden key nested inside cookie_policy itself, including a bracket-style field name a
  // Rails-shaped candidate form would use.
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: JSON.stringify({
      cookie_policy: { categories: '', 'candidate[first_name]': 'Mehek' }
    })
  })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: JSON.stringify({
      cookie_policy: { categories: '', job_application: { resume: 'x' } }
    })
  })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: JSON.stringify({
      cookie_policy: { categories: '', file: 'resume.pdf' }
    })
  })), false);

  // 3. A raw, non-JSON body shaped like a smuggled candidate form submission or a multipart file
  // part - neither parses as the required JSON envelope, so both are refused exactly like any
  // other unparseable body.
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: 'candidate[first_name]=Mehek&candidate[resume]=%25PDF-1.4'
  })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: '------WebKitFormBoundary\r\n'
      + 'Content-Disposition: form-data; name="resume"; filename="r.pdf"\r\n\r\n%PDF-1.4\r\n'
  })), false);

  // 4. A category token outside the closed set - the one place free text could otherwise sneak in.
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: declineAllBody({ categories: 'analytics,candidate' })
  })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: declineAllBody({ categories: 'candidate[first_name]=Mehek' })
  })), false);

  // 5. categories carrying a nested object instead of a string.
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: JSON.stringify({ cookie_policy: { categories: { candidate: { id: 1 } } } })
  })), false);

  // 6. A batched/array body is not a single provable preference write.
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: JSON.stringify([{ cookie_policy: { categories: '' } }])
  })), false);

  // 7. An oversized body - the small size cap - even if every key is otherwise well-formed.
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: declineAllBody({ referrer: 'https://example.com/?q=' + 'x'.repeat(5000) })
  })), false);
});

test('the write allowance is scoped to Teamtailor runs, the exact path, https, and this envelope', () => {
  // A run on some other board may not reach teamtailor.com even with a perfect preference body.
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({ applicationSite: 'ashbyhq.com' })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({ applicationSite: null })), false);

  // A Teamtailor run may not reach a look-alike host.
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    url: 'https://evil-teamtailor.com/cookie-policy/accept'
  })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    url: 'https://' + COVENANT_HOUSE_TENANT + '.evil.example/cookie-policy/accept'
  })), false);

  // Nor any other path on the right host - most importantly, Teamtailor's real application
  // endpoint, which is a separate, unrelated route this allowance must never reach.
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    url: 'https://' + COVENANT_HOUSE_TENANT + '/jobs/686133-intern-finance/applications'
  })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    url: 'https://' + COVENANT_HOUSE_TENANT + '/jobs/686133/applications'
  })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    url: 'https://' + COVENANT_HOUSE_TENANT + '/cookie-policy/accept/extra'
  })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    url: 'https://' + COVENANT_HOUSE_TENANT + '/cookie-policy'
  })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    url: 'http://' + COVENANT_HOUSE_TENANT + '/cookie-policy/accept'
  })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({ url: 'not a url' })), false);

  // Confirmed byte-identical bundle, dialog and action on a non-regional tenant, 2026-09-05: the
  // host-family match cannot be tied to any particular number of subdomain labels.
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    url: 'https://career.teamtailor.com/cookie-policy/accept'
  })), true);
});

test('the write allowance never widens the method or the resource set', () => {
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({ method: 'GET' })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({ method: 'PUT' })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({ method: 'HEAD' })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({ resourceType: 'document' })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({ resourceType: 'websocket' })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({ resourceType: 'worker' })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({ resourceType: 'ping' })), false);
});

test('the allowed field list is exactly the four keys the measured client ever sends', () => {
  assert.deepEqual(
    [...TEAMTAILOR_COOKIE_CHOICE_FIELDS].sort(),
    ['categories', 'referrer', 'same_site', 'visitor_uuid'].sort()
  );
});

/* -------------------------------------------------------------------------------------------- *
 * THE CONTAINMENT HANDLER ITSELF: proves the admission is actually wired into the fill-phase
 * route handler, not merely that isTeamtailorCookieChoiceWrite returns the right boolean in
 * isolation. Extracted from SANDBOX_RUNNER by marker and executed against fake dependencies -
 * test/post-submit-observation-survives-blocked-transport.test.js's technique - so this measures
 * the real control flow: does an admitted write actually reach route.fallback(), and does
 * everything else still reach block()?
 * -------------------------------------------------------------------------------------------- */

function extractCookieChoiceGate() {
  const startMarker = 'if (ashbyFileBindWrite(request)) {';
  const start = SANDBOX_RUNNER.indexOf(startMarker);
  assert.notEqual(start, -1, 'the runner must still contain the Ashby file-bind admission this gate sits beside');
  assert.equal(
    SANDBOX_RUNNER.indexOf(startMarker, start + 1),
    -1,
    'the start marker must be unique or the slice below may cut the wrong occurrence'
  );
  const endMarker = "return block(route, request.resourceType() + ' transport');\n          }\n          return route.fallback();";
  const endIdx = SANDBOX_RUNNER.indexOf(endMarker, start);
  assert.notEqual(endIdx, -1, 'the runner must still carry the locked-mode compound refusal this gate precedes');
  return SANDBOX_RUNNER.slice(start, endIdx + endMarker.length);
}

const fakeRequest = ({ method, resourceType, url, postData }) => ({
  method: () => method,
  resourceType: () => resourceType,
  url: () => url,
  postData: () => postData
});

// The exact wrapper shape the runner itself builds around isTeamtailorCookieChoiceWrite (see
// "const teamtailorCookieChoiceWrite = (request) => isTeamtailorCookieChoiceWrite({...})" in
// src/managed-browser.js), so the gate below exercises the real, shipped predicate.
const realTeamtailorCookieChoiceWrite = (request) => isTeamtailorCookieChoiceWrite({
  applicationSite: 'teamtailor.com',
  method: request.method(),
  resourceType: request.resourceType(),
  url: request.url(),
  postData: request.postData()
});

function runCookieChoiceGate(request) {
  const calls = [];
  const statement = extractCookieChoiceGate();
  const route = { fallback: () => { calls.push('fallback'); return 'fallback'; } };
  const block = (routeArg, reason) => { calls.push(['block', reason]); return 'blocked'; };
  const containment = { ashbyFileBindWriteAdmitted: false };
  // eslint-disable-next-line no-new-func
  const run = new Function(
    'route', 'request', 'containment', 'block',
    'readOnlyDataFetch', 'ashbyPublicBoardRead', 'ashbyFormValueWrite',
    'ashbyFileBindWrite', 'teamtailorCookieChoiceWrite',
    'return (() => { ' + statement + ' })();'
  );
  run(
    route, request, containment, block,
    false, () => false, () => false,
    () => false, realTeamtailorCookieChoiceWrite
  );
  return calls;
}

test('(a) the containment handler admits the real Covenant House decline-all POST during a fill', () => {
  const calls = runCookieChoiceGate(fakeRequest({
    method: 'POST', resourceType: 'fetch', url: COOKIE_URL, postData: declineAllBody()
  }));
  assert.deepEqual(calls, ['fallback'],
    'the handler must admit the request via route.fallback() and must never call block()');
});

test('(b) the containment handler still refuses the same URL when the body smuggles a candidate field', () => {
  const calls = runCookieChoiceGate(fakeRequest({
    method: 'POST', resourceType: 'fetch', url: COOKIE_URL,
    postData: JSON.stringify({ cookie_policy: { categories: '' }, candidate: { first_name: 'Mehek' } })
  }));
  assert.deepEqual(calls, [['block', 'fetch transport']],
    'a body carrying a candidate field must still be blocked, not admitted');
});

test('(b) the containment handler still refuses a multipart-shaped file part at the same URL', () => {
  const calls = runCookieChoiceGate(fakeRequest({
    method: 'POST', resourceType: 'fetch', url: COOKIE_URL,
    postData: '------WebKitFormBoundary\r\n'
      + 'Content-Disposition: form-data; name="resume"; filename="r.pdf"\r\n\r\n%PDF-1.4\r\n'
  }));
  assert.deepEqual(calls, [['block', 'fetch transport']],
    'an unparseable, file-shaped body must still be blocked, not admitted');
});

test('(c) the containment handler still refuses a real application POST on the same host during a fill', () => {
  const calls = runCookieChoiceGate(fakeRequest({
    method: 'POST', resourceType: 'fetch',
    url: 'https://' + COVENANT_HOUSE_TENANT + '/jobs/686133/applications',
    postData: JSON.stringify({ candidate: { first_name: 'Mehek' } })
  }));
  assert.deepEqual(calls, [['block', 'fetch transport']],
    'the real application endpoint must still be refused outside the final submit step');
});

test('(d) the containment handler refuses a look-alike host even at the exact cookie-choice path', () => {
  const calls = runCookieChoiceGate(fakeRequest({
    method: 'POST', resourceType: 'fetch',
    url: 'https://evil-teamtailor.com/cookie-policy/accept',
    postData: declineAllBody()
  }));
  assert.deepEqual(calls, [['block', 'fetch transport']],
    'a look-alike host must still be refused even though the path and body are otherwise valid');
});

test('(e) the admission never touches the final-submit gate or the activation-mode branch', () => {
  // Consulted exactly once in the whole runner (the gate's own early-return), and defined exactly
  // once (the wrapper) - never folded into the compound refusal condition beside it, which stays
  // byte-for-byte the same pin test/containment-readonly-fetch.test.js already holds it to.
  assert.equal(source.split('teamtailorCookieChoiceWrite(request)').length - 1, 1,
    'teamtailorCookieChoiceWrite(request) must be called from exactly one site: the gate');
  assert.match(source, /const teamtailorCookieChoiceWrite = \(request\) => isTeamtailorCookieChoiceWrite\(\{/);
  assert.match(
    source,
    /if \(teamtailorCookieChoiceWrite\(request\)\) \{\s*\n\s*return route\.fallback\(\);\s*\n\s*\}\s*\n\s*if \(!readOnlyDataFetch && !ashbyPublicBoardRead\(request\) && !ashbyFormValueWrite\(request\)\) \{/,
    'the gate must sit as its own early-return immediately before the untouched compound condition'
  );
  // The compound refusal condition itself: the exact pin containment-readonly-fetch.test.js holds,
  // reproduced here so a regression in either file catches the same drift.
  assert.match(
    source,
    /if \(!readOnlyDataFetch && !ashbyPublicBoardRead\(request\) && !ashbyFormValueWrite\(request\)\) \{\s*\n\s*return block\(route, request\.resourceType\(\) \+ ' transport'\);/
  );
  // The final-submit gate: unchanged literal requirement.
  assert.match(source, /A final employer action requires literal allowSubmit and exact final authority/);
  assert.match(
    source,
    /runInput\?\.allowSubmit === true\s*\n\s*&& runInput\?\.exactFinalActionAuthority === true/
  );
  // The 'activation' branch (where a real confirmAndSubmit executes) returns before either gate,
  // so nothing added here can be reached from it.
  assert.match(source, /if \(containment\.mode === 'activation'\) return route\.fallback\(\);/);
});

test('every definition the admission needs is interpolated into the runner, not left a bare module reference', () => {
  /* b816a61's lesson, 2026-09-01: a module identifier referenced but not interpolated is a
   * ReferenceError on every managed run - source that parses, passes node --check, and matches
   * every source-contract regex. test/sandbox-runner-compiles.test.js's general guard already
   * covers this for every export; these are the specific lines that guard should be finding. */
  for (const injected of [
    'const TEAMTAILOR_SITE = ${JSON.stringify(TEAMTAILOR_SITE)};',
    'const TEAMTAILOR_COOKIE_CHOICE_PATH = ${JSON.stringify(TEAMTAILOR_COOKIE_CHOICE_PATH)};',
    'const TEAMTAILOR_COOKIE_CHOICE_CATEGORIES = ${JSON.stringify(TEAMTAILOR_COOKIE_CHOICE_CATEGORIES)};',
    'const TEAMTAILOR_COOKIE_CHOICE_FIELDS = ${JSON.stringify(TEAMTAILOR_COOKIE_CHOICE_FIELDS)};',
    'const TEAMTAILOR_COOKIE_CHOICE_MAX_BODY_LENGTH = ${JSON.stringify(TEAMTAILOR_COOKIE_CHOICE_MAX_BODY_LENGTH)};',
    'const TEAMTAILOR_COOKIE_CHOICE_MAX_FIELD_LENGTH = ${JSON.stringify(TEAMTAILOR_COOKIE_CHOICE_MAX_FIELD_LENGTH)};',
    'const isTeamtailorCookieChoiceWrite = ${isTeamtailorCookieChoiceWrite.toString()};'
  ]) {
    assert.ok(source.includes(injected), injected);
  }
});

/* -------------------------------------------------------------------------------------------- *
 * REVIEW ROUND 1, 2026-09-05: the path check alone left the query string and fragment unexamined
 * (a POST to .../cookie-policy/accept?candidate_email=...&resume=<3000 chars> was admitted on a
 * minimal valid body, an unbounded smuggling channel to the employer host outside the submit gate),
 * and visitor_uuid/referrer were only length-capped rather than shape-validated (~4 KB of free text
 * could ride through either). (a) and (c) below are written to fail against the pre-round-1 code -
 * that is the proof the gap was real, not merely theoretical.
 * -------------------------------------------------------------------------------------------- */

test('(a) a query string on the cookie-choice URL is refused, even carrying an otherwise-valid body', () => {
  // The exact shape of the finding: a minimal valid decline body, with candidate data smuggled into
  // the URL instead of the proven JSON envelope. This must fail on the pre-round-1 code - there the
  // query string was never examined and this same call returns true.
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    url: COOKIE_URL + '?candidate_email=mehek%40usc.edu&resume=' + encodeURIComponent('x'.repeat(3000))
  })), false);
});

test('(b) a fragment on the cookie-choice URL is refused, even carrying an otherwise-valid body', () => {
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    url: COOKIE_URL + '#resume=' + encodeURIComponent('x'.repeat(3000))
  })), false);
});

test('(c) referrer must be empty, null, a utm_source label or an actual URL - free text is refused, the measured job-page referrer and empty are admitted', () => {
  // Free text under both the old 2000-char cap and the new 512-char cap: only the shape check added
  // in round 1 catches this. Must fail on the pre-round-1 code, where length was the only gate.
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: declineAllBody({ referrer: 'candidate_email=mehek@usc.edu; resume=not a url at all' })
  })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: declineAllBody({
      referrer: 'https://' + COVENANT_HOUSE_TENANT + '/jobs/686133-intern-finance'
    })
  })), true);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: declineAllBody({ referrer: '' })
  })), true);
});

test('(d) visitor_uuid must be UUID-shaped or empty', () => {
  for (const badValue of [
    'not-a-uuid',
    'a1b2c3d4-0000-4000-8000',
    'a1b2c3d4_0000_4000_8000_000000000000',
    'candidate_email=mehek@usc.edu'
  ]) {
    assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
      postData: declineAllBody({ visitor_uuid: badValue })
    })), false, badValue);
  }
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: declineAllBody({ visitor_uuid: '' })
  })), true);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: declineAllBody({ visitor_uuid: 'A1B2C3D4-0000-4000-8000-000000000000' })
  })), true);
});

test('(e) the measured decline body - empty categories, a UUID visitor_uuid, the job-page referrer - is still admitted', () => {
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: declineAllBody({
      visitor_uuid: 'a1b2c3d4-0000-4000-8000-000000000000',
      referrer: 'https://' + COVENANT_HOUSE_TENANT + '/jobs/686133-intern-finance',
      categories: ''
    })
  })), true);
});

/* ROUND 3, MEASURED LIVE 2026-09-04 23:32Z AND 23:37Z (runs 32cd900c and 01cc54be, both on the
 * round-1 build): the same Covenant House fill stopped on the identical violation sentence twice
 * after round 1 deployed. Run offline against the shipped predicate, the minimal body was admitted
 * and {"cookie_policy":{"referrer":null,"categories":""}} was refused - and the second is what the
 * page sends. Teamtailor's careersite controller (chunk 6950, handleReferrerCookie) executes
 * window.referrer || (window.referrer = this.referrerValue()) on connect, and referrerValue() is
 * this.utmSource() || this.documentReferrer(), which is null in a fresh managed browser: no
 * utm_source on the apply URL, no cross-host document.referrer. JSON.stringify keeps that null
 * where it drops an undefined, and round 1's typeof-string check refused it. These tests pin the
 * measured body, the null-as-absent reading for both window-global fields, and the one other value
 * referrerValue() can produce - a bare utm_source label - while proving null is not a wildcard and
 * the label class cannot carry an email, a query string, a path or free text. */

const MEASURED_FRESH_BROWSER_DECLINE_BODY = JSON.stringify({ cookie_policy: { referrer: null, categories: '' } });

test('(f) the decline-all body a fresh managed browser actually sends - referrer null - is admitted, through the shipped gate', () => {
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({ postData: MEASURED_FRESH_BROWSER_DECLINE_BODY })), true);
  const calls = runCookieChoiceGate(fakeRequest({
    method: 'POST', resourceType: 'fetch', url: COOKIE_URL, postData: MEASURED_FRESH_BROWSER_DECLINE_BODY
  }));
  assert.deepEqual(calls, ['fallback'],
    'the measured body must be admitted via route.fallback(); this is the exact request runs 32cd900c and 01cc54be died on');
});

test('(f) visitor_uuid null reads as absent too, alone and beside a null referrer', () => {
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: declineAllBody({ visitor_uuid: null })
  })), true);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: JSON.stringify({ cookie_policy: { visitor_uuid: null, referrer: null, categories: '' } })
  })), true);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: JSON.stringify({ cookie_policy: { visitor_uuid: null, referrer: null, categories: 'analytics,marketing,preferences' } })
  })), true);
});

test('(g) null is an absence, never a wildcard: null categories, same_site, or cookie_policy are still refused', () => {
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: JSON.stringify({ cookie_policy: { categories: null } })
  })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: JSON.stringify({ cookie_policy: { categories: '', same_site: null } })
  })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: JSON.stringify({ cookie_policy: null })
  })), false);
  // A null referrer buys nothing for a smuggled sibling key.
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: JSON.stringify({ cookie_policy: { referrer: null, categories: '', candidate_email: 'mehek@usc.edu' } })
  })), false);
  assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
    postData: JSON.stringify({ cookie_policy: { referrer: null, categories: '' }, candidate: { first_name: 'Mehek' } })
  })), false);
});

test('(h) a bare utm_source label is admitted; an email, a query string, a path, free text, and an over-long label are not', () => {
  for (const label of ['linkedin', 'Indeed', 'google_jobs_apply', 'LinkedIn Limited Listings', 'jobs2careers', 'x'.repeat(100)]) {
    assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
      postData: declineAllBody({ referrer: label })
    })), true, label);
  }
  for (const notALabel of [
    'mehek@usc.edu',
    'candidate_email=mehek@usc.edu',
    'a=b&c=d',
    'linkedin?utm_medium=x',
    '/jobs/686133-intern-finance',
    'resume: not a url at all',
    ' leading-space',
    'name;drop',
    'x'.repeat(101),
    'https://' + COVENANT_HOUSE_TENANT + '/jobs/686133-intern-finance?q=' + 'x'.repeat(600)
  ]) {
    assert.equal(isTeamtailorCookieChoiceWrite(cookieWrite({
      postData: declineAllBody({ referrer: notALabel })
    })), false, notALabel.slice(0, 40));
  }
});

test('the runner carries no backtick template literals or stray interpolation markers', () => {
  // src/managed-browser.js is one String.raw`...` template; a literal backtick or ${ typed
  // directly into the runner body (rather than through the sanctioned interpolation slots above)
  // would either terminate that template early or open an unintended substitution. Confirmed clear
  // by scanning the COMPOSED runner text itself, the same property
  // test/sandbox-runner-compiles.test.js's own comment already asserts of the file as a whole.
  assert.equal(SANDBOX_RUNNER.includes('`'), false);
  assert.equal(SANDBOX_RUNNER.includes('${'), false);
});
