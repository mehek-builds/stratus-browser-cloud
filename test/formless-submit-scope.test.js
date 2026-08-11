/* THE SUBMIT CHOOSER, RUN AGAINST PRODUCTION-SHAPED ATS DOM INSTEAD OF READ AS A STRING.
 *
 * The only coverage this chooser had was `assert.match(SANDBOX_RUNNER, /confirmAndSubmitPass/)`,
 * which asserts that a name appears in a string. It cannot catch a chooser that finds nothing and
 * throws, and it did not.
 *
 * Measured on the live kos.ai Ashby application page on 2026-08-11:
 *
 *   document.querySelectorAll('form').length   0
 *   input elements                             4, plus 1 textarea and 2 input[type=file]
 *   Submit Application button                  visible, enabled, final intent, NO form ancestor
 *   its ancestor chain                         button -> div#form -> div.ashby-job-posting-right-pane
 *
 * The viability filter required element.closest('form'), so the viable list was empty on every
 * Ashby application and the pass threw "Atomic submit control was missing or ambiguous" before any
 * click. Meanwhile the live Haize Labs Greenhouse page has exactly 1 form and must keep behaving
 * as it does today.
 *
 * Half of these cases exist because a first attempt at the fix was wrong in ways only a served
 * page could show: a container scope that competed with a real form let a header "Apply Now"
 * outscore an in-form "Submit" and take the click, and an innermost container smaller than the
 * application clicked with a required question elsewhere on the page still empty. Both are pinned
 * below.
 *
 * Every test spawns the shipped runner against a served page and asserts on what happened: which
 * button was pressed, how many times, and which node the pass bound as its scope. Nothing here
 * matches on runner source text.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ATOMIC_SUBMIT_POLICY, SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const HELPERS = `
  function attach(id) {
    var transfer = new DataTransfer();
    transfer.items.add(new File(['resume'], 'resume.pdf', { type: 'application/pdf' }));
    document.getElementById(id).files = transfer.files;
  }
  function record(who) {
    var log = document.getElementById('submitted');
    log.textContent = log.textContent ? log.textContent + ',' + who : who;
    navigator.sendBeacon('/record-click?who=' + who);
  }`;

/* The formless Ashby shape: a plain div#form holding every control, no <form> element anywhere on
 * the page, and the submit button as a sibling of the fields inside that div. */
const ASHBY = `<!doctype html><meta charset="utf-8"><title>Formless Ashby application</title>
<div id="root"><div class="_container_dea4p_28"><div class="_content_dea4p_70">
<div class="ashby-job-posting-right-pane">
<div id="form">
  <div class="field"><label for="name">Full name *</label><input id="name" required value="Mehek Mandal"></div>
  <div class="field"><label for="email">Email *</label><input id="email" type="email" required value="mehek@example.com"></div>
  <div class="field"><label for="phone">Phone *</label><input id="phone" type="tel" required value="+971501234567"></div>
  <div class="field"><label for="linkedin">LinkedIn</label><input id="linkedin" value="https://www.linkedin.com/in/mehek"></div>
  <div class="field"><label for="why">Why this role? *</label><textarea id="why" required>Because it fits.</textarea></div>
  <div class="field"><label for="resume">Resume *</label><input id="resume" type="file" required></div>
  <div class="field"><label for="cover">Cover letter</label><input id="cover" type="file"></div>
  <button id="submit" class="_button_zyh3g_28 _primary_zyh3g_97">Submit Application</button>
</div>
</div></div></div>
<div id="submitted"></div>
<script>${HELPERS}
  attach('resume');
  document.getElementById('submit').addEventListener('click', function () { record('ashby'); });
</script>`;

/* The Greenhouse shape: one real form, plus the top-of-page Apply button that sits outside it. */
const GREENHOUSE = `<!doctype html><meta charset="utf-8"><title>Greenhouse application</title>
<div id="page">
  <div id="header"><h1>Software Engineering Intern</h1><button id="decoy">Apply</button></div>
  <form id="application" novalidate>
    <div class="field"><label for="gh-name">Full name *</label><input id="gh-name" required value="Mehek Mandal"></div>
    <div class="field"><label for="gh-email">Email *</label><input id="gh-email" type="email" required value="mehek@example.com"></div>
    <div class="field"><label for="gh-resume">Resume *</label><input id="gh-resume" type="file" required></div>
    <button id="submit" type="submit">Submit application</button>
  </form>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  attach('gh-resume');
  document.getElementById('decoy').addEventListener('click', function () { record('decoy'); });
  document.getElementById('application').addEventListener('submit', function (event) {
    event.preventDefault();
    record('greenhouse');
  });
</script>`;

/* THE OUTSCORING DECOY. The real submit is labelled "Submit", which is what SmartRecruiters,
 * Workday and Paylocity actually render, and it scores 1. The sticky header "Apply Now" scores 2
 * and has no form, but its walk climbs out of the header into the wrapper that also holds the
 * form's inputs. If a container may compete with a form, the decoy wins on score and the run
 * presses the wrong control on a real employer form. */
const OUTSCORING_DECOY = `<!doctype html><meta charset="utf-8"><title>Header apply over a real form</title>
<div id="wrapper">
  <div id="header"><button id="decoy">Apply Now</button></div>
  <form id="application" novalidate>
    <div class="field"><label for="d-name">Full name *</label><input id="d-name" required value="Mehek Mandal"></div>
    <div class="field"><label for="d-email">Email *</label><input id="d-email" type="email" required value="mehek@example.com"></div>
    <button id="submit" type="submit">Submit</button>
  </form>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('decoy').addEventListener('click', function () { record('decoy'); });
  document.getElementById('application').addEventListener('submit', function (event) {
    event.preventDefault();
    record('real');
  });
</script>`;

/* No form, and no qualifying ancestor either: the fields and the button are direct children of
 * body, so the only container that holds both is body itself. That is not a scope. */
const BODY_ONLY = `<!doctype html><meta charset="utf-8"><title>Body scope only</title>
<label for="name">Full name *</label><input id="name" required value="Mehek Mandal">
<label for="email">Email *</label><input id="email" type="email" required value="mehek@example.com">
<button id="submit">Submit Application</button>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('submit').addEventListener('click', function () { record('body'); });
</script>`;

/* Two controls with identical text inside the same formless container. Equal top score is the
 * ambiguity rule's exact trigger, and the container scope must not weaken it. */
const AMBIGUOUS = `<!doctype html><meta charset="utf-8"><title>Ambiguous formless</title>
<div id="root"><div id="form">
  <div class="field"><label for="name">Full name *</label><input id="name" required value="Mehek Mandal"></div>
  <div class="field"><label for="resume">Resume *</label><input id="resume" type="file" required></div>
  <button id="submit-a">Submit Application</button>
  <button id="submit-b">Submit Application</button>
</div></div>
<div id="submitted"></div>
<script>${HELPERS}
  attach('resume');
  document.getElementById('submit-a').addEventListener('click', function () { record('a'); });
  document.getElementById('submit-b').addEventListener('click', function () { record('b'); });
</script>`;

/* THE UNDER-SCOPED CONTAINER. The submit sits in a final section with the consent field, and the
 * employer's work authorisation question is one level up and empty. The innermost container holds
 * a field, so it qualifies on that test alone, and binding it would scan one answered checkbox and
 * click an incomplete application. */
const NESTED = `<!doctype html><meta charset="utf-8"><title>Nested under-scope</title>
<div id="outer">
  <div class="field"><label for="work">Work authorisation *</label><input id="work" required value=""></div>
  <div id="inner">
    <div class="field"><label for="consent">I agree *</label><input id="consent" required value="Yes"></div>
    <button id="submit">Submit Application</button>
  </div>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('submit').addEventListener('click', function () { record('nested'); });
</script>`;

/* The submit lives in a footer bar that holds no fields at all, so the nearest ancestor holding a
 * field is the wrapper above both. Nothing else on the page is required, so the wrapper is the
 * application and the run may press it. */
const FOOTER_BAR = `<!doctype html><meta charset="utf-8"><title>Submit outside the field container</title>
<div id="page">
  <div id="fields">
    <div class="field"><label for="f-name">Full name *</label><input id="f-name" required value="Mehek Mandal"></div>
    <div class="field"><label for="f-email">Email *</label><input id="f-email" type="email" required value="mehek@example.com"></div>
  </div>
  <div id="footer-bar"><button id="submit">Submit Application</button></div>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('submit').addEventListener('click', function () { record('footer'); });
</script>`;

/* The same shape with page furniture that is itself required and formless. The wrapper is the only
 * ancestor of the submit that holds fields, so the furniture is inside the bound scope and the
 * scan reports it. That is not a good outcome and it is the honest one: nothing in a formless DOM
 * says whether a required field beside the application belongs to it. The rule this pins is that
 * the run withholds the click rather than sending an application it cannot account for. */
const FOOTER_BAR_FURNITURE = `<!doctype html><meta charset="utf-8"><title>Furniture inside the wrapper</title>
<div id="page">
  <div id="fields">
    <div class="field"><label for="f-name">Full name *</label><input id="f-name" required value="Mehek Mandal"></div>
  </div>
  <div id="alerts">
    <div class="field"><label for="alert-email">Job alert email *</label><input id="alert-email" required value=""></div>
  </div>
  <div id="footer-bar"><button id="submit">Submit Application</button></div>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('submit').addEventListener('click', function () { record('furniture'); });
</script>`;

/* THE BAMBOOHR SHAPE: a formless application sitting beside a real <form> that is not an
 * application at all. The newsletter's email is required, and it must not veto the application,
 * because it belongs to its own form's submission. Its Subscribe button is not a final control, so
 * the form path finds nothing and the container path is still allowed to run. */
const SIBLING_FORM = `<!doctype html><meta charset="utf-8"><title>Formless application beside a real form</title>
<div id="page">
  <form id="newsletter">
    <div class="field"><label for="alerts">Job alert email *</label><input id="alerts" type="email" required value=""></div>
    <button id="subscribe" type="submit">Subscribe</button>
  </form>
  <div id="app-form">
    <div class="field"><label for="b-name">Full name *</label><input id="b-name" required value="Mehek Mandal"></div>
    <div class="field"><label for="b-email">Email *</label><input id="b-email" type="email" required value="mehek@example.com"></div>
    <div class="field"><label for="b-resume">Resume *</label><input id="b-resume" type="file" required></div>
    <button id="submit">Submit Application</button>
  </div>
  <div id="search"><input id="site-search" type="search" placeholder="Search jobs"></div>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  attach('b-resume');
  document.getElementById('submit').addEventListener('click', function () { record('bamboo'); });
  document.getElementById('newsletter').addEventListener('submit', function (event) {
    event.preventDefault();
    record('subscribe');
  });
</script>`;

/* An empty required field inside the container, and an unrelated block outside it carrying a live
 * validation error over a field that is not required. Only the first belongs to this application. */
const SCAN_BOUNDS = `<!doctype html><meta charset="utf-8"><title>Container scope bounds</title>
<div id="page">
  <div id="app-form">
    <div class="field"><label for="s-name">Full name *</label><input id="s-name" required value=""></div>
    <button id="submit">Submit Application</button>
  </div>
  <div id="aside">
    <div class="field"><label for="aside-note">Newsletter</label><input id="aside-note" aria-invalid="true" value="x"><span>This requires an answer</span></div>
  </div>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('submit').addEventListener('click', function () { record('scan-bounds'); });
</script>`;

/* THE RETAINED PAGE, TWICE. Phase zero binds a scope inside a shadow root. Phase one runs on the
 * same live Page after the DOM has moved on, and the candidate index that addressed the shadow
 * scope now addresses a light-DOM one. A marker left behind inside the shadow tree makes that
 * index match two nodes and throws for the rest of the session. */
const SHADOW = `<!doctype html><meta charset="utf-8"><title>Shadow scope across two passes</title>
<div id="host"></div>
<div id="light">
  <div class="field"><label for="l-name">Full name *</label><input id="l-name" required value="Mehek Mandal"></div>
  <button id="l-submit">Continue</button>
</div>
<button id="mutate">Refresh listing</button>
<div id="submitted"></div>
<script>${HELPERS}
  var root = document.getElementById('host').attachShadow({ mode: 'open' });
  root.innerHTML = '<div id="s-form"><div class="field"><label for="s-name">Full name *</label>'
    + '<input id="s-name" required value="Mehek Mandal"></div>'
    + '<button id="s-submit">Submit Application</button></div>';
  root.getElementById('s-submit').addEventListener('click', function () { record('shadow'); });
  document.getElementById('l-submit').addEventListener('click', function () { record('light'); });
  document.getElementById('mutate').addEventListener('click', function () {
    var shadowSubmit = root.getElementById('s-submit');
    if (shadowSubmit) shadowSubmit.remove();
    document.getElementById('l-submit').textContent = 'Submit Application';
  });
</script>`;

const FIXTURES = {
  '/ashby': ASHBY,
  '/greenhouse': GREENHOUSE,
  '/outscoring-decoy': OUTSCORING_DECOY,
  '/body-only': BODY_ONLY,
  '/ambiguous': AMBIGUOUS,
  '/nested': NESTED,
  '/footer-bar': FOOTER_BAR,
  '/footer-bar-furniture': FOOTER_BAR_FURNITURE,
  '/sibling-form': SIBLING_FORM,
  '/scan-bounds': SCAN_BOUNDS,
  '/shadow': SHADOW
};

const clicks = [];
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/record-click') {
    clicks.push(url.searchParams.get('who'));
    response.writeHead(204, { connection: 'close' });
    response.end();
    return;
  }
  const body = FIXTURES[url.pathname];
  if (!body) {
    response.writeHead(404, { connection: 'close' });
    response.end('no fixture');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
  response.end(body);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-formless-scope-'));
fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);

const submitAction = {
  type: 'confirmAndSubmit',
  selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
  chooserPolicy: ATOMIC_SUBMIT_POLICY,
  label: 'final_submit',
  optional: false,
  maxRetries: 1,
  contractVersion: 2,
  submitKind: 'application'
};

const resultPath = (phase) => path.join(workDir, 'stratus-result-' + phase + '.json');
const readResult = (phase) => (fs.existsSync(resultPath(phase))
  ? JSON.parse(fs.readFileSync(resultPath(phase), 'utf8'))
  : null);

function writeInput(fixture, extras, overrides) {
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: `http://127.0.0.1:${server.address().port}${fixture}`,
    actions: [submitAction, { type: 'extract', selector: '#submitted' }, ...extras],
    allowSubmit: true,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    ...overrides
  }));
}

function startRunner() {
  const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'], {
    cwd: workDir,
    env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
  });
  child.stderr.resume();
  child.stdout.resume();
  return child;
}

/** Runs the shipped runner against one fixture. Returns the exit code and the result file if any. */
async function run(fixture, extras = []) {
  clicks.length = 0;
  writeInput(fixture, extras, {});
  fs.rmSync(resultPath(0), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
  const status = await new Promise((resolve) => startRunner().on('close', resolve));
  return { status, result: readResult(0), clicks: [...clicks] };
}

const valueOf = (result, selector) => result.extracted.find((entry) => entry.selector === selector)?.value;

test.after(() => { server.close(); fs.rmSync(workDir, { recursive: true, force: true }); });

test('a formless Ashby application binds the field container and submits exactly once', async () => {
  const { status, result, clicks: recorded } = await run('/ashby', [
    { type: 'extract', selector: '#form', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#root', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '.ashby-job-posting-right-pane', attribute: 'data-litos-submit-scope-v2' }
  ]);
  assert.equal(status, 0, 'the run must not abort on a page with no form element');
  assert.deepEqual(recorded, ['ashby'], 'the submit control is pressed exactly once');
  assert.equal(valueOf(result, '#submitted'), 'ashby');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(result.submitOutcome.pressed, true);
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.equal(pass.submissionOutcome, 'clicked');
  assert.equal(pass.scope.scopeKind, 'container');
  assert.equal(pass.scope.sameNode, true);
  assert.deepEqual(pass.unresolved, []);
  // The nearest ancestor holding field controls is div#form, not the pane above it and not the root.
  assert.equal(valueOf(result, '#form'), '0');
  assert.equal(valueOf(result, '.ashby-job-posting-right-pane'), null);
  assert.equal(valueOf(result, '#root'), null);
});

test('the Greenhouse shape still binds its real form and ignores the Apply button outside it', async () => {
  const { status, result, clicks: recorded } = await run('/greenhouse', [
    { type: 'extract', selector: '#application', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#page', attribute: 'data-litos-submit-scope-v2' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, ['greenhouse'], 'the in-form submit is pressed, and the decoy never is');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.equal(pass.scope.scopeKind, 'form', 'a form ancestor still wins outright');
  assert.equal(pass.submissionOutcome, 'clicked');
  assert.equal(valueOf(result, '#application'), '1', 'candidate 1 is the in-form submit');
  // The decoy resolves no scope at all on a page that has a viable in-form candidate, so nothing
  // above the form is ever a submission scope.
  assert.equal(valueOf(result, '#page'), null);
});

test('a header Apply Now cannot outscore the real in-form Submit', async () => {
  const { status, result, clicks: recorded } = await run('/outscoring-decoy', [
    { type: 'extract', selector: '#application', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#wrapper', attribute: 'data-litos-submit-scope-v2' }
  ]);
  assert.equal(status, 0);
  // "Apply Now" scores 2 and "Submit" scores 1, so score alone would press the wrong control.
  assert.deepEqual(recorded, ['real'], 'the form submit is pressed and the header decoy is not');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(result.requiredFieldConfirmation.passes[0].scope.scopeKind, 'form');
  assert.equal(valueOf(result, '#application'), '1');
  assert.equal(valueOf(result, '#wrapper'), null, 'the wrapper is never a scope while a form is viable');
});

test('a submit whose only container would be body fails closed and clicks nothing', async () => {
  const { status, result, clicks: recorded } = await run('/body-only');
  assert.notEqual(status, 0, 'no scope means no submit, and the run stops');
  assert.equal(result, null, 'a failed pass writes no result packet');
  assert.deepEqual(recorded, [], 'nothing on the page may be pressed');
});

test('two equally scored final controls in one container stay ambiguous and click nothing', async () => {
  const { status, result, clicks: recorded } = await run('/ambiguous');
  assert.notEqual(status, 0, 'an equal top-score tie must fail closed on a formless page too');
  assert.equal(result, null);
  assert.deepEqual(recorded, [], 'neither candidate may be pressed');
});

test('a container smaller than the application refuses rather than clicking past a required field', async () => {
  const { status, result, clicks: recorded } = await run('/nested');
  assert.notEqual(status, 0, 'a required field outside the container is unresolvable, not ignorable');
  assert.equal(result, null);
  assert.deepEqual(recorded, [], 'the empty work authorisation question withholds the click');
});

test('a submit outside the field container binds the wrapper that holds both', async () => {
  const { status, result, clicks: recorded } = await run('/footer-bar', [
    { type: 'extract', selector: '#page', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#footer-bar', attribute: 'data-litos-submit-scope-v2' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, ['footer'], 'a footer submit over a complete form still sends once');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.equal(pass.scope.scopeKind, 'container');
  assert.equal(pass.scope.requiredControlCount, 2, 'both application fields are in scope');
  assert.equal(valueOf(result, '#page'), '0');
  assert.equal(valueOf(result, '#footer-bar'), null, 'a box with no fields is not a scope');
});

test('required page furniture inside the bound wrapper withholds the click', async () => {
  const { status, result, clicks: recorded } = await run('/footer-bar-furniture');
  assert.equal(status, 0);
  assert.deepEqual(recorded, [], 'an unexplained required field in scope is never clicked past');
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.submitOutcome.pressed, false);
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.equal(pass.submissionOutcome, 'blocked');
  assert.ok(pass.unresolved.some((entry) => /Job alert email/.test(entry)), 'and it says what stopped it');
});

test('a real form beside a formless application does not veto that application', async () => {
  const { status, result, clicks: recorded } = await run('/sibling-form', [
    { type: 'extract', selector: '#app-form', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#newsletter', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#alerts', attribute: 'value' }
  ]);
  assert.equal(status, 0);
  // The newsletter's email is required and empty, but it belongs to its own form's submission.
  assert.deepEqual(recorded, ['bamboo'], 'the application is sent and Subscribe is never pressed');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.equal(pass.scope.scopeKind, 'container');
  assert.equal(pass.scope.requiredControlCount, 3, 'only the application fields are scanned');
  // Subscribe is candidate 0 and resolves its own form, which is exactly why it does not disable
  // the container path: it is not a final control, so the form rule finds nothing to submit here.
  assert.equal(valueOf(result, '#newsletter'), '0');
  assert.equal(valueOf(result, '#app-form'), '1');
  assert.equal(valueOf(result, '#alerts'), '', 'the newsletter field is untouched');
});

test('the container scope bounds the required-field scan to its own fields', async () => {
  // The block outside the container carries a live "This requires an answer" over a field this run
  // never filled. A scope that leaked up to the page would report it and blame the wrong form.
  const { status, result, clicks: recorded } = await run('/scan-bounds');
  assert.equal(status, 0);
  assert.deepEqual(recorded, [], 'an empty required field in scope withholds the click');
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.submitOutcome.pressed, false);
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.equal(pass.scope.scopeKind, 'container');
  assert.equal(pass.scope.requiredControlCount, 1);
  assert.equal(pass.attempts.length, 1);
  assert.match(pass.attempts[0].label || '', /Full name/);
  assert.equal(pass.attempts[0].outcome, 'failed');
  assert.ok(pass.unresolved.some((entry) => /Full name/.test(entry)), 'the in-scope field blocks');
  assert.doesNotMatch(JSON.stringify(pass.unresolved), /unmatched validation error/i, 'the aside is not this form');
  assert.doesNotMatch(JSON.stringify(pass.attempts), /Newsletter/i);
});

test('a shadow scope from an earlier pass cannot break the next pass on a retained page', async () => {
  /* Phase zero binds a scope inside the shadow root and clicks it. Phase one runs against the same
   * Page after the shadow submit is gone, so candidate index 0 now belongs to the light DOM. The
   * marker clearing has to cross the shadow boundary, because the read-back locator does: if it
   * does not, index 0 matches two nodes and every later pass on this session throws. */
  clicks.length = 0;
  fs.rmSync(resultPath(0), { force: true });
  fs.rmSync(resultPath(1), { force: true });
  const continuationInput = path.join(workDir, 'stratus-continuation-input.json');
  fs.rmSync(continuationInput, { force: true });
  fs.rmSync(path.join(workDir, 'stratus-continuation-ready.json'), { force: true });
  writeInput('/shadow', [], {
    requestContinuation: true,
    continuationCheckpoint: true,
    continuationTtlSeconds: 20,
    continuationExpiresAt: new Date(Date.now() + 20_000).toISOString()
  });
  const child = startRunner();
  const closed = new Promise((resolve) => child.on('close', resolve));
  const waitFor = async (file, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(file) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    return fs.existsSync(file);
  };
  assert.ok(await waitFor(resultPath(0)), 'phase zero must produce a result');
  const first = readResult(0);
  assert.equal(first.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(first.requiredFieldConfirmation.passes[0].scope.scopeKind, 'container');
  assert.deepEqual(clicks, ['shadow'], 'phase zero presses the control inside the shadow root');
  fs.writeFileSync(continuationInput, JSON.stringify({
    actions: [
      { type: 'click', selector: '#mutate' },
      submitAction,
      { type: 'extract', selector: '#submitted' },
      { type: 'extract', selector: '#light', attribute: 'data-litos-submit-scope-v2' }
    ],
    screenshot: false
  }));
  assert.ok(await waitFor(resultPath(1)), 'the second pass on the retained page must not throw');
  const second = readResult(1);
  assert.equal(second.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(valueOf(second, '#light'), '0', 'the light-DOM container is the only node carrying index 0');
  assert.deepEqual(clicks, ['shadow', 'light'], 'exactly one click per pass, on the current control');
  assert.equal(await closed, 0);
});
