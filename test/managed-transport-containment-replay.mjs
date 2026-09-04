// Runner-level regression coverage for the "managed" (non-v4) out-of-band transport containment,
// driven through the REAL stratus-runner.cjs the way litos-api actually invokes it, not through
// logic extracted from SANDBOX_RUNNER's text or a source-shape pin.
//
// test/out-of-band-transport-origin.test.js proves the pure recorder logic (recordManagedOutOfBandTransport,
// managedEmployerBoundOrigin, ...) by slicing that code out of SANDBOX_RUNNER and evaluating it with
// a hand-built harness. It never launches a browser, so it can describe what the console listener and
// the init script are SUPPOSED to do but cannot prove Chromium actually reaches either one.
// test/managed-browser.test.js and test/sandbox-runner-compiles.test.js pin the SHAPE of the runner
// string. Nothing before this file drove one real fill through the full managed containment pipeline -
// real Chromium, the real addInitScript callback, the real browserContext.on('console', ...) listener -
// so a scope regression inside that listener leaves every one of those tests green. That is not
// hypothetical: an adversarial review reproduced exactly this on an intermediate commit, a
// `ReferenceError` thrown from inside the console listener the moment ANY page console message
// arrived, which would crash the run on ordinary page chatter alone - i.e. on nearly every real
// managed fill, not just one that actually attempts an out-of-band channel.
//
// Three fixtures, one shared shape: a single text field whose 'input' listener reacts on keystroke,
// filled by a real `fill` action under exactMutationAuthority + a submissionAttempt (the same
// combination litos-api sends on a managed prepare run), no confirmAndSubmit v4 action anywhere -
// so managedMutationContainmentRequired is what is under test here, not the separate v4 path.
//
//   - log-only: the listener only console.logs, the way ordinary page telemetry, analytics or a
//     React dev warning would. This must not be misread as a violation and must not crash the
//     listener. Expect exit 0.
//   - worker:   the listener also logs, then constructs a Worker. Expect a non-zero exit and the
//     exact violation sentence naming Worker and this page's own origin.
//   - popup:    the listener calls window.open(...). This is the live reproduction of the review's
//     second finding: Window.prototype is not where a [Global] interface's own members live on the
//     instance, so a prototype-only override of 'open' never intercepts a real page's window.open()
//     call - measured before the fix, this fixture's violation arrives as `out-of-band transport:
//     page from about:blank` (caught only by the browserContext.on('page') fallback that closes any
//     unexpected second page) rather than `out-of-band transport: popup from <origin>`. Asserting the
//     exact 'popup from <this page's own origin>' sentence proves two things the review asked for at
//     once: the hook actually fires (only litosBlockedPopup's own notify('popup') produces that exact
//     channel name), and it therefore returns null (that function's only return statement).

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// Same helper other replays use: production always hands the runner a real deadline, and these
// replays write stratus-input.json by hand rather than going through normalizeProviderDeadline.
const providerDeadlineAt = () => new Date(Date.now() + 240_000).toISOString();
const SUBMISSION_ATTEMPT = Object.freeze({
  runId: '77777777-7777-4777-8777-777777777777',
  claimId: '88888888-8888-4888-8888-888888888888',
  executionId: '99999999-9999-4999-8999-999999999999'
});

const fixturePage = (behavior) => `<!doctype html><meta charset="utf-8"><title>Transport containment fixture</title>
<label for="q">Question</label><input id="q">
<script>
  document.getElementById('q').addEventListener('input', function () {
    console.log('ordinary page telemetry: ' + this.value);
    ${behavior}
  });
</script>`;

const FIXTURES = {
  'log-only': fixturePage(''),
  worker: fixturePage("try { new Worker('data:text/javascript,'); } catch (e) {}"),
  popup: fixturePage("window.open('about:blank', 'containment-probe');")
};

const server = http.createServer((request, response) => {
  const key = new URL(request.url, 'http://127.0.0.1').pathname.slice(1);
  // 'close' matters: a keep-alive socket stops Chromium ever reporting networkidle.
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
  response.end(FIXTURES[key] || FIXTURES['log-only']);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const urlFor = (fixtureName) => `http://127.0.0.1:${server.address().port}/${fixtureName}`;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-transport-replay-'));
fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);

async function run(fixtureName) {
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    providerDeadlineAt: providerDeadlineAt(),
    url: urlFor(fixtureName),
    exactMutationAuthority: true,
    submissionAttempt: SUBMISSION_ATTEMPT,
    actions: [
      { type: 'fill', selector: '#q', value: 'hello', label: 'q', optional: false, requireUnique: true }
    ],
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 }
  }));
  fs.rmSync(path.join(workDir, 'stratus-result-0.json'), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-progress.json'), { force: true });
  // spawn, never spawnSync: the fixture server lives in this process, and spawnSync would block
  // the event loop so the page could never load.
  const { status, stderr } = await new Promise((resolve) => {
    const child = spawn(process.execPath, [
      '--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'
    ], {
      cwd: workDir,
      env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
    });
    let captured = '';
    child.stderr.on('data', (chunk) => { captured += chunk; });
    child.stdout.resume();
    child.on('close', (code) => resolve({ status: code, stderr: captured }));
  });
  return { status, stderr };
}

{
  const { status, stderr } = await run('log-only');
  assert.equal(
    status,
    0,
    `ordinary page console traffic must not fail a managed fill: exit ${status}: `
    + stderr.split('\n').slice(0, 5).join(' ')
  );
}

{
  const { status, stderr } = await run('worker');
  assert.notEqual(status, 0, 'a Worker constructed on the employer page must fail the run');
  assert.match(
    stderr,
    /A non-submit action attempted employer transport without exact final authority \(out-of-band transport: Worker from http:\/\/127\.0\.0\.1:\d+\)/,
    'the run must fail with the named Worker channel and this page\'s own origin, not a bare or ' +
    'differently-shaped sentence: ' + stderr.split('\n').slice(0, 5).join(' ')
  );
}

{
  const { status, stderr } = await run('popup');
  assert.notEqual(status, 0, 'a popup opened on the employer page must fail the run');
  assert.match(
    stderr,
    /A non-submit action attempted employer transport without exact final authority \(out-of-band transport: popup from http:\/\/127\.0\.0\.1:\d+\)/,
    'window.open must be intercepted by the init script itself (channel "popup", this page\'s own ' +
    'origin), not merely caught later by the browserContext.on(\'page\') fallback (which would name ' +
    'the channel "page" and the popup\'s own URL, e.g. about:blank, instead): '
    + stderr.split('\n').slice(0, 5).join(' ')
  );
}

server.close();
console.log('managed-transport-containment-replay: ok');
