/* Workable publishes bare job links and resolves them to tenant-qualified application pages. This
 * replay runs the shipped sandbox runner against the real apply.workable.com origin through the
 * test-only managed runner shim. The shim supplies local response bytes, but Chromium, the runner,
 * and every URL proof still see the production hostname and HTTPS URL. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import https from 'node:https';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ATOMIC_SUBMIT_POLICY_V4,
  ATOMIC_SUBMIT_V4_CAPABILITY,
  EXACT_PAGE_URL_CAPABILITY,
  SANDBOX_RUNNER
} from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TOKEN = '20e78cba92';
const BARE_URL = `https://apply.workable.com/j/${TOKEN}/apply?source=litos`;
const CANONICAL_URL = 'https://apply.workable.com/max-borges-agency/j/20E78CBA92/apply?source=litos';
const OTHER_TENANT_URL = 'https://apply.workable.com/other-tenant/j/20E78CBA92/apply?source=litos';
const OTHER_TOKEN_URL = 'https://apply.workable.com/max-borges-agency/j/AAAAAAAAAA/apply?source=litos';

const APPLICATION = `<!doctype html><meta charset="utf-8"><title>Workable application</title>
<form id="application" method="get" action="/unsupported-get">
  <label for="email">Email</label>
  <input id="email" name="email" type="email" required>
  <button id="route-drift" type="button">Review another tenant</button>
  <button id="submit" type="submit">Submit application</button>
</form>
<div id="applicant-state">untouched</div>
<div id="submitted">application page retained</div>
<script>
  document.getElementById('email').addEventListener('input', function (event) {
    document.getElementById('applicant-state').textContent = event.target.value;
  });
  document.getElementById('route-drift').addEventListener('click', function () {
    history.pushState(null, '', ${JSON.stringify(OTHER_TENANT_URL)});
  });
</script>`;

function inputFor(actions, expectedPageUrl = BARE_URL) {
  return {
    url: expectedPageUrl,
    actions: [
      {
        type: 'requireCapability',
        value: EXACT_PAGE_URL_CAPABILITY,
        optional: false,
        expectedPageUrl
      },
      {
        type: 'requireCapability',
        value: ATOMIC_SUBMIT_V4_CAPABILITY,
        optional: false,
        applicationScopeSelector: '#application'
      },
      ...actions
    ],
    allowSubmit: true,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 }
  };
}

function submitAction(expectedPageUrl = BARE_URL) {
  return {
    type: 'confirmAndSubmit',
    selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
    chooserPolicy: ATOMIC_SUBMIT_POLICY_V4,
    label: 'final_submit',
    optional: false,
    maxRetries: 1,
    contractVersion: 2,
    submitKind: 'application',
    expectedPageUrl
  };
}

async function runReplay({ canonicalUrl = CANONICAL_URL, secondRedirectUrl = null, actions }) {
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-workable-redirect-'));
  const resultPath = path.join(workDir, 'stratus-result-0.json');
  const errorPath = path.join(workDir, 'stratus-error.json');
  const keyPath = path.join(workDir, 'workable.key');
  const certificatePath = path.join(workDir, 'workable.crt');
  const certificateConfigPath = path.join(workDir, 'workable-cert.cnf');
  fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify(inputFor(actions)));
  fs.writeFileSync(certificateConfigPath, `[req]
distinguished_name = subject
x509_extensions = extensions
prompt = no
[subject]
CN = apply.workable.com
[extensions]
subjectAltName = DNS:apply.workable.com
basicConstraints = critical,CA:TRUE
keyUsage = critical,digitalSignature,keyEncipherment,keyCertSign
extendedKeyUsage = serverAuth
`);
  execFileSync('openssl', [
    'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1',
    '-config', certificateConfigPath, '-keyout', keyPath, '-out', certificatePath
  ], { stdio: 'ignore' });
  const routes = [];
  const fixtureServer = https.createServer({
    key: fs.readFileSync(keyPath),
    cert: fs.readFileSync(certificatePath)
  }, (request, response) => {
    const requestUrl = 'https://apply.workable.com' + request.url;
    routes.push(requestUrl);
    if (requestUrl === BARE_URL) {
      response.writeHead(302, {
        location: canonicalUrl,
        'cache-control': 'no-store',
        connection: 'close'
      });
      response.end();
      return;
    }
    if (requestUrl === canonicalUrl) {
      if (secondRedirectUrl) {
        response.writeHead(302, {
          location: secondRedirectUrl,
          'cache-control': 'no-store',
          connection: 'close'
        });
        response.end();
        return;
      }
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        connection: 'close'
      });
      response.end(APPLICATION);
      return;
    }
    response.writeHead(404, { connection: 'close' });
    response.end('no fixture');
  });
  await new Promise((resolve) => fixtureServer.listen(0, '127.0.0.1', resolve));

  try {
    const outcome = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'],
        {
          cwd: workDir,
          env: {
            ...process.env,
            NODE_PATH: path.join(process.cwd(), 'node_modules'),
            STRATUS_TEST_WORKABLE_HTTPS_PORT: String(fixtureServer.address().port)
          }
        }
      );
      let stderr = '';
      child.stderr.on('data', (chunk) => { stderr += chunk; });
      child.stdout.resume();
      const timer = setTimeout(() => {
        child.kill('SIGKILL');
        reject(new Error('Workable redirect replay timed out'));
      }, 60_000);
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (status) => {
        clearTimeout(timer);
        resolve({ status, stderr });
      });
    });
    return {
      ...outcome,
      result: fs.existsSync(resultPath) ? JSON.parse(fs.readFileSync(resultPath, 'utf8')) : null,
      error: fs.existsSync(errorPath) ? JSON.parse(fs.readFileSync(errorPath, 'utf8')) : null,
      routes
    };
  } finally {
    await new Promise((resolve) => fixtureServer.close(resolve));
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

test('v4 permits one Workable bare-link redirect and freezes the tenant page before applicant data', async () => {
  const run = await runReplay({
    actions: [
      { type: 'fill', selector: '#email', value: 'applicant@example.com', label: 'email' },
      submitAction(),
      { type: 'extract', selector: '#applicant-state' }
    ]
  });
  assert.equal(run.status, 0, JSON.stringify({ error: run.error, stderr: run.stderr }));
  assert.deepEqual(run.routes, [BARE_URL, CANONICAL_URL]);
  assert.deepEqual(run.result.exactPageUrlProof, {
    expected: BARE_URL,
    beforeActions: CANONICAL_URL,
    beforeApplicantData: CANONICAL_URL,
    beforeFinalChooser: CANONICAL_URL,
    beforeSubmit: CANONICAL_URL
  });
  assert.equal(run.result.extracted.find((entry) => entry.selector === '#applicant-state')?.value,
    'applicant@example.com');
  assert.equal(run.result.finalSubmitChooser.outcome, 'transport_unsupported');
  assert.equal(run.result.submitOutcome.pressed, false);
});

test('v4 blocks a Workable redirect whose job token does not match', async () => {
  const run = await runReplay({
    canonicalUrl: OTHER_TOKEN_URL,
    actions: [
      { type: 'fill', selector: '#email', value: 'must-not-land@example.com', label: 'email' },
      submitAction()
    ]
  });
  assert.notEqual(run.status, 0);
  assert.equal(run.result, null);
  assert.deepEqual(run.routes, [BARE_URL, OTHER_TOKEN_URL]);
});

test('v4 blocks a second Workable redirect after resolving the approved tenant page', async () => {
  const run = await runReplay({
    secondRedirectUrl: OTHER_TENANT_URL,
    actions: [
      { type: 'fill', selector: '#email', value: 'must-not-land@example.com', label: 'email' },
      submitAction()
    ]
  });
  assert.notEqual(run.status, 0);
  assert.equal(run.result, null);
  assert.deepEqual(run.routes, [BARE_URL, CANONICAL_URL, OTHER_TENANT_URL]);
});

test('v4 blocks a tenant-page drift before the next applicant-data action', async () => {
  const run = await runReplay({
    actions: [
      { type: 'click', selector: '#route-drift', label: 'review_route' },
      { type: 'fill', selector: '#email', value: 'must-not-land@example.com', label: 'email' },
      submitAction()
    ]
  });
  assert.notEqual(run.status, 0);
  assert.equal(run.result, null);
  assert.deepEqual(run.routes, [BARE_URL, CANONICAL_URL]);
  assert.match(JSON.stringify(run.error), /Employer page URL changed before applicant data could be applied/);
});
