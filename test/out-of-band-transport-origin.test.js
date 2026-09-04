import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');

/* THE SECOND DISJUNCT OF THE CONTAINMENT ASSERT, which until 2026-09-04 was origin-blind.
 *
 * assertManagedMutationTransportClean fails on either blockedAttemptCount > 0 (the route path) or
 * managedOutOfBandTransportAttempted (the WebSocket route, the init script's constructor locks, and
 * a second page in the context). The route path has always discriminated employer-bound from
 * third-party and named the offending request in the sentence; the out-of-band path did neither,
 * so a Worker constructed by ANY frame killed the run and the sentence arrived bare.
 *
 * That is exactly how the Sage Greenhouse packet aae653a3 failed: "A non-submit action attempted
 * employer transport without exact final authority" with no parenthetical, which the route path is
 * structurally incapable of producing because blockedReason is assigned in the same branch that
 * increments blockedAttemptCount.
 *
 * These tests execute the shipped logic extracted from SANDBOX_RUNNER rather than pinning its
 * text, so they measure the semantics and not the spelling. */

const APPLICATION_URL = 'https://job-boards.greenhouse.io/embed/job_app?for=wehrtyou&token=8052083';

const sliceBetween = (startMarker, endMarker, label) => {
  const start = SANDBOX_RUNNER.indexOf(startMarker);
  assert.notEqual(start, -1, 'the runner must still contain ' + label + ' (start)');
  const end = SANDBOX_RUNNER.indexOf(endMarker, start);
  assert.notEqual(end, -1, 'the runner must still contain ' + label + ' (end)');
  return SANDBOX_RUNNER.slice(start, end);
};

/* The mutable flags plus the origin helpers and the recorder, lifted whole out of the runner and
 * evaluated with the one binding they need from their enclosing scope. */
const buildHarness = (applicationUrl = APPLICATION_URL) => {
  const helpers = sliceBetween(
    'let managedOutOfBandTransportAttempted = false;',
    "fs.writeFileSync('stratus-runner-capabilities.json'",
    'the out-of-band recorder block'
  );

  const listenerBody = sliceBetween(
    "const prefix = managedTransportConsoleToken + ':';",
    '\n      });',
    'the managed transport console listener'
  );

  // eslint-disable-next-line no-new-func
  const factory = new Function('input', 'managedMutationContainmentRequired', helpers + `
    // managedPrimaryPage is declared by the extracted block itself; only bind it here.
    const managedTransportConsoleToken = '__litosManagedTransport_test';
    managedPrimaryPage = { primary: true };
    const onConsole = (message) => {
      const text = message.text();
      ${listenerBody}
    };
    return {
      record: (kind, origin) => recordManagedOutOfBandTransport(kind, origin),
      notify: (kind, origin, { page = managedPrimaryPage, duringNavigation = false } = {}) => {
        managedInitialNavigationActive = duringNavigation;
        onConsole({
          text: () => managedTransportConsoleToken + ':' + kind + ':' + origin,
          page: () => page
        });
      },
      employerBound: (value) => managedEmployerBoundOrigin(value),
      site: managedApplicationTransportSite,
      state: () => ({
        fatal: managedOutOfBandTransportAttempted,
        thirdParty: managedOutOfBandThirdPartyCount,
        reason: managedOutOfBandReason
      })
    };
  `);
  return factory({ url: applicationUrl }, true);
};

test('the recorder is reachable and pinned to the application page site', () => {
  const harness = buildHarness();
  assert.equal(harness.site, 'greenhouse.io');
});

/* THE MEASURED FAILURE. 647170c admitted the challenge widget's own anchor frame, so reCAPTCHA
 * enterprise now mounts on a Greenhouse board and its frame calls the Worker constructor this
 * containment has replaced. www.recaptcha.net is not greenhouse.io, and a blocked Google-owned
 * worker cannot file an application with an employer. */
test('a challenge widget frame constructing a Worker no longer kills the fill', () => {
  const harness = buildHarness();
  harness.notify('Worker', 'https://www.recaptcha.net');
  const state = harness.state();
  assert.equal(state.fatal, false, 'a third-party out-of-band channel must not be run-fatal');
  assert.equal(state.thirdParty, 1, 'it is still counted');
  assert.equal(state.reason, null, 'and it contributes no violation sentence');
});

test('the same channel on the employer page is still run-fatal', () => {
  const harness = buildHarness();
  harness.notify('Worker', 'https://job-boards.greenhouse.io');
  const state = harness.state();
  assert.equal(state.fatal, true, 'the employer\'s own out-of-band transport stays fatal');
  assert.equal(state.thirdParty, 0);
  assert.match(state.reason, /^out-of-band transport: Worker from https:\/\/job-boards\.greenhouse\.io$/);
});

test('a sibling host under the employer registrable site is employer-bound', () => {
  const harness = buildHarness();
  // boards-api.greenhouse.io reduces to the same greenhouse.io the application page does.
  assert.equal(harness.employerBound('https://boards-api.greenhouse.io'), true);
  assert.equal(harness.employerBound('https://www.recaptcha.net'), false);
  assert.equal(harness.employerBound('https://newassets.hcaptcha.com'), false);
  // A lookalike cannot borrow the employer's suffix by prefixing it.
  assert.equal(harness.employerBound('https://greenhouse.io.evil.example'), false);
});

test('an opaque, absent or unparseable origin fails closed', () => {
  /* about:blank, data:, blob: and javascript: all PARSE. Their hostname is empty, so a
   * suffix-only comparison would have read them as third-party and spared the run - the one
   * fail-open path this discriminator had. */
  for (const origin of [
    '', 'null', 'about:blank', 'not a url',
    'data:text/html,<script>fetch("//x")</script>',
    'blob:https://job-boards.greenhouse.io/9f2c',
    'javascript:void 0'
  ]) {
    const harness = buildHarness();
    harness.notify('Worker', origin);
    assert.equal(
      harness.state().fatal,
      true,
      'an origin that cannot prove it is third-party must stay fatal: ' + JSON.stringify(origin)
    );
  }
});

test('a lock that failed to install is fatal at every origin', () => {
  const harness = buildHarness();
  harness.notify('unavailable', 'https://www.recaptcha.net');
  const state = harness.state();
  assert.equal(state.fatal, true, 'the instrument reporting it could not install is never spared');
  assert.match(state.reason, /out-of-band transport: unavailable/);
});

test('the payload split keeps a port-bearing origin whole', () => {
  const harness = buildHarness('https://careers.example:8443/apply');
  harness.notify('SharedWorker', 'https://careers.example:8443');
  assert.match(
    harness.state().reason,
    /^out-of-band transport: SharedWorker from https:\/\/careers\.example:8443$/,
    'the origin is split off at the FIRST colon only, so its own scheme and port survive'
  );
});

test('a notify with no origin at all fails closed', () => {
  const harness = buildHarness();
  // A payload predating the kind:origin shape carries no separator.
  harness.record('Worker', '');
  assert.equal(harness.state().fatal, true);
});

test('the primary page during initial navigation is still exempt', () => {
  const harness = buildHarness();
  harness.notify('Worker', 'https://job-boards.greenhouse.io', { duringNavigation: true });
  assert.equal(harness.state().fatal, false, 'the trusted initial load is unchanged');
});

test('a popup raised during initial navigation is NOT exempt', () => {
  const harness = buildHarness();
  harness.notify('popup', 'https://job-boards.greenhouse.io', {
    duringNavigation: true,
    page: { primary: false }
  });
  assert.equal(
    harness.state().fatal,
    true,
    'the exemption is the primary page only - a popup during load still counts'
  );
});

test('only the first violation is kept, so the sentence names the earliest cause', () => {
  const harness = buildHarness();
  harness.notify('Worker', 'https://job-boards.greenhouse.io');
  harness.notify('popup', 'https://job-boards.greenhouse.io');
  assert.match(harness.state().reason, /Worker/);
});

/* WIRING. The three channels all route through the one recorder, and nothing that was blocked
 * before is admitted now: only fatality moved. */

test('every out-of-band channel routes through the origin-discriminating recorder', () => {
  assert.match(source, /recordManagedOutOfBandTransport\('websocket', socketTarget\);/);
  assert.match(source, /recordManagedOutOfBandTransport\('page', candidateUrl\);/);
  assert.match(
    source,
    /recordManagedOutOfBandTransport\(\s*\n\s*separator === -1 \? payload : payload\.slice\(0, separator\),/
  );
  // No channel may still set the flag directly, or it would bypass the discrimination entirely.
  const directSets = source.match(/managedOutOfBandTransportAttempted = true/g) || [];
  assert.equal(
    directSets.length,
    1,
    'the flag is set in recordManagedOutOfBandTransport and nowhere else'
  );
});

test('the blocking behaviour itself is untouched', () => {
  // The constructor locks still throw, the popup still returns null, the service worker still
  // rejects, the socket is still closed 1008, and an extra page is still closed.
  assert.match(source, /throw new TypeError\('Managed non-submit mutation blocks ' \+ name \+ ' transport'\)/);
  assert.match(source, /function litosBlockedPopup\(\) \{\s*\n\s*notify\('popup'\);\s*\n\s*return null;/);
  assert.match(source, /'Managed non-submit mutation blocks service worker registration'/);
  assert.match(source, /reason: 'Managed non-submit mutation blocks WebSocket transport'/);
  assert.match(source, /void candidate\.close\(\)\.catch\(\(\) => undefined\);/);
  assert.match(source, /for \(const name of \['Worker', 'SharedWorker', 'WebTransport', 'WebSocketStream'\]\)/);
});

test('the final submit gate and the route path are unchanged', () => {
  assert.match(source, /runInput\?\.allowSubmit === true\s*\n\s*&& runInput\?\.exactFinalActionAuthority === true/);
  assert.match(source, /if \(employerBoundTransport\(request\)\) \{\s*\n\s*containment\.blockedAttemptCount \+= 1;/);
  assert.match(source, /containment\.blockedThirdPartyCount \+= 1;/);
});

test('the violation sentence now names the out-of-band cause too', () => {
  // Before this change only blockedReason could fill the parenthetical, so an out-of-band trip
  // was reported bare and the absence of a suffix was the only evidence of which branch fired.
  assert.match(
    source,
    /const detail = managedMutationTransportContainment\.blockedReason \|\| managedOutOfBandReason;/
  );
  assert.match(source, /\+ \(detail \? ' \(' \+ detail \+ '\)' : ''\)/);
});

test('the init script carries the frame origin it captured before page script ran', () => {
  assert.match(source, /let frameOrigin = '';\s*\n\s*try \{ frameOrigin = String\(location\.origin \|\| ''\); \} catch \{\}/);
  assert.match(
    source,
    /apply\(consoleError, nativeConsole, \[consoleToken \+ ':' \+ kind \+ ':' \+ frameOrigin\]\);/
  );
});
