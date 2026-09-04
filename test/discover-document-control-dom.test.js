/* THE REQUIRED CONTROL DISCOVERY COULD NOT SEE.
 *
 * Packet a34e5ce2 (DSI Innovations, Recruitee, 2026-09-03) went to an employer form whose one
 * required field was a document: "CV or resume *". The application review came back with
 * required_documents: [] - not "unknown", but measured and empty - so Litos did not know a resume
 * was mandatory on that form, nothing hard-blocked over it, and the packet sat at
 * ready_for_final_approval with Send enabled over an empty dropzone.
 *
 * The backend names this gap in its own source. measuredRequiredDocuments filters discovered
 * questions on 'required && portal_input_type === "file"', and the comment above it records that
 * "NEITHER discovery pass produces one yet ... stratus's managed discover scan builds its candidate
 * list the same way. So this filter is empty on both paths as the code stands." The consumer has
 * been waiting for a producer.
 *
 * Two things kept the producer silent, and both are fixed here:
 *   - the candidate list enumerated ten input types and not input[type=file];
 *   - every styled uploader hides its real file input behind a dropzone, so even once enumerated it
 *     was dropped by the visibility test and again by the honeypot test, exactly as a choice input
 *     would have been before choice inputs were exempted for the same reason.
 *
 * And one thing kept it reporting the wrong answer: a document control's required marker lives on
 * its block's own label, which neither marksRequired arm could reach.
 *
 * Every test here spawns the shipped runner against a served page and asserts on result.discovered.
 * Nothing matches on runner source text.
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

/* THE RECRUITEE BLOCK, transcribed from the run's own post-fill screenshot and kept identical to
 * the fixture starred-upload-readiness-dom.test.js uses for the same form: a starred label, a
 * styled dropzone carrying the empty prompt and the accepted-formats hint, and a bare file input
 * with no id for a label[for] to name and no wrapping label either. The input is hidden the way
 * every styled uploader hides it. */
const recruiteeStyle = `
<style>
  .dropzone { border: 1px dashed #999; padding: 24px; }
  .dropzone input[type=file] { display: none; }
</style>`;

const shapes = {
  'recruitee-required-cv': () => `${recruiteeStyle}
<form id="application">
  <div class="field"><label for="name">Full name *</label><input type="text" id="name" name="candidate.name" required></div>
  <div class="field">
    <label>CV or resume *</label>
    <div class="dropzone">Upload a file or drag and drop here
      <span>Accepted files: PDF, DOC, DOCX, JPEG and PNG up to 50MB.</span>
      <input type="file" name="candidate.cv">
    </div>
  </div>
  <div class="field">
    <label>Cover letter</label>
    <div class="dropzone">Upload a file or drag and drop here
      <input type="file" name="candidate.coverLetterFile">
    </div>
  </div>
</form>`,

  // The same control, visible and marked with the native attribute rather than a starred label.
  'native-required-attribute': () => `
<form id="application">
  <div class="field"><label for="cv">Resume</label><input type="file" id="cv" name="candidate.cv" required></div>
</form>`,

  /* A STARRED LABEL OVER A BLOCK THAT HOLDS A SECOND CONTROL. The block's label no longer speaks
   * for one control, so the block-label arm must decline rather than mark both required. */
  'shared-block': () => `
<form id="application">
  <div class="field">
    <label>Documents *</label>
    <div class="dropzone"><input type="file" name="candidate.cv"></div>
    <div class="dropzone"><input type="file" name="candidate.coverLetterFile"></div>
  </div>
</form>`,

  // A page legend explaining the asterisk convention must not make a document control required.
  'legend-only': () => `
<form id="application">
  <legend>* indicates a required field</legend>
  <div class="field">
    <label>Resume</label>
    <div class="dropzone"><input type="file" name="candidate.cv"></div>
  </div>
</form>`,

  // A block whose upload sits beside a text control is still discovered, just not made required by
  // the block label.
  'upload-beside-text': () => `
<form id="application">
  <div class="field">
    <label>Portfolio *</label>
    <input type="url" name="candidate.portfolioUrl">
    <div class="dropzone"><input type="file" name="candidate.portfolio"></div>
  </div>
</form>`
};

let server;
let workDir;

test.before(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const shape = shapes[url.searchParams.get('shape')];
    if (!shape) {
      response.writeHead(404, { 'content-type': 'text/plain' });
      return response.end('unknown shape');
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return response.end('<!doctype html><meta charset="utf-8"><title>Apply</title><body>' + shape() + '</body>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-discover-documents-'));
  fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);
});
test.after(async () => { if (server) await new Promise((resolve) => server.close(resolve)); });

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

async function discover(shape) {
  fs.rmSync(resultPath(), { force: true });
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: 'http://127.0.0.1:' + server.address().port + '/?shape=' + shape,
    actions: [{ type: 'discover' }],
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
  return JSON.parse(fs.readFileSync(resultPath(), 'utf8')).discovered || [];
}

/* Matched on the durable selector rather than the label, because questionLabel deliberately
 * normalises and augments what it returns (lowercased, with the control's own name and id folded in
 * as disambiguating hints). The selector is the stable identity, and it is also the field the
 * backend keys a question row on. */
const bySelector = (found, selector) => found.find((entry) => entry.durableSelector === selector);

test('a hidden required document control on a Recruitee block is discovered, typed and marked required', async () => {
  const found = await discover('recruitee-required-cv');
  const cv = bySelector(found, '[name="candidate.cv"]');
  assert.ok(cv, 'the required document control must be discovered: ' + JSON.stringify(found.map((f) => f.label)));
  assert.match(cv.label, /cv or resume/i, 'and it must carry the employer\'s own words');
  /* portal_input_type is the exact key the backend's measuredRequiredDocuments filters on, together
   * with required. Both have to be right or required_documents stays empty. */
  assert.equal(cv.inputType, 'file');
  assert.equal(cv.required, true, 'the starred label is the only place this form says so');
});

test('an unstarred document control on the same form is discovered and NOT required', async () => {
  const found = await discover('recruitee-required-cv');
  const cover = bySelector(found, '[name="candidate.coverLetterFile"]');
  assert.ok(cover, 'an optional document is still a control Litos should know about');
  assert.match(cover.label, /cover letter/i);
  assert.equal(cover.inputType, 'file');
  assert.equal(cover.required, false, 'nothing on this block marks the cover letter mandatory');
});

test('the text control on the same form is unchanged', async () => {
  // The point of narrowing the new required arm to file controls: nothing else moves.
  const found = await discover('recruitee-required-cv');
  const name = bySelector(found, '#name');
  assert.ok(name, JSON.stringify(found.map((f) => f.label)));
  assert.equal(name.inputType, 'text');
  assert.equal(name.required, true, 'this one was already required by its own attribute');
});

test('a native required attribute still decides on its own', async () => {
  const found = await discover('native-required-attribute');
  const cv = bySelector(found, '#cv');
  assert.ok(cv, JSON.stringify(found.map((f) => f.label)));
  assert.equal(cv.inputType, 'file');
  assert.equal(cv.required, true);
});

test('a starred label over two document controls marks neither required', async () => {
  /* The asymmetry: a wrong required flag on a document blocks a send the applicant was entitled to.
   * A block label that speaks for two controls does not say which one the employer means, so it
   * says nothing. Both controls are still discovered. */
  const found = await discover('shared-block');
  const files = found.filter((entry) => entry.inputType === 'file');
  assert.equal(files.length, 2, 'both document controls are discovered: ' + JSON.stringify(found));
  assert.deepEqual(files.map((entry) => entry.required), [false, false]);
});

test('a page legend explaining the asterisk does not make a document required', async () => {
  const found = await discover('legend-only');
  const cv = found.find((entry) => entry.inputType === 'file');
  assert.ok(cv, JSON.stringify(found));
  assert.equal(cv.required, false, '"* indicates a required field" is not a statement about this control');
});

test('a document control sharing its block with a text control is discovered but not made required by the block label', async () => {
  const found = await discover('upload-beside-text');
  const file = found.find((entry) => entry.inputType === 'file');
  assert.ok(file, JSON.stringify(found));
  assert.equal(file.inputType, 'file');
  assert.equal(file.required, false, 'the starred label may be speaking for the url field');
  // And the text control beside it is still judged by the arms that already existed.
  const url = found.find((entry) => entry.inputType === 'url');
  assert.ok(url, JSON.stringify(found));
});
