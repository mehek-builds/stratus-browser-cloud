/* THE MYTOS EDUCATION CARD, WITH LEVER'S OWN SELECT2 4.0.0 RUNNING, through the shipped runner.
 *
 * Measured in production 2026-08-28 (application 55de7c9e, submission run a274b5c0), on the fully
 * fixed stack after PRs #114-#116: the Mytos run filled the form, found the submit control, and
 * held the press with 'Litos did not press submit: 2 required field confirmations failed
 * ([name="cards[62541ff1-...][field5]"]; A required field on the form has no label Litos can
 * read, and is still empty)'.
 *
 * Replayed byte-for-byte here against the markup captured read-only from the live
 * jobs.lever.co/mytos apply page the same day, with the exact jquery-3.6.1.min.js and Select2
 * 4.0.0 select2.full.min.js Lever serves (vendored under test/fixtures/lever/), initialised the
 * way Lever's own inline script does: $('.application-university select').select2({}).
 *
 * What the replay proved, against the suspicion that shipped with PR #116:
 *
 *   1. The Select2 v4 university picker is NOT the failing control. The fill lands on the backing
 *      native select ('<select required>' left 1x1 and aria-hidden by Select2 4.0.0, holding the
 *      submitted value), Select2's own change listener repaints .select2-selection__rendered with
 *      the chosen university, and the required gates read the answered select as answered. The
 *      happy-path test below pins all three of those readings against real Select2 4.0.0, which
 *      no test had ever loaded before.
 *
 *   2. BOTH production failures were ONE control, reported twice and namelessly: the
 *      degree-classification select (field5), whose stored answer '3.89/4.00 (US 4.0 scale)'
 *      matches none of the nine band options - 3.89 sits in the gap between 'GPA 3.5-3.8' and
 *      'GPA 3.9+', so refusing to guess a band is the correct fail-closed refusal. The DEFECT is
 *      the reporting: Lever heads each card question with a plain div.application-label inside
 *      li.application-question, no <label>, no aria, no id, so both required gates' labelOf
 *      copies came back empty. The atomic scan reported the field as its naked name selector, and
 *      readSubmitReadiness reported the same field again as 'A required field on the form has no
 *      label Litos can read, and is still empty' - two anonymous sentences for one on-screen
 *      question. PR #116's fixture taught DISCOVERY's questionLabel this heading; the two gates
 *      were left behind.
 *
 * The fix teaches both labelOf copies the Lever card heading (one control in the card, a heading
 * holding no control, or nothing) and drops readiness's restatement of a field the confirmation
 * loop already reported by the same label. The submit stays held - an unanswerable required
 * select must block - but it is held ONCE, under the employer's own words.
 *
 * Every test spawns the shipped runner (same runner string, same protocol as production) against
 * a served page. Nothing matches on runner source text.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ATOMIC_SUBMIT_POLICY, SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CARD = 'cards[62541ff1-0b7c-4f5b-a51d-a217d565776e]';
const providerDeadlineAt = () => new Date(Date.now() + 240_000).toISOString();

const CLASSIFICATION_LABEL = 'What was your degree classification?✱';
const CLASSIFICATION_SELECTOR = `[name="${CARD}[field5]"]`;
const NO_LABEL_SENTENCE = 'A required field on the form has no label Litos can read, and is still empty';

/* Transcribed from the captured Mytos apply page (2026-08-28), structure intact: the question in
 * a div.application-label heading, the control alone in div.application-field, the required mark
 * welded to the heading text, and nothing carrying a <label>, an id or any aria naming. */
const cardSelect = (field, prompt, options) => `
  <li class="application-question custom-question"><div>
    <div class="application-label full-width dropdown"><div class="text">${prompt}<span class="required">✱</span></div></div>
    <div class="application-field full-width required-field"><div class="application-dropdown">
      <select name="${CARD}[${field}]" required><option value="">Select...</option>${options.map((option) => `<option value="${option}">${option}</option>`).join('')}</select>
    </div></div>
  </div></li>`;

const cardText = (field, prompt) => `
  <li class="application-question custom-question"><div>
    <div class="application-label full-width text"><div class="text">${prompt}<span class="required">✱</span></div></div>
    <div class="application-field full-width required-field">
      <input required="required" class="card-field-input" type="text" placeholder="Type your response" value="" name="${CARD}[${field}]" />
    </div>
  </div></li>`;

const cardTextarea = (field, prompt) => `
  <li class="application-question custom-question"><div>
    <div class="application-label full-width textarea"><div class="text">${prompt}<span class="required">✱</span></div></div>
    <div class="application-field full-width required-field">
      <textarea required="required" class="card-field-textarea" placeholder="Type your response" name="${CARD}[${field}]"></textarea>
    </div>
  </div></li>`;

/* The live list is thousands of institutions; the shape - a required native select carrying a
 * placeholder option, wrapped by div.application-university, upgraded by Lever's inline
 * $('.application-university select').select2({}) - is what matters and is kept exactly. */
const universityPicker = `
  <li class="application-question custom-question"><div>
    <div class="application-label full-width university"><div class="text">Which was the most recent university you attended?<span class="required">✱</span></div></div>
    <div class="application-field full-width required-field"><div class="application-university">
      <select data-qa="university-dropdown" name="${CARD}[field0]" id="university-picker-62541ff1-0b7c-4f5b-a51d-a217d565776e-0" style="width: 100%" data-allow-clear="false" data-placeholder="Select a university or college" required>
        <option value="">Select a university or college</option>
        <option value="Auckland University of Technology">Auckland University of Technology</option>
        <option value="Bond University">Bond University</option>
        <option value="University of California, Los Angeles (UCLA)">University of California, Los Angeles (UCLA)</option>
        <option value="University of Southern California">University of Southern California</option>
        <option value="University of Oxford">University of Oxford</option>
        <option value="Other">Other</option>
      </select>
    </div></div>
  </div></li>`;

const CLASSIFICATION_OPTIONS = [
  'First-Class Honours (First or 1st) (70% and above)',
  'Upper Second-Class Honours (2:1, 2.i) (60-70%)',
  'Lower Second-Class Honours (2:2, 2.ii) (50-60%)',
  'Third-Class Honours (Third or 3rd) (40-50%)',
  'GPA &lt;3.0', 'GPA 3.0-3.4', 'GPA 3.5-3.8', 'GPA 3.9+', 'Other'
];

const fixture = `<!doctype html><html><head><meta charset="utf-8"><title>Mytos education card</title>
<link href="/styles/select2.min.css" rel="stylesheet">
<style>.application-dropdown select { width: 100%; }</style>
</head>
<body class="application">
<form id="application-form" enctype="multipart/form-data" method="POST" action="/candidates">
<div class="section page-centered application-form"><h4>Submit your application</h4><ul>
  <li class="application-question"><label><div class="application-label">Full name<span class="required">✱</span></div><div class="application-field"><input type="text" data-qa="name-input" name="name" required></div></label></li>
  <li class="application-question"><label><div class="application-label">Email<span class="required">✱</span></div><div class="application-field"><input name="email" data-qa="email-input" type="email" required></div></label></li>
</ul></div>
<div class="section page-centered application-form" data-qa="additional-cards">
<h4 data-qa="card-name">EDUCATION</h4>
<input type="hidden" value='{"text":"EDUCATION"}' name="${CARD}[baseTemplate]">
<ul>
${universityPicker}
${cardSelect('field1', 'What discipline did your degree fall under?', ['Engineering', 'Computer Science', 'Natural Sciences', 'Social Sciences', 'Arts', 'Other', 'Code bootcamp'])}
${cardText('field2', 'What degree did you complete at the above university?')}
${cardSelect('field3', 'What level of formal educational qualification do you hold?', ['GCSE, or equivalent', 'A-level, or equivalent', "Undergraduate, Bachelor's, or equivalent", "Postgraduate, Master's, or equivalent", 'PhD, or equivalent'])}
${cardText('field4', 'What was your numeric percentage average?')}
${cardSelect('field5', 'What was your degree classification?', CLASSIFICATION_OPTIONS)}
${cardTextarea('field6', 'What have you built that was challenging, you had ownership of and are proud of?')}
${cardSelect('field7', 'Do you require a visa to work in the UK?', ['Yes - I require a visa sponsorship', 'No - I have the right to work in the UK', 'Temporary right to work in the UK (e.g. graduate visa)', 'Other'])}
</ul>
</div>
<button id="btn-submit" type="submit" data-qa="btn-submit" class="postings-btn template-btn-submit">Submit application</button>
</form>
<div id="submitted"></div>
<div id="university-echo"></div>
<script src="/js/jquery-3.6.1.min.js"></script>
<script src="/js/select2.full.min.js" type="text/javascript"></script>
<script>$(function() {$('.application-university select').select2({});});</script>
<script>
  document.addEventListener('change', function () {
    var university = document.querySelector('[name="${CARD}[field0]"]');
    document.getElementById('university-echo').textContent = university ? university.value : '';
  });
  document.getElementById('application-form').addEventListener('submit', function (event) {
    event.preventDefault();
    document.getElementById('submitted').textContent = 'submitted';
  });
</script>
</body></html>`;

const assets = {
  '/js/jquery-3.6.1.min.js': ['application/javascript', fs.readFileSync(path.join(HERE, 'fixtures/lever/jquery-3.6.1.min.js'))],
  '/js/select2.full.min.js': ['application/javascript', fs.readFileSync(path.join(HERE, 'fixtures/lever/select2.full.min.js'))],
  '/styles/select2.min.css': ['text/css', fs.readFileSync(path.join(HERE, 'fixtures/lever/select2.min.css'))]
};

let server;
let workDir;
test.before(async () => {
  server = http.createServer((request, response) => {
    const url = new URL(request.url, 'http://127.0.0.1');
    const asset = assets[url.pathname];
    if (asset) {
      response.writeHead(200, { 'content-type': asset[0], connection: 'close' });
      response.end(asset[1]);
      return;
    }
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    response.end(fixture);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-lever-select2v4-'));
  fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);
});
test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

const resultPath = () => path.join(workDir, 'stratus-result-0.json');

function waitForRunner(child, timeoutMs = 120_000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      try { child.kill('SIGKILL'); } catch {}
      reject(new Error('runner timed out'));
    }, timeoutMs);
    child.once('error', (error) => { clearTimeout(timer); reject(error); });
    child.once('close', (status) => { clearTimeout(timer); resolve(status); });
  });
}

async function run(actions) {
  fs.rmSync(resultPath(), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: `http://127.0.0.1:${server.address().port}/`,
    actions,
    allowSubmit: true,
    submissionAttempt: {
      runId: '11111111-1111-4111-8111-111111111111',
      claimId: '22222222-2222-4222-8222-222222222222',
      executionId: '33333333-3333-4333-8333-333333333333'
    },
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

const fill = (selector, value, label) => ({ type: 'fill', selector, value, label, optional: true });
const submitAction = {
  type: 'confirmAndSubmit',
  selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
  chooserPolicy: ATOMIC_SUBMIT_POLICY,
  label: 'final_submit',
  optional: false,
  maxRetries: 1,
  contractVersion: 2,
  submitKind: 'application'
};

const cardFills = (classificationAnswer) => [
  fill('[name="name"]', 'Mehek Mandal', 'name'),
  fill('[name="email"]', 'mehek@example.com', 'email'),
  fill(`[name="${CARD}[field0]"]`, 'University of Southern California', 'question:which was the most recent university you attended? ✱'),
  fill(`[name="${CARD}[field1]"]`, 'Computer Science', 'question:what discipline did your degree fall under? ✱'),
  fill(`[name="${CARD}[field2]"]`, 'Bachelor of Science in Computer Science', 'question:what degree did you complete at the above university? ✱'),
  fill(`[name="${CARD}[field3]"]`, "Undergraduate, Bachelor's, or equivalent", 'question:what level of formal educational qualification do you hold? ✱'),
  fill(`[name="${CARD}[field4]"]`, '97', 'question:what was your numeric percentage average? ✱'),
  fill(`[name="${CARD}[field5]"]`, classificationAnswer, 'question:what was your degree classification? ✱'),
  fill(`[name="${CARD}[field6]"]`, 'A production browser runner.', 'question:what have you built that was challenging, you had ownership of and are proud of?'),
  fill(`[name="${CARD}[field7]"]`, 'Yes - I require a visa sponsorship', 'question:do you require a visa to work in the uk? ✱')
];

test('the production Mytos stop: a band-gapped GPA holds the submit ONCE, under the question\'s own words', async () => {
  const result = await run([
    ...cardFills('3.89/4.00 (US 4.0 scale)'),
    submitAction,
    { type: 'extract', selector: '#submitted', optional: true }
  ]);
  // 3.89 sits in the gap between 'GPA 3.5-3.8' and 'GPA 3.9+', so refusing to guess a band and
  // holding the press is correct - that behavior must not change.
  assert.equal(result.submitOutcome?.pressed, false, 'an unanswerable required select must hold the press');
  assert.equal(result.requiredFieldConfirmation?.status, 'blocked');
  assert.ok(result.skipped.some((line) => line.includes('no option matched "3.89/4.00 (US 4.0 scale)"')),
    'the refusal must say the answer matched no option');
  const unresolved = result.requiredFieldConfirmation?.passes?.[0]?.unresolved || [];
  // The production defect, byte for byte: unresolved was
  //   ['[name="cards[62541ff1-...][field5]"]',
  //    'A required field on the form has no label Litos can read, and is still empty']
  // - one on-screen question reported twice, and namelessly both times.
  assert.deepEqual(unresolved, [CLASSIFICATION_LABEL],
    'one unanswered question is one failure, named by the employer\'s own words');
  assert.ok(!unresolved.includes(CLASSIFICATION_SELECTOR),
    'a naked name selector is not a sentence an applicant can act on');
  assert.ok(!unresolved.includes(NO_LABEL_SENTENCE),
    'the question heading is on the screen, so the gate must be able to read it');
  const attempt = result.requiredFieldConfirmation?.passes?.[0]?.attempts
    ?.find((entry) => entry.selector === CLASSIFICATION_SELECTOR);
  assert.equal(attempt?.label, CLASSIFICATION_LABEL,
    'the atomic required scan must name the card select by its div.application-label heading');
});

test('the Select2 4.0.0 university picker fills through its backing select and the rendered selection repaints', async () => {
  const result = await run([
    ...cardFills('GPA 3.9+'),
    submitAction,
    { type: 'extract', selector: '#submitted', optional: true },
    { type: 'extract', selector: '#university-echo', optional: true },
    { type: 'extract', selector: '.select2-selection__rendered', optional: true }
  ]);
  // PR #116's replay believed the university picker passes via its backing native select. That
  // belief was never pinned against real Select2 4.0.0 - this is the pin, on Lever's own bundle.
  assert.deepEqual(result.skipped, [], 'no card answer with an exact option may be skipped');
  assert.equal(result.submitOutcome?.pressed, true, 'a fully answered card must be pressed');
  assert.equal(result.requiredFieldConfirmation?.status, 'confirmed');
  assert.deepEqual(result.requiredFieldConfirmation?.passes?.[0]?.unresolved, []);
  assert.equal(result.extracted.find((entry) => entry.selector === '#submitted')?.value, 'submitted');
  assert.equal(result.extracted.find((entry) => entry.selector === '#university-echo')?.value,
    'University of Southern California',
    'the submitted value lives on the backing native select and must genuinely be set');
  assert.equal(result.extracted.find((entry) => entry.selector === '.select2-selection__rendered')?.value,
    'University of Southern California',
    'Select2 4.0.0 must have repainted the applicant-visible selection from the change event');
});

test('a card question never answered at all blocks under its heading, not as an unlabelled field', async () => {
  const actions = cardFills('GPA 3.9+').filter((action) => !action.selector.includes('field5'));
  const result = await run([...actions, submitAction]);
  assert.equal(result.submitOutcome?.pressed, false);
  const unresolved = result.requiredFieldConfirmation?.passes?.[0]?.unresolved || [];
  assert.deepEqual(unresolved, [CLASSIFICATION_LABEL],
    'an untouched required card select must still be reported once, by its heading');
});
