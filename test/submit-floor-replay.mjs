/* THE SUBMIT FLOOR, RUN RATHER THAN READ.
 *
 * Same technique and the same reason as test/managed-runner-replay.mjs: SANDBOX_RUNNER ships to the
 * sandbox as a string, so nothing type-checks it and no source-text pin can tell you whether it
 * stops anything. This drives the shipped runner against served pages that reproduce, mechanism for
 * mechanism, how each live board's Submit control actually behaves.
 *
 * WHAT WAS MEASURED, 2026-09-04, read-only, on the live application form of every board this runner
 * has an adapter for, with the default-deny DOM submit guard installed verbatim, a non-GET abort net
 * in front of it, and no field ever filled. Pressing the board's own Submit control produced:
 *
 *   Greenhouse   job-boards.greenhouse.io/embed/job_app   no submit event   blockedSubmits 0
 *   Ashby        jobs.ashbyhq.com/.../application         no submit event   blockedSubmits 0
 *   Lever        jobs.lever.co/.../apply                  no submit event   blockedSubmits 0
 *   Workable     apply.workable.com/.../apply             no submit event   blockedSubmits 0
 *   Breezy       <tenant>.breezy.hr/p/.../apply           no submit event   blockedSubmits 0
 *   Recruitee    <tenant>.recruitee.com/o/.../c/new       submit event      blockedSubmits 1
 *   Rippling     ats.rippling.com/.../apply               submit event      blockedSubmits 1
 *
 * SmartRecruiters could not be measured: its apply route answers 403 from a bot-detection
 * challenge, and this project does not defeat those.
 *
 * The four shapes below are those seven boards reduced to what actually differs. The page is a
 * local fixture, never an employer's, and the "employer" origin is the one hostname the replay shim
 * already maps to loopback.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const providerDeadlineAt = () => new Date(Date.now() + 240_000).toISOString();

/* THE FOUR MECHANISMS, and which live boards each one stands for.
 *
 * 1. cancelled-click  Greenhouse, Workable. A button[type=submit] inside a real form whose click
 *    handler calls preventDefault() and posts itself. Implicit submission never happens, so no
 *    submit event is ever dispatched and the DOM guard has nothing to see.
 * 2. formless         Ashby. No form element anywhere on the page. There is no node a submit event
 *    could be dispatched at, and the live board's press went straight to its real filing operation
 *    on an EMPTY form with no validation in front of it.
 * 3. plain-button     Lever (#btn-submit), Breezy. type="button" inside a form: no activation
 *    behaviour to intercept, so again no event.
 * 4. native-submit    Recruitee, Rippling. A real submit control with no interception. This is the
 *    one shape the DOM guard already caught, and it must keep catching it.
 */
const fixture = `<!doctype html><meta charset="utf-8"><title>Submit Floor Fixture</title>
<div id="log">idle</div>
<div id="submit-events">0</div>

<!-- 1. cancelled-click: Greenhouse / Workable -->
<form id="cancelled-form" method="get" action="/cancelled-form-action">
  <input id="cancelled-name" name="name">
  <button id="cancelled-submit" type="submit">Submit application</button>
</form>

<!-- 3. plain-button: Lever / Breezy -->
<form id="plain-form" method="POST">
  <input id="plain-name" name="name">
  <button id="plain-submit" type="button">SUBMIT APPLICATION</button>
</form>

<!-- 4. native-submit: Recruitee / Rippling -->
<form id="native-form" method="get" action="/native-form-action">
  <input id="native-name" name="name">
  <button id="native-submit" type="submit">Send</button>
</form>

<!-- 2. formless: Ashby. Deliberately outside every form above. -->
<button id="formless-submit">Submit Application</button>

<!-- the resume field, whose change handler posts the bytes the moment a file is attached -->
<input id="resume" type="file">

<button id="read-only-fetch" type="button">refresh options</button>
<button id="vendor-beacon" type="button">third party</button>
<script>
  var log = document.getElementById('log');
  var seen = document.getElementById('submit-events');
  /* ON WINDOW, AT CAPTURE, AND THAT IS THE WHOLE POINT. The guard's own listener is a capture
   * listener on document that calls stopImmediatePropagation, so a second document listener could
   * be silenced by it and would prove nothing about whether an event was dispatched. Window is the
   * outermost node in the capture path, so this one runs before the guard's no matter which was
   * registered first, and a zero here really does mean no submit event existed. */
  window.addEventListener('submit', function () {
    seen.textContent = String(Number(seen.textContent) + 1);
  }, true);
  function settle(text) { log.textContent = text; log.setAttribute('data-settled', '1'); }
  function fileApplication(via) {
    log.textContent = 'posting:' + via;
    return fetch('/apply', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ via: via, name: 'Applicant' })
    }).then(function () { settle('posted:' + via); })
      .catch(function (error) { settle('refused:' + via + ':' + String(error.message || error)); });
  }
  document.getElementById('cancelled-submit').addEventListener('click', function (event) {
    event.preventDefault();
    fileApplication('cancelled-click');
  });
  document.getElementById('plain-submit').addEventListener('click', function () {
    fileApplication('plain-button');
  });
  document.getElementById('formless-submit').addEventListener('click', function () {
    fileApplication('formless');
  });
  document.getElementById('resume').addEventListener('change', function () {
    // Greenhouse, Ashby and Breezy all upload eagerly on change, long before any submit control is
    // pressed. Attaching a document is not filing an application.
    log.textContent = 'uploading';
    fetch('/upload', { method: 'POST', body: 'resume-bytes' })
      .then(function () { settle('uploaded'); })
      .catch(function (error) { settle('upload-refused:' + String(error.message || error)); });
  });
  document.getElementById('read-only-fetch').addEventListener('click', function () {
    fetch('/options').then(function (r) { return r.text(); })
      .then(function (t) { settle('options:' + t); })
      .catch(function (error) { settle('options-refused:' + String(error.message || error)); });
  });
  document.getElementById('vendor-beacon').addEventListener('click', function () {
    fetch(window.__vendorOrigin + '/vendor-event', { method: 'POST', body: 'seen' })
      .then(function () { settle('vendor-posted'); })
      .catch(function (error) { settle('vendor-refused:' + String(error.message || error)); });
  });
</script>`;

/* The employer's own server. Every write-shaped request it receives is recorded, because the
 * question these cases answer is not "was a counter incremented" but "did anything reach the
 * employer". */
const employerWrites = [];
const employerReads = [];
const employerServer = http.createServer((request, response) => {
  const method = request.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    if (request.url.startsWith('/options')) {
      employerReads.push(request.url);
      response.writeHead(200, { 'content-type': 'text/plain', connection: 'close' });
      response.end('fresh');
      return;
    }
    if (request.url.startsWith('/cancelled-form-action') || request.url.startsWith('/native-form-action')) {
      // A native GET submission would land here. Recorded as a write: it carries the form's values.
      employerWrites.push({ method, url: request.url });
      response.writeHead(200, { 'content-type': 'text/html', connection: 'close' });
      response.end('<!doctype html><title>navigated</title>');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    response.end(fixture.replace('<script>', `<script>window.__vendorOrigin = ${JSON.stringify(vendorOrigin())};`));
    return;
  }
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    employerWrites.push({ method, url: request.url, body: Buffer.concat(chunks).toString().slice(0, 200) });
    response.writeHead(200, { 'content-type': 'application/json', connection: 'close' });
    response.end('{"ok":true}');
  });
});

/* A different registrable site, so it is genuinely third party to the runner's own test:
 * 127.0.0.1 reduces to "0.1" and the employer origin reduces to "greenhouse.io". A fill run does
 * not block third-party transport today and this change does not start. */
const vendorWrites = [];
const vendorServer = http.createServer((request, response) => {
  const chunks = [];
  request.on('data', (chunk) => chunks.push(chunk));
  request.on('end', () => {
    if (request.method.toUpperCase() !== 'GET') vendorWrites.push(request.url);
    response.writeHead(200, { 'access-control-allow-origin': '*', connection: 'close' });
    response.end('ok');
  });
});
let vendorPort = 0;
function vendorOrigin() { return `http://127.0.0.1:${vendorPort}`; }

await new Promise((resolve) => employerServer.listen(0, '127.0.0.1', resolve));
await new Promise((resolve) => vendorServer.listen(0, '127.0.0.1', resolve));
vendorPort = vendorServer.address().port;
// The one hostname test/managed-runner-shim.cjs already maps to loopback, so the runner sees a real
// employer registrable site rather than an IP literal.
const base = `http://job-boards.greenhouse.io:${employerServer.address().port}/`;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-submit-floor-'));
fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);

/* MUTANTS. Every gate below is verified by shimming one helper to a constant or to identity in a
 * SEPARATE copy of the shipped runner, then asserting the case's outcome flips. Deleting the gate
 * would prove nothing: a deleted branch can fail for a syntax reason. A gate replaced by a constant
 * still runs, still returns, and still type-checks, so a mutant that keeps the test green means the
 * gate was never load-bearing. */
const mutants = {
  /* Reproduces the defect this floor exists for: the run keeps the DOM submit guard and loses
   * nothing else. Every cancelled-click, formless and plain-button case must go back to reporting
   * blockedSubmits 0 while the application reaches the employer. */
  floorNeverInstalled: [
    ['const submitTransportFloorRequired = input.allowSubmit !== true',
     'const submitTransportFloorRequired = false && input.allowSubmit !== true']
  ],
  // The employer-bound discriminator answers "no" for everything, so the floor stops aborting.
  everythingIsThirdParty: [
    ['const employerBoundTransport = (request) => {',
     'const employerBoundTransport = (request) => { if (true) return false;']
  ],
  // The floor still aborts, but the result stops carrying its count.
  countNotReported: [
    ['+ (submitTransportFloor?.blockedAttemptCount || 0)', '+ 0']
  ],
  // The upload window never opens, so the board's own eager resume POST is aborted and counted.
  uploadWindowNeverArms: [
    ['armed.uploadActionArmed = true;', 'armed.uploadActionArmed = false;']
  ]
};
for (const [name, edits] of Object.entries(mutants)) {
  let source = SANDBOX_RUNNER;
  for (const [from, to] of edits) {
    assert.equal(source.split(from).length - 1, 1,
      `mutant ${name} must match its anchor exactly once: ${from}`);
    source = source.replace(from, to);
  }
  fs.writeFileSync(path.join(workDir, `stratus-runner-${name}.cjs`), source);
}

let runIndex = 0;
async function replay(actions, options = {}, { runner = 'stratus-runner.cjs' } = {}) {
  runIndex += 1;
  employerWrites.length = 0;
  employerReads.length = 0;
  vendorWrites.length = 0;
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    providerDeadlineAt: providerDeadlineAt(),
    url: base,
    actions,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    ...options
  }));
  fs.rmSync(path.join(workDir, 'stratus-result-0.json'), { force: true });
  const { status, stderr } = await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), runner], {
      cwd: workDir,
      env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
    });
    let captured = '';
    child.stderr.on('data', (chunk) => { captured += chunk; });
    child.stdout.resume();
    child.on('close', (code) => resolve({ status: code, stderr: captured }));
  });
  assert.equal(status, 0, `runner exited ${status}: ${stderr.split('\n').slice(0, 4).join(' ')}`);
  const result = JSON.parse(fs.readFileSync(path.join(workDir, 'stratus-result-0.json'), 'utf8'));
  return {
    result,
    // Only the filing endpoint. An upload or a form navigation is recorded separately.
    filings: employerWrites.filter((entry) => entry.url.startsWith('/apply')),
    employerWrites: [...employerWrites],
    employerReads: [...employerReads],
    vendorWrites: [...vendorWrites]
  };
}

const valueOf = (result, selector) => result.extracted.find((entry) => entry.selector === selector)?.value;
/* The page marks #log settled once its own post has resolved or been refused, so the extract reads
 * a decided outcome rather than racing it. Optional, because the native-submit shape never starts a
 * request at all and must not fail the run for it. */
const press = (selector) => [
  { type: 'click', selector, optional: false },
  { type: 'waitForSelector', selector: '#log[data-settled]', timeout: 4000, optional: true },
  { type: 'extract', selector: '#log' },
  { type: 'extract', selector: '#submit-events' }
];

// 1 to 3: THE THREE SHAPES THE DOM GUARD CANNOT SEE.
for (const shape of [
  { name: 'cancelled-click (Greenhouse, Workable)', selector: '#cancelled-submit', via: 'cancelled-click' },
  { name: 'formless (Ashby)', selector: '#formless-submit', via: 'formless' },
  { name: 'plain-button (Lever, Breezy)', selector: '#plain-submit', via: 'plain-button' }
]) {
  const pressed = await replay(press(shape.selector));
  assert.equal(pressed.filings.length, 0,
    `${shape.name}: the application must not reach the employer, got ` + JSON.stringify(pressed.filings));
  assert.equal(pressed.result.blockedSubmits, 1,
    `${shape.name}: the run must report exactly one stopped submission, got ` + pressed.result.blockedSubmits);
  /* No submit event was dispatched anywhere, which is exactly why the DOM guard is blind to these
   * three shapes on the live boards. Measured on window at capture, above the guard's own listener,
   * so this is the absence of an event and not an event the guard silenced. */
  assert.equal(valueOf(pressed.result, '#submit-events'), '0',
    `${shape.name}: this shape must dispatch no submit event at all`);
  assert.match(String(valueOf(pressed.result, '#log')), /^refused:/,
    `${shape.name}: the page's own post must have been refused, got ` + valueOf(pressed.result, '#log'));

  /* MUTANT: the floor is never installed. This is the shipped behaviour before this change, and it
   * is what the 2026-09-04 sweep measured on the live boards. */
  const withoutFloor = await replay(press(shape.selector), {}, { runner: 'stratus-runner-floorNeverInstalled.cjs' });
  assert.equal(withoutFloor.result.blockedSubmits, 0,
    `${shape.name}: without the floor the counter must go back to reading zero`);
  assert.equal(withoutFloor.filings.length, 1,
    `${shape.name}: without the floor the application must actually reach the employer`);

  // MUTANT: employer-bound answers "no" for every request, so nothing is aborted or counted.
  const allThirdParty = await replay(press(shape.selector), {}, { runner: 'stratus-runner-everythingIsThirdParty.cjs' });
  assert.equal(allThirdParty.result.blockedSubmits, 0, `${shape.name}: employer-bound gate must be load-bearing`);
  assert.equal(allThirdParty.filings.length, 1, `${shape.name}: employer-bound gate must be what aborts`);

  // MUTANT: the floor still aborts, but its count stops reaching the result.
  const unreported = await replay(press(shape.selector), {}, { runner: 'stratus-runner-countNotReported.cjs' });
  assert.equal(unreported.filings.length, 0, `${shape.name}: the abort is independent of the report`);
  assert.equal(unreported.result.blockedSubmits, 0,
    `${shape.name}: blockedSubmits must be the line that carries the floor's count`);
}

// 4: THE SHAPE THE DOM GUARD ALREADY CAUGHT MUST KEEP BEING CAUGHT.
{
  const pressed = await replay(press('#native-submit'));
  assert.equal(pressed.result.blockedSubmits, 1,
    'native submit: the DOM guard must still stop and count it, got ' + pressed.result.blockedSubmits);
  assert.equal(pressed.employerWrites.length, 0,
    'native submit: nothing may reach the employer, got ' + JSON.stringify(pressed.employerWrites));
  // And here an event really was dispatched, which is the difference from the three shapes above.
  assert.equal(valueOf(pressed.result, '#submit-events'), '1',
    'native submit: this shape must dispatch exactly one submit event');
  /* And it is the DOM guard, not the floor, that catches this one: with the floor removed entirely
   * the count is unchanged, because a prevented native submission never becomes a request. */
  const withoutFloor = await replay(press('#native-submit'), {}, { runner: 'stratus-runner-floorNeverInstalled.cjs' });
  assert.equal(withoutFloor.result.blockedSubmits, 1,
    'native submit: this shape is the DOM guard\'s, and must not depend on the floor');
  assert.equal(withoutFloor.employerWrites.length, 0, 'native submit: still nothing reaches the employer');
}

/* 5: THE FLOOR IS NARROWER THAN A BLANKET NON-GET BLOCK, which is the whole reason it is not one.
 * Greenhouse's uploader POSTs the resume the instant it is attached. Blocking that breaks the single
 * most important field, so the armed upload window has to admit it, and admitting it must not read
 * as an attempted filing. */
{
  const uploaded = await replay([
    {
      type: 'upload',
      selector: '#resume',
      label: 'resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    },
    { type: 'waitForSelector', selector: '#log[data-settled]', timeout: 4000, optional: true },
    { type: 'extract', selector: '#log' }
  ]);
  assert.deepEqual(
    uploaded.employerWrites.map((entry) => entry.url),
    ['/upload'],
    'the eager resume upload must reach the employer, got ' + JSON.stringify(uploaded.employerWrites)
  );
  assert.equal(uploaded.result.blockedSubmits, 0,
    'attaching a document is not filing an application, got ' + uploaded.result.blockedSubmits);
  assert.equal(valueOf(uploaded.result, '#log'), 'uploaded');

  // MUTANT: the upload window never opens. The bytes are aborted and the run reports a filing.
  const unarmed = await replay([
    {
      type: 'upload',
      selector: '#resume',
      label: 'resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    },
    { type: 'waitForSelector', selector: '#log[data-settled]', timeout: 4000, optional: true },
    { type: 'extract', selector: '#log' }
  ], {}, { runner: 'stratus-runner-uploadWindowNeverArms.cjs' });
  assert.equal(unarmed.employerWrites.length, 0, 'the upload window must be what admits the bytes');
  assert.equal(unarmed.result.blockedSubmits, 1, 'without its window the upload is counted as a filing');
}

// 6: A THIRD-PARTY BEACON IS NOT A SUBMISSION AND MUST NOT BE COUNTED.
{
  const beaconed = await replay(press('#vendor-beacon'));
  assert.equal(beaconed.result.blockedSubmits, 0,
    'a third-party POST must not read as a stopped submission, got ' + beaconed.result.blockedSubmits);
  assert.deepEqual(beaconed.vendorWrites, ['/vendor-event'],
    'a fill run does not block third-party transport today and must not start');
  assert.equal(beaconed.filings.length, 0);
}

// 7: A READ IS STILL A READ. The floor must not touch GET, or every board that fetches its options
// after load would report a submission it never attempted.
{
  const read = await replay(press('#read-only-fetch'));
  assert.equal(read.result.blockedSubmits, 0, 'a GET must not be counted, got ' + read.result.blockedSubmits);
  assert.deepEqual(read.employerReads, ['/options'], 'the employer-bound GET must still be served');
  assert.equal(valueOf(read.result, '#log'), 'options:fresh');
}

/* 8: THE ARMING LITERAL. The floor is armed by exactly the same value the DOM guard is armed by, so
 * a run that WAS asked to submit still posts, and still reports zero. */
{
  const allowed = await replay(press('#cancelled-submit'), { allowSubmit: true });
  assert.equal(allowed.result.blockedSubmits, 0, 'an authorized run reports nothing stopped');
  assert.equal(allowed.filings.length, 1, 'an authorized run may reach the employer');
  // And every non-literal stays denied, the same way allowSubmit itself does.
  for (const notTrue of ['true', 1, {}]) {
    const denied = await replay(press('#cancelled-submit'), { allowSubmit: notTrue });
    assert.equal(denied.result.blockedSubmits, 1,
      `allowSubmit ${JSON.stringify(notTrue)} must not arm the submit path`);
    assert.equal(denied.filings.length, 0,
      `allowSubmit ${JSON.stringify(notTrue)} must not let an application through`);
  }
}

employerServer.close();
vendorServer.close();
console.log('submit floor replay: ok');
