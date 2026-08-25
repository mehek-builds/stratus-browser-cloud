// Greenhouse's emailed security code, and the submit a fill run must never be able to make.
//
// Same replay technique as test/managed-runner-replay.mjs, and for the same reason: SANDBOX_RUNNER
// ships to the sandbox as a STRING, so nothing in the ordinary suite executes it and a defect in it
// survives every test that can only read it. This runs it, against a local fixture, in a real
// browser.
//
// TWO DEFECTS ARE PINNED HERE, and they are separate defects with separate fixes.
//
// (a) A FILL RUN SUBMITTED A REAL APPLICATION. On 2026-08-08 three Greenhouse packets (Redwood
//     Materials, Scale AI, Cresta) reached 'ready_for_final_approval' with submission_claimed_at,
//     submission_authorization and browser_session_id all null - the authorized submit path
//     provably never ran - while Greenhouse emailed the applicant a security code at the exact
//     minute of each FILL run. The mechanism then was an unaimed keystroke, since fixed. The
//     mechanism is not the point: an aimed Enter on a plain text input submits a form just as well,
//     so the fixture uses exactly that, and the guard is what has to hold.
//
// (b) THE CHALLENGE ITSELF. Greenhouse answers an unauthenticated submit by emailing an 8-character
//     code and rendering a code field, and files nothing until the form is submitted again with the
//     code in it. The fixture reproduces the control from the Cresta preview screenshot: eight
//     single-character boxes under a "Security code" label, with the sentence naming the address.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ATOMIC_SUBMIT_V4_CAPABILITY,
  ATOMIC_SUBMIT_POLICY,
  ATOMIC_SUBMIT_POLICY_V4,
  EXACT_PAGE_URL_CAPABILITY,
  SANDBOX_RUNNER
} from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODE = 'TPHJrFMJ';

/* THE WIDGET IS GREENHOUSE'S, NOT AN IMPRESSION OF ONE.
 *
 * Everything in the challenge below is transcribed from the code job-boards.greenhouse.io serves to
 * the live Cresta posting, read on 2026-08-10 out of
 * https://job-boards.cdn.greenhouse.io/assets/entry.client-Da_lLnMl.js, the asset that page links.
 * The previous fixture was written from a screenshot and got three things wrong, and every one of
 * them is load-bearing:
 *
 *   1. it put autocomplete="one-time-code" on the boxes. Greenhouse does not. Its inputs are
 *      id="security-input-0" through "security-input-7", type=text, maxLength 1, aria-required,
 *      aria-invalid, aria-errormessage, and nothing else. So the detector's platform-name branch
 *      never fires on a real Greenhouse form and the one-character-group branch does all the work.
 *   2. it left aria-required OFF. Greenhouse sets it on all eight, which is what made the old "the
 *      code boxes must not be reported as empty required fields" assertion vacuous: it passed
 *      because the fixture had no marker to find.
 *   3. it left the submit button permanently enabled. Greenhouse disables the form in the same
 *      breath as it learns the recipient, and re-enables it only once the eight joined box values
 *      are exactly eight characters long. A run that types the code and immediately reaches for a
 *      submit control finds a disabled one, and the atomic submit drops disabled candidates.
 *
 * The auto-advance and the paste distribution are the compiled handlers, with the input element
 * substituted for React's ref.current, which is what ref.current is:
 *
 *   onChange u(m,x): f=value; g=a[x+1]; y=a.map(k=>k.current?.value); a[x].current.value=f;
 *                    y[x]=f; b=y.join(""); t(b); d(b);
 *                    if (a[x].current?.value) g?.current?.select();
 *   onPaste  h(m,x): f=clipboardData.getData("text").split(""); g=0;
 *                    a.forEach((b,j)=>{ if (j<x) return; b.current.value=f[g]; g+=1 });
 *                    t(joined); d(joined)
 *   enable   d(m):   m.length === 8 ? setFormDisabled(false) : setFormDisabled(true)
 *
 * novalidate for the same reason the other fixture uses it: with native validation on, an empty
 * required field would stop the submission by itself and a guard that did nothing would look like a
 * guard that worked. Greenhouse validates in JavaScript.
 *
 * The legend is present ON PURPOSE. '* indicates a required field' is on every Greenhouse form ever
 * rendered, including every one with no challenge at all, and this repo has already shipped one
 * gate that keyed on page text. Case 6 asserts the detector ignores it.
 */
const fixture = `<!doctype html><meta charset="utf-8"><title>Security Code Fixture</title>
<form id="app-form" novalidate>
  <label for="first_name">First Name</label><input id="first_name" type="text">
  <label for="email">Email</label><input id="email" type="text">
  <p class="legend">* indicates a required field</p>
  <div id="challenge"></div>
  <div class="application--submit"><button id="submit-btn" type="submit">Submit application</button></div>
</form>
<div id="submitted">no</div>
<div id="filed">no</div>
<div id="empty-code-submits">0</div>
<div id="box-values">-</div>
<div id="disabled-at-challenge">-</div>
<div id="disabled-at-code-submit">-</div>
<script>
  var attempts = 0;
  var CODE_LENGTH = 8;
  var securityCode = '';
  // Read once, at load. The linger path rewrites the URL to Greenhouse's confirmation route, which
  // replaces the query string, so a flag re-read after that point would silently change meaning.
  var LINGER = location.search.indexOf('linger=1') !== -1;
  var KEEP = location.search.indexOf('keep=1') !== -1;
  var PROSE = location.search.indexOf('prose=1') !== -1;
  var AMBIGUOUS_VERIFICATION = location.search.indexOf('ambiguous-verification=1') !== -1;
  var SECURITY_MARKER_COPY = location.search.indexOf('security-marker-copy=1') !== -1;
  var OTP_AUTO_SUBMIT = location.search.indexOf('otp-auto-submit=1') !== -1;
  var OTP_VALUE_SPOOF = location.search.indexOf('otp-value-spoof=1') !== -1;
  var OTP_TYPE_SPOOF = location.search.indexOf('otp-type-spoof=1') !== -1;
  var OTP_ROLE_SPOOF = location.search.indexOf('otp-role-spoof=1') !== -1;
  var OTP_ORDER_REVERSE = location.search.indexOf('otp-order-reverse=1') !== -1;
  var OTP_POST_ENTRY_REORDER = location.search.indexOf('otp-post-entry-reorder=1') !== -1;
  var OTP_UNNAMED = location.search.indexOf('otp-unnamed=1') !== -1;
  var V4_SAME_URL_CHALLENGE = globalThis.__v4SameUrlChallenge === true;
  var V4_NATIVE = location.search.indexOf('v4-native=1') !== -1 || V4_SAME_URL_CHALLENGE;
  var V4_APPLICATION = location.search.indexOf('v4-application=1') !== -1;
  var V4_APPLICATION_SAME_URL = location.search.indexOf('v4-application-same-url=1') !== -1
    && !V4_SAME_URL_CHALLENGE;
  var nativeInputValueDescriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  var nativeInputValueGetter = nativeInputValueDescriptor.get;
  var nativeInputValueSetter = nativeInputValueDescriptor.set;
  var nativeInputFormGetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'form').get;
  var nativeAppendChild = Node.prototype.appendChild;
  if (OTP_ROLE_SPOOF) {
    document.getElementById('first_name').name = 'first_name';
    var nativeGetAttribute = Element.prototype.getAttribute;
    Element.prototype.getAttribute = function (name) {
      if (this.id === 'first_name' && String(name).toLowerCase() === 'autocomplete') {
        return 'one-time-code';
      }
      return nativeGetAttribute.call(this, name);
    };
  }
  if (OTP_ORDER_REVERSE) {
    var nativeDocumentQuerySelectorAll = Document.prototype.querySelectorAll;
    Document.prototype.querySelectorAll = function (selector) {
      if (String(selector).trim() === 'input') {
        return Array.from(nativeDocumentQuerySelectorAll.call(
          this,
          '#email-verification input[name="security_code"]'
        )).reverse();
      }
      return nativeDocumentQuerySelectorAll.call(this, selector);
    };
  }
  var otpAutoSubmitTriggered = false;
  if (V4_NATIVE || V4_APPLICATION || V4_APPLICATION_SAME_URL) {
    var nativeForm = document.getElementById('app-form');
    nativeForm.noValidate = false;
    nativeForm.method = 'post';
    nativeForm.action = V4_APPLICATION_SAME_URL
      ? location.href
      : V4_APPLICATION
        ? '/v4-native-application?challenge=1&v4-native=1'
        : '/v4-native-verification';
    if (V4_APPLICATION || V4_APPLICATION_SAME_URL) {
      document.getElementById('first_name').name = 'first_name';
      document.getElementById('email').name = 'email';
    }
  }
  function boxRefs() { return [].slice.call(document.querySelectorAll('#email-verification input')); }
  // Null-guarded because the prose case below removes the control mid-run, and the re-enable is
  // scheduled on a timer that can outlive it.
  function setFormDisabled(state) {
    var button = document.getElementById('submit-btn');
    if (button) button.disabled = state;
    var decoy = document.getElementById('verification-decoy');
    if (decoy) decoy.disabled = state;
  }
  // d(m), one render later. React does not apply setFormDisabled during the change handler: it
  // schedules a re-render, and the button's disabled attribute changes when that render commits. A
  // fixture that flips the attribute synchronously would let a run that reaches for the submit
  // control the instant the last character lands pass here and fail against Greenhouse.
  function onCodeLength(value) {
    var next = value.length !== CODE_LENGTH;
    setTimeout(function () { setFormDisabled(next); }, 0);
  }
  function onCodeChange(event, index) {
    var a = boxRefs();
    var f = event.currentTarget.value;
    var g = a[index + 1];
    var y = a.map(function (k) { return k.value; });
    a[index].value = f;
    if (OTP_VALUE_SPOOF) {
      delete a[index].value;
      nativeInputValueSetter.call(a[index], 'X');
      var reported = f;
      Object.defineProperty(a[index], 'value', {
        configurable: true,
        get: function () { return reported; },
        set: function (next) { reported = String(next); }
      });
    }
    y[index] = f;
    var b = y.join('');
    securityCode = b;
    onCodeLength(b);
    if (OTP_AUTO_SUBMIT && !otpAutoSubmitTriggered) {
      otpAutoSubmitTriggered = true;
      fetch('/otp-auto?kind=fetch', { method: 'POST', body: 'code=' + encodeURIComponent(b) }).catch(function () {});
      var request = new XMLHttpRequest();
      request.open('POST', '/otp-auto?kind=xhr');
      request.send('code=' + b);
      navigator.sendBeacon('/otp-auto?kind=beacon', 'code=' + b);
      document.getElementById('app-form').requestSubmit();
    }
    if (a[index].value && g) g.select();
  }
  function onCodePaste(event, index) {
    var a = boxRefs();
    var f = (event.clipboardData ? event.clipboardData.getData('text') : '').split('');
    var g = 0;
    a.forEach(function (b, j) { if (j < index) return; b.value = f[g]; g += 1; });
    var y = a.map(function (b) { return b.value; }).join('');
    securityCode = y;
    onCodeLength(y);
    event.preventDefault();
  }
  function renderChallenge() {
    var html = '<div class="divider" role="separator"></div><fieldset id="email-verification">'
      + '<legend>A verification code was sent to mehekmandal05@gmail.com. To submit your'
      + ' application, enter the 8-character code to confirm you\\'re a human.</legend>'
      + '<label aria-hidden="true" id="email-verification-label" for="security-input-0">Security code</label>'
      + '<div class="email-verification__wrapper">';
    for (var b = 0; b < (OTP_TYPE_SPOOF ? 1 : CODE_LENGTH); b += 1) {
      html += '<input id="security-input-' + b + '" type="' + (OTP_TYPE_SPOOF ? 'submit' : 'text')
        + '" aria-invalid="false"'
        + ' aria-errormessage="email-verification-error" aria-required="true" maxlength="1"'
        + (OTP_TYPE_SPOOF ? ' autocomplete="one-time-code"' : '')
        + (V4_NATIVE && !OTP_UNNAMED ? ' name="security_code"' : '') + '>';
    }
    document.getElementById('challenge').innerHTML = html + '</div></fieldset>';
    if (OTP_TYPE_SPOOF) {
      var hostileCodeBox = document.getElementById('security-input-0');
      var hostileCode = '';
      Object.defineProperty(hostileCodeBox, 'type', {
        configurable: true,
        get: function () { return 'text'; }
      });
      hostileCodeBox.addEventListener('keydown', function (event) {
        if (event.key.length !== 1 || hostileCode.length >= CODE_LENGTH) return;
        hostileCode += event.key;
        nativeInputValueSetter.call(hostileCodeBox, hostileCode);
        securityCode = hostileCode;
        onCodeLength(hostileCode);
      });
    }
    if (SECURITY_MARKER_COPY && !document.getElementById('security-decoys')) {
      var decoys = document.createElement('div');
      decoys.id = 'security-decoys';
      decoys.hidden = true;
      for (var d = 0; d < CODE_LENGTH; d += 1) {
        var decoyBox = document.createElement('input');
        decoyBox.id = 'security-decoy-' + d;
        decoyBox.type = 'text';
        decoyBox.maxLength = 1;
        decoys.appendChild(decoyBox);
      }
      document.body.appendChild(decoys);
      new MutationObserver(function (mutations) {
        mutations.forEach(function (mutation) {
          var value = mutation.target.getAttribute('data-litos-security-code-box');
          if (value == null) return;
          mutation.target.removeAttribute('data-litos-security-code-box');
          document.getElementById('security-decoy-' + value)
            ?.setAttribute('data-litos-security-code-box', value);
        });
      }).observe(document.getElementById('app-form'), {
        subtree: true,
        attributes: true,
        attributeFilter: ['data-litos-security-code-box']
      });
    }
    if (AMBIGUOUS_VERIFICATION && !document.getElementById('verification-decoy')) {
      document.getElementById('submit-btn').textContent = 'Verify code';
      var decoy = document.createElement('button');
      decoy.id = 'verification-decoy';
      decoy.type = 'submit';
      decoy.textContent = 'Verify code';
      document.querySelector('.application--submit').appendChild(decoy);
    }
    boxRefs().forEach(function (box, index) {
      box.addEventListener('input', function (event) { onCodeChange(event, index); });
      box.addEventListener('paste', function (event) { onCodePaste(event, index); });
    });
    if (OTP_POST_ENTRY_REORDER) {
      var postEntryBoxes = boxRefs();
      var postEntryParent = postEntryBoxes[0].parentElement;
      var postEntryReordered = false;
      Object.defineProperty(postEntryBoxes[0], 'form', {
        configurable: true,
        get: function () {
          var joined = postEntryBoxes.map(function (box) {
            return nativeInputValueGetter.call(box);
          }).join('');
          if (!postEntryReordered && joined === '${CODE}') {
            postEntryReordered = true;
            postEntryBoxes.slice().reverse().forEach(function (box) {
              nativeAppendChild.call(postEntryParent, box);
            });
          }
          return nativeInputFormGetter.call(this);
        }
      });
    }
    securityCode = '';
    setFormDisabled(true);
    document.getElementById('disabled-at-challenge').textContent = String(document.getElementById('submit-btn').disabled);
  }
  document.getElementById('app-form').addEventListener('submit', function (event) {
    if (!V4_NATIVE && !V4_APPLICATION && !V4_APPLICATION_SAME_URL) event.preventDefault();
    attempts += 1;
    document.getElementById('submitted').textContent = String(attempts);
    var boxes = boxRefs();
    if (boxes.length) {
      document.getElementById('disabled-at-code-submit').textContent = String(document.getElementById('submit-btn').disabled);
      document.getElementById('box-values').textContent = boxes.map(function (box) { return box.value || '_'; }).join('|');
      var typed = securityCode;
      if (!typed) {
        document.getElementById('empty-code-submits').textContent = String(Number(document.getElementById('empty-code-submits').textContent) + 1);
      }
      if (typed === '${CODE}') {
        // The v4 fixture deliberately exercises a real browser-native POST. The listener still
        // records the exact code and button state, but it must not synthesize the receipt or cancel
        // the one legitimate native navigation.
        if (V4_NATIVE) return;
        var done = document.createElement('div');
        done.id = 'confirmation';
        done.textContent = 'Thank you for applying. Your application has been received.';
        /* THE VIEW SWAP IS NOT ATOMIC, and 'linger' is that fact made observable.
         *
         * On a client-rendered embed the receipt commits before the old subtree is unmounted, so
         * there is a window in which the page says the application is in AND the code control the
         * resubmit was aimed at is still attached. networkidle resolves inside that window - there
         * is no request to wait for - so a verdict read off the control alone reads a filed
         * application as a refusal. Measured on the Cresta packet: rejected at 17:35:04Z, and
         * recruiting@cresta.ai wrote "Thank you for applying to Cresta" to that alias at 17:36:04Z.
         *
         * THE RECEIPT IS THE ROUTE, not the sentence, because that is the only kind of receipt
         * allowed to outrank a standing control. Greenhouse confirms by navigating to its own
         * '/embed/job_app/confirmation', and the runner reads that off location together with the
         * form being gone. A fixture that confirmed by prose would be pinning the verdict against
         * source 'page_text', which is exactly the arm that must NOT be able to decide this: every
         * weaker arm is gated on formStillPresent, and formStillPresent is structurally dead on a
         * code screen, whose eight maxLength=1 text boxes match none of its selectors.
         *
         * replaceState rather than assign, and that is the one deliberate difference from
         * Greenhouse. A real navigation would tear down the document and take the code control with
         * it, which destroys the very combination this case exists to put in front of the runner.
         * The difference cannot reach the code under test: readSubmitOutcome reads location.hostname
         * and location.pathname, and both say the same thing either way.
         *
         * The submit control goes with the receipt, because the route arm is gated on the form being
         * gone too. The code fieldset stays. */
        if (LINGER) {
          history.replaceState({}, '', '/embed/job_app/confirmation?for=cresta&token=fixture');
          document.getElementById('submit-btn').remove();
          document.body.appendChild(done);
          document.getElementById('filed').textContent = 'yes';
          // 'keep' holds the window open for the whole run. See case 4c for why one case pins it
          // that way and does not rely on a timer.
          if (!KEEP) {
            setTimeout(function () { document.getElementById('email-verification').remove(); }, 250);
          }
          return;
        }
        // window.location.assign(confirmationPath). The form goes, and what replaces it is the body
        // of Greenhouse's own confirmation route, fetched read-only from the live Cresta board on
        // 2026-08-10.
        document.getElementById('app-form').remove();
        document.body.appendChild(done);
        document.getElementById('filed').textContent = 'yes';
        return;
      }
      /* A REFUSED CODE ON A PAGE THAT STILL SAYS SOMETHING ENCOURAGING. Employer pages carry prose
       * like this whether or not anything was filed, and Greenhouse leaves the code control standing
       * when it refuses. The submit control goes so that formStillPresent reads false, which is not
       * a contrivance: on a real code screen there is nothing formStillPresent can see anyway, since
       * the boxes are input[type=text] and the application form is already gone. Nothing here was
       * filed, and #filed stays 'no' to say so. */
      if (PROSE) {
        var button = document.getElementById('submit-btn');
        if (button) button.remove();
        if (!document.getElementById('prose-receipt')) {
          var prose = document.createElement('p');
          prose.id = 'prose-receipt';
          prose.textContent = 'Thank you for applying. Your application has been received.';
          document.body.appendChild(prose);
        }
      }
      if (V4_NATIVE) event.preventDefault();
      return;
    }
    // The application POST itself returns the retained code wall. Rendering that wall in the old
    // document would mutate the activation-bound form before the browser could send the native
    // request, and canceling here would make the server response structurally unreachable.
    if (V4_APPLICATION || V4_APPLICATION_SAME_URL) return;
    // A client-rendered ATS can commit the verification step on a later task. The submit click is
    // already real at this point, but there is briefly no navigation, receipt, or code control to
    // observe. The delayed query pins that production shape without slowing the other replay cases.
    if (location.search.includes('delayed=slow')) setTimeout(renderChallenge, 3600);
    else if (location.search.includes('delayed=1')) setTimeout(renderChallenge, 250);
    else renderChallenge();
  });
  if (location.search.includes('challenge=1') || V4_SAME_URL_CHALLENGE) renderChallenge();
</script>`;

const otpTransmissions = [];
const v4ApplicationSubmissions = [];
const v4NativeSubmissions = [];
const v4ReceiptLeaks = [];
const v4NativeReceipt = `<!doctype html><meta charset="utf-8"><title>Application submitted</title>
<main id="v4-receipt">Thank you for applying. Your application has been received.</main>
<script>
  var receipt = document.getElementById('v4-receipt');
  setTimeout(function () {
    fetch('/v4-receipt-leak', { method: 'POST', body: 'must=stay-blocked' }).finally(function () {
      receipt.setAttribute('data-leak-attempted', 'true');
    }).catch(function () {});
  }, 50);
</script>`;
const server = http.createServer((request, response) => {
  const requestUrl = new URL(request.url, 'http://127.0.0.1');
  if (requestUrl.pathname === '/' && request.method === 'POST'
    && requestUrl.searchParams.get('v4-application-same-url') === '1') {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      v4ApplicationSubmissions.push({
        method: request.method,
        path: requestUrl.pathname,
        body: Buffer.concat(chunks).toString('utf8')
      });
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
      response.end(fixture.replace(
        '<form id="app-form"',
        '<script>globalThis.__v4SameUrlChallenge = true;</script><form id="app-form"'
      ));
    });
    return;
  }
  if (requestUrl.pathname === '/otp-auto') {
    otpTransmissions.push(requestUrl.searchParams.get('kind'));
    response.writeHead(204, { connection: 'close' });
    response.end();
    return;
  }
  if (requestUrl.pathname === '/v4-native-application' && request.method === 'POST') {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      v4ApplicationSubmissions.push({
        method: request.method,
        path: requestUrl.pathname,
        body: Buffer.concat(chunks).toString('utf8')
      });
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
      response.end(fixture);
    });
    return;
  }
  if (requestUrl.pathname === '/v4-native-verification' && request.method === 'POST') {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      v4NativeSubmissions.push({
        method: request.method,
        path: requestUrl.pathname,
        body: Buffer.concat(chunks).toString('utf8')
      });
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
      response.end(v4NativeReceipt);
    });
    return;
  }
  if (requestUrl.pathname === '/v4-receipt-leak' && request.method === 'POST') {
    v4ReceiptLeaks.push(requestUrl.pathname);
    request.resume();
    response.writeHead(204, { connection: 'close' });
    response.end();
    return;
  }
  // 'close' matters: a keep-alive socket stops Chromium ever reporting networkidle.
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
  response.end(fixture);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;
/* The same server under the name Greenhouse serves its boards from, resolved to the loopback by the
 * host-resolver rule in test/managed-runner-shim.cjs. Only the cases that need the confirmation
 * ROUTE arm of readSubmitOutcome use it, because that arm keys on hostname and pathname together and
 * nothing served from 127.0.0.1 can ever reach it. Every other case stays on the loopback name, so
 * the mapping cannot quietly change what they are testing. */
const greenhouseBase = `http://job-boards.greenhouse.io:${server.address().port}/`;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-seccode-'));
fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);

async function replay(actions, options = {}) {
  const pathSuffix = options.pathSuffix || '';
  const origin = options.origin || base;
  const runOptions = { ...options };
  delete runOptions.pathSuffix;
  delete runOptions.origin;
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: origin + pathSuffix,
    actions,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    ...runOptions
  }));
  fs.rmSync(path.join(workDir, 'stratus-result-0.json'), { force: true });
  const { status, stderr } = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'], {
      cwd: workDir,
      env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
    });
    let captured = '';
    child.stderr.on('data', (chunk) => { captured += chunk; });
    child.stdout.resume();
    child.on('close', (code) => resolve({ status: code, stderr: captured }));
  });
  assert.equal(status, 0, `runner exited ${status}: ${stderr.split('\n').slice(0, 3).join(' ')}`);
  return JSON.parse(fs.readFileSync(path.join(workDir, 'stratus-result-0.json'), 'utf8'));
}

const valueOf = (result, selector) => result.extracted.find((entry) => entry.selector === selector)?.value;

// 1. A FILL RUN CANNOT SUBMIT. The action list is the shape of a real prepare run: fills, then an
//    Enter aimed at a field, and no submit click anywhere. Before the guard, that Enter reached the
//    form and sent an application no one had authorized.
{
  const result = await replay([
    { type: 'fill', selector: '#first_name', value: 'Mehek', label: 'first_name' },
    { type: 'fill', selector: '#email', value: 'mehekmandal05@gmail.com', label: 'email' },
    { type: 'press', selector: '#email', value: 'Enter', label: 'email_confirm' },
    { type: 'extract', selector: '#submitted' }
  ]);
  assert.equal(valueOf(result, '#submitted'), 'no',
    'a run that was not allowed to submit must not have submitted');
  assert.equal(result.blockedSubmits, 1,
    'the blocked submission must be counted and reported, not silently swallowed');
  assert.equal(result.humanVerification, null, 'no submission means no challenge');
  // The fills still happened. A guard that works by breaking the run is not a fix.
  assert.deepEqual(result.filledFields, ['first_name', 'email']);
}

// 2. THE CONTRAST CASE, and the reason case 1 proves anything. The same keystroke on a run that
//    IS allowed to submit goes through. A guard that is always on would pass case 1 while making
//    the product unable to apply for a job.
{
  const result = await replay([
    { type: 'fill', selector: '#email', value: 'mehekmandal05@gmail.com', label: 'email' },
    { type: 'press', selector: '#email', value: 'Enter', label: 'email_confirm' },
    { type: 'extract', selector: '#submitted' }
  ], { allowSubmit: true });
  assert.equal(valueOf(result, '#submitted'), '1', 'an authorized run must still be able to submit');
  assert.equal(result.blockedSubmits, 0, 'nothing is blocked on a run that was allowed to submit');
}

// 3. THE CHALLENGE IS SEEN, AND IT IS READ OFF THE CONTROL. A submit with no code supplied leaves
//    the code group standing, and the run reports what the page is waiting for: how many characters,
//    and which address the code went to. Costing zero actions, which is why it can be read on every
//    run: MANAGED_ACTION_LIMIT is 120 and a real Greenhouse packet reconstructs to exactly 120.
{
  const result = await replay([
    { type: 'fill', selector: '#email', value: 'mehekmandal05@gmail.com', label: 'email' },
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' },
    { type: 'extract', selector: '#submitted' },
    { type: 'extract', selector: '#filed' },
    { type: 'extract', selector: '#disabled-at-challenge' }
  ], { allowSubmit: true });
  assert.equal(valueOf(result, '#submitted'), '1', 'the submit happened');
  assert.equal(valueOf(result, '#filed'), 'no', 'and the employer has nothing: the code gates it');
  assert.equal(result.humanVerification?.kind, 'security_code');
  assert.equal(result.humanVerification?.fieldCount, 8, 'sized off the control, not off the sentence');
  assert.equal(result.humanVerification?.sentTo, 'mehekmandal05@gmail.com');
  assert.equal(result.securityCodeAttempt, null, 'no code was supplied, so none was attempted');
  /* AND THE CHALLENGE IS NOT REPORTED AS EIGHT EMPTY REQUIRED FIELDS.
   *
   * D-01 promoted readSubmitReadiness to the end of EVERY run, so the same scan that withholds the
   * click now writes `blockers` too. The code control is eight empty inputs sitting on the form at
   * exactly the moment that scan runs. If it claimed them, a packet waiting on a code would carry
   * eight junk blocker sentences under its own honest one, and the applicant would be sent looking
   * for form fields to fill instead of an email to open.
   *
   * THIS ASSERTION USED TO PROVE NOTHING. Its comment said Greenhouse marks the boxes with neither
   * the required attribute nor aria-required, and the fixture was built to match that claim. The
   * live bundle says otherwise: aria-required="true" is on all eight, and the readiness scan reads
   * aria-required. The gate now excludes the group on its SHAPE, which is the same structural
   * signal the detector uses, and the fixture now carries the marker that makes the exclusion the
   * thing being tested. */
  assert.deepEqual(result.blockers, [],
    'the code boxes must not be reported as empty required fields, got ' + JSON.stringify(result.blockers));
  assert.equal(valueOf(result, '#disabled-at-challenge'), 'true',
    'Greenhouse disables its own submit the moment the challenge appears');
}

// 3b. THE POST-CLICK TRANSITION CAN BE CLIENT-RENDERED. This action is deliberately last, matching
// a production submit list. A runner that only waits for networkidle sees no network request, reads
// the old form immediately, and reports neither a challenge nor a receipt.
{
  const result = await replay([
    { type: 'fill', selector: '#email', value: 'mehekmandal05@gmail.com', label: 'email' },
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' }
  ], { allowSubmit: true, pathSuffix: '?delayed=1' });
  assert.equal(result.humanVerification?.kind, 'security_code',
    'the runner must observe a delayed client-rendered verification control');
  assert.equal(result.continuationOffered, false,
    'this replay did not request a continuation, so detecting the challenge must not invent one');
}

// 3c. A RETAINED CODE WALL IS NOT A SECOND APPLICATION SUBMIT.
{
  const result = await replay([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' },
    { type: 'extract', selector: '#submitted' },
    { type: 'extract', selector: '#filed' }
  ], { allowSubmit: true, pathSuffix: '?challenge=1' });
  assert.equal(result.humanVerification?.fieldCount, 8, 'the retained wall must be returned as a challenge');
  assert.equal(result.submitOutcome?.pressed, false, 'no application submit is pressed against a standing code wall');
  assert.equal(result.submitOutcome?.state, 'not_attempted');
  assert.equal(valueOf(result, '#submitted'), 'no', 'the application submit count must stay unchanged');
  assert.equal(valueOf(result, '#filed'), 'no');
  assert.ok(result.skipped.includes('confirm_and_submit: employer security code challenge already standing'));
}

// 3b-continued. GREENHOUSE PHASE ZERO WAITS FOR ITS EXACT SLOW CODE WALL.
{
  const result = await replay([
    { type: 'fill', selector: '#email', value: 'mehekmandal05@gmail.com', label: 'email' },
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' }
  ], {
    allowSubmit: true,
    requestContinuation: true,
    continuationTtlSeconds: 15,
    origin: greenhouseBase,
    pathSuffix: '?delayed=slow'
  });
  assert.equal(result.humanVerification?.kind, 'security_code');
  assert.equal(result.humanVerification?.fieldCount, 8);
  assert.equal(result.continuationOffered, true,
    'the original phase-zero challenge capability must survive the delayed Greenhouse render');
  assert.equal(result.submitOutcome?.pressed, true, 'the one authorized application click remains recorded');
  assert.notEqual(result.submitOutcome?.state, 'confirmed');
}

/* 3c-continued. THE SAME RETAINED PAGE ACCEPTS ONLY THE VERIFICATION SUBMIT.
 *
 * Phase zero starts on the exact Greenhouse control already measured in production. Its application
 * action must return the challenge and hold the Page without clicking. Phase one receives only the
 * atomic verification action after the caller has obtained the routing-alias code. The two result
 * files make the click count observable across the retained Page: zero before the code, exactly one
 * after it, and a confirmed receipt rather than an inferred disappearance. */
{
  const result0 = path.join(workDir, 'stratus-result-0.json');
  const result1 = path.join(workDir, 'stratus-result-1.json');
  const continuationInput = path.join(workDir, 'stratus-continuation-input.json');
  fs.rmSync(result0, { force: true });
  fs.rmSync(result1, { force: true });
  fs.rmSync(continuationInput, { force: true });
  fs.rmSync(path.join(workDir, 'stratus-continuation-ready.json'), { force: true });
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: `${base}?challenge=1`,
    actions: [
      { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' },
      { type: 'extract', selector: '#submitted' },
      { type: 'extract', selector: '#filed' }
    ],
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    allowSubmit: true,
    requestContinuation: true,
    continuationTtlSeconds: 15,
    continuationExpiresAt: new Date(Date.now() + 15_000).toISOString(),
    allowedHost: new URL(base).hostname
  }));
  const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'], {
    cwd: workDir,
    env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.resume();
  const waitForFile = async (file, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(file) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(fs.existsSync(file), `runner did not create ${path.basename(file)}: ${stderr}`);
  };
  await waitForFile(result0);
  const first = JSON.parse(fs.readFileSync(result0, 'utf8'));
  assert.equal(first.humanVerification?.kind, 'security_code');
  assert.equal(first.humanVerification?.fieldCount, 8);
  assert.equal(first.continuationOffered, true, 'the exact challenge must retain a one-shot continuation');
  assert.equal(first.submitOutcome?.pressed, false, 'phase zero must not press the application submit');
  assert.equal(first.submitOutcome?.state, 'not_attempted');
  assert.equal(valueOf(first, '#submitted'), 'no');
  assert.equal(valueOf(first, '#filed'), 'no');
  fs.writeFileSync(continuationInput, JSON.stringify({
    actions: [
      { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'verification_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'verification', securityCode: CODE },
      { type: 'extract', selector: '#submitted' },
      { type: 'extract', selector: '#filed' },
      { type: 'extract', selector: '#box-values' },
      { type: 'extract', selector: '#empty-code-submits' }
    ],
    screenshot: false,
    fullPage: false
  }));
  await waitForFile(result1);
  const second = JSON.parse(fs.readFileSync(result1, 'utf8'));
  assert.equal(valueOf(second, '#submitted'), '1', 'only the atomic verification continuation may click');
  assert.equal(valueOf(second, '#filed'), 'yes');
  assert.equal(valueOf(second, '#box-values'), CODE.split('').join('|'));
  assert.equal(valueOf(second, '#empty-code-submits'), '0');
  assert.deepEqual(second.securityCodeAttempt, {
    supplied: true, entered: true, resubmitted: true, outcome: 'accepted'
  });
  assert.equal(second.submitOutcome?.state, 'confirmed');
  assert.equal(second.requiredFieldConfirmation?.passes.length, 1);
  assert.equal(second.requiredFieldConfirmation?.passes[0]?.submitKind, 'verification');
  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(exitCode, 0, `verification continuation runner exited ${exitCode}: ${stderr}`);
}

/* 3d. THE WINDOW OPENS ON THE CHALLENGE, NOT ON THE FORK.
 *
 * This is the case that decides whether a held session is usable at all. The window used to be
 * fixed before phase 0 started, so the fill spent it: a real Greenhouse packet is a hundred-odd
 * actions, and on the measured runs most of a 120 second budget was gone before there was anything
 * to continue. What was left had to cover reading a mailbox and coming back, and when it did not,
 * the only way back to a code field was to SEND THE APPLICATION AGAIN - which is what makes the
 * code stale, because Greenhouse issues a new one on every send.
 *
 * The assertion is a lower bound rather than an equality: the deadline must sit at least most of a
 * full TTL in the future AFTER a run that already spent real time submitting. A fork-clock deadline
 * cannot, by construction, because the run's own elapsed time has already come out of it.
 *
 * The marker is checked too, because the marker is what the claim script actually enforces. A
 * result that advertises a later deadline than the marker allows is worse than no rebase: the
 * caller would spend a continuation it is about to be refused.
 */
{
  const markerPath = path.join(workDir, 'stratus-continuation.json');
  const readyPath = path.join(workDir, 'stratus-continuation-ready.json');
  fs.rmSync(readyPath, { force: true });
  const forkedAt = Date.now();
  fs.writeFileSync(markerPath, JSON.stringify({
    tokenHash: 'token-hash', projectHash: 'project-hash', host: new URL(base).hostname,
    expiresAt: new Date(forkedAt + 15_000).toISOString(), used: false
  }));
  const result = await replay([
    { type: 'fill', selector: '#email', value: 'mehekmandal05@gmail.com', label: 'email' },
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' }
  ], {
    allowSubmit: true,
    requestContinuation: true,
    continuationTtlSeconds: 15,
    continuationExpiresAt: new Date(forkedAt + 15_000).toISOString()
  });
  assert.equal(result.continuationOffered, true, 'a challenge with a continuation requested is a continuation offered');
  const reopened = Date.parse(result.continuationExpiresAt);
  assert.ok(Number.isFinite(reopened), 'the run must report the deadline it is actually holding to');
  assert.ok(reopened - (forkedAt + 15_000) >= 1_000,
    'the window must be measured from the challenge: the run spent ' + result.elapsedMs
    + 'ms getting there, and a fork-clock deadline would already have lost every one of those ms');
  const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
  assert.equal(marker.expiresAt, result.continuationExpiresAt,
    'the deadline the caller is told must be the deadline the claim script enforces');
  assert.equal(marker.tokenHash, 'token-hash', 'rebasing the deadline must not disturb what the marker binds to');
  assert.equal(marker.used, false, 'rebasing must not consume the single use');
  assert.equal(JSON.parse(fs.readFileSync(readyPath, 'utf8')).expiresAt, result.continuationExpiresAt);
  assert.equal(fs.existsSync(path.join(workDir, 'stratus-continuation-next.json')), false,
    'the marker is replaced by rename, so no half-written copy may be left where a claim could read it');
  fs.rmSync(markerPath, { force: true });
  fs.rmSync(readyPath, { force: true });
}

/* 3e. V4 NO-CLICK BLOCKS PRE-CHOOSER OTP AUTO-SUBMIT AND IS TERMINAL FOR LATER MUTATIONS.
 *
 * The code is entered into the retained challenge first, then two equally strong verification
 * controls make the chooser refuse to select either one. A generic click or Enter after that
 * refusal would submit the form outside the chooser unless the no-click decision ends every later
 * mutating action. Extracts remain available so the caller receives the no-control evidence. */
{
  const pathSuffix = '?challenge=1&ambiguous-verification=1&otp-auto-submit=1';
  const expectedPageUrl = base + pathSuffix;
  const result = await replay([
    { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl },
    {
      type: 'requireCapability', value: ATOMIC_SUBMIT_V4_CAPABILITY, optional: false,
      applicationScopeSelector: '#app-form'
    },
    {
      type: 'confirmAndSubmit',
      selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
      chooserPolicy: ATOMIC_SUBMIT_POLICY_V4,
      expectedPageUrl,
      label: 'verification_submit',
      optional: false,
      maxRetries: 1,
      contractVersion: 2,
      submitKind: 'verification',
      securityCode: CODE
    },
    { type: 'click', selector: '#submit-btn', label: 'later_click' },
    { type: 'press', selector: '#security-input-0', value: 'Enter', label: 'later_enter' },
    { type: 'extract', selector: '#submitted' },
    { type: 'extract', selector: '#box-values' }
  ], { allowSubmit: true, pathSuffix });
  assert.equal(valueOf(result, '#submitted'), 'no');
  assert.equal(valueOf(result, '#box-values'), '-');
  assert.deepEqual(otpTransmissions, [],
    'v4 no-click blocks pre-chooser OTP fetch, XHR, beacon, and native auto-submit transmission');
  assert.deepEqual(result.securityCodeAttempt, {
    supplied: true, entered: true, outcome: 'no_control', resubmitted: false
  });
  assert.equal(result.submitOutcome?.pressed, false);
  assert.equal(result.finalSubmitChooser?.outcome, 'ambiguous_submit');
  assert.ok(result.skipped.includes('later_click: skipped after the atomic submit decision became terminal'));
  assert.ok(result.skipped.includes('later_enter: skipped after the atomic submit decision became terminal'));
}

/* 3e.1. UNNAMED CODE BOXES MAY BE VERIFIED BUT CANNOT AUTHORIZE A NATIVE POST.
 *
 * The isolated group proof can safely establish that the exact caller code reached the exact eight
 * controls even when those controls have no successful form names. That is enough to proceed to a
 * chooser that may refuse to click, but it is not payload authority: a native POST would omit every
 * code byte. One unambiguous Verify control makes that distinction observable. */
{
  v4NativeSubmissions.length = 0;
  const pathSuffix = '?challenge=1&v4-native=1&otp-unnamed=1';
  const expectedPageUrl = base + pathSuffix;
  const result = await replay([
    { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl },
    {
      type: 'requireCapability', value: ATOMIC_SUBMIT_V4_CAPABILITY, optional: false,
      applicationScopeSelector: '#app-form'
    },
    {
      type: 'confirmAndSubmit',
      selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
      chooserPolicy: ATOMIC_SUBMIT_POLICY_V4,
      expectedPageUrl,
      label: 'verification_submit',
      optional: false,
      maxRetries: 1,
      contractVersion: 2,
      submitKind: 'verification',
      securityCode: CODE
    },
    { type: 'extract', selector: '#submitted' },
    { type: 'extract', selector: '#box-values' }
  ], { allowSubmit: true, pathSuffix });
  assert.deepEqual(v4NativeSubmissions, [],
    'unnamed OTP controls must never authorize a native verification POST that omits the code');
  assert.equal(valueOf(result, '#submitted'), 'no');
  assert.equal(valueOf(result, '#box-values'), '-');
  assert.deepEqual(result.securityCodeAttempt, {
    supplied: true, entered: true, outcome: 'no_control', resubmitted: false
  });
  assert.equal(result.submitOutcome?.pressed, false);
  assert.equal(result.finalSubmitChooser?.outcome, 'activation_blocked');
  assert.ok(result.skipped.includes(
    'confirm_and_submit: exact security code had no successful native payload control'
  ));
}

/* 3f. A RETAINED V4 APPLICATION NAVIGATES TO A CODE WALL, THEN COMPLETES.
 *
 * Phase zero releases one exact native application POST whose same-URL response is the code-wall
 * document. That navigation destroys the old utility execution context while the retained Page stays alive.
 * Phase one must reacquire the new isolated context, enter the eight exact code controls, and
 * release one verification POST. The receipt then tries one delayed background write. */
{
  v4ApplicationSubmissions.length = 0;
  v4NativeSubmissions.length = 0;
  v4ReceiptLeaks.length = 0;
  const result0 = path.join(workDir, 'stratus-result-0.json');
  const result1 = path.join(workDir, 'stratus-result-1.json');
  const continuationInput = path.join(workDir, 'stratus-continuation-input.json');
  const readyPath = path.join(workDir, 'stratus-continuation-ready.json');
  const errorPath = path.join(workDir, 'stratus-error.json');
  const applicationPathSuffix = '?v4-application-same-url=1';
  const applicationPageUrl = base + applicationPathSuffix;
  const challengePageUrl = applicationPageUrl;
  const applicationCapabilityActions = [
    {
      type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false,
      expectedPageUrl: applicationPageUrl
    },
    {
      type: 'requireCapability', value: ATOMIC_SUBMIT_V4_CAPABILITY, optional: false,
      applicationScopeSelector: '#app-form'
    }
  ];
  const challengeCapabilityActions = [
    {
      type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false,
      expectedPageUrl: challengePageUrl
    },
    {
      type: 'requireCapability', value: ATOMIC_SUBMIT_V4_CAPABILITY, optional: false,
      applicationScopeSelector: '#app-form'
    }
  ];
  fs.rmSync(result0, { force: true });
  fs.rmSync(result1, { force: true });
  fs.rmSync(continuationInput, { force: true });
  fs.rmSync(readyPath, { force: true });
  fs.rmSync(errorPath, { force: true });
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: applicationPageUrl,
    actions: [
      ...applicationCapabilityActions,
      { type: 'fill', selector: '#first_name', value: 'Mehek', label: 'first_name' },
      { type: 'fill', selector: '#email', value: 'mehek@example.com', label: 'email' },
      {
        type: 'confirmAndSubmit',
        selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
        chooserPolicy: ATOMIC_SUBMIT_POLICY_V4,
        expectedPageUrl: applicationPageUrl,
        label: 'final_submit',
        optional: false,
        maxRetries: 1,
        contractVersion: 2,
        submitKind: 'application'
      }
    ],
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    allowSubmit: true,
    requestContinuation: true,
    continuationTtlSeconds: 15,
    continuationExpiresAt: new Date(Date.now() + 15_000).toISOString(),
    allowedHost: new URL(base).hostname
  }));
  const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'], {
    cwd: workDir,
    env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.resume();
  const childExit = new Promise((resolve) => child.on('close', resolve));
  const waitForFile = async (file, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(file) && !fs.existsSync(errorPath) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(fs.existsSync(errorPath), false,
      `runner failed before creating ${path.basename(file)}: ${fs.existsSync(errorPath) ? fs.readFileSync(errorPath, 'utf8') : stderr}`);
    assert.ok(fs.existsSync(file), `runner did not create ${path.basename(file)}: ${stderr}`);
  };
  await waitForFile(result0);
  const first = JSON.parse(fs.readFileSync(result0, 'utf8'));
  assert.equal(first.humanVerification?.kind, 'security_code');
  assert.equal(first.humanVerification?.fieldCount, 8);
  assert.equal(first.continuationOffered, true, 'the v4 challenge must retain one continuation');
  assert.equal(first.submitOutcome?.pressed, true, 'phase zero must release the one bound application POST');
  assert.notEqual(first.submitOutcome?.state, 'confirmed', 'the code wall is not a final receipt');
  assert.equal(first.url, challengePageUrl, 'the retained page must be the newly committed challenge document');
  assert.deepEqual(v4ApplicationSubmissions.map((submission) => ({
    method: submission.method,
    path: submission.path,
    fields: [...new URLSearchParams(submission.body).entries()]
  })), [{
    method: 'POST',
    path: '/',
    fields: [['first_name', 'Mehek'], ['email', 'mehek@example.com']]
  }], 'phase zero must release exactly one application POST with the caller values');
  assert.deepEqual(v4NativeSubmissions, [], 'phase zero must not reach the verification endpoint');

  fs.writeFileSync(continuationInput, JSON.stringify({
    actions: [
      ...challengeCapabilityActions,
      {
        type: 'confirmAndSubmit',
        selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
        chooserPolicy: ATOMIC_SUBMIT_POLICY_V4,
        expectedPageUrl: challengePageUrl,
        label: 'verification_submit',
        optional: false,
        maxRetries: 1,
        contractVersion: 2,
        submitKind: 'verification',
        securityCode: CODE
      },
      {
        type: 'waitForSelector', selector: '#v4-receipt[data-leak-attempted="true"]',
        label: 'receipt_wait', optional: false
      },
      { type: 'extract', selector: '#v4-receipt', label: 'receipt_text' },
      {
        type: 'extract', selector: '#v4-receipt', attribute: 'data-leak-attempted',
        label: 'receipt_leak_settled'
      }
    ],
    screenshot: false,
    fullPage: false
  }));
  await waitForFile(result1);
  const second = JSON.parse(fs.readFileSync(result1, 'utf8'));
  const exitCode = await childExit;
  assert.equal(exitCode, 0, `v4 verification continuation runner exited ${exitCode}: ${stderr}`);

  assert.deepEqual(v4NativeSubmissions.map((submission) => ({
    method: submission.method,
    path: submission.path,
    fields: [...new URLSearchParams(submission.body).entries()]
  })), [{
    method: 'POST',
    path: '/v4-native-verification',
    fields: CODE.split('').map((character) => ['security_code', character])
  }], 'the continuation must release exactly one ordered duplicate-field verification POST');
  assert.deepEqual(second.securityCodeAttempt, {
    supplied: true, entered: true, resubmitted: true, outcome: 'accepted'
  });
  assert.equal(second.submitOutcome?.pressed, true);
  assert.equal(second.submitOutcome?.state, 'confirmed');
  assert.equal(second.submitOutcome?.formStillPresent, false, 'the native response must be a form-free receipt');
  assert.equal(second.requiredFieldConfirmation?.status, 'confirmed');
  assert.equal(second.requiredFieldConfirmation?.passes.length, 1);
  assert.equal(second.requiredFieldConfirmation?.passes[0]?.submitKind, 'verification');
  assert.equal(second.finalSubmitChooser?.outcome, 'selected');
  assert.equal(second.skipped.includes(
    'receipt_wait: skipped after the atomic submit decision became terminal'
  ), false, 'the required post-submit receipt wait must run after the terminal decision');
  assert.match(valueOf(second, '#v4-receipt') || '', /application has been received/i);
  assert.equal(second.extracted.find((entry) => entry.label === 'receipt_leak_settled')?.value,
    'true', 'the delayed background write must settle before receipt observation completes');
  assert.deepEqual(v4ReceiptLeaks, [], 'post-receipt writes must stay blocked until the browser closes');
}

/* 3f.1. THE EXPORTED V3 CHOOSER CAN FINISH ONE RETAINED V4 CODE WALL.
 *
 * The backend still emits the exported v3 chooser for verification. A v4 phase-zero run must keep
 * that one exact, URL-bound security-code continuation compatible, while internally applying the
 * full v4 isolated proof, native payload binding, and transport gate. */
{
  v4NativeSubmissions.length = 0;
  const result0 = path.join(workDir, 'stratus-result-0.json');
  const result1 = path.join(workDir, 'stratus-result-1.json');
  const continuationInput = path.join(workDir, 'stratus-continuation-input.json');
  const readyPath = path.join(workDir, 'stratus-continuation-ready.json');
  const errorPath = path.join(workDir, 'stratus-error.json');
  const expectedPageUrl = base + '?challenge=1&v4-native=1';
  fs.rmSync(result0, { force: true });
  fs.rmSync(result1, { force: true });
  fs.rmSync(continuationInput, { force: true });
  fs.rmSync(readyPath, { force: true });
  fs.rmSync(errorPath, { force: true });
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: expectedPageUrl,
    actions: [
      {
        type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false,
        expectedPageUrl
      },
      {
        type: 'requireCapability', value: ATOMIC_SUBMIT_V4_CAPABILITY, optional: false,
        applicationScopeSelector: '#app-form'
      },
      {
        type: 'confirmAndSubmit',
        selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
        chooserPolicy: ATOMIC_SUBMIT_POLICY_V4,
        expectedPageUrl,
        label: 'final_submit',
        optional: false,
        maxRetries: 1,
        contractVersion: 2,
        submitKind: 'application'
      }
    ],
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    allowSubmit: true,
    requestContinuation: true,
    continuationTtlSeconds: 20,
    continuationExpiresAt: new Date(Date.now() + 20_000).toISOString(),
    allowedHost: new URL(base).hostname
  }));
  const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'], {
    cwd: workDir,
    env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.resume();
  const childExit = new Promise((resolve) => child.on('close', resolve));
  const waitForFile = async (file, timeoutMs = 30_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(file) && !fs.existsSync(errorPath) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    assert.equal(fs.existsSync(errorPath), false,
      `runner failed before creating ${path.basename(file)}: ${fs.existsSync(errorPath) ? fs.readFileSync(errorPath, 'utf8') : stderr}`);
    assert.ok(fs.existsSync(file), `runner did not create ${path.basename(file)}: ${stderr}`);
  };
  await waitForFile(result0);
  const first = JSON.parse(fs.readFileSync(result0, 'utf8'));
  assert.equal(first.continuationOffered, true);
  assert.equal(first.submitOutcome?.pressed, false,
    'phase zero must not submit an application against an already-standing code wall');
  assert.deepEqual(v4NativeSubmissions, []);

  fs.writeFileSync(continuationInput, JSON.stringify({
    actions: [
      {
        type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false,
        expectedPageUrl
      },
      {
        type: 'confirmAndSubmit',
        selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
        chooserPolicy: ATOMIC_SUBMIT_POLICY,
        expectedPageUrl,
        label: 'verification_submit',
        optional: false,
        maxRetries: 1,
        contractVersion: 2,
        submitKind: 'verification',
        securityCode: CODE
      }
    ],
    screenshot: false,
    fullPage: false
  }));
  await waitForFile(result1);
  const second = JSON.parse(fs.readFileSync(result1, 'utf8'));
  const exitCode = await childExit;
  assert.equal(exitCode, 0, `retained v4 plus v3 verification runner exited ${exitCode}: ${stderr}`);
  assert.deepEqual(v4NativeSubmissions.map((submission) => ({
    method: submission.method,
    path: submission.path,
    fields: [...new URLSearchParams(submission.body).entries()]
  })), [{
    method: 'POST',
    path: '/v4-native-verification',
    fields: CODE.split('').map((character) => ['security_code', character])
  }], 'the v3 compatibility action must still release only the v4-bound ordered code payload');
  assert.deepEqual(second.securityCodeAttempt, {
    supplied: true, entered: true, resubmitted: true, outcome: 'accepted'
  });
  assert.equal(second.submitOutcome?.pressed, true);
  assert.equal(second.submitOutcome?.state, 'confirmed');
  assert.equal(second.requiredFieldConfirmation?.status, 'confirmed');
  assert.equal(second.finalSubmitChooser?.policyVersion, 3,
    'the result must preserve the caller contract while the retained runner hardens it internally');
  assert.equal(second.finalSubmitChooser?.outcome, 'selected');
}

/* 3g. PAGE-WORLD VALUE GETTERS CANNOT LAUNDER DIFFERENT NATIVE CODE BYTES.
 *
 * Each input handler keeps an attacker character in the native value slot while an own getter
 * reports the caller-supplied character to ordinary page JavaScript. The v4 proof reads the native
 * slots from its isolated world and either safely repairs them or refuses the submit. This fixture
 * deliberately reapplies the split after every repair attempt, so the only safe outcome is a typed
 * no-click result with no verification request. */
{
  v4NativeSubmissions.length = 0;
  const pathSuffix = '?challenge=1&v4-native=1&otp-value-spoof=1';
  const expectedPageUrl = base + pathSuffix;
  const result = await replay([
    { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl },
    {
      type: 'requireCapability', value: ATOMIC_SUBMIT_V4_CAPABILITY, optional: false,
      applicationScopeSelector: '#app-form'
    },
    {
      type: 'confirmAndSubmit',
      selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
      chooserPolicy: ATOMIC_SUBMIT_POLICY_V4,
      expectedPageUrl,
      label: 'verification_submit',
      optional: false,
      maxRetries: 1,
      contractVersion: 2,
      submitKind: 'verification',
      securityCode: CODE
    }
  ], { allowSubmit: true, pathSuffix });
  assert.deepEqual(v4NativeSubmissions, [], 'spoofed native code bytes must never reach the endpoint');
  assert.deepEqual(result.securityCodeAttempt, {
    supplied: true, entered: false, outcome: 'not_entered', resubmitted: false
  });
  assert.equal(result.submitOutcome?.pressed, false);
  assert.equal(result.finalSubmitChooser?.outcome, 'binding_changed');
  assert.equal(result.requiredFieldConfirmation?.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation?.passes[0]?.blockerReason, 'successful_address_changed');
}

/* 3h. A NATIVE SUBMIT INPUT CANNOT MASQUERADE AS A CODE BOX.
 *
 * Main-world type inspection sees a text input and keydown handlers retain the supplied code in its
 * native value slot. The isolated proof still sees that the control's native type is submit. Such a
 * control would be omitted from the eventual form payload when a different submitter is chosen, so
 * v4 must reject it before any verification request is released. */
{
  v4NativeSubmissions.length = 0;
  const pathSuffix = '?challenge=1&v4-native=1&otp-type-spoof=1';
  const expectedPageUrl = base + pathSuffix;
  const result = await replay([
    { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl },
    {
      type: 'requireCapability', value: ATOMIC_SUBMIT_V4_CAPABILITY, optional: false,
      applicationScopeSelector: '#app-form'
    },
    {
      type: 'confirmAndSubmit',
      selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
      chooserPolicy: ATOMIC_SUBMIT_POLICY_V4,
      expectedPageUrl,
      label: 'verification_submit',
      optional: false,
      maxRetries: 1,
      contractVersion: 2,
      submitKind: 'verification',
      securityCode: CODE
    }
  ], { allowSubmit: true, pathSuffix });
  assert.deepEqual(v4NativeSubmissions, [], 'a submit-shaped code decoy must never reach the endpoint');
  assert.deepEqual(result.securityCodeAttempt, {
    supplied: true, entered: false, outcome: 'not_entered', resubmitted: false
  });
  assert.equal(result.submitOutcome?.pressed, false);
  assert.equal(result.finalSubmitChooser?.outcome, 'binding_changed');
  assert.equal(result.requiredFieldConfirmation?.passes[0]?.blockerReason, 'successful_address_changed');
}

/* 3i. PAGE-WORLD OTP ROLE SPOOFING CANNOT TURN AN APPLICATION FIELD INTO THE CODE CONTROL.
 *
 * The hostile page makes its ordinary first-name input report autocomplete=one-time-code only to
 * main-world JavaScript. The isolated capability reads the native attribute and group shape before
 * typing, so the caller's code never overwrites or submits that application field. */
{
  v4NativeSubmissions.length = 0;
  const pathSuffix = '?challenge=1&v4-native=1&otp-role-spoof=1';
  const expectedPageUrl = base + pathSuffix;
  const result = await replay([
    { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl },
    {
      type: 'requireCapability', value: ATOMIC_SUBMIT_V4_CAPABILITY, optional: false,
      applicationScopeSelector: '#app-form'
    },
    {
      type: 'confirmAndSubmit',
      selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
      chooserPolicy: ATOMIC_SUBMIT_POLICY_V4,
      expectedPageUrl,
      label: 'verification_submit',
      optional: false,
      maxRetries: 1,
      contractVersion: 2,
      submitKind: 'verification',
      securityCode: CODE
    }
  ], { allowSubmit: true, pathSuffix });
  assert.deepEqual(v4NativeSubmissions, [], 'a page-forged OTP role must never reach the endpoint');
  assert.deepEqual(result.securityCodeAttempt, {
    supplied: true, entered: false, outcome: 'not_entered', resubmitted: false
  });
  assert.equal(result.submitOutcome?.pressed, false);
  assert.equal(result.finalSubmitChooser?.outcome, 'binding_changed');
  assert.equal(result.requiredFieldConfirmation?.passes[0]?.blockerReason, 'successful_address_changed');
}

/* 3j. PAGE-WORLD OTP ORDER SPOOFING CANNOT REVERSE DUPLICATE-NAME CODE BYTES.
 *
 * The hostile page replaces Document.prototype.querySelectorAll so main-world discovery receives
 * the genuine security_code controls in reverse document order. The isolated group proof compares
 * the supplied handles in sequence and must refuse them before typing or releasing the native POST. */
{
  v4NativeSubmissions.length = 0;
  const pathSuffix = '?challenge=1&v4-native=1&otp-order-reverse=1';
  const expectedPageUrl = base + pathSuffix;
  const result = await replay([
    { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl },
    {
      type: 'requireCapability', value: ATOMIC_SUBMIT_V4_CAPABILITY, optional: false,
      applicationScopeSelector: '#app-form'
    },
    {
      type: 'confirmAndSubmit',
      selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
      chooserPolicy: ATOMIC_SUBMIT_POLICY_V4,
      expectedPageUrl,
      label: 'verification_submit',
      optional: false,
      maxRetries: 1,
      contractVersion: 2,
      submitKind: 'verification',
      securityCode: CODE
    }
  ], { allowSubmit: true, pathSuffix });
  assert.deepEqual(v4NativeSubmissions, [], 'reverse-ordered code controls must never reach the endpoint');
  assert.deepEqual(result.securityCodeAttempt, {
    supplied: true, entered: false, outcome: 'not_entered', resubmitted: false
  });
  assert.equal(result.submitOutcome?.pressed, false);
  assert.equal(result.finalSubmitChooser?.outcome, 'binding_changed');
  assert.equal(result.requiredFieldConfirmation?.passes[0]?.blockerReason, 'successful_address_changed');
}

/* 3k. A POST-READBACK OTP REORDER CANNOT CHANGE THE NATIVE CODE BYTE ORDER.
 *
 * Each named one-character box still has its proved value and identity after this mutation. The
 * hostile form getter waits until all eight native values exactly equal the supplied code, then
 * reverses the real nodes after final readback but before submit selection. Native form encoding
 * would emit the shared security_code name in that new order unless transport binding carries and
 * checks the actual form.elements proof order. The guard must stop before any request is released. */
{
  v4NativeSubmissions.length = 0;
  const pathSuffix = '?challenge=1&v4-native=1&otp-post-entry-reorder=1';
  const expectedPageUrl = base + pathSuffix;
  const result = await replay([
    { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl },
    {
      type: 'requireCapability', value: ATOMIC_SUBMIT_V4_CAPABILITY, optional: false,
      applicationScopeSelector: '#app-form'
    },
    {
      type: 'confirmAndSubmit',
      selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
      chooserPolicy: ATOMIC_SUBMIT_POLICY_V4,
      expectedPageUrl,
      label: 'verification_submit',
      optional: false,
      maxRetries: 1,
      contractVersion: 2,
      submitKind: 'verification',
      securityCode: CODE
    }
  ], { allowSubmit: true, pathSuffix });
  assert.deepEqual(v4NativeSubmissions, [], 'post-readback reordered code controls must release zero requests');
  assert.deepEqual(result.securityCodeAttempt, {
    supplied: true, entered: true, outcome: 'not_entered', resubmitted: false
  });
  assert.equal(result.submitOutcome?.pressed, false);
  assert.equal(result.finalSubmitChooser?.outcome, 'binding_changed');
  assert.equal(result.requiredFieldConfirmation?.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation?.passes[0]?.blockerReason, 'security_code_binding_changed');
}

// 4. THE CODE FINISHES THE APPLICATION in its own continuation run. That run begins on the changed
//    challenge DOM and carries exactly one atomic action, one receipt pass, and one physical click.
{
  const result = await replay([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'verification_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'verification', securityCode: CODE },
    { type: 'extract', selector: '#submitted' },
    { type: 'extract', selector: '#filed' },
    { type: 'extract', selector: '#empty-code-submits' },
    { type: 'extract', selector: '#box-values' },
    { type: 'extract', selector: '#disabled-at-code-submit' }
  ], { allowSubmit: true, pathSuffix: '?challenge=1' });
  assert.equal(valueOf(result, '#submitted'), '1', 'the continuation makes exactly one submit with the code in it');
  assert.equal(valueOf(result, '#filed'), 'yes', 'and this time the employer has the application');
  /* EIGHT CHARACTERS IN EIGHT BOXES, IN ORDER, and read back off the boxes themselves at the moment
     the form was submitted rather than inferred from the outcome. The widget auto-advances by
     calling select() on the next box after each character, so one focus and eight keystrokes is
     the right shape; on a widget that did not, this is the assertion that would say so. */
  assert.equal(valueOf(result, '#box-values'), CODE.split('').join('|'),
    'each box must hold exactly one character of the code, in order');
  /* AND THE SUBMIT WAS ENABLED WHEN IT WAS PRESSED. Greenhouse re-enables the button from state one
     render after the eighth character. Without the wait for that, the atomic submit's candidate
     filter drops disabled controls and raises "Atomic submit control was missing or ambiguous" over
     a form that was about to be perfectly submittable. */
  assert.equal(valueOf(result, '#disabled-at-code-submit'), 'false',
    'the code must be complete, and the form re-enabled, before the click');
  assert.deepEqual(result.securityCodeAttempt, {
    supplied: true, entered: true, resubmitted: true, outcome: 'accepted'
  });
  assert.equal(valueOf(result, '#empty-code-submits'), '0', 'verification must never click before the changing code is entered');
  assert.equal(result.requiredFieldConfirmation.passes.length, 1);
  assert.equal(result.requiredFieldConfirmation.passes[0].submitKind, 'verification');
  assert.equal(result.humanVerification, null, 'the challenge is gone, which is what accepted means');
  /* AND THE CHALLENGE BEING GONE IS NOT WHAT PROVES IT. The page said so itself, with the form
     replaced by the confirmation body. The backend refuses to write 'submitted' on a code run
     without both this and an 'accepted' code outcome. */
  assert.equal(result.submitOutcome?.state, 'confirmed');
  assert.equal(result.submitOutcome?.formStillPresent, false);
}

/* 4a. SECURITY CODE ENTRY USES THE EXACT DETECTED INPUT HANDLES.
 *
 * A page observer copies the old public box indices to hidden decoy inputs before a later locator
 * could resolve them. Direct runner-owned handles keep every character and the form association on
 * the detected challenge controls, so the real verification succeeds and the decoys stay empty. */
{
  const result = await replay([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'verification_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'verification', securityCode: CODE },
    { type: 'extract', selector: '#filed' },
    { type: 'extract', selector: '#box-values' },
    { type: 'extract', selector: '#security-decoy-0', attribute: 'value' }
  ], { allowSubmit: true, pathSuffix: '?challenge=1&security-marker-copy=1' });
  assert.equal(valueOf(result, '#filed'), 'yes');
  assert.equal(valueOf(result, '#box-values'), CODE.split('').join('|'));
  assert.equal(valueOf(result, '#security-decoy-0'), '');
  assert.equal(result.securityCodeAttempt?.outcome, 'accepted');
}

/* 4c. A CONFIRMED RECEIPT OUTRANKS A CONTROL THAT HAS NOT UNMOUNTED YET.
 *
 * The false negative this pins is the worst output on the security-code path, and it is worse than a
 * missing verdict: the application HAS been filed, and the applicant is told "the employer did not
 * accept it, so this one needs you: open the portal and finish it there." She then reapplies to a
 * job she already holds an application for, or writes it off.
 *
 * Two things had to change and this case needs both. The branch waits for a post-submit state the
 * way the sibling application submit already did, and the receipt outranks control presence.
 *
 * THE CONTROL NEVER DETACHES HERE, deliberately. A fixture that removed it on a timer would be racy
 * in the direction that hides the bug: if the removal fires before the verdict read, the old code
 * passes too and the case proves nothing. Holding it attached for the whole run makes the assertion
 * impossible to satisfy by accident - the run must decide 'accepted' with the challenge in front of
 * it - and humanVerification is asserted non-null to prove it really was there.
 *
 * AND THE RECEIPT IS THE ROUTE. The run is served from Greenhouse's own hostname so that the
 * confirmation reaches readSubmitOutcome through its ats_route arm, which is the only source allowed
 * to outrank a standing control. Reviewed and measured twice over. With a prose receipt instead, a
 * REFUSED code under a page that merely says "Thank you for applying" also read as accepted, because
 * every weaker arm is gated on formStillPresent and a code screen has nothing formStillPresent can
 * see. And with 'ats_state' as the requirement, a page could mint one by printing Ashby's published
 * container class, which is markup and therefore forgeable; 'ats_route' is derived from location and
 * is not. The source and the evidence are both asserted below, not just the state, so this case
 * cannot start passing again through an arm it exists to keep out. */
{
  const result = await replay([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'verification_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'verification', securityCode: CODE },
    { type: 'extract', selector: '#filed' }
  ], { allowSubmit: true, origin: greenhouseBase, pathSuffix: '?challenge=1&linger=1&keep=1' });
  assert.equal(valueOf(result, '#filed'), 'yes', 'the employer has the application');
  assert.equal(result.submitOutcome?.state, 'confirmed', 'and the page says so');
  assert.equal(result.submitOutcome?.source, 'ats_route',
    'through the location-derived arm, which is the only source strong enough to outrank a standing control');
  assert.match(String(result.submitOutcome?.evidence), /^greenhouse:.*\/confirmation$/,
    'and specifically through the confirmation route, which is what production actually does');
  assert.equal(result.humanVerification?.kind, 'security_code',
    'the code control is still on the page, which is what makes the next assertion mean something');
  assert.equal(result.securityCodeAttempt?.outcome, 'accepted',
    'a filed application must not be reported as a rejected code because its control has not unmounted');
}

/* 4d. THE SAME THING IN ITS PRODUCTION SHAPE, where the control unmounts a beat after the receipt
 * instead of never. This is the measured Cresta timing, and it is here because a fix that only
 * handled the permanent case would be fitting the fixture rather than the defect.
 *
 * The property under test is that the verdict is STABLE ACROSS THE SWAP WINDOW: whether the run
 * reads the page before or after the unmount, the answer is the same, because the receipt is what
 * decides it either way. Which side of the window the read lands on depends on how fast the machine
 * is - the same suite measured 12s and 140s on one laptop - so nothing here asserts the end-of-run
 * challenge state. An assertion that a timer had fired would be testing the host, and case 4c
 * already pins the hard side of the window deterministically.
 *
 * The evidence is asserted here as well as the source, because 'ats_route' has exactly one producer
 * today and a second one arriving later must not be able to satisfy this case silently. */
{
  const result = await replay([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'verification_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'verification', securityCode: CODE },
    { type: 'extract', selector: '#filed' }
  ], { allowSubmit: true, origin: greenhouseBase, pathSuffix: '?challenge=1&linger=1' });
  assert.equal(valueOf(result, '#filed'), 'yes');
  assert.equal(result.submitOutcome?.state, 'confirmed');
  assert.equal(result.submitOutcome?.source, 'ats_route');
  assert.match(String(result.submitOutcome?.evidence), /^greenhouse:.*\/confirmation$/);
  assert.equal(result.securityCodeAttempt?.outcome, 'accepted');
}

/* 4e. THE INVERSION, WIRED END TO END, and the case this whole change set was blocked on.
 *
 * A wrong code, refused, on a page that carries a confirmation-shaped sentence. The first repair let
 * ANY confirmed receipt outrank the standing control, and this is the shape where that is wrong:
 * readSubmitOutcome gates every weak arm on formStillPresent, and a security-code screen has nothing
 * formStillPresent can see, so the body-text arm decides unopposed and a refused code reads as
 * accepted. That is the error class this system must not make, and it is worse than the false
 * rejection the repair removed: an applicant told her application is in stops following it up.
 *
 * The trap is asserted armed rather than assumed: state confirmed, source page_text. If a later
 * change stops the sentence from producing a receipt at all, this case must fail loudly instead of
 * passing for the wrong reason. */
{
  const result = await replay([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'verification_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'verification', securityCode: 'AAAAAAAA' },
    { type: 'extract', selector: '#filed' }
  ], { allowSubmit: true, pathSuffix: '?challenge=1&prose=1' });
  assert.equal(valueOf(result, '#filed'), 'no', 'nothing was filed, whatever the page says');
  assert.equal(result.submitOutcome?.state, 'confirmed', 'the weak arm really did fire');
  assert.equal(result.submitOutcome?.source, 'page_text', 'off body text, which must not be able to decide this');
  assert.equal(result.humanVerification?.kind, 'security_code', 'and the challenge is still standing');
  assert.equal(result.securityCodeAttempt?.outcome, 'rejected',
    'a refused code must not be reported as accepted because the page carries an encouraging sentence');
}

// 4b. THE PRODUCTION SHAPE THAT FAILED, and the reason the code now travels on a continuation.
//
//     Packet 9810bdcf-fc3d-44bb-a8cb-b09c51aaf131, Cresta, 2026-08-09. The finishing run was given
//     the whole packet action list with the code hung on its terminal atomic submit. That list
//     begins with a fresh page load, so at the moment the atomic action ran there was no code
//     control on the page at all - Greenhouse only renders one in answer to a submit it has
//     refused. The runner reported no_control and threw, and the receipt shows eight empty boxes
//     under a fully populated form.
//
//     The runner's refusal is correct and stays: typing must come before the click, so an atomic
//     verification submit on a page with no code control has nothing it can honestly do. What
//     changed is the caller, which now sends this action only as a continuation of the run that
//     raised the challenge. This case pins the runner half.
{
  let failed = null;
  try {
    await replay([
      { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'verification_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'verification', securityCode: CODE }
    ], { allowSubmit: true });
  } catch (error) {
    failed = error;
  }
  assert.ok(failed, 'a verification submit with no code control on the page must not proceed');
  assert.match(String(failed.message), /Security code was not entered before atomic verification/);
}

// 5. A WRONG CODE IS REPORTED AS WRONG. It must not read as accepted, and it must not read as a
//    generic failure either: the applicant needs to know the application is still sitting behind
//    the same check and a fresh code is in her mailbox.
{
  const result = await replay([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'verification_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'verification', securityCode: 'AAAAAAAA' },
    { type: 'extract', selector: '#filed' },
    { type: 'extract', selector: '#empty-code-submits' }
  ], { allowSubmit: true, pathSuffix: '?challenge=1' });
  assert.equal(valueOf(result, '#filed'), 'no');
  assert.equal(result.securityCodeAttempt?.outcome, 'rejected');
  assert.equal(valueOf(result, '#empty-code-submits'), '0');
  assert.equal(result.humanVerification?.kind, 'security_code', 'the challenge is still standing');
}

// 6. THE LEGEND IS NOT A CHALLENGE. '* indicates a required field' is on the fixture from first
//    paint, exactly as it is on every Greenhouse form. A run that never submitted must report no
//    challenge at all. This is the regression that a text-matching detector would ship.
{
  const result = await replay([
    { type: 'fill', selector: '#first_name', value: 'Mehek', label: 'first_name' },
    { type: 'extract', selector: '.legend' }
  ]);
  assert.match(valueOf(result, '.legend'), /indicates a required field/,
    'the legend really is on the page, so case 6 is testing something');
  assert.equal(result.humanVerification, null, 'and it is not a security-code challenge');
}

server.close();
fs.rmSync(workDir, { recursive: true, force: true });
console.log('security-code replay: 21 cases passed');
