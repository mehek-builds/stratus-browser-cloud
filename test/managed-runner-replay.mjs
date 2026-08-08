// R-100 regression: an optional action that is meant to wait must actually wait.
//
// test/managed-browser.test.js pins the SHAPE of the runner string. This runs it. SANDBOX_RUNNER
// ships to the sandbox as a string, so nothing type-checks it and nothing else in the suite ever
// executes it; the defect it covers survived several deploys precisely because every existing test
// could only read it.
//
// The replay is faithful to executeSandboxRun(): same runner string, same stratus-input.json /
// stratus-result.json file protocol, same `node stratus-runner.cjs` invocation. Only the sandbox
// and its preinstalled Playwright are replaced, by test/managed-runner-shim.cjs.
//
// The page is a local fixture, never an employer's. It reproduces the mechanism that matters:
// clicking a button renders a panel a beat later, which is what Greenhouse does when you click
// "Apply for this job". The old pre-check tested for that panel at the one instant it could not be
// there, so the run typed into a form that did not exist yet, and an optional waitForSelector
// aimed at the same panel was cancelled before its timeout ever started.
//
// Two delays on purpose, and they now show the same thing from both sides: a control that renders
// late is reached only when the caller DECLARES a wait for it. waitForSelector keeps its own
// timeout and is exempt from the pre-check; everything else keeps the instantaneous snapshot it
// always had. An earlier version of the fix also gave every optional action a 1500ms settle grace,
// which measured identically on two live Greenhouse forms while costing about 4.3s a run, so the
// grace is gone and case 2 pins what that gives up.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Late enough that the pre-check's snapshot cannot see it, which is the point: without a declared
// wait this control is skipped. Sized on the live measurement that motivated the dropped grace:
// Greenhouse's asynchronously loaded School and Discipline options arrived 563ms and 555ms late.
const QUICK_PANEL_MS = 700;
// Slower again, so only an honoured waitForSelector can reach it.
const SLOW_PANEL_MS = 2500;

const fixture = `<!doctype html><meta charset="utf-8"><title>Replay Fixture</title>
<button id="apply">Apply for this job</button>
<button id="apply-slow">Apply for this job (slow board)</button>
<div id="quick-panel"></div>
<div id="slow-panel"></div>
<div id="email-echo"></div>
<div id="slow-email-echo"></div>
<label for="start_month">Start month</label>
<select id="start_month"><option value=""></option><option value="5">May</option></select>
<input id="plain" type="text">
<input id="aimed" type="text">
<div id="combo-shell"><input id="combo" role="combobox" aria-expanded="false"></div>
<div id="keytarget"></div>
<!-- novalidate deliberately: with the browser's own required-field validation on, an empty required
     input stops the form submitting all by itself, and a gate that did nothing would look like a
     gate that worked. Turning it off leaves the gate as the only thing between the click and the
     submission, which is what is being tested. Greenhouse validates in JavaScript, not natively. -->
<form id="app-form" novalidate>
  <div class="field"><label for="req_name">Full name</label><input id="req_name" type="text" required></div>
  <div class="field"><label for="req_email">Email</label><input id="req_email" type="text" required></div>
  <!-- R-103, reproduced: Greenhouse puts the phone number and its country React Select in ONE
       fieldset, so the country's rendered "+971" used to make the whole block read as answered and
       an empty required number invisible to the gate. -->
  <fieldset class="phone-input">
    <label for="req_phone">Phone</label>
    <div class="select__container">
      <div class="select__single-value">+971</div>
      <input id="req_country" type="text" role="combobox" aria-required="true">
    </div>
    <input id="req_phone" type="tel" required>
  </fieldset>
  <p class="legend">* indicates a required field</p>
  <button id="submit-btn" type="submit">Submit application</button>
</form>
<div id="submitted"></div>
<script>
  // fill() sets the value PROPERTY, which no attribute read can see, so the page echoes it into a
  // node the runner's own 'extract' can read back.
  document.addEventListener('input', function (event) {
    var echo = document.getElementById(event.target.id + '-echo');
    if (echo) echo.textContent = event.target.value;
  });
  // Where a keystroke actually LANDED. An unaimed page.keyboard.press() with nothing focused reports
  // BODY; a press aimed at an element reports that element's id.
  document.addEventListener('keydown', function (event) {
    document.getElementById('keytarget').textContent = event.target.id || event.target.tagName;
  });
  // The fixture form never leaves the page, so a replay can prove the gate let a click THROUGH
  // without anything being submitted anywhere.
  document.getElementById('app-form').addEventListener('submit', function (event) {
    event.preventDefault();
    document.getElementById('submitted').textContent = 'yes';
  });
  document.getElementById('apply').addEventListener('click', function () {
    setTimeout(function () {
      document.getElementById('quick-panel').innerHTML = '<input id="email" type="text">';
    }, ${QUICK_PANEL_MS});
  });
  document.getElementById('apply-slow').addEventListener('click', function () {
    setTimeout(function () {
      document.getElementById('slow-panel').innerHTML = '<input id="slow-email" type="text">';
    }, ${SLOW_PANEL_MS});
  });
</script>`;

const server = http.createServer((request, response) => {
  // 'close' matters: a keep-alive socket stops Chromium ever reporting networkidle.
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
  response.end(fixture);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-replay-'));
fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);

async function replay(actions) {
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: base,
    actions,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 }
  }));
  fs.rmSync(path.join(workDir, 'stratus-result.json'), { force: true });
  // spawn, never spawnSync: the fixture server lives in this process, and spawnSync would block the
  // event loop so the page could never load.
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
  return JSON.parse(fs.readFileSync(path.join(workDir, 'stratus-result.json'), 'utf8'));
}

const valueOf = (result, selector) => result.extracted.find((entry) => entry.selector === selector)?.value;

// 1. An optional waitForSelector must wait. It is the one action whose entire job is to wait, and
//    the pre-check used to answer "not there" before its timeout ever started. This is exactly the
//    'greenhouse_application_form_ready' action the Litos backend emits after clicking Apply, and
//    exactly the deliberate render delay jobExtract uses to let a client-rendered board paint.
{
  const result = await replay([
    { type: 'click', selector: '#apply-slow', label: 'open_application_form', optional: true },
    { type: 'waitForSelector', selector: '#slow-email', label: 'application_form_ready', optional: true, timeout: 8000 },
    { type: 'fill', selector: '#slow-email', value: 'person@example.com', label: 'email', optional: true },
    { type: 'extract', selector: '#slow-email-echo' }
  ]);
  assert.equal(valueOf(result, '#slow-email-echo'), 'person@example.com',
    'an optional waitForSelector must hold the run until its element exists');
  assert.deepEqual(result.filledFields, ['email'], 'the field must be reported filled, not skipped');
}

// 2. What the narrowing gives up, stated out loud. A control that renders a beat late and that no
//    caller declared a wait for is now SKIPPED rather than waited for, and reported. Declaring the
//    wait is what fixes it, and that is the caller's job. The inline <select> is the contrast case:
//    its options are in the page from first paint, so it always worked and must keep working.
{
  const undeclared = await replay([
    { type: 'click', selector: '#apply', label: 'open_application_form', optional: true },
    { type: 'fill', selector: '#email', value: 'person@example.com', label: 'email', optional: true },
    { type: 'select', selector: '#start_month', value: '5', label: 'start_month', optional: true },
    { type: 'extract', selector: '#start_month' }
  ]);
  assert.deepEqual(undeclared.skipped, ['email: nothing matched #email'],
    'a late control with no declared wait is skipped, and says so, got ' + JSON.stringify(undeclared.skipped));
  assert.equal(valueOf(undeclared, '#start_month'), 'May', 'the inline-options contrast case must keep working');

  const declared = await replay([
    { type: 'click', selector: '#apply', label: 'open_application_form', optional: true },
    { type: 'waitForSelector', selector: '#email', label: 'form_ready', optional: true, timeout: 5000 },
    { type: 'fill', selector: '#email', value: 'person@example.com', label: 'email', optional: true },
    { type: 'extract', selector: '#email-echo' }
  ]);
  assert.equal(valueOf(declared, '#email-echo'), 'person@example.com',
    'declaring the wait is what fills a late control, and it must work');
  assert.deepEqual(declared.skipped, [], 'nothing was missing once the wait was declared');
}

// 3. The cost. Six absent optional selectors in a row, exactly Greenhouse's cookie preflight. Each
//    is one instantaneous snapshot, so six of them cost about as much as none: the measured reason
//    the settle grace was dropped is that on two live Greenhouse forms it spent its whole 5000ms
//    budget here and on selectors like these, and changed no filled field and no blocker.
{
  const selectors = [
    '#onetrust-accept-btn-handler',
    '.onetrust-close-btn-handler',
    'button:has-text("Allow All")',
    'button:has-text("Accept All Cookies")',
    'button:has-text("Accept Cookies")',
    'button:has-text("Confirm My Choices")'
  ];
  const result = await replay([
    ...selectors.map((selector, index) => ({ type: 'click', selector, label: `greenhouse_cookie_preflight:${index}`, optional: true })),
    { type: 'extract', selector: 'title' }
  ]);
  assert.equal(valueOf(result, 'title'), 'Replay Fixture', 'the run must continue past every absent optional action');
  assert.equal(result.skipped.length, 6, 'every absent optional action is reported');
  for (const [index, entry] of result.skipped.entries()) {
    assert.match(entry, new RegExp(`^greenhouse_cookie_preflight:${index}: nothing matched `));
    // No grace, so no duration is claimed. A message that says "after 1500ms" is the dropped design.
    assert.doesNotMatch(entry, /after \d+ms$/);
  }
  // The slack covers browser startup and page load on a cold machine, not waiting.
  assert.ok(result.elapsedMs < 5000, `six absent optional selectors must cost nothing, took ${result.elapsedMs}ms`);
}

// 5. THE MERGE ITSELF. Two branches rewrote this loop for different reasons and both intents have
//    to survive together, so one run exercises both: an optional waitForSelector that must hold the
//    run open, and a press that must land on the element it names rather than on the form. Checked
//    in one run because the failure mode being guarded against is a resolution that keeps one side's
//    behaviour and silently drops the other's.
{
  const result = await replay([
    { type: 'click', selector: '#apply-slow', label: 'open_application_form', optional: true },
    { type: 'waitForSelector', selector: '#slow-email', label: 'application_form_ready', optional: true, timeout: 8000 },
    { type: 'fill', selector: '#slow-email', value: 'person@example.com', label: 'email', optional: true },
    { type: 'press', selector: '#aimed', value: 'Enter', label: 'aimed_press' },
    { type: 'extract', selector: '#slow-email-echo' },
    { type: 'extract', selector: '#keytarget' }
  ]);
  assert.equal(valueOf(result, '#slow-email-echo'), 'person@example.com',
    'the optional waitForSelector must still hold the run open after the merge');
  assert.equal(valueOf(result, '#keytarget'), 'aimed',
    'the press must still land on the element it names after the merge, not on the page');
}

// 6. An optional press keeps its selector now, so for the first time it reaches the pre-check above.
//    An Enter aimed at a shut choice control is withheld, and an optional press whose target is not
//    on the page at all is skipped rather than delivered to whatever holds focus.
{
  const withheld = await replay([
    { type: 'press', selector: '#combo', value: 'Enter', label: 'question_confirm', optional: true },
    { type: 'extract', selector: '#keytarget' }
  ]);
  assert.equal(valueOf(withheld, '#keytarget'), '',
    'Enter on a choice control with no menu open must not reach the page at all');
  assert.ok(withheld.skipped.some((entry) => /question_confirm: Enter withheld/.test(entry)),
    'the withheld keystroke must be reported, got ' + JSON.stringify(withheld.skipped));

  const absent = await replay([
    { type: 'press', selector: '#not-on-this-page', value: 'Enter', label: 'question_confirm', optional: true },
    { type: 'extract', selector: '#keytarget' }
  ]);
  assert.equal(valueOf(absent, '#keytarget'), '',
    'an optional press whose target is absent must not fire at the page');
  assert.deepEqual(absent.skipped, ['question_confirm: nothing matched #not-on-this-page'],
    'and it must say so, got ' + JSON.stringify(absent.skipped));
}

// 7. The pre-submit gate, both directions, against the merged loop. An incomplete form must not be
//    submitted and must say which fields are empty; a complete one must go through untouched. The
//    fixture carries the form's own "* indicates a required field" legend on purpose: an early
//    version of the gate matched it and would have refused every Greenhouse submission there is.
{
  const blocked = await replay([
    { type: 'click', selector: 'button[type="submit"]', label: 'final_submit' },
    { type: 'extract', selector: '#submitted' }
  ]);
  assert.equal(valueOf(blocked, '#submitted'), '', 'an incomplete form must not be submitted');
  assert.deepEqual(blocked.blockers.sort(), [
    '"Email" is required and is still empty',
    '"Full name" is required and is still empty',
    '"Phone" is required and is still empty'
  ], 'the gate must name the empty fields, got ' + JSON.stringify(blocked.blockers));

  const fill = (selector, value) => ({ type: 'fill', selector, value, label: selector.slice(1) });
  const allowed = await replay([
    fill('#req_name', 'Mehek Mandal'),
    fill('#req_email', 'person@example.com'),
    fill('#req_phone', '+971 50 123 4567'),
    { type: 'click', selector: 'button[type="submit"]', label: 'final_submit' },
    { type: 'extract', selector: '#submitted' }
  ]);
  assert.equal(valueOf(allowed, '#submitted'), 'yes', 'a complete form must not be blocked');
  assert.deepEqual(allowed.blockers, [], 'a complete form must produce no blockers, got ' + JSON.stringify(allowed.blockers));

  // R-103. Everything filled EXCEPT the phone number, which shares its fieldset with an answered
  // country select. The gate used to read that fieldset as a whole, find the country's "+971", and
  // let the submit through. "Phone is required." is one of the six messages from the incident that
  // built this gate, so it was blind to the field it exists to catch.
  const phoneEmpty = await replay([
    fill('#req_name', 'Mehek Mandal'),
    fill('#req_email', 'person@example.com'),
    { type: 'click', selector: 'button[type="submit"]', label: 'final_submit' },
    { type: 'extract', selector: '#submitted' }
  ]);
  assert.equal(valueOf(phoneEmpty, '#submitted'), '',
    'an empty required control beside an answered choice control must still stop the submit');
  // Asserted on 'skipped', not only on 'blockers': the runner has a SECOND, older required-field
  // scan that runs after the loop and reports the same field, so a blockers-only assertion passes
  // even when the gate saw nothing and let the click through. This line is the gate's alone.
  assert.ok(phoneEmpty.skipped.some((entry) => /^final_submit: submit withheld, 1 required field/.test(entry)),
    'the GATE, not the post-loop scan, must be what withheld the click, got ' + JSON.stringify(phoneEmpty.skipped));
  assert.deepEqual(phoneEmpty.blockers, ['"Phone" is required and is still empty'],
    'the gate must name the phone, and must not blame the answered country, got ' + JSON.stringify(phoneEmpty.blockers));
}

server.close();
fs.rmSync(workDir, { recursive: true, force: true });
console.log('managed runner replay: an optional waitForSelector waits, a press lands where it is aimed, and the pre-submit gate holds in both directions including a required control beside an answered choice control');
