import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isTeamtailorCookieConsentWrite,
  TEAMTAILOR_COOKIE_CONSENT_PATH
} from '../src/managed-browser.js';

/* Measured 2026-09-04 22:12Z on Covenant House International's Intern, Finance (packet c24e48a2):
 * the backend's cookie preflight clicked Teamtailor's "disable all" and the tenant's client answered
 * with POST https://covenanthouseinternational.na.teamtailor.com/cookie-policy/accept, which the
 * locked-fill gate blocked as employer transport and the run died on. These tests pin the one path
 * that is admitted and, mostly, prove that nothing else on the tenant is widened by it. */

const consentWrite = (over = {}) => ({
  applicationSite: 'teamtailor.com',
  method: 'POST',
  resourceType: 'fetch',
  url: 'https://covenanthouseinternational.na.teamtailor.com/cookie-policy/accept',
  ...over
});

test('the cookie-preference POST a live Teamtailor decline issues is allowed', () => {
  assert.equal(TEAMTAILOR_COOKIE_CONSENT_PATH, '/cookie-policy/accept');
  assert.equal(isTeamtailorCookieConsentWrite(consentWrite()), true);
  // The single-label tenant host too, and xhr as well as fetch.
  assert.equal(isTeamtailorCookieConsentWrite(consentWrite({ url: 'https://fully.teamtailor.com/cookie-policy/accept' })), true);
  assert.equal(isTeamtailorCookieConsentWrite(consentWrite({ resourceType: 'xhr' })), true);
  // A query string on the same path is still the same endpoint.
  assert.equal(isTeamtailorCookieConsentWrite(consentWrite({ url: 'https://fully.teamtailor.com/cookie-policy/accept?locale=en' })), true);
});

test('the application submit and every other tenant write stay blocked', () => {
  for (const url of [
    'https://covenanthouseinternational.na.teamtailor.com/jobs/686133-intern-finance/applications',
    'https://covenanthouseinternational.na.teamtailor.com/jobs/686133-intern-finance/applications/new',
    'https://covenanthouseinternational.na.teamtailor.com/cookie-policy',
    'https://covenanthouseinternational.na.teamtailor.com/cookie-policy/accept/extra',
    'https://covenanthouseinternational.na.teamtailor.com/api/v1/candidates',
    'https://covenanthouseinternational.na.teamtailor.com/'
  ]) {
    assert.equal(isTeamtailorCookieConsentWrite(consentWrite({ url })), false, url);
  }
});

test('only a POST xhr/fetch on the application page\'s own Teamtailor tenant qualifies', () => {
  assert.equal(isTeamtailorCookieConsentWrite(consentWrite({ method: 'GET' })), false);
  assert.equal(isTeamtailorCookieConsentWrite(consentWrite({ method: 'PUT' })), false);
  assert.equal(isTeamtailorCookieConsentWrite(consentWrite({ resourceType: 'document' })), false);
  assert.equal(isTeamtailorCookieConsentWrite(consentWrite({ resourceType: 'websocket' })), false);
  assert.equal(isTeamtailorCookieConsentWrite(consentWrite({ url: 'http://fully.teamtailor.com/cookie-policy/accept' })), false);
  // Not the application page's site: a Teamtailor tenant reached from a Greenhouse fill, or a
  // look-alike host that is not a tenant at all.
  assert.equal(isTeamtailorCookieConsentWrite(consentWrite({ applicationSite: 'greenhouse.io' })), false);
  assert.equal(isTeamtailorCookieConsentWrite(consentWrite({ applicationSite: null })), false);
  assert.equal(isTeamtailorCookieConsentWrite(consentWrite({ url: 'https://teamtailor.com.evil.example/cookie-polic/accept' })), false);
  assert.equal(isTeamtailorCookieConsentWrite(consentWrite({ url: 'https://www.teamtailor.com/cookie-policy/accept', applicationSite: 'teamtailor.com' })), true,
    'a bare www host is still the tenant site; the path is what is admitted');
  assert.equal(isTeamtailorCookieConsentWrite(consentWrite({ url: 'not a url' })), false);
  assert.equal(isTeamtailorCookieConsentWrite(), false);
});

/* The runner is one String.raw template evaluated in the sandbox, so a module identifier used
 * inside it must be interpolated there or it is a ReferenceError at run time (production,
 * 2026-09-01). Pin that both the constant and the predicate are shipped into the template, and that
 * the locked-fill gate consults the predicate. */
test('the predicate is interpolated into the sandbox runner and consulted by the locked-fill gate', () => {
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  assert.match(source, /const TEAMTAILOR_COOKIE_CONSENT_PATH = \$\{JSON\.stringify\(TEAMTAILOR_COOKIE_CONSENT_PATH\)\};/);
  assert.match(source, /const isTeamtailorCookieConsentWrite = \$\{isTeamtailorCookieConsentWrite\.toString\(\)\};/);
  assert.match(source, /const teamtailorCookieConsentWrite = \(request\) => isTeamtailorCookieConsentWrite\(\{/);
  assert.match(
    source,
    /if \(!readOnlyDataFetch && !ashbyPublicBoardRead\(request\) && !ashbyFormValueWrite\(request\)\s*&& !teamtailorCookieConsentWrite\(request\)\) \{/
  );
});
