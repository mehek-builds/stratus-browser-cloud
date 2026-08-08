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
// Two delays on purpose: one inside the settle grace, one well beyond it. Together they show the
// division of labour the fix depends on. A short grace catches a control that is merely a moment
// late; anything slower is the caller's to declare with waitForSelector, which keeps its own
// timeout and is exempt from the pre-check.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Inside the 1500ms grace. Sized on the live measurement the grace itself is sized on: Greenhouse's
// asynchronously loaded School and Discipline options arrived 563ms and 555ms after the fill.
const QUICK_PANEL_MS = 700;
// Beyond the grace, so only an honoured waitForSelector can reach it.
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
<script>
  // fill() sets the value PROPERTY, which no attribute read can see, so the page echoes it into a
  // node the runner's own 'extract' can read back.
  document.addEventListener('input', function (event) {
    var echo = document.getElementById(event.target.id + '-echo');
    if (echo) echo.textContent = event.target.value;
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

// 2. The settle grace, for a control that is merely a moment late and that no caller thought to
//    declare a wait for. The inline <select> is the contrast case: its options are in the page from
//    first paint, so it always worked, and it must keep working.
{
  const result = await replay([
    { type: 'click', selector: '#apply', label: 'open_application_form', optional: true },
    { type: 'fill', selector: '#email', value: 'person@example.com', label: 'email', optional: true },
    { type: 'select', selector: '#start_month', value: '5', label: 'start_month', optional: true },
    { type: 'extract', selector: '#email-echo' },
    { type: 'extract', selector: '#start_month' }
  ]);
  assert.equal(valueOf(result, '#email-echo'), 'person@example.com',
    'an optional fill on a control that renders a beat late must wait for it');
  assert.equal(valueOf(result, '#start_month'), 'May', 'the inline-options contrast case must keep working');
  assert.deepEqual(result.skipped, [], 'nothing was actually missing, so nothing should be reported skipped');
}

// 3. The cost bound. Six absent optional selectors in a row, exactly Greenhouse's cookie preflight.
//    Naively giving every optional action a grace would cost six; only the first probe may pay,
//    because after an empty probe nothing has happened that could make the next one appear.
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
  assert.match(result.skipped[0], /greenhouse_cookie_preflight:0: nothing matched .* after 1500ms$/);
  for (const entry of result.skipped.slice(1)) assert.match(entry, / after 0ms$/);
  // One 1500ms grace, not six. The slack covers browser startup and page load on a cold machine.
  assert.ok(result.elapsedMs < 5000, `six absent optional selectors must not cost six graces, took ${result.elapsedMs}ms`);
}

// 4. The run-wide budget. Absences each preceded by an action that DID run cannot each buy a grace
//    forever: once the budget is spent the pre-check reverts to an instant snapshot, and the entries
//    that follow say 'after 0ms' rather than going silent.
{
  const pairs = [];
  for (let index = 0; index < 8; index += 1) {
    // A plain input, deliberately: filling a combobox runs the react-select path, which has waits
    // of its own and would measure those instead of the optional-wait budget this case bounds.
    pairs.push({ type: 'fill', selector: '#plain', value: `probe ${index}`, optional: true });
    pairs.push({ type: 'click', selector: `#never-present-${index}`, label: `absent:${index}`, optional: true });
  }
  const result = await replay([...pairs, { type: 'extract', selector: 'title' }]);
  assert.equal(result.skipped.length, 8, 'every absent optional action is still reported');
  const graced = result.skipped.filter((entry) => !/ after 0ms$/.test(entry));
  assert.ok(graced.length < 8, `the run-wide budget must stop granting grace, granted ${graced.length}/8`);
  // Eight graces at 1500ms would be 12s. The 5000ms budget caps the waiting well below that.
  assert.ok(result.elapsedMs < 10000, `optional waiting must stay inside its run-wide budget, took ${result.elapsedMs}ms`);
}

server.close();
fs.rmSync(workDir, { recursive: true, force: true });
console.log('managed runner replay: optional actions that are meant to wait do wait, and stay bounded');
