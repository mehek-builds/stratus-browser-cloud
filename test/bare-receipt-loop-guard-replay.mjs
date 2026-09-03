// THE BARE-RECEIPT ARM'S VERDICT MUST HOLD ACROSS A SECOND READ. The settle loop in the shipped
// runner re-reads the page 500ms after a body_bare_receipt verdict and only returns when the second
// read is the same verdict with the same message byte for byte. Nothing else in the suite executes
// that branch: submit-outcome-dom.test.js extracts readSubmitOutcome alone, so it can only ever see
// one read. This replay runs the real runner string against a fixture that shows a bare thank-you
// and then changes its mind, which is the transient the guard exists for.
//
// Same file protocol and shim as managed-runner-replay.mjs.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ATOMIC_SUBMIT_POLICY, SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const providerDeadlineAt = () => new Date(Date.now() + 240_000).toISOString();

// ?mode=stable   : "Thank you" and nothing else, forever. The guard must let it through.
// ?mode=transient: "Thank you" for 250ms, then an error page. The guard must refuse it.
// ?mode=flip     : "Thank you" for 250ms, then a different bare receipt line. The guard must refuse
//                  the first read and the loop must settle on the second line, not the first.
const fixture = `<!doctype html><html><body>
<form id="app-form" novalidate>
  <label for="email">Email</label>
  <input id="email" type="email" required>
  <button id="submit-btn" type="submit">Submit application</button>
</form>
<div id="result"></div>
<script>
  var mode = new URLSearchParams(location.search).get('mode') || 'stable';
  document.getElementById('app-form').addEventListener('submit', function (event) {
    event.preventDefault();
    document.getElementById('app-form').remove();
    document.getElementById('result').innerHTML = '<h1>Thank you</h1>';
    if (mode === 'transient') {
      setTimeout(function () {
        document.getElementById('result').innerHTML = '<p>Something went wrong. Please try again.</p>';
      }, 250);
    } else if (mode === 'flip') {
      setTimeout(function () {
        document.getElementById('result').innerHTML = '<p>Thanks! We will be in touch.</p>';
      }, 250);
    }
  });
</script>
</body></html>`;

const server = http.createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
  response.end(fixture);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-bare-receipt-'));
fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);

async function replay(mode) {
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    providerDeadlineAt: providerDeadlineAt(),
    url: `${base}?mode=${mode}`,
    actions: [
      { type: 'fill', selector: '#email', value: 'person@example.com', label: 'email' },
      { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' }
    ],
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    allowSubmit: true,
    // Long enough for the 500ms second read and a few more loop turns, short enough to keep the
    // transient case from spending the whole production window.
    postSubmitSettleMs: 2500
  }));
  fs.rmSync(path.join(workDir, 'stratus-result-0.json'), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
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
  assert.equal(status, 0, `runner exited ${status}: ${stderr.split('\n').slice(0, 5).join(' ')}`);
  return JSON.parse(fs.readFileSync(path.join(workDir, 'stratus-result-0.json'), 'utf8'));
}

const stable = await replay('stable');
assert.equal(stable.submitOutcome.pressed, true);
assert.equal(stable.submitOutcome.state, 'confirmed', JSON.stringify(stable.submitOutcome));
assert.equal(stable.submitOutcome.evidence, 'body_bare_receipt');
assert.equal(stable.submitOutcome.message, 'Thank you');

const transient = await replay('transient');
assert.equal(transient.submitOutcome.pressed, true);
assert.notEqual(transient.submitOutcome.state, 'confirmed',
  'a thank-you that was replaced by an error 250ms later must not be a confirmation: ' + JSON.stringify(transient.submitOutcome));
assert.match(transient.submitOutcome.message || '', /went wrong/, 'the terminal page is what the record carries');

const flip = await replay('flip');
assert.equal(flip.submitOutcome.state, 'confirmed', JSON.stringify(flip.submitOutcome));
assert.equal(flip.submitOutcome.evidence, 'body_bare_receipt');
assert.equal(flip.submitOutcome.message, 'Thanks! We will be in touch.',
  'the loop must settle on the line that held, never the first read');

server.close();
console.log('bare-receipt loop guard replay: a stable bare receipt confirms, a transient one does not, and a flipped one settles on the line that held');
