/* A REQUIRED UPLOAD THAT IS THE ONLY CONTROL IN ITS BLOCK.
 *
 * The gate excludes file inputs when it picks the control a marked label speaks for, so that a
 * block holding a real control prefers that one. On the asterisk arm, which passes no widget
 * fallback, a block whose ONLY control is the upload resolved to nothing at all - so the field was
 * not judged empty, it was skipped, and this runner pressed submit against a form with no resume.
 *
 * That is the DSI Innovations / Recruitee failure of 2026-09-02 (packet a34e5ce2): the upload
 * action reported success because setInputFiles returned cleanly, this gate stayed silent, and the
 * employer form had nothing to accept - which comes back as no_confirmation_state and an unverified
 * submission that cannot be resolved without opening the employer's portal.
 *
 * THE ASYMMETRY, the same one own-question-readiness-dom.test.js encodes: dropping a blocker that
 * was right sends an employer an application with no resume in it. Keeping one that was wrong costs
 * her a send. So the "silent" cases below are half this file, and they are what make the new arm
 * safe rather than merely louder.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* Extracted from the shipped runner string rather than copied, the way the other DOM tests here do
 * it. A copy would let this file keep passing while the gate drifted, which is the exact failure
 * that made the backend's PR #527 fix invisible in production. */
function readinessScanSource() {
  const start = SANDBOX_RUNNER.indexOf('const scan = (root = document) => {');
  assert.notEqual(start, -1, 'the readiness scan must still be in the runner');
  const end = SANDBOX_RUNNER.indexOf("const failed = { blocking: ['Required-field readiness scan failed']", start);
  assert.ok(end > start, 'could not bound the readiness scan');
  return SANDBOX_RUNNER.slice(start, end).trimEnd();
}

const SCAN_SOURCE = readinessScanSource();

let browser;
let page;

test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

async function readinessOf(html) {
  await page.setContent(`<!doctype html><html><body><form>${html}</form></body></html>`);
  return page.evaluate((source) => {
    // eslint-disable-next-line no-new-func
    const scan = new Function(`${source}\nreturn scan;`)();
    return scan(document);
  }, SCAN_SOURCE);
}

/* The shape DSI Innovations submitted against, transcribed from the run's own preview screenshot:
 * a starred label, a styled dropzone carrying the empty prompt, and a bare file input with no id
 * for the label to name. */
const recruiteeEmptyResume = `
  <div class="field">
    <label>CV or resume *</label>
    <div class="dropzone">Upload a file or drag and drop here</div>
    <input type="file" name="candidate[cv]">
  </div>`;

test('a starred block whose only control is an empty upload is reported', async () => {
  const readiness = await readinessOf(recruiteeEmptyResume);
  assert.deepEqual(readiness.blocking, ['"CV or resume" is required and is still empty']);
});

/* THE CASE THAT DECIDES WHERE THE EVIDENCE IS READ. An uploader that consumes the file and resets
 * its own input reads back empty, and the filename chip is rendered OUTSIDE the input's immediate
 * parent - a sibling of the dropzone, not a child of it. Handing note() the file input would read
 * uploadHasFile(input.parentElement), see the bare dropzone, and refuse a correct send. The block
 * is the target for exactly this reason. */
test('a filename rendered outside the input\'s own parent still counts as uploaded', async () => {
  const readiness = await readinessOf(`
    <div class="field">
      <label>CV or resume *</label>
      <div class="dropzone"><input type="file" name="candidate[cv]"></div>
      <span class="file-upload__filename">Mehek Mandal Resume.pdf</span>
    </div>`);
  assert.deepEqual(readiness.blocking, []);
});

test('a file held in the input is not reported', async () => {
  await page.setContent(`<!doctype html><html><body><form>${recruiteeEmptyResume}</form></body></html>`);
  await page.setInputFiles('input[type="file"]', {
    name: 'Mehek Mandal Resume.pdf',
    mimeType: 'application/pdf',
    buffer: Buffer.from('%PDF-1.4 test')
  });
  const readiness = await page.evaluate((source) => {
    // eslint-disable-next-line no-new-func
    const scan = new Function(`${source}\nreturn scan;`)();
    return scan(document);
  }, SCAN_SOURCE);
  assert.deepEqual(readiness.blocking, []);
});

test('an upload the employer did not mark is not reported', async () => {
  const readiness = await readinessOf(`
    <div class="field">
      <label>Cover letter</label>
      <input type="file" name="candidate[cover]">
    </div>`);
  assert.deepEqual(readiness.blocking, []);
});

/* The new arm adds a target where the chain resolved to nothing; it must not take one from a block
 * that already had a real control to speak for. */
test('a block holding a real control still resolves to that control', async () => {
  const readiness = await readinessOf(`
    <div class="field">
      <label>Full name *</label>
      <input type="text" value="Mehek Mandal">
      <input type="file" name="candidate[cv]">
    </div>`);
  assert.deepEqual(readiness.blocking, []);
});
