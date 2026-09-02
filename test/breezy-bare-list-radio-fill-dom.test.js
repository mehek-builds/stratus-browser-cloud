/* A BREEZY EEOC RADIO GROUP IN BARE LIST ROWS, run through the shipped runner against the markup
 * that lost it.
 *
 * Measured on the live alertalarm.breezy.hr Field Project Manager apply form, 2026-09-01: the
 * veteran and disability sections render as
 *
 *   <h3>Voluntary Self-Identification of Veteran Status</h3>
 *   <p>...preamble...</p>
 *   <ul>
 *     <li><input id="vet_yes" type="radio" name="eeoc.veteran_status" value="true"><label for="vet_yes">...</label></li>
 *     <li><input id="vet_no" type="radio" name="eeoc.veteran_status" value="false"><label for="vet_no">...</label></li>
 *     <li><input id="vet_nope" type="radio" name="eeoc.veteran_status" value="unspecified"><label for="vet_nope">...</label></li>
 *   </ul>
 *
 * with no fieldset, class or role anywhere. PR #141 made the option inventory read all three rows.
 * Two halves remained before a stored "No" was actually pressed:
 *   - the fillByLabelText block. The label lookup finds the <h3>, the semantic-ancestor walk finds
 *     nothing, and the container fallback depends on which wrappers the theme adds: none (no div
 *     holds a control, so "field not found"), one per section (works), or one around every EEOC
 *     section (three names, refused). The rows' own same-name ancestor is the group in every case;
 *   - the chooser. "No" against "I identify as ..." / "I am not a protected veteran" / "I don't
 *     wish to answer" matched nothing, so even the lucky wrapper reported no option matched.
 *
 * Every test here spawns the shipped runner (same runner string, same file protocol as production)
 * against a served page and asserts on what happened to the form. Nothing matches on runner text.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const providerDeadlineAt = () => new Date(Date.now() + 240_000).toISOString();

const VETERAN_LABEL = 'Voluntary Self-Identification of Veteran Status';
const DISABILITY_LABEL = 'Voluntary Self-Identification of Disability';

const GENDER_SECTION = `
  <h3>Voluntary Self-Identification of Gender and Race/Ethnicity</h3>
  <ul><li><span>Gender</span>
    <div><ul>
      <li class="option"><input id="gender_male" type="radio" name="gender" value="male"><label for="gender_male"><span>Male</span></label></li>
      <li class="option"><input id="gender_female" type="radio" name="gender" value="female"><label for="gender_female"><span>Female</span></label></li>
      <li class="option"><input id="gender_no" type="radio" name="gender" value="unspecified"><label for="gender_no"><span>I don't wish to answer</span></label></li>
    </ul></div>
  </li></ul>`;
const VETERAN_SECTION = `
  <h3>${VETERAN_LABEL}</h3>
  <p>This employer is a Government contractor subject to the Vietnam Era Veterans' Readjustment Assistance Act.</p>
  <p>Please check one of the boxes below:</p>
  <ul>
    <li><input id="vet_yes" type="radio" name="eeoc.veteran_status" value="true"><label for="vet_yes"><strong>I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERAN LISTED ABOVE</strong></label></li>
    <li><input id="vet_no" type="radio" name="eeoc.veteran_status" value="false"><label for="vet_no"><strong>I AM NOT A PROTECTED VETERAN</strong></label></li>
    <li><input id="vet_nope" type="radio" name="eeoc.veteran_status" value="unspecified"><label for="vet_nope"><strong>I DON'T WISH TO ANSWER</strong></label></li>
  </ul>`;
const DISABILITY_SECTION = `
  <h3>${DISABILITY_LABEL}</h3>
  <ul>
    <li><input id="disability_yes" type="radio" name="eeoc.disability_status" value="true"><label for="disability_yes"><strong>Yes, I have a disability, or have had one in the past</strong></label></li>
    <li><input id="disability_no" type="radio" name="eeoc.disability_status" value="false"><label for="disability_no"><strong>No, I don't have a disability</strong></label></li>
    <li><input id="disability_nope" type="radio" name="eeoc.disability_status" value="unspecified"><label for="disability_nope"><strong>I don't wish to answer</strong></label></li>
  </ul>`;

/* Three wrapper shapes around the same three sections. The live page is the first; the other two
 * are the wrappers a Breezy theme can add, and they are the two the old container fallback
 * resolved differently (one per section: worked; one around all: three names, refused). */
const WRAPPERS = {
  '/bare': (sections) => sections.join('<hr>'),
  '/sections': (sections) => sections.map((section) => `<div class="section">${section}</div>`).join(''),
  '/wrapped': (sections) => `<div class="eeoc">${sections.join('<hr>')}</div>`,
};

const fixture = (wrap) => `<!doctype html><meta charset="utf-8"><title>Breezy EEOC</title>
<body>
<form id="application-form" action="/apply" method="post">
<h2>Apply for this position</h2>
<label for="name">Name</label> <input id="name" name="name" type="text">
${wrap([GENDER_SECTION, VETERAN_SECTION, DISABILITY_SECTION])}
<button id="submit" type="submit">Submit application</button>
</form>
<div id="echo"></div>
<script>
  document.addEventListener('change', function () {
    var picks = [];
    var checked = document.querySelectorAll('input[type=radio]:checked');
    for (var index = 0; index < checked.length; index += 1) picks.push(checked[index].id);
    document.getElementById('echo').textContent = picks.join(',');
  });
  document.getElementById('application-form').addEventListener('submit', function (event) {
    event.preventDefault();
  });
</script>
</body>`;

let server;
let workDir;
test.before(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const wrap = WRAPPERS[url.pathname];
    if (!wrap) {
      response.writeHead(404, { connection: 'close' });
      response.end('no such fixture');
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    response.end(fixture(wrap));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-breezy-eeoc-'));
  fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);
});
test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

const resultPath = () => path.join(workDir, 'stratus-result-0.json');

function waitForRunner(child, timeoutMs = 90_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('runner timed out'));
    }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (status) => { clearTimeout(timer); resolve(status); });
  });
}

async function run(fixturePath, actions) {
  fs.rmSync(resultPath(), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: `http://127.0.0.1:${server.address().port}${fixturePath}`,
    actions,
    allowSubmit: false,
    providerDeadlineAt: providerDeadlineAt(),
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 }
  }));
  const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'], {
    cwd: workDir,
    env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
  });
  child.stderr.resume();
  child.stdout.resume();
  await waitForRunner(child);
  assert.ok(fs.existsSync(resultPath()), 'the runner must produce a result file');
  return JSON.parse(fs.readFileSync(resultPath(), 'utf8'));
}

const byLabel = (text, value) => ({ type: 'fillByLabelText', text, value, label: text, optional: true });
const echoOf = (result) => result.extracted.find((entry) => entry.selector === '#echo')?.value;

for (const variant of Object.keys(WRAPPERS)) {
  test(`a stored "No" under the veteran heading presses "I am not a protected veteran" (${variant})`, async () => {
    const result = await run(variant, [
      byLabel(VETERAN_LABEL, 'No'),
      { type: 'extract', selector: '#echo' }
    ]);
    // The production defect, in three wrapper shapes: "field not found" with no wrapper, a
    // three-groups refusal with one wrapper around every section, and "no option matched" with
    // the one wrapper shape that reached the rows. The rows' own same-name ancestor is the group in
    // every shape, so every shape ticks the negated row and nothing else.
    assert.deepEqual(result.skipped, [], 'a "No" with a single negated statement on the group may not be skipped');
    assert.deepEqual(result.filledFields, [VETERAN_LABEL]);
    assert.equal(echoOf(result), 'vet_no', 'the negated row, and only it, must genuinely be checked');
  });
}

test('the same "No" on the disability group, and a "Yes", each press their own row', async () => {
  const result = await run('/bare', [
    byLabel(DISABILITY_LABEL, 'No'),
    byLabel(VETERAN_LABEL, 'Yes'),
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.filledFields, [DISABILITY_LABEL, VETERAN_LABEL]);
  assert.equal(echoOf(result), 'vet_yes,disability_no');
});

test('a stored refusal lands on the refusal row, and a gender answer reaches its own bare rows', async () => {
  const result = await run('/bare', [
    byLabel(VETERAN_LABEL, 'I decline to self-identify'),
    byLabel('Gender', 'Female'),
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.filledFields, [VETERAN_LABEL, 'Gender']);
  assert.equal(echoOf(result), 'gender_female,vet_nope');
});

test('an answer the group does not carry is left unticked and named, never guessed', async () => {
  const result = await run('/bare', [
    byLabel(VETERAN_LABEL, 'Maybe'),
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.filledFields, []);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /no option matched "Maybe"/);
  assert.equal(echoOf(result), '', 'nothing may be ticked for an answer that is not on the list');
});
