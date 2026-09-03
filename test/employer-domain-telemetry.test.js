import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isEmployerDomainTelemetryHost,
  EMPLOYER_DOMAIN_TELEMETRY_HOSTS,
  isEmployerTelemetryPath,
  EMPLOYER_TELEMETRY_PATH_SEGMENTS,
  isBoardResumeStorageUploadHost,
} from '../src/managed-browser.js';

/* Greenhouse serves its Snowplow collector from c.spl.greenhouse.io, inside the same registrable
 * domain as the board itself, so PR #127's third-party carve-out never covered it and every
 * Greenhouse fill died on an analytics beacon. Measured live 2026-09-01: a Verkada fill stopped at
 * "POST https://c.spl.greenhouse.io/com.snowplowanalytics.snowplow/tp2", and a replay of the real
 * containment against a live Anthropic posting reproduced it with the page fully rendered and 10
 * controls readable. These tests pin the exemption to collectors only, and above all pin that the
 * real submit path is NOT exempt. */

test('the measured Greenhouse collector is spared', () => {
  assert.equal(isEmployerDomainTelemetryHost('c.spl.greenhouse.io'), true);
  assert.equal(isEmployerDomainTelemetryHost('spl.greenhouse.io'), true);
  assert.equal(isEmployerDomainTelemetryHost('a.b.spl.greenhouse.io'), true);
  // A trailing-dot FQDN and any casing are the same host.
  assert.equal(isEmployerDomainTelemetryHost('c.spl.greenhouse.io.'), true);
  assert.equal(isEmployerDomainTelemetryHost('C.SPL.Greenhouse.IO'), true);
});

test('THE REAL SUBMIT PATH IS NEVER SPARED', () => {
  // This is the invariant the whole change rests on: filing an application must stay fatal.
  assert.equal(isEmployerDomainTelemetryHost('job-boards.greenhouse.io'), false);
  assert.equal(isEmployerDomainTelemetryHost('boards-api.greenhouse.io'), false);
  assert.equal(isEmployerDomainTelemetryHost('api.greenhouse.io'), false);
  assert.equal(isEmployerDomainTelemetryHost('greenhouse.io'), false);
});

test('matching is exact host or exact subdomain, never a substring', () => {
  // A look-alike that merely CONTAINS the collector name must not inherit its exemption.
  assert.equal(isEmployerDomainTelemetryHost('spl.greenhouse.io.evil.example'), false);
  assert.equal(isEmployerDomainTelemetryHost('notspl.greenhouse.io'), false);
  assert.equal(isEmployerDomainTelemetryHost('xspl.greenhouse.io'), false);
  assert.equal(isEmployerDomainTelemetryHost(''), false);
  assert.equal(isEmployerDomainTelemetryHost(null), false);
  assert.equal(isEmployerDomainTelemetryHost(undefined), false);
});

test('no other board is touched', () => {
  assert.equal(isEmployerDomainTelemetryHost('jobs.ashbyhq.com'), false);
  assert.equal(isEmployerDomainTelemetryHost('app.breezy.hr'), false);
  assert.equal(isEmployerDomainTelemetryHost('jobs.lever.co'), false);
});

test('the list stays a deliberate, reviewed set', () => {
  // Every entry here is a measured capture proving the host is a collector. Growth should be
  // visible in review rather than incidental, so the exact contents are pinned.
  assert.deepEqual([...EMPLOYER_DOMAIN_TELEMETRY_HOSTS], ['spl.greenhouse.io']);
  assert.equal(Object.isFrozen(EMPLOYER_DOMAIN_TELEMETRY_HOSTS), true);
});

test('the exemption is consulted for fatality only, never for whether to abort', () => {
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  // It lives inside employerBoundTransport, which only decides whether a block is RUN-FATAL.
  assert.match(
    source,
    /if \(isEmployerDomainTelemetryHost\(hostname\)\) return false;\s*\n\s*return registrableSuffix\(hostname\) === applicationTransportSite;/
  );
  // EXACTLY ONE call site. It must not leak into the route handler, where returning early could
  // spare a request from being aborted rather than merely sparing the run from dying.
  assert.equal(source.split('isEmployerDomainTelemetryHost(').length - 1, 1);
  // The block() call that aborts is unconditional on this predicate.
  assert.match(source, /return route\.abort\('blockedbyclient'\);/);
});

test('a telemetry host is refused admission to the #129 upload window', () => {
  /* employerBoundTransport is read at two call sites asking different questions: in block() false
   * means "spared, do not kill the run", and in the #129 upload window it is a positive
   * requirement to ADMIT a POST/PUT. This pins the second one, which the predicate silently
   * changes. A refactor that moved the telemetry check into block() alone would keep every other
   * test green while re-admitting Snowplow POSTs through the upload window. */
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  /* The window now has TWO admission arms: employer-bound transport, and the board's own resume
   * store (added deliberately by #145 so Greenhouse's eager S3 upload can complete). The pin reads
   * both, because the safety property this test exists for - a telemetry host is never admitted -
   * has to hold across every arm, not just the first one. */
  assert.match(
    source,
    /containment\.uploadActionArmed[\s\S]{0,240}?&& \(employerBoundTransport\(request\) \|\| boardResumeStorageUpload\(request\)\)\) \{/,
  );
  // And the telemetry check sits inside employerBoundTransport, so both callers see it.
  const fn = source.slice(source.indexOf('const employerBoundTransport = (request) => {'));
  const body = fn.slice(0, fn.indexOf('\n      };'));
  assert.ok(
    body.includes('isEmployerDomainTelemetryHost(hostname)'),
    'the telemetry check must live inside employerBoundTransport so the upload gate sees it too'
  );

  // Behavioural equivalent of what that gate computes, for the hosts that matter. Both arms are
  // asked, so a beacon cannot be re-admitted by widening either one.
  const admittedByUploadWindow = (host) => !isEmployerDomainTelemetryHost(host)
    || isBoardResumeStorageUploadHost(host);
  assert.equal(admittedByUploadWindow('c.spl.greenhouse.io'), false, 'a beacon may not ride an upload');
  assert.equal(admittedByUploadWindow('spl.greenhouse.io'), false, 'nor may the collector apex');
  assert.equal(admittedByUploadWindow('job-boards.greenhouse.io'), true, 'a real upload must still be admitted');
  // The second arm is a Greenhouse-named S3 bucket and nothing wider: amazonaws.com in general,
  // and any other bucket, stay outside it.
  assert.equal(isBoardResumeStorageUploadHost('grnhse-prod-jben-us-east-1.s3.amazonaws.com'), true);
  assert.equal(isBoardResumeStorageUploadHost('evil.s3.amazonaws.com'), false);
  assert.equal(isBoardResumeStorageUploadHost('s3.amazonaws.com'), false);
  assert.equal(isBoardResumeStorageUploadHost('c.spl.greenhouse.io'), false, 'a beacon is not a resume store');
});

/* The Teamtailor page-view beacon lives on the employer's own host, so the host rule cannot spare
 * it; the path can. Measured 2026-09-01 on the live TixTrack fill. */
test('a collector path on the employer host is spared, by exact last segment only', () => {
  assert.equal(isEmployerTelemetryPath('https://tixtrack.teamtailor.com/pageview'), true);
  assert.equal(isEmployerTelemetryPath('https://tixtrack.teamtailor.com/pageview?ref=apply'), true);
  assert.equal(isEmployerTelemetryPath('https://jobs.example.com/js/pageview.gif'), true);
  assert.equal(isEmployerTelemetryPath('https://jobs.example.com/api/v2/analytics'), true);
  assert.equal(isEmployerTelemetryPath('https://jobs.example.com/rum'), true);
  // Cloudflare's reserved prefix, measured on the live Apollo Research (Lever) fill.
  assert.equal(isEmployerTelemetryPath('https://jobs.lever.co/cdn-cgi/challenge-platform/h/b/jsd/oneshot/e694063b5082/0.12:1788300912:abc/a347f0385e2eed35'), true);
  assert.equal(isEmployerTelemetryPath('https://jobs.lever.co/cdn-cgi/rum'), true);
  assert.equal(isEmployerTelemetryPath('https://jobs.lever.co/apollo/cdn-cgi/anything'), false, 'the prefix, never a substring');
});

test('THE REAL SUBMIT PATH IS NEVER A COLLECTOR PATH', () => {
  for (const url of [
    'https://tixtrack.teamtailor.com/jobs/8287889/applications',
    'https://tixtrack.teamtailor.com/jobs/8287889/applications/new',
    'https://job-boards.greenhouse.io/embed/job_app',
    'https://jobs.lever.co/apollo/apply',
    'https://alertalarm.breezy.hr/api/portal/alertalarm/upload',
    'https://jobs.example.com/pageview/submit',
    'https://jobs.example.com/api/pageview-settings',
    'https://jobs.example.com/analytics-consent',
    'https://jobs.example.com/collection',
    'https://jobs.example.com/collect',
    'https://jobs.example.com/ping',
    'https://jobs.example.com/',
    'not a url',
    '',
  ]) {
    assert.equal(isEmployerTelemetryPath(url), false, url);
  }
});

test('the path exemption is consulted for fatality only too, inside employerBoundTransport, once', () => {
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  assert.equal(source.split('isEmployerTelemetryPath(').length - 1, 1);
  const fn = source.slice(source.indexOf('const employerBoundTransport = (request) => {'));
  const body = fn.slice(0, fn.indexOf('\n      };'));
  assert.ok(body.includes('isEmployerTelemetryPath(request.url())'), 'the path check lives inside employerBoundTransport');
  assert.deepEqual([...EMPLOYER_TELEMETRY_PATH_SEGMENTS], ['pageview', 'pageviews', 'analytics', 'beacon', 'telemetry', 'rum', 'metrics']);
  assert.equal(Object.isFrozen(EMPLOYER_TELEMETRY_PATH_SEGMENTS), true);
});
