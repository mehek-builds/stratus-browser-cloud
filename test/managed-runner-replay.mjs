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

// How late the discipline menu renders. Past the old flat 150ms, inside the new bounded wait, and
// sized on the live measurement: Greenhouse's asynchronously loaded menus arrived 555-563ms after
// the control was touched.
const MENU_RENDER_MS = 600;

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
<!-- A job description, copied in shape from the live DRW and Virtu Greenhouse postings. The bullet
     contains the answer text and is a plain <li> loose in the page. Sweeping the document for
     'li' containing the answer clicked exactly this and called the Discipline field answered. -->
<ul id="jd">
  <li>Are pursuing a bachelor's, master's or PhD in mathematics, economics, physics, statistics, computer science or any engineering discipline</li>
</ul>
<!-- A React Select, reproduced down to the parts that bite: the answer lives in a
     .select__single-value node and not on the input; the menu renders LATE; and the container holds
     a "Clear selections" <button> alongside the combobox. -->
<div class="select__container" id="discipline-shell">
  <div class="select__control">
    <div class="select__value-container">
      <div class="select__placeholder" id="discipline-placeholder">Select...</div>
      <div class="select__input-container"><input id="discipline" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off"></div>
    </div>
    <button type="button" class="select__clear-indicator" aria-label="Clear selections">x</button>
    <button type="button" class="select__dropdown-indicator" aria-label="Toggle flyout">v</button>
  </div>
</div>
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

  // ---- React Select, faithfully enough to reproduce the two ways an answer was destroyed ----
  var TAXONOMY = ['Business Administration', 'Computer Engineering', 'Computer Science', 'Economics', 'Finance', 'Mathematics'];
  var shell = document.getElementById('discipline-shell');
  var input = document.getElementById('discipline');
  var control = shell.querySelector('.select__control');
  var chosen = '';
  var menuTimer = null;
  var suppressInput = false;
  function renderChosen() {
    var existing = shell.querySelector('.select__single-value');
    if (existing) existing.remove();
    var placeholder = document.getElementById('discipline-placeholder');
    if (chosen) {
      if (placeholder) placeholder.style.display = 'none';
      var node = document.createElement('div');
      node.className = 'select__single-value';
      node.textContent = chosen;
      shell.querySelector('.select__value-container').prepend(node);
    } else if (placeholder) {
      placeholder.style.display = '';
    }
  }
  function closeMenu() {
    if (menuTimer) { clearTimeout(menuTimer); menuTimer = null; }
    var menu = shell.querySelector('.select__menu');
    if (menu) menu.remove();
    input.setAttribute('aria-expanded', 'false');
  }
  function openMenu() {
    closeMenu();
    input.setAttribute('aria-expanded', 'true');
    // LATE, on purpose. The old code looked for options 150ms after the click and fell through to a
    // page-wide sweep every single time.
    menuTimer = setTimeout(function () {
      menuTimer = null;
      var query = input.value.trim().toLowerCase();
      var matches = TAXONOMY.filter(function (entry) { return !query || entry.toLowerCase().indexOf(query) >= 0; });
      var menu = document.createElement('div');
      menu.className = 'select__menu';
      menu.setAttribute('role', 'listbox');
      matches.forEach(function (entry, index) {
        var option = document.createElement('div');
        option.className = 'select__option';
        option.setAttribute('role', 'option');
        option.id = 'react-select-discipline-option-' + index;
        option.textContent = entry;
        option.addEventListener('mousedown', function (event) {
          event.preventDefault();
          chosen = entry;
          suppressInput = true;
          input.value = '';
          suppressInput = false;
          renderChosen();
          closeMenu();
        });
        menu.appendChild(option);
      });
      shell.appendChild(menu);
    }, ${MENU_RENDER_MS});
  }
  control.addEventListener('mousedown', function (event) {
    if (event.target.classList.contains('select__clear-indicator')) return;
    if (input.getAttribute('aria-expanded') === 'true') closeMenu(); else openMenu();
  });
  shell.querySelector('.select__clear-indicator').addEventListener('click', function () {
    // What React Select's clear indicator does, and what the old control sweep clicked.
    chosen = '';
    renderChosen();
  });
  input.addEventListener('input', function () {
    if (suppressInput) return;
    // backspaceRemovesValue: emptying the search box of a select that HOLDS a value deletes the
    // value. Playwright's fill('') arrives here.
    if (input.value === '' && chosen) { chosen = ''; renderChosen(); }
    openMenu();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeMenu();
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

// `options` carries whatever the run-level input needs, which today means allowSubmit. It defaults
// to absent, so every case below that does not ask for it runs under the default-deny submit guard,
// which is the shape of a real prepare run.
async function replay(actions, options = {}) {
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: base,
    actions,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    ...options
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
//
//    Every case here runs with allowSubmit, and it has to. These are the AUTHORIZED submit run: the
//    run-level guard that stops a fill run submitting is deliberately not installed on it, which
//    leaves the pre-submit gate as the only thing between the click and the submission. That is the
//    same reason the fixture's form is novalidate. Without allowSubmit the two refusal cases below
//    would still go green, and they would be green because the guard stopped the submit and not
//    because the gate did - a test passing for the wrong reason is how a gate rots unnoticed.
{
  const blocked = await replay([
    { type: 'click', selector: 'button[type="submit"]', label: 'final_submit' },
    { type: 'extract', selector: '#submitted' }
  ], { allowSubmit: true });
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
  ], { allowSubmit: true });
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
  ], { allowSubmit: true });
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

// A choice control is answered from its OWN menu, and an answer already on the form survives every
// later candidate.
//
// Both halves were measured on live Greenhouse forms on 2026-08-08, and both reported success while
// leaving the control on "Select...":
//   - DRW and Virtu: the fallback locator swept the page for 'li' containing "Computer Science" and
//     clicked a bullet in the job description, because the properly scoped attempt was made as an
//     instant count() 150ms after the click, before the menu had rendered.
//   - Five Rings: Discipline was correctly set to "Computer Science" and then emptied by a later
//     candidate, twice over - an empty fill lands as a backspace on the always-empty search box, and
//     the control sweep clicks the "Clear selections" button.
{
  const disciplineText = (result) => (valueOf(result, '#discipline-shell') || '').replace(/\s+/g, ' ').trim();

  const answered = await replay([
    { type: 'click', selector: '#discipline', label: 'discipline_open', optional: true },
    { type: 'fill', selector: '#discipline', value: 'Computer Science', label: 'discipline', optional: true },
    { type: 'extract', selector: '#discipline-shell' }
  ]);
  assert.match(disciplineText(answered), /Computer Science/,
    'the option must be taken from the control\'s own menu once it renders, got ' + JSON.stringify(disciplineText(answered)));
  assert.ok(!/Are pursuing a bachelor/.test(disciplineText(answered)), 'the job description must not end up in the control');
  assert.deepEqual(answered.filledFields, ['discipline'], 'and it must be reported filled, got ' + JSON.stringify(answered));

  // A second candidate that matches nothing. It must leave the first answer exactly where it was,
  // and must say so rather than claiming a fill.
  const survives = await replay([
    { type: 'click', selector: '#discipline', label: 'discipline:0_open', optional: true },
    { type: 'fill', selector: '#discipline', value: 'Computer Science', label: 'discipline:0', optional: true },
    { type: 'click', selector: '#discipline', label: 'discipline:1_open', optional: true },
    { type: 'fill', selector: '#discipline', value: 'Astrophysics', label: 'discipline:1', optional: true },
    { type: 'extract', selector: '#discipline-shell' }
  ]);
  assert.match(disciplineText(survives), /Computer Science/,
    'a later candidate that matches nothing must not clear an answer that matched, got ' + JSON.stringify(disciplineText(survives)));
  assert.ok(survives.filledFields.includes('discipline:0'), 'the candidate that worked is still reported filled');
  assert.ok(survives.skipped.some((entry) => /^discipline:1: left the answer already on the form/.test(entry)),
    'the candidate that missed must be reported honestly, got ' + JSON.stringify(survives.skipped));

  // Nothing on the ladder matches. The control must be left for the applicant and reported as such,
  // never typed into and then read back out of its own search box.
  const unmatchable = await replay([
    { type: 'click', selector: '#discipline', label: 'discipline_open', optional: true },
    { type: 'fill', selector: '#discipline', value: 'Computer Science & Business Administration, Finance Emphasis', label: 'discipline', optional: true },
    { type: 'extract', selector: '#discipline-shell' }
  ]);
  assert.match(disciplineText(unmatchable), /Select\.\.\./,
    'an answer that is on no list must leave the control untouched, got ' + JSON.stringify(disciplineText(unmatchable)));
  assert.deepEqual(unmatchable.filledFields, [], 'and it must NOT be reported filled, got ' + JSON.stringify(unmatchable.filledFields));
  assert.ok(unmatchable.skipped.some((entry) => /^discipline: no option matched .*left for you to choose$/.test(entry)),
    'and the applicant must be told, got ' + JSON.stringify(unmatchable.skipped));
}

server.close();
fs.rmSync(workDir, { recursive: true, force: true });
console.log('managed runner replay: an optional waitForSelector waits, a press lands where it is aimed, a choice is taken from the control\'s own menu and never undone by a later candidate, and the pre-submit gate holds in both directions');
