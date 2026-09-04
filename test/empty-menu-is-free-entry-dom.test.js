/* A CONTROL THAT OPENED AND OFFERED NOTHING IS A TEXT BOX, run through the shipped runner against
 * the markup that lost the answer.
 *
 * Measured in production on Hudson River Trading (job-boards.greenhouse.io, packet 4a79eec1,
 * 2026-09-02). The form asks for a GPA twice: a banded react-select ("What is your overall
 * college/university GPA?", thirteen bands including "3.76 - 4.0") and, under it, a write-in
 * captioned "We recognize that the options above may not cover all global grading systems... write
 * in your GPA below without conversion". The write-in wears the same widget shell and opens the
 * same menu markup, and that menu holds react-select's own
 * '<div class="select__menu-notice select__menu-notice--no-options">No options</div>' and nothing
 * else. Every matching tier correctly found nothing, the action parked, and the run ended:
 *
 *   status: failed
 *   "gpa" (no option matched "3.89" (the list offered: "No options"), left for you to choose)
 *
 * Two things are wrong in that one sentence. The report calls "No options" an OFFER, because the
 * evidence read went through offeredRows while every clicking path in the file goes through
 * realOfferedRows, which drops that placeholder. And the verdict parks a free-entry box as though
 * a menu had refused an answer.
 *
 * WHAT THESE TESTS ARE FOR IS THE OPPOSITE DIRECTION. If a control that IS a closed menu were
 * treated as free entry, Litos would type into a control that only accepts its own options and
 * either write nothing or write a string the employer never offered, while reporting it filled.
 * So most of what is pinned here is what must STILL park: a menu with real options that do not
 * match, a menu still loading, a menu already holding an answer, a bare opener with no box, and a
 * genuine chooser whose empty menu is a server's answer to one query rather than a statement that
 * the control has no options.
 *
 * Every test spawns the shipped runner (same runner string, same file protocol as production)
 * against a served page and asserts on result.filledFields / result.skipped and on what the FORM
 * ended up holding. Nothing matches on runner source text.
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

/* The thirteen bands, in the order the live board serves them
 * (boards-api.greenhouse.io/v1/boards/wehrtyou/jobs/8052083?questions=true, read 2026-09-04). */
const BANDS = [
  'First-Class Honours (UK)', 'Upper Second-Class Honours (UK)', 'Lower Second-Class Honours (UK)',
  'Third-Class Honours (UK)', '< 3.0', '3.01 - 3.25', '3.26 - 3.50', '3.51 - 3.75', '3.76 - 4.0',
  '4.01 - 4.25', '4.26 - 4.50', '4.51 - 4.75', '4.76 - 5.0'
];

const BAND_LABEL = 'What is your overall college/university GPA?';
// The write-in's caption, verbatim from the live board.
const WRITE_IN_LABEL = 'We recognize that the options above may not cover all global grading systems.'
  + ' Please feel free to write in your GPA below without conversion, along with the corresponding'
  + ' scale and any other relevant details.';
const LOADING_LABEL = 'School';
const GEOCODER_LABEL = 'Location (City)';
const MULTI_LABEL = 'Race/Ethnicity';
const BARE_LABEL = 'Are you a veteran?';
const SEARCH_LABEL = 'University';
const NO_MENU_LABEL = 'Current City';
const LOAD_KEEP_LABEL = 'Preferred Office';
const CHOSEN_KEEP_LABEL = 'Coding Language';

/* Transcribed from the live job-boards react-select DOM: the shell, the control, the placeholder,
 * the search input that carries the combobox role and names its own menu, and the menu-list that
 * carries role="listbox". The no-options notice is rendered inside that listbox exactly where
 * react-select renders it, which is why '[class*="option"]' matches it at all. */
const widget = (id, prompt, kind, rows) => `
  <div class="question" data-question="${id}">
    <label for="${id}-input">${prompt}<span class="required">*</span></label>
    <div class="select__container" data-widget="${kind}" data-id="${id}">
      <div class="select__control">
        <div class="select__value-container">
          <div class="select__placeholder">Select...</div>
          <input id="${id}-input" class="select__input" type="text" role="combobox"
            aria-haspopup="listbox" aria-expanded="false" aria-autocomplete="list"
            aria-controls="${id}-menu" autocomplete="off" value="" />
        </div>
      </div>
      <div class="select__menu" id="${id}-menu" style="display:none">
        <div class="select__menu-list" role="listbox">
          ${rows}
        </div>
      </div>
    </div>
  </div>`;

const optionRows = (options) => options
  .map((option, index) => `<div class="select__option" role="option" id="opt-${index}">${option}</div>`)
  .join('\n          ');

const NO_OPTIONS = '<div class="select__menu-notice select__menu-notice--no-options">No options</div>';
const LOADING = '<div class="select__menu-notice select__menu-notice--loading">Loading...</div>';

/* A bare opener: role=combobox on a div with no input anywhere, which is the Ashby/Workday shape.
 * Its menu is empty too, so this pins that an empty menu alone never licenses a write - there has
 * to be a box. */
const bareWidget = (id, prompt) => `
  <div class="question" data-question="${id}">
    <div class="bare-label">${prompt}<span class="required">*</span></div>
    <div class="select__container" data-widget="bare" data-id="${id}">
      <div id="${id}-input" class="select__control" role="combobox" aria-haspopup="listbox"
        aria-expanded="false" aria-controls="${id}-menu" tabindex="0">
        <div class="select__placeholder">Select...</div>
      </div>
      <div class="select__menu" id="${id}-menu" style="display:none">
        <div class="select__menu-list" role="listbox">${NO_OPTIONS}</div>
      </div>
    </div>
  </div>`;

/* GREENHOUSE'S LOCATION GEOCODER, in the exact shape isGreenhouseLocationCityGeocoder recognises:
 * id="candidate-location", role=combobox, aria-autocomplete=list, and a label reading exactly
 * "Location (City)". It is the one control whose empty menu proves nothing - a live geocoder
 * answering one query string is not a closed list - and it is built here as the DANGEROUS variant
 * that keeps whatever was typed into it, because that is the measured harm: filled_fields carried
 * "location" on every run while the packet's own required-field scan kept naming Current Location
 * empty, from the same run, every time. */
const geocoderWidget = `
  <div class="question" data-question="geo">
    <label for="candidate-location">${GEOCODER_LABEL}<span class="required">*</span></label>
    <div class="select__container" data-widget="geokeep" data-id="geo">
      <div class="select__control">
        <div class="select__value-container">
          <div class="select__placeholder">Start typing...</div>
          <input id="candidate-location" class="select__input" type="text" role="combobox"
            aria-haspopup="listbox" aria-expanded="false" aria-autocomplete="list"
            aria-controls="geo-menu" autocomplete="off" value="" />
        </div>
      </div>
      <div class="select__menu" id="geo-menu" style="display:none">
        <div class="select__menu-list" role="listbox">${NO_OPTIONS}</div>
      </div>
    </div>
  </div>`;

/* A CONTROL WHOSE MENU NEVER RENDERS AT ALL, and whose box KEEPS what is typed into it. This is
 * not a synthetic shape: it is the Ashby autocomplete measured on the live Deepgram and Notion
 * postings (packet 9f1d9e52, 2026-08-21) and named in the runner's own comment - "a real, typeable
 * <input>, not a bare div opener", where a plain fill sets the DOM value and persists while the
 * widget's own state and the employer's validator still call the field empty. filled_fields carried
 * "location" on every run against exactly this. A menu that never appeared is not a menu that
 * offered nothing, and the --no-options requirement is the only thing separating them. */
const noMenuWidget = `
  <div class="question" data-question="nomenu">
    <label for="nomenu-input">${NO_MENU_LABEL}<span class="required">*</span></label>
    <div class="select__container" data-widget="nomenu" data-id="nomenu">
      <div class="select__control">
        <div class="select__value-container">
          <div class="select__placeholder">Start typing...</div>
          <input id="nomenu-input" class="select__input" type="text" role="combobox"
            aria-haspopup="listbox" aria-expanded="false" aria-autocomplete="list"
            autocomplete="off" value="" />
        </div>
      </div>
    </div>
  </div>`;

/* THE SAME KEEPING BOX WITH A MENU THAT IS STILL LOADING. react-select renders its loading state
 * and its no-options state through the same notice slot, so a rule that reads "a notice was
 * dropped" rather than "the no-options notice was dropped" would write into a control whose list
 * simply had not arrived. */
const loadingKeepWidget = `
  <div class="question" data-question="loadkeep">
    <label for="loadkeep-input">${LOAD_KEEP_LABEL}<span class="required">*</span></label>
    <div class="select__container" data-widget="loadkeep" data-id="loadkeep">
      <div class="select__control">
        <div class="select__value-container">
          <div class="select__placeholder">Select...</div>
          <input id="loadkeep-input" class="select__input" type="text" role="combobox"
            aria-haspopup="listbox" aria-expanded="false" aria-autocomplete="list"
            aria-controls="loadkeep-menu" autocomplete="off" value="" />
        </div>
      </div>
      <div class="select__menu" id="loadkeep-menu" style="display:none">
        <div class="select__menu-list" role="listbox">${LOADING}</div>
      </div>
    </div>
  </div>`;

/* AN ANSWER ALREADY ON THE FORM, on a control whose box also keeps what is typed into it. The chip
 * is what readChoiceState calls the answer; the keeping box is the Ashby shape above. Combined
 * deliberately, because the read-back cannot see the difference between writing beside an existing
 * answer and writing into an empty box, and "never overwrite an answer already on the form" has to
 * hold on its own rather than as a side effect of the read-back. */
const chosenKeepWidget = `
  <div class="question" data-question="chosenkeep">
    <label for="chosenkeep-input">${CHOSEN_KEEP_LABEL}<span class="required">*</span></label>
    <div class="select__container" data-widget="chosenkeep" data-id="chosenkeep">
      <div class="select__control">
        <div class="select__value-container">
          <div class="select__single-value">Python</div>
          <input id="chosenkeep-input" class="select__input" type="text" role="combobox"
            aria-haspopup="listbox" aria-expanded="false" aria-autocomplete="list"
            aria-controls="chosenkeep-menu" autocomplete="off" value="" />
        </div>
      </div>
      <div class="select__menu" id="chosenkeep-menu" style="display:none">
        <div class="select__menu-list" role="listbox">${NO_OPTIONS}</div>
      </div>
    </div>
  </div>`;

const fixture = `<!doctype html><meta charset="utf-8"><title>Trading firm application</title>
<style>
  body { font: 14px system-ui; }
  .question { margin: 18px 0; }
  .select__container { position: relative; width: 460px; }
  .select__control { border: 1px solid #999; padding: 6px; min-height: 24px; }
  .select__menu { border: 1px solid #ccc; }
  .select__option, .select__menu-notice { padding: 4px; }
  .select__input { border: 0; outline: none; width: 300px; }
  .select__single-value, .select__multi-value__label { display: inline-block; }
</style>
<body>
<form id="application-form" action="/candidates" method="post">
${widget('band', BAND_LABEL, 'band', optionRows(BANDS))}
${widget('writein', WRITE_IN_LABEL, 'writein', NO_OPTIONS)}
${widget('search', SEARCH_LABEL, 'search', NO_OPTIONS)}
${widget('loading', LOADING_LABEL, 'loading', LOADING)}
${geocoderWidget}
${widget('multi', MULTI_LABEL, 'multi', NO_OPTIONS)}
${noMenuWidget}
${loadingKeepWidget}
${chosenKeepWidget}
${bareWidget('bare', BARE_LABEL)}
<button id="submit" type="submit">Submit application</button>
</form>
<div id="echo"></div>
<script>
  // The chosen value of every widget, plus whatever each search box is holding, read straight off
  // the DOM the way the employer's own form would read it.
  function echo() {
    var parts = [];
    var shells = document.querySelectorAll('.select__container');
    for (var i = 0; i < shells.length; i += 1) {
      var shell = shells[i];
      var chips = shell.querySelectorAll('.select__single-value, .select__multi-value__label');
      var chosen = [];
      for (var c = 0; c < chips.length; c += 1) chosen.push(chips[c].textContent);
      var input = shell.querySelector('input.select__input');
      parts.push(shell.getAttribute('data-id') + '=' + chosen.join('|')
        + '/' + (input ? input.value : ''));
    }
    document.getElementById('echo').textContent = parts.join(' ; ');
  }
  function menuOf(shell) { return shell.querySelector('.select__menu'); }
  function openMenu(shell) {
    var menu = menuOf(shell);
    if (menu) menu.style.display = 'block';
    var opener = shell.querySelector('[role="combobox"]');
    if (opener) opener.setAttribute('aria-expanded', menu ? 'true' : 'false');
  }
  function closeMenu(shell) {
    var menu = menuOf(shell);
    if (menu) menu.style.display = 'none';
    var opener = shell.querySelector('[role="combobox"]');
    if (opener) opener.setAttribute('aria-expanded', 'false');
  }
  /* THE FILTER, and it is the mechanism behind the production sentence. react-select narrows its
   * rendered rows to the query and, when nothing survives, replaces them with its own no-options
   * notice. So a menu that really did offer thirteen bands renders exactly one node reading
   * "No options" the moment "3.89" is typed into its search box. */
  function applyFilter(shell) {
    var list = shell.querySelector('.select__menu-list');
    var input = shell.querySelector('input.select__input');
    if (!list || !input || !list.querySelector('.select__option')
      && !list.querySelector('.select__menu-notice--no-options')) return;
    if (!shell.querySelector('.select__option')) return;
    var query = (input.value || '').trim().toLowerCase();
    var rows = list.querySelectorAll('.select__option');
    var shown = 0;
    for (var r = 0; r < rows.length; r += 1) {
      var hit = !query || rows[r].textContent.toLowerCase().indexOf(query) !== -1;
      rows[r].style.display = hit ? '' : 'none';
      if (hit) shown += 1;
    }
    var notice = list.querySelector('.select__menu-notice');
    if (shown === 0 && !notice) {
      notice = document.createElement('div');
      notice.className = 'select__menu-notice select__menu-notice--no-options';
      notice.textContent = 'No options';
      list.appendChild(notice);
    } else if (shown > 0 && notice) {
      notice.remove();
    }
  }
  function commit(shell, text) {
    var kind = shell.getAttribute('data-widget');
    var container = shell.querySelector('.select__value-container');
    var placeholder = container.querySelector('.select__placeholder');
    if (placeholder) placeholder.remove();
    if (kind === 'multi') {
      // react-select isMulti: every pick APPENDS a chip. A naive re-pick is how "South Asian"
      // became "South Asian|East Asian" on a packet that was already answered.
      var chip = document.createElement('div');
      chip.className = 'select__multi-value__label';
      chip.textContent = text;
      container.insertBefore(chip, container.firstChild);
    } else {
      var single = container.querySelector('.select__single-value');
      if (!single) {
        single = document.createElement('div');
        single.className = 'select__single-value';
        container.insertBefore(single, container.firstChild);
      }
      single.textContent = text;
    }
    var input = shell.querySelector('input.select__input');
    if (input) input.value = '';
    closeMenu(shell);
    echo();
  }
  document.addEventListener('mousedown', function (event) {
    var row = event.target.closest ? event.target.closest('.select__option') : null;
    if (row) { commit(row.closest('.select__container'), row.textContent.trim()); return; }
  }, true);
  document.addEventListener('click', function (event) {
    var row = event.target.closest ? event.target.closest('.select__option') : null;
    if (row) { commit(row.closest('.select__container'), row.textContent.trim()); return; }
    var shell = event.target.closest ? event.target.closest('.select__container') : null;
    if (shell) openMenu(shell);
  });
  document.addEventListener('focusin', function (event) {
    var shell = event.target.closest ? event.target.closest('.select__container') : null;
    if (shell) openMenu(shell);
  });
  // THE ONE BEHAVIOURAL DIFFERENCE THAT DECIDES THIS. A react-select search box is the widget's
  // own query field: it drops whatever is in it on Escape and on blur, because the text was a
  // QUERY and the widget owns it. A free-entry box is not a query field and ignores both. Only
  // 'writein' is free entry here; every other widget clears, which is exactly how the runner's
  // blur-then-read-back tells one from the other.
  var KEEPS_ITS_TEXT = ['writein', 'geokeep', 'nomenu', 'loadkeep', 'chosenkeep'];
  function dropQuery(shell) {
    var kind = shell.getAttribute('data-widget');
    var input = shell.querySelector('input.select__input');
    if (input && KEEPS_ITS_TEXT.indexOf(kind) === -1) input.value = '';
    applyFilter(shell);
  }
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    var shells = document.querySelectorAll('.select__container');
    for (var i = 0; i < shells.length; i += 1) { dropQuery(shells[i]); closeMenu(shells[i]); }
    echo();
  });
  document.addEventListener('focusout', function (event) {
    var shell = event.target.closest ? event.target.closest('.select__container') : null;
    if (!shell) return;
    dropQuery(shell);
    closeMenu(shell);
    echo();
  });
  document.addEventListener('input', function (event) {
    var shell = event.target.closest ? event.target.closest('.select__container') : null;
    if (shell) applyFilter(shell);
    echo();
  });
  document.addEventListener('change', echo);
  // The multi widget arrives already answered, the way a re-run reaches a packet whose EEO answer
  // is on the form.
  commit(document.querySelector('[data-id="multi"]'), 'South Asian');
  echo();
</script>
</body>`;

let server;
let workDir;
test.before(async () => {
  server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    response.end(fixture);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-empty-menu-'));
  fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);
});
test.after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
});

const resultPath = () => path.join(workDir, 'stratus-result-0.json');

function waitForRunner(child, timeoutMs = 180_000) {
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
    allowSubmit: false,
    providerDeadlineAt: providerDeadlineAt(),
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 1400 }
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

const fillBy = (text, value, label) => ({
  type: 'fillByLabelText', text, value, label, optional: true
});

const echoOf = (result) => result.extracted.find((entry) => entry.selector === '#echo')?.value || '';
const stateOf = (result, id) => (echoOf(result).split(' ; ')
  .find((entry) => entry.startsWith(id + '=')) || '').slice(id.length + 1);

test('the write-in whose menu offered nothing is typed into, byte for byte', async () => {
  const result = await run([
    fillBy(WRITE_IN_LABEL, '3.89', 'gpa'),
    { type: 'extract', selector: '#echo' }
  ]);
  // The production verdict: parked with 'no option matched "3.89" (the list offered: "No options")'
  // and nothing reached the employer.
  assert.deepEqual(result.skipped, [], 'a control that offered nothing may not be parked as a menu');
  assert.deepEqual(result.filledFields, ['gpa']);
  assert.equal(stateOf(result, 'writein'), '/3.89',
    'the stored answer must actually be sitting in the write-in box, unaltered');
});

test('the banded dropdown still goes to the dropdown, and the band is never typed anywhere', async () => {
  const result = await run([
    fillBy(BAND_LABEL, '3.76 - 4.0', 'gpa_band'),
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.filledFields, ['gpa_band']);
  assert.equal(stateOf(result, 'band'), '3.76 - 4.0/',
    'the band must be CHOSEN on the dropdown, not typed into its search box');
  assert.equal(stateOf(result, 'writein'), '/',
    'nothing may be written into the write-in box by the band question');
});

test('both GPA questions in one run keep to their own controls', async () => {
  const result = await run([
    fillBy(BAND_LABEL, '3.76 - 4.0', 'gpa_band'),
    fillBy(WRITE_IN_LABEL, '3.89', 'gpa'),
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.filledFields, ['gpa_band', 'gpa']);
  assert.equal(stateOf(result, 'band'), '3.76 - 4.0/', 'a raw number must never reach the menu');
  assert.equal(stateOf(result, 'writein'), '/3.89', 'a band must never reach the text box');
});

/* THE PRODUCTION ACTION EXACTLY AS IT ARRIVED, and what it really reaches.
 *
 * The backend sent {type:'fillByLabelText', text:'GPA', value:'3.89', label:'gpa'} for a question
 * whose label on the live board is the long write-in caption above. Nothing on the HRT form has the
 * whole text "GPA" - verified against the live markup at
 * job-boards.greenhouse.io/embed/job_app?for=wehrtyou&token=8052083 on 2026-09-04, where
 * question_68000289 is a bare '<input type="text" class="input input__single-line">' in a
 * text-input-wrapper with no select shell above it - so the anchor falls back to the loose match
 * and takes the FIRST element containing "GPA" in DOM order, which is the banded dropdown's label.
 * The write-in is never reached at all.
 *
 * What this pins is the outcome once the report is honest. The run still parks, correctly, because
 * the band really does have thirteen options, and the sentence now names them instead of quoting
 * the widget's own empty state back as an offer. The remaining defect is the ANCHOR, and nothing in
 * this file can fix it: given only the word "GPA" no rule can tell a band question from a write-in.
 * The action has to carry the real question label or the durable selector. */
test('the production anchor reaches the banded dropdown, and parks there honestly', async () => {
  const result = await run([
    { type: 'fillByLabelText', text: 'GPA', value: '3.89', label: 'gpa', optional: true },
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.filledFields, []);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /^gpa: no option matched "3\.89"/);
  assert.doesNotMatch(result.skipped[0], /No options/,
    'the production sentence blamed the applicant for a list that was never empty');
  assert.match(result.skipped[0], /the list offered: "First-Class Honours \(UK\)"/);
  assert.equal(stateOf(result, 'band'), '/', 'nothing may be typed into a control with options');
  assert.equal(stateOf(result, 'writein'), '/',
    'and the write-in this action was meant for is not reached by this anchor');
});

/* THE OTHER CALL SITE. A selector-addressed 'fill' reaches the same verdict through a different
 * branch of the action loop, and a fix wired into only one of them leaves the packet that arrives
 * with a durable selector - which is most of them - parked exactly as before. Deleting either call
 * site has to redden a test, not just deleting the helper. */
test('a selector-addressed fill into the same empty-menu control types it too', async () => {
  const result = await run([
    { type: 'fill', selector: '#writein-input', value: '3.89', label: 'gpa', optional: true },
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.skipped, []);
  assert.deepEqual(result.filledFields, ['gpa']);
  assert.equal(stateOf(result, 'writein'), '/3.89');
});

test('a selector-addressed fill into a real menu still parks', async () => {
  const result = await run([
    { type: 'fill', selector: '#band-input', value: '3.89', label: 'gpa_band', optional: true },
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.filledFields, []);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /no option matched "3\.89"/);
  assert.equal(stateOf(result, 'band'), '/');
});

test('the location geocoder is never written into, however empty its menu came back', async () => {
  const result = await run([
    fillBy(GEOCODER_LABEL, 'Dubai, U.A.E.', 'location'),
    { type: 'extract', selector: '#echo' }
  ]);
  // This box KEEPS whatever is typed into it, so a run that wrote here would read its own
  // keystrokes back and report the field filled while the employer's canonical location stayed
  // empty. A geocoder's empty menu is an answer about one query, never about the control.
  assert.deepEqual(result.filledFields, [],
    'a live-searched location field may never be reported filled from a typed query');
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /left for you to choose/);
});

/* THE PRODUCTION SENTENCE ITSELF. This is the exact shape that reached Mehek: a stored "3.89"
 * against a thirteen-band react-select. The runner types the answer into the widget's search box,
 * react-select narrows thirteen rows to none and renders its own notice, and the evidence read then
 * counted that notice as a row - texts.length 1, so it OVERWROTE the honest pre-search record of
 * the thirteen bands. That is where 'the list offered: "No options"' came from: not from a control
 * with nothing on it, but from a filtered read of a control with thirteen things on it. */
test('a real menu whose options do not match the answer still parks and names the real rows', async () => {
  const result = await run([
    fillBy(BAND_LABEL, '3.89', 'gpa_band'),
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.filledFields, []);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /no option matched "3\.89"/);
  assert.doesNotMatch(result.skipped[0], /No options/,
    'the filtered read must never replace the honest one');
  assert.match(result.skipped[0], /the list offered: "First-Class Honours \(UK\)"/,
    'the honest report names the rows that were actually on offer');
  assert.match(result.skipped[0], /plus 5 more/, 'and says how many it did not name');
  assert.equal(stateOf(result, 'band'), '/',
    'a control that HAS options must never be written into as though it were free entry');
});

test('a menu that never rendered at all is not a menu that offered nothing', async () => {
  // The Ashby autocomplete: the box keeps what is typed, so without the --no-options requirement
  // the read-back would agree with its own keystrokes and the field would be reported filled while
  // the widget's real state, and the employer's validator, still call it empty.
  const result = await run([
    fillBy(NO_MENU_LABEL, 'Dubai', 'current_city'),
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.filledFields, [],
    'a control whose menu never appeared may not be written into as free entry');
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /left for you to choose/);
});

test('a loading menu on a box that keeps its text is still not free entry', async () => {
  const result = await run([
    fillBy(LOAD_KEEP_LABEL, 'Singapore', 'office'),
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.filledFields, [],
    'a list that has not arrived is not a list that has nothing in it');
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /left for you to choose/);
});

test('an answer on the form survives even where the read-back could not have caught the write', async () => {
  const result = await run([
    fillBy(CHOSEN_KEEP_LABEL, 'C++', 'coding_language'),
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.filledFields, []);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /left the answer already on the form, "Python"/);
  // The chip is the answer the form holds. The trailing query text is the chooser's own search
  // residue, which this synthesized widget keeps and a real react-select drops on blur; what must
  // never change is the answer itself.
  assert.equal(stateOf(result, 'chosenkeep').split('/')[0], 'Python',
    'the answer already standing on the form must be untouched and unduplicated');
});

test('a menu that is still loading is not a menu that offered nothing', async () => {
  const result = await run([
    fillBy(LOADING_LABEL, 'University of Southern California', 'school'),
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.filledFields, []);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /left for you to choose/);
  assert.equal(stateOf(result, 'loading'), '/',
    'a loading notice must never be read as proof the control has no options');
});

test('a genuine chooser whose empty menu is a search result is reported honestly, never filled', async () => {
  const result = await run([
    fillBy(SEARCH_LABEL, 'Some University', 'university'),
    { type: 'extract', selector: '#echo' }
  ]);
  // The write is attempted and the widget throws it away on blur, which is exactly what a
  // react-select search box does. The read-back has to catch that and report the honest sentence.
  assert.deepEqual(result.filledFields, [],
    'a widget that did not keep the value may never be reported as filled');
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /left for you to choose/);
  assert.equal(stateOf(result, 'search'), '/', 'and the form must end holding nothing');
});

test('an answer already on the form is left alone even when the menu offers nothing', async () => {
  // The chip is a react-select isMulti value, so this is also the shape PR #154 was rejected for:
  // a second value appended beside the first while the field was reported filled. This path never
  // clicks a row, so it cannot append one - and the 'chosen' guard is what stops it writing "East
  // Asian" into the widget's own box beside the answer already standing there.
  const result = await run([
    fillBy(MULTI_LABEL, 'East Asian', 'race'),
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.filledFields, []);
  assert.equal(result.skipped.length, 1);
  assert.equal(stateOf(result, 'multi'), 'South Asian/',
    'the answer already chosen must survive untouched - nothing appended, nothing typed beside it');
});

test('a bare opener with an empty menu has no box to write in and still parks', async () => {
  const result = await run([
    fillBy(BARE_LABEL, 'I am not a protected veteran', 'veteran_status'),
    { type: 'extract', selector: '#echo' }
  ]);
  assert.deepEqual(result.filledFields, []);
  assert.equal(result.skipped.length, 1);
  assert.match(result.skipped[0], /left for you to choose/);
  assert.equal(stateOf(result, 'bare'), '/');
});

test('the refusal sentence never calls the empty-state placeholder an offer', async () => {
  // The write-in is answered now, so the only way to see the sentence is a control whose empty
  // menu the runner is not allowed to write into. Whatever the verdict, "No options" is the
  // widget saying it has none, and it may not be quoted back as a row that was offered.
  const result = await run([
    fillBy(SEARCH_LABEL, 'Some University', 'university'),
    fillBy(LOADING_LABEL, 'Some School', 'school')
  ]);
  for (const line of result.skipped) {
    assert.doesNotMatch(line, /the list offered: "No options"/,
      'react-select\'s own empty state is not one of the things the list offered');
    assert.doesNotMatch(line, /the list offered: "Loading/,
      'and neither is its loading notice');
  }
});
