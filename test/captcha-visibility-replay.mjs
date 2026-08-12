/* THE PRODUCER HALF OF A CROSS-REPO CONTRACT, RUN RATHER THAN DESCRIBED.
 *
 * WHAT THIS EXISTS TO STOP. student-outreach-backend builds an action list, this runner executes it,
 * and the backend decides whether a person has to finish an application by hand from what comes
 * back. Neither repo can import the other, so until now each side pinned its half against a literal
 * it wrote itself. Both halves passed while the two disagreed: that is exactly how the
 * pass.scope.scopeKind mismatch blocked every submission in the product for a day.
 *
 * test/fixtures/captcha-visibility-contract.json is the shared artifact, committed byte-identical in
 * both repos. It carries the backend's REAL action list, the fixture pages, this runner's REAL
 * emission for them, and the verdicts the backend's REAL predicates reach. This file proves the
 * producer half: serve the page, run the actions through the shipped SANDBOX_RUNNER, and require the
 * emission to match. The consumer half is pinned in the backend against the same bytes.
 *
 * WHY THE REPLAY AND NOT A page.evaluate. The thing under test is not only the visibility rule - it
 * is the extract handler around it: which locator it builds, whether it drops .first(), how many
 * entries it pushes, and what the run advertises in `capabilities`. Only running the real runner
 * covers those, and the fixtures are local pages, never an employer's.
 *
 * Set CAPTCHA_CONTRACT_WRITE=1 to rewrite the contract from a live run instead of asserting against
 * it. That is the regeneration path after a deliberate change; the file then has to be copied into
 * the backend unchanged.
 */

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.join(HERE, 'fixtures', 'captcha-visibility-contract.json');
const CONTRACT_BYTES = fs.readFileSync(CONTRACT_PATH);
const contract = JSON.parse(CONTRACT_BYTES.toString('utf8'));
const WRITE = process.env.CAPTCHA_CONTRACT_WRITE === '1';

/* THE DIGEST, PINNED HERE AND IN THE BACKEND'S OWN TEST AS THE SAME 64 CHARACTERS.
 *
 * Everything else in this file proves that THIS repo agrees with the file. Nothing in either repo
 * could previously prove the two COPIES of the file agree with each other, so a hand-edit of the
 * backend's copy alone passed both suites and the shared artifact silently stopped being shared.
 * Pinning the bytes here means editing either copy fails that copy's repo until its literal is
 * updated, and the two literals sit in two pull requests where a reviewer can compare them without
 * leaving the diff. It is not a cross-repo lock, which nothing without shared CI can be. It is what
 * turns a silent divergence into a red suite and a visible constant. */
const CONTRACT_SHA256 = '3561ff6813e9b655c5eb4a74cd3a3ec19545ee82b2aabc1963b3e090b280b4b6';

let currentHtml = '';
const server = http.createServer((request, response) => {
  // 'close' matters: a keep-alive socket stops Chromium ever reporting networkidle.
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
  // Anything that is not the page itself is an iframe the fixture points at. Answered locally and
  // empty: the srcs keep the production path and query because that is all any predicate reads, and
  // nothing here should ever leave the machine.
  const isPage = request.url === '/' || request.url.startsWith('/?');
  response.end(isPage
    ? '<!doctype html><html><head><title>Fixture</title></head><body>' + currentHtml + '</body></html>'
    : '<!doctype html><html><body></body></html>');
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port + '/';

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'captcha-contract-'));
fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);

async function replay(html, actions) {
  currentHtml = html;
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: base,
    actions,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 }
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
  assert.equal(status, 0, 'runner exited ' + status + ': ' + stderr.split('\n').slice(0, 3).join(' '));
  const result = JSON.parse(fs.readFileSync(path.join(workDir, 'stratus-result-0.json'), 'utf8'));
  return {
    extracted: result.extracted,
    capabilities: result.capabilities ?? null,
    captchaSkipped: (result.skipped ?? []).filter((line) => line.startsWith('captcha_')),
    runnerBlockedOnCaptcha: (result.blockers ?? []).includes('CAPTCHA requires your attention')
  };
}

let failures = 0;
const rewritten = [];

if (!WRITE) {
  const digest = createHash('sha256').update(CONTRACT_BYTES).digest('hex');
  try {
    assert.equal(digest, CONTRACT_SHA256,
      'the contract file changed: update CONTRACT_SHA256 here and in the backend, and copy the file across');
    console.log('ok   contract digest ' + digest.slice(0, 16));
  } catch (error) {
    failures += 1;
    console.error('FAIL contract digest\n' + String(error && error.message));
  }
}

for (const entry of contract.cases) {
  const emitted = await replay(entry.html, contract.actions);
  if (WRITE) {
    rewritten.push({ ...entry, emitted });
    continue;
  }
  try {
    assert.deepEqual(emitted, entry.emitted, entry.name + ': the runner no longer emits what the backend is pinned against');
    /* THE SAME PAGE, THIS RUNNER'S OWN PREDICATE. Carried in the contract beside the extraction so
     * the two layers are compared on one DOM rather than on two descriptions of one. The whole
     * defect being fixed was these two disagreeing: the managed evidence called three live Lever
     * postings a challenge while this predicate, on the same markup, said no. */
    assert.equal(emitted.runnerBlockedOnCaptcha, entry.expected.runnerBlocked,
      entry.name + ': the runner blocker predicate disagrees with the contract');
    console.log('ok   ' + entry.name);
  } catch (error) {
    failures += 1;
    console.error('FAIL ' + entry.name + '\n' + String(error && error.message).split('\n').slice(0, 12).join('\n'));
  }
}

/* Not decoration: the contract's `actions` are the backend's, and if this runner ever stopped
 * receiving requireVisible the emission would silently fall back to the first-match reading under
 * the same labels. The capability is the only thing in the payload that can say which question was
 * answered, so every case has to carry it. */
if (!WRITE) {
  for (const entry of contract.cases) {
    try {
      assert.deepEqual(entry.emitted.capabilities, ['extract-require-visible-v1'],
        entry.name + ': the run must advertise that requireVisible was honoured');
    } catch (error) {
      failures += 1;
      console.error('FAIL ' + entry.name + ' capability\n' + String(error && error.message));
    }
  }
}

server.close();
fs.rmSync(workDir, { recursive: true, force: true });

if (WRITE) {
  fs.writeFileSync(CONTRACT_PATH, JSON.stringify({ ...contract, cases: rewritten }, null, 2) + '\n');
  console.log('captcha visibility contract rewritten from a live run: ' + rewritten.length + ' cases');
  console.log('copy it into student-outreach-backend/src/lib/fixtures/ unchanged');
} else if (failures > 0) {
  console.error('captcha visibility contract: ' + failures + ' failures');
  process.exit(1);
} else {
  console.log('captcha visibility contract: ' + contract.cases.length + ' cases passed');
}
