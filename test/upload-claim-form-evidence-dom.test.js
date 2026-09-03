/* AN UPLOAD IS CLAIMED ONLY WHEN THE EMPLOYER'S FORM SHOWS THE DOCUMENT.
 *
 * Packet a34e5ce2 (DSI Innovations, Recruitee) was filled twice, 2026-09-02 and 2026-09-03. Both
 * runs came back with resume and cover_letter in filled_fields, failed_fields empty and no skipped
 * reason, while the 2026-09-03 post-fill screenshot shows the required "CV or resume *" dropzone and
 * the "Cover letter" dropzone both still rendering the empty "Upload a file or drag and drop here"
 * prompt at native 1440px with no filename anywhere. The 09-02 attempt pressed submit on that form
 * and came back no_confirmation_state with no acknowledgement mail at the packet's alias.
 *
 * The backend reads filled_fields as a statement about the EMPLOYER'S FORM: a missing 'resume' is
 * the one thing filledFieldBlockers refuses a send for. The runner was reporting a statement about
 * its own process - setInputFiles returned - so the dashboard showed the packet complete with Send
 * enabled, and pressing it would file a real application to a real employer with no resume in it.
 *
 * Every test in this file spawns the SHIPPED runner (same runner string, same file protocol as
 * production) against a served page and asserts on result.filledFields and result.skipped. Nothing
 * here matches on runner source text, which is the whole point: the previous attempt at this fix
 * (PR #152) was four source-text pins, and seven no-op shims of its own mechanisms left the suite
 * fully green while the gate could not fire on the failure it was named after.
 *
 * THE ASYMMETRY these tests encode, the same one own-question-readiness-dom.test.js and
 * starred-upload-readiness-dom.test.js encode: dropping a claim that was right costs Mehek a send.
 * Keeping one that was wrong sends an employer an application with no resume, and an employer keeps
 * the first application it receives. So an ambiguous reading KEEPS the claim and says so out loud,
 * and half the tests below are about exactly which readings are ambiguous and which are not.
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

const RESUME_NAME = 'Mehek_Mandal_Resume.pdf';
const RESUME_FILE = {
  name: RESUME_NAME,
  mimeType: 'application/pdf',
  base64: Buffer.from('%PDF-1.4 stratus upload evidence fixture').toString('base64')
};
const COVER_FILE = {
  name: 'Mehek_Mandal_Cover_Letter.pdf',
  mimeType: 'application/pdf',
  base64: Buffer.from('%PDF-1.4 stratus cover letter fixture').toString('base64')
};

/* THE RECRUITEE BLOCK, transcribed from the run's own post-fill screenshot and kept identical to
 * the fixture starred-upload-readiness-dom.test.js uses for the same failure: a starred label, a
 * styled dropzone carrying the empty prompt, and a bare file input with no id for the label to
 * name. Every shape below is this block with one thing changed. */
const dropzoneField = (label, name, prompt = 'Upload a file or drag and drop here') => `
  <div class="field">
    <label>${label}</label>
    <div class="dropzone">${prompt}</div>
    <input type="file" name="${name}">
  </div>`;

const page = (body, script = '') => `<!doctype html><meta charset="utf-8"><title>Recruitee upload block</title>
<body>
<form id="application" action="/candidates" method="post">
${body}
<button id="submit" type="submit">Submit</button>
</form>
<script>
document.getElementById('application').addEventListener('submit', function (event) { event.preventDefault(); });
${script}
</script>
</body>`;

const wireDropzone = (selector, render) => `
var control = document.querySelector('${selector}');
control.addEventListener('change', function (event) {
  var uploaded = event.target.files[0] ? event.target.files[0].name : '';
  var zone = control.closest('.field').querySelector('.dropzone');
  ${render}
});`;

let beaconOrigin = '';
const shapes = {
  /* THE MEASURED FAILURE. No change listener at all, which is behaviourally identical to a board
   * whose listener never ran, and identical to the two DSI runs' screenshots. */
  'dsi-never-noticed': () => page(dropzoneField('CV or resume *', 'candidate[cv]')),

  // A board that took the file and told the applicant so, which must still be claimed.
  'renders-filename': () => page(
    dropzoneField('CV or resume *', 'candidate[cv]'),
    wireDropzone('input[type=file]', 'zone.textContent = uploaded;')
  ),

  /* THE BOARD PRINTING THE FILENAME WHILE SAYING IT FAILED. An unanchored substring test over the
   * block's textContent reads this sentence as proof the document is attached. */
  'says-it-failed': () => page(
    dropzoneField('CV or resume *', 'candidate[cv]'),
    wireDropzone('input[type=file]', "zone.textContent = uploaded + ' could not be uploaded. Please try again.';")
  ),

  // And the same, with the filename inside its own element so a one-level statement read would miss
  // the sentence that condemns it.
  'says-it-failed-nested': () => page(
    dropzoneField('CV or resume *', 'candidate[cv]'),
    wireDropzone('input[type=file]', "zone.innerHTML = '<strong>' + uploaded + '</strong> could not be uploaded.';")
  ),

  /* A STUCK PROGRESS INDICATOR NAMING THE FILE. This is the Greenhouse S3 case the runner already
   * documents: the eager POST never settled and React left a perpetual progress bar. */
  'stuck-progress': () => page(
    dropzoneField('CV or resume *', 'candidate[cv]'),
    wireDropzone('input[type=file]', "zone.textContent = 'Uploading ' + uploaded + ' 0%';")
  ),

  // The board's own static hint about what it accepts, naming a file called exactly what this run
  // is about to upload.
  'static-hint': () => page(dropzoneField(
    'CV or resume *',
    'candidate[cv]',
    'Upload a file or drag and drop here. Accepted: resume.pdf, resume.docx'
  )),

  /* TWO DOCUMENT QUESTIONS IN ONE CARD, the resume attached and the cover letter empty. A fixed
   * ancestor climb reads the resume's chip as evidence about the cover letter's control. */
  'neighbour-chip': () => page(`
    <div class="section">
      <div class="field">
        <label>CV or resume *</label>
        <div class="dropzone"><input type="file" name="candidate[cv]"></div>
        <span class="file-upload__filename">${RESUME_NAME}</span>
      </div>
      ${dropzoneField('Cover letter', 'candidate[cover]')}
    </div>`),

  /* NO FORM ELEMENT ANYWHERE, and a foreign filename chip one level above the question. A walk
   * whose only stop is FORM/BODY/HTML never stops here. */
  'formless-neighbour': () => `<!doctype html><meta charset="utf-8"><title>Formless board</title>
<body><div class="app"><div class="page"><div class="card"><div class="section">
  <span class="file-upload__filename">Somebody_Elses_Transcript.pdf</span>
  ${dropzoneField('CV or resume *', 'candidate[cv]')}
</div></div></div></div></body>`,

  /* A DECOY FILE INPUT INSIDE THE DROPZONE, ahead of the real control in DOM order, so that a
   * selector aimed at input[type=file] writes to a control nobody reads. Only the real input is
   * wired, exactly as a board that keeps a hidden duplicate behaves. */
  'decoy-first': () => page(`
    <div class="field">
      <label>CV or resume *</label>
      <div class="dropzone">Upload a file or drag and drop here<input type="file" class="decoy" tabindex="-1"></div>
      <input type="file" name="candidate[cv]">
    </div>`,
  wireDropzone('input[name="candidate[cv]"]', 'zone.textContent = uploaded;')),

  /* THE BOARD'S OWN UPLOAD POST, still open when the run wants to read the form. The page renders
   * the filename only when its POST resolves, and the server holds that POST past the settle cap. */
  'employer-post-hangs': () => page(
    dropzoneField('CV or resume *', 'candidate[cv]'),
    wireDropzone('input[type=file]', "fetch('/board-upload-slow', { method: 'POST', body: 'x' })"
      + '.then(function () { zone.textContent = uploaded; }).catch(function () {});')
  ),

  /* A THIRD-PARTY WRITE-SHAPED POST held open even longer, on a host outside the application's
   * registrable suffix. The board itself renders the filename at once, so if the settle waited on
   * write-shaped transport in general it would report this upload unsettled. */
  'third-party-post-hangs': () => page(
    dropzoneField('CV or resume *', 'candidate[cv]'),
    wireDropzone('input[type=file]', "fetch('" + beaconOrigin + "/beacon-slow', { method: 'POST', body: 'x' })"
      + '.catch(function () {}); zone.textContent = uploaded;')
  ),

  /* THE FILENAME CHIP AND NOTHING ELSE, beside a dropzone prompt the board did not clear. The chip
   * carries no readable file name, so this shape can only be claimed by the chip arm, and it is
   * also where the prompt has to NOT be a veto: counter-evidence counts where there is nothing to
   * count against. */
  'chip-only': () => page(`
    <div class="field">
      <label>CV or resume *</label>
      <div class="dropzone">Upload a file or drag and drop here</div>
      <span class="file-upload__filename">Attached</span>
      <input type="file" name="candidate[cv]">
    </div>`),

  /* A FILE NAME TRUNCATED PAST RECOGNITION, with a chip class this file has never seen. Neither the
   * exact-name arm nor the chip arm can read this, and it is a working upload. */
  'truncated-token': () => page(
    dropzoneField('CV or resume *', 'candidate[cv]'),
    wireDropzone('input[type=file]', "zone.textContent = 'Mehek_Mandal_Res\\u2026.pdf';")
  ),

  /* THE PROMPT ITSELF NAMING A DOCUMENT, which is what a board does when it shows an example
   * alongside its empty state. One document-shaped token, inside the prompt. */
  'prompt-names-a-document': () => page(dropzoneField(
    'CV or resume *',
    'candidate[cv]',
    'Upload a file or drag and drop here<br>example_resume.pdf'
  )),

  /* TWO DOCUMENT NAMES IN ONE STATEMENT, the prompt cleared. A pair of names is a list of what the
   * board will take, not the document it took. */
  'two-sample-names': () => page(
    dropzoneField('CV or resume *', 'candidate[cv]'),
    wireDropzone('input[type=file]', "zone.textContent = 'resume.pdf / resume.docx';")
  ),

  // And one that renders the filename INSIDE the dropzone without clearing the prompt.
  'filename-inside-prompt': () => page(
    dropzoneField('CV or resume *', 'candidate[cv]'),
    wireDropzone('input[type=file]', "zone.textContent = 'Upload a file or drag and drop here ' + uploaded;")
  ),

  /* GREENHOUSE, which REMOVES its file input on completion and replaces it with a filename chip.
   * The control this run wrote to is gone by the time the form is read, so the evidence has to come
   * from the block that outlived it. */
  'control-consumed': () => page(
    dropzoneField('CV or resume *', 'candidate[cv]'),
    wireDropzone('input[type=file]', `
  var chip = document.createElement('span');
  chip.className = 'file-upload__filename';
  chip.textContent = uploaded;
  zone.textContent = '';
  zone.appendChild(chip);
  control.remove();`)
  ),

  /* AND THE SAME REMOVAL WITH NOTHING PUT IN ITS PLACE, which is the shape the review measured
   * #152 keeping: a board that unmounted the input because the upload failed. */
  'control-consumed-empty': () => page(
    dropzoneField('CV or resume *', 'candidate[cv]'),
    wireDropzone('input[type=file]', 'control.remove();')
  ),

  /* EVERY CONTROL A FLAT SIBLING OF EVERY OTHER, so the file input's immediate parent is the whole
   * form. There is no question block to read here at all, and a foreign filename chip sits in that
   * same parent waiting to be borrowed. */
  'flat-siblings': () => `<!doctype html><meta charset="utf-8"><title>Flat form</title>
<body><form id="application">
  <label>Full name</label><input type="text" name="name">
  <label>CV or resume *</label>
  <div class="dropzone">Upload a file or drag and drop here</div>
  <input type="file" name="candidate[cv]">
  <span class="file-upload__filename">Somebody_Elses_Transcript.pdf</span>
</form></body>`
};

let server;
let beaconServer;
let workDir;
const pendingTimers = new Set();
const openSockets = new Set();

function serve(request, response) {
  const url = new URL(request.url, 'http://127.0.0.1');
  const hold = (ms) => {
    const timer = setTimeout(() => {
      pendingTimers.delete(timer);
      response.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
      response.end('ok');
    }, ms);
    pendingTimers.add(timer);
  };
  // Held well past UPLOAD_TRANSPORT_SETTLE_MS so that "did the run wait for this?" is answerable
  // from the result rather than from a stopwatch.
  if (url.pathname === '/board-upload-slow') return hold(6000);
  if (url.pathname === '/beacon-slow') return hold(6000);
  const shape = shapes[url.searchParams.get('shape')];
  if (!shape) {
    response.writeHead(404, { 'content-type': 'text/plain' });
    return response.end('unknown shape');
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  return response.end(shape());
}

test.before(async () => {
  server = http.createServer(serve);
  server.on('connection', (socket) => {
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
  });
  beaconServer = http.createServer(serve);
  beaconServer.on('connection', (socket) => {
    openSockets.add(socket);
    socket.on('close', () => openSockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  // 'localhost' and '127.0.0.1' have different registrable suffixes, which is how a genuinely
  // third-party host is arranged without leaving the machine.
  await new Promise((resolve) => beaconServer.listen(0, 'localhost', resolve));
  beaconOrigin = 'http://localhost:' + beaconServer.address().port;
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-upload-evidence-'));
  fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);
});

test.after(async () => {
  for (const timer of pendingTimers) clearTimeout(timer);
  pendingTimers.clear();
  for (const socket of openSockets) socket.destroy();
  openSockets.clear();
  if (server) await new Promise((resolve) => server.close(resolve));
  if (beaconServer) await new Promise((resolve) => beaconServer.close(resolve));
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

async function run(shape, actions) {
  fs.rmSync(resultPath(), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: 'http://127.0.0.1:' + server.address().port + '/?shape=' + shape,
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

const uploadResume = (selector = 'input[type="file"]') => ({
  type: 'upload',
  selector,
  file: RESUME_FILE,
  label: 'resume',
  optional: true
});

const said = (result, pattern) => (result.skipped || []).some((line) => pattern.test(line));

/* ------------------------------------------------------------------ the measured failure */

test('the DSI shape drops the resume claim and says why', async () => {
  const result = await run('dsi-never-noticed', [uploadResume()]);
  // THE PRODUCTION DEFECT. This asserted ['resume'] before the gate existed, with skipped empty.
  assert.deepEqual(result.filledFields, [], 'a dropzone still asking for a file has taken nothing');
  assert.equal(result.failedFields?.length ?? 0, 0, 'the setInputFiles call itself did not fail');
  assert.ok(
    said(result, /resume: the file was set into .* and the form did not take it/),
    'the reason must be named, not silent: ' + JSON.stringify(result.skipped)
  );
  assert.ok(said(result, /still asking for a file/), JSON.stringify(result.skipped));
});

test('a board that shows the file name keeps the claim, silently', async () => {
  const result = await run('renders-filename', [uploadResume()]);
  assert.deepEqual(result.filledFields, ['resume']);
  assert.deepEqual(result.skipped, [], 'a form that shows the document needs no explanation');
});

/* ------------------------------------------------------------------ the filename is not enough */

test('a filename inside the board own failure sentence does not keep the claim', async () => {
  const result = await run('says-it-failed', [uploadResume()]);
  assert.deepEqual(result.filledFields, []);
  assert.ok(said(result, /reports the upload failed/), JSON.stringify(result.skipped));
});

test('a filename wrapped in its own element inside a failure sentence does not keep the claim', async () => {
  const result = await run('says-it-failed-nested', [uploadResume()]);
  assert.deepEqual(result.filledFields, []);
  assert.ok(said(result, /reports the upload failed/), JSON.stringify(result.skipped));
});

test('a stuck progress indicator naming the file is never a silent success', async () => {
  const result = await run('stuck-progress', [uploadResume()]);
  /* Ambiguous by the asymmetry above, so the claim is KEPT: a progress bar at 100% about to swap
   * itself for a chip is a working upload, and the run has already waited for the board's own
   * transport. What is forbidden is saying nothing, which is what the two DSI runs did. */
  assert.deepEqual(result.filledFields, ['resume']);
  assert.ok(
    said(result, /claimed without evidence/) && said(result, /upload still in progress/),
    'a progress bar must be reported as unproven: ' + JSON.stringify(result.skipped)
  );
});

test('the board own list of accepted file names is not a document', async () => {
  // Uploading a file called exactly what the board's static hint names, so the only thing that can
  // tell them apart is that the hint is the board describing what it accepts.
  const result = await run('static-hint', [{
    type: 'upload',
    selector: 'input[type="file"]',
    file: { ...RESUME_FILE, name: 'resume.pdf' },
    label: 'resume',
    optional: true
  }]);
  assert.deepEqual(result.filledFields, []);
  assert.ok(said(result, /still asking for a file/), JSON.stringify(result.skipped));
});

/* ------------------------------------------------------------------ scope */

test('an empty cover letter cannot borrow the resume filename chip beside it', async () => {
  const result = await run('neighbour-chip', [
    uploadResume('input[name="candidate[cv]"]'),
    {
      type: 'upload',
      selector: 'input[name="candidate[cover]"]',
      file: COVER_FILE,
      label: 'cover_letter',
      optional: true
    }
  ]);
  assert.deepEqual(result.filledFields, ['resume'], 'the resume has a chip; the cover letter has a prompt');
  assert.ok(said(result, /cover_letter: the file was set into .* did not take it/), JSON.stringify(result.skipped));
  assert.ok(!said(result, /^resume:/), 'the resume claim must not be disturbed');
});

test('a formless board cannot widen the scope into a neighbour chip', async () => {
  const result = await run('formless-neighbour', [uploadResume('input[name="candidate[cv]"]')]);
  assert.deepEqual(result.filledFields, [], 'a chip one level up belongs to another question');
  assert.ok(said(result, /still asking for a file/), JSON.stringify(result.skipped));
});

test('a write into a decoy file input the board never reads is not a filled field', async () => {
  // 'input[type="file"]' resolves to the decoy, so this is the mis-targeted upload: the run writes
  // to control A, the wired control B stays empty, and nothing on the form changes.
  const result = await run('decoy-first', [uploadResume('input[type="file"]')]);
  assert.deepEqual(result.filledFields, []);
  assert.ok(said(result, /still asking for a file/), JSON.stringify(result.skipped));
});

test('the same page claims the upload when the write lands on the control the board reads', async () => {
  // The control the mis-target test missed, on the identical page. Without this the test above
  // would also pass against a gate that simply refuses every upload on that markup.
  const result = await run('decoy-first', [uploadResume('input[name="candidate[cv]"]')]);
  assert.deepEqual(result.filledFields, ['resume']);
  assert.deepEqual(result.skipped, []);
});

/* ------------------------------------------------------------------ the settle */

test('the run waits for the board own upload POST and reports it if it never lands', async () => {
  const result = await run('employer-post-hangs', [uploadResume()]);
  /* The page renders the filename only when its own POST resolves, and the server holds that POST
   * past the settle cap. So this asserts two things at once: the run waited on employer-bound
   * write-shaped transport, and an upload it could not see land is not claimed. */
  assert.deepEqual(result.filledFields, []);
  assert.ok(
    said(result, /still had upload transport in flight after \d+ms/),
    'an upload POST still open when the run gave up must be named: ' + JSON.stringify(result.skipped)
  );
});

test('a third-party POST cannot consume the upload wait', async () => {
  const result = await run('third-party-post-hangs', [uploadResume()]);
  // Held longer than the settle cap, so a watch with no host predicate would have to report it.
  assert.deepEqual(result.filledFields, ['resume']);
  assert.ok(
    !said(result, /in flight/),
    'a POST outside the application registrable suffix is not this upload: ' + JSON.stringify(result.skipped)
  );
});

/* ------------------------------------------------------------------ the generous direction */

test('a filename chip with no readable name keeps the claim, prompt or no prompt', async () => {
  // Nothing here is a file name, so only the chip arm can carry this, and the uncleared prompt must
  // not veto it.
  const result = await run('chip-only', [uploadResume('input[name="candidate[cv]"]')]);
  assert.deepEqual(result.filledFields, ['resume']);
  assert.deepEqual(result.skipped, [], 'a chip is the form showing the document');
});

test('a truncated file name the exact-name arm cannot match keeps the claim', async () => {
  // Only the document-token arm can carry this one: no chip class, and the name is not the name
  // this run uploaded. This is the arm that stops the gate refusing a working uploader.
  const result = await run('truncated-token', [uploadResume()]);
  assert.deepEqual(result.filledFields, ['resume']);
  assert.deepEqual(result.skipped, []);
});

test('a document name printed inside the empty prompt is not an attachment', async () => {
  const result = await run('prompt-names-a-document', [uploadResume()]);
  assert.deepEqual(result.filledFields, [], 'the prompt naming a document is still the prompt');
  assert.ok(said(result, /still asking for a file/), JSON.stringify(result.skipped));
});

test('two document names in one statement are a list, not a document', async () => {
  const result = await run('two-sample-names', [uploadResume()]);
  // Ambiguous rather than refused, so the claim stands, but it is reported as unproven.
  assert.deepEqual(result.filledFields, ['resume']);
  assert.ok(said(result, /claimed without evidence/), JSON.stringify(result.skipped));
});

test('a filename rendered inside an uncleared prompt keeps the claim', async () => {
  const result = await run('filename-inside-prompt', [uploadResume()]);
  assert.deepEqual(result.filledFields, ['resume']);
  assert.deepEqual(result.skipped, []);
});

test('an uploader that removes its own control and shows a chip keeps the claim', async () => {
  // The evidence has to survive the control: this is why the block is captured before the write.
  const result = await run('control-consumed', [uploadResume()]);
  assert.deepEqual(result.filledFields, ['resume']);
  assert.deepEqual(result.skipped, []);
});

test('a form with no question block to read reports no evidence rather than borrowing a chip', async () => {
  const result = await run('flat-siblings', [uploadResume('input[type="file"]')]);
  /* The generous direction, and the point of it: there is nothing here this can honestly read, so
   * the claim stands and the run says the form showed no sign of the document. What it must never
   * do is widen until the transcript chip in the same parent satisfies the resume. */
  assert.deepEqual(result.filledFields, ['resume']);
  assert.ok(said(result, /claimed without evidence/), JSON.stringify(result.skipped));
  assert.ok(
    !said(result, /Somebody_Elses_Transcript/),
    'a neighbour document must never appear in this action\'s evidence: ' + JSON.stringify(result.skipped)
  );
});

test('an uploader that removes its own control and shows nothing is not a silent success', async () => {
  /* The dropzone prompt is still there, so this is the same statement as the DSI shape: the form is
   * asking for a file. #152's gate kept this claim, on the reasoning that a missing control proves
   * an uploader that took the file. */
  const result = await run('control-consumed-empty', [uploadResume()]);
  assert.deepEqual(result.filledFields, []);
  assert.ok(said(result, /still asking for a file/), JSON.stringify(result.skipped));
  assert.ok(said(result, /the control is gone/), JSON.stringify(result.skipped));
});
