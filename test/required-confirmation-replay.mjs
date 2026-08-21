import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ATOMIC_SUBMIT_POLICY, SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = `<!doctype html><meta charset="utf-8"><title>Required confirmation replay</title>
<style>.select2-offscreen { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }</style>
<form id="newsletter"><div class="field"><label for="newsletter-email">Newsletter email</label><input id="newsletter-email" required value="newsletter@example.com" aria-invalid="true"><span id="newsletter-error">This requires an answer</span></div><button>Subscribe</button><input type="button" value="Search"><span role="button">Join newsletter</span></form>
<form id="application" novalidate>
  <div class="field"><label for="text">Name *</label><input id="text" value="Mehek Mandal" aria-invalid="true"><span>This requires an answer</span></div>
  <div class="field"><label for="email-field">Email</label><input id="email-field" type="email" required value="mehek@example.com" aria-invalid="true"><span>This requires an answer</span></div>
  <div class="field"><label for="phone-field">Phone</label><input id="phone-field" type="tel" required value="+971501234567" aria-invalid="true"><span>This requires an answer</span></div>
  <div class="field"><label for="essay">Why this role?</label><textarea id="essay" required aria-invalid="true">Because it fits.</textarea><span>This requires an answer</span></div>
  <div class="field"><label for="resume">Resume</label><input id="resume" type="file" required><div id="file-state"></div></div>
  <div class="field"><label for="date">Start date</label><input id="date" type="date" required value="2026-08-10" aria-invalid="true"><span>This requires an answer</span></div>
  <div class="field"><label for="question_123[]">Bracket question</label><input id="question_123[]" required value="Already committed"></div>
  <div class="field select__container"><label for="react">Privacy Statement *</label><div class="select__single-value">I Agree</div><input id="react" role="combobox" aria-required="true" aria-invalid="true"><input id="react-hidden" type="hidden" aria-required="true"><span>This requires an answer</span></div>
  <div class="field"><label for="select">Country</label><select id="select" required aria-invalid="true"><option selected>United Arab Emirates</option></select><span>This requires an answer</span></div>
  <fieldset><legend>Work authorized</legend><input id="radio" name="work" type="radio" required checked aria-invalid="true"><label for="radio">Yes</label><span>This requires an answer</span></fieldset>
  <div class="field"><label for="checkbox">I agree</label><input id="checkbox" type="checkbox" required checked aria-invalid="true"><span>This requires an answer</span></div>
  <div id="custom" class="field" role="group" aria-required="true" aria-invalid="true"><label>Schedule</label><button type="button" class="_active_test">Weekdays</button><span>This requires an answer</span></div>
  <button id="application-submit" type="submit">Submit application</button>
</form>
<div id="submitted"></div>
<div id="checkbox-state"></div><div id="checkbox-clicks">0</div><div id="custom-state">selected</div><div id="react-commits">0</div><div id="react-option-clicks">0</div><div id="react-multi-values"></div>
<script>
  function clear(id) {
    if (location.search.includes('sticky-required-copy')) return;
    var control = document.getElementById(id);
    control.setAttribute('aria-invalid', 'false');
    var error = control.closest('.field, fieldset').querySelector('span');
    if (error) error.remove();
  }
  var reactParams = new URLSearchParams(location.search);
  var reactAnswer = reactParams.get('react-answer') || 'I Agree';
  var reactLabel = reactParams.get('react-label') || 'Privacy Statement *';
  var reactDelay = Number(reactParams.get('react-delay') || '100');
  var reactDisplay = reactParams.get('react-display') || reactAnswer;
  var reactMulti = location.search.includes('react-multi');
  var reactMultiOne = location.search.includes('react-multi-one');
  var reactMultiUnmarked = location.search.includes('react-multi-unmarked');
  var reactMultiEmpty = location.search.includes('react-multi-empty');
  document.querySelector('label[for="react"]').textContent = reactLabel;
  document.querySelector('.select__single-value').textContent = reactDisplay;
  if (reactMulti) {
    var firstChip = document.querySelector('.select__single-value');
    firstChip.className = 'select__multi-value__label';
    firstChip.textContent = reactMultiUnmarked ? 'Austin' : 'Alpha';
    firstChip.setAttribute('aria-label', reactMultiUnmarked ? 'Austin' : 'Alpha');
    if (reactMultiEmpty) firstChip.remove();
    if (!reactMultiOne && !reactMultiUnmarked && !reactMultiEmpty) {
      var secondChip = document.createElement('div');
      secondChip.className = 'select__multi-value__label';
      secondChip.textContent = 'Beta';
      secondChip.setAttribute('aria-label', 'Beta');
      firstChip.parentElement.insertBefore(secondChip, document.getElementById('react'));
    }
  }
  if (location.search.includes('hidden-invalid-only')) {
    document.getElementById('react').setAttribute('aria-invalid', 'false');
    document.getElementById('react-hidden').setAttribute('aria-invalid', 'true');
    document.querySelector('.select__container > span').remove();
  }
  if (location.search.includes('marked-unverified-choice')) {
    document.getElementById('question_123[]').closest('.field')
      .setAttribute('data-litos-unverified-choice', 'unreadable');
  }
  document.getElementById('newsletter-email').addEventListener('blur', function () { clear('newsletter-email'); });
  ['text', 'email-field', 'phone-field', 'essay', 'date'].forEach(function (id) {
    document.getElementById(id).addEventListener('blur', function () { clear(id); });
  });
  document.getElementById('text').addEventListener('blur', function () {
    if (location.search.includes('replace-submit')) {
      var oldSubmit = document.getElementById('application-submit');
      oldSubmit.replaceWith(oldSubmit.cloneNode(true));
    }
    if (location.search.includes('scan-exception')) {
      document.getElementById('application').querySelectorAll = function () { throw new Error('injected scoped scan failure'); };
    }
  });
  var transfer = new DataTransfer();
  transfer.items.add(new File(['resume'], 'resume.pdf', { type: 'application/pdf' }));
  document.getElementById('resume').files = transfer.files;
  document.getElementById('file-state').textContent = document.getElementById('resume').files[0].name;
  document.getElementById('react').addEventListener('click', function () {
    if (document.getElementById('react-listbox')) return;
    var listbox = document.createElement('div');
    listbox.id = 'react-listbox';
    listbox.setAttribute('role', 'listbox');
    if (reactMulti && !location.search.includes('react-multi-no-aria')) {
      listbox.setAttribute('aria-multiselectable', 'true');
    }
    var addOption = function (text, selected) {
      var option = document.createElement(
        location.search.includes('react-submit-option') ? 'button' : 'div'
      );
      option.setAttribute('role', 'option');
      if (!reactMultiUnmarked) option.setAttribute('aria-selected', String(selected));
      option.textContent = text;
      option.addEventListener('click', function () {
        var optionClicks = document.getElementById('react-option-clicks');
        optionClicks.textContent = String(Number(optionClicks.textContent) + 1);
        if (reactMulti) {
          option.setAttribute('aria-selected', String(option.getAttribute('aria-selected') !== 'true'));
          document.querySelectorAll('.select__multi-value__label').forEach(function (chip) {
            if (chip.textContent === text) chip.remove();
          });
          return;
        }
      var commits = document.getElementById('react-commits');
      commits.textContent = String(Number(commits.textContent) + 1);
      var selected = document.querySelector('.select__single-value');
      selected.remove();
      setTimeout(function () {
        var replacement = document.createElement('div');
        replacement.className = 'select__single-value';
        replacement.textContent = reactAnswer;
        document.querySelector('.select__container').insertBefore(replacement, document.getElementById('react'));
        clear('react');
        if (!location.search.includes('keep-hidden-invalid')) {
          document.getElementById('react-hidden').setAttribute('aria-invalid', 'false');
        }
      }, reactDelay);
        listbox.remove();
        document.getElementById('react').removeAttribute('aria-controls');
      });
      listbox.appendChild(option);
    };
    if (reactMulti) {
      if (reactMultiUnmarked) {
        if (!location.search.includes('react-multi-unmarked-missing')) addOption('Austin', true);
        if (location.search.includes('react-multi-unmarked-ambiguous')) addOption('Austin', true);
        if (location.search.includes('react-multi-selected-hidden')) addOption('Chicago', false);
      } else {
        addOption('Alpha', true);
        if (!reactMultiOne) addOption('Beta', true);
      }
    } else {
      addOption(
        location.search.includes('missing-react-option')
          ? 'I Disagree'
          : location.search.includes('react-selected-superset')
            ? 'I Agree to Marketing'
            : reactAnswer,
        true
      );
    }
    this.setAttribute('aria-controls', listbox.id);
    this.closest('.select__container').appendChild(listbox);
    if (location.search.includes('react-multi-chip-changes')) {
      var chip = document.querySelector('.select__multi-value__label');
      chip.textContent = 'Chicago';
      chip.setAttribute('aria-label', 'Chicago');
    }
  });
  document.getElementById('react').addEventListener('blur', function () {
    if (reactMulti) {
      document.getElementById('react-multi-values').textContent = [...document.querySelectorAll(
        '.select__multi-value__label'
      )].map(function (chip) { return chip.textContent; }).join('|');
      clear('react');
    }
  });
  if (location.search.includes('select-shell-grid-cross-field')) {
    var grid = document.createElement('div');
    grid.className = 'field select-shell-grid';
    grid.innerHTML = '<div class="select__control">'
      + '<label for="grid-choice">Privacy Statement *</label>'
      + '<div class="select__single-value">I Agree</div>'
      + '<input id="grid-choice" role="combobox" aria-required="true"></div>'
      + '<div><label for="grid-empty">Additional required answer *</label>'
      + '<input id="grid-empty" aria-required="true" value=""></div>';
    document.getElementById('application').insertBefore(grid, document.getElementById('application-submit'));
  }
  if (location.search.includes('select2-case')) {
    var select2Field = document.createElement('div');
    select2Field.className = 'field';
    var select2ShellId = location.search.includes('select2-id-mismatch')
      ? 's2id_someone-else'
      : 's2id_legacy-source';
    var select2Source = location.search.includes('select2-hidden-input')
      ? '<input id="legacy-source" type="hidden" class="select2-offscreen" required aria-invalid="true" tabindex="-1" value="cs-id">'
      : '<select id="legacy-source" class="select2-offscreen" required aria-invalid="true" tabindex="-1">'
        + '<option value="cs-id" selected>Computer Science</option>'
        + '<option value="econ-id">Economics</option></select>';
    var openerShape = reactParams.get('select2-opener') || 'one';
    var select2Display = location.search.includes('select2-source-display-mismatch')
      ? 'Economics' : 'Computer Science';
    var select2Openers = openerShape === 'zero' ? ''
      : openerShape === 'two'
        ? '<a class="select2-choice" role="button"><span class="select2-chosen">' + select2Display + '</span></a>'
          + '<a class="select2-choice" role="button"><span class="select2-chosen">' + select2Display + '</span></a>'
        : '<a class="select2-choice" role="button"'
          + (openerShape === 'hidden' ? ' style="display:none"' : '') + '>'
          + '<span class="select2-chosen">' + select2Display + '</span></a>';
    select2Field.innerHTML = '<label for="legacy-source">Legacy choice *</label>'
      + '<div id="' + select2ShellId + '" class="select2-container">'
      + select2Openers + '</div>'
      + select2Source
      + '<span class="select2-error">This requires an answer</span>';
    document.getElementById('application').insertBefore(select2Field, document.getElementById('application-submit'));
    [
      'select2-clicks', 'select2-option-clicks', 'select2-decoy-option-clicks',
      'select2-changes', 'select2-source-clicks', 'select2-foreign-option-clicks'
    ].forEach(function (id) {
      var counter = document.createElement('div');
      counter.id = id;
      counter.textContent = '0';
      document.body.appendChild(counter);
    });
    var increment = function (id) {
      var counter = document.getElementById(id);
      counter.textContent = String(Number(counter.textContent) + 1);
    };
    var select2SourceElement = document.getElementById('legacy-source');
    var select2ResultData = new WeakMap();
    var select2Instance = {
      container: [select2Field.querySelector('.select2-container')],
      dropdown: [],
      results: [],
      id: function (data) { return data && data.id; }
    };
    window.jQuery = function (element) {
      var wrapper = {
        data: function (key) {
          if (key === 'select2' && element === select2SourceElement) return select2Instance;
          if (key === 'select2-data') return select2ResultData.get(element);
          return undefined;
        },
        select2: function (command, value, triggerChange) {
          if (element !== select2SourceElement || command !== 'val') throw new Error('unexpected Select2 API call');
          element.value = value;
          if (triggerChange) element.dispatchEvent(new Event('change', { bubbles: true }));
          return wrapper;
        }
      };
      return wrapper;
    };
    select2SourceElement.addEventListener('click', function () {
      increment('select2-source-clicks');
      if (location.search.includes('select2-source-click-submit')) {
        document.getElementById('application').requestSubmit();
      }
    });
    var closeSelect2 = function () {
      select2Field.querySelector('.select2-container')?.classList.remove('select2-dropdown-open');
      document.getElementById('select2-drop')?.remove();
    };
    var select2PickedExact = false;
    select2Field.querySelectorAll('.select2-choice').forEach(function (opener) {
      opener.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') closeSelect2();
      });
      opener.addEventListener('click', function () {
        increment('select2-clicks');
        if (document.getElementById('select2-drop')) return;
        this.closest('.select2-container').classList.add('select2-dropdown-open');
        var dropdown = document.createElement('div');
        dropdown.id = 'select2-drop';
        dropdown.className = 'select2-drop-active';
        var results = document.createElement('ul');
        results.className = 'select2-results';
        var addResult = function (label, id) {
          var result = document.createElement('li');
          result.className = 'select2-result select2-result-selectable';
          select2ResultData.set(result, { id: id, text: label });
          var option = document.createElement(
            location.search.includes('select2-submit-option') && label === 'Computer Science'
              ? 'button' : 'div'
          );
          if (option instanceof HTMLButtonElement) option.setAttribute('form', 'application');
          option.setAttribute('role', 'option');
          if (location.search.includes('select2-nested-submit-option') && label === 'Computer Science') {
            var nestedSubmit = document.createElement('button');
            nestedSubmit.setAttribute('form', 'application');
            nestedSubmit.textContent = label;
            option.appendChild(nestedSubmit);
          } else {
            option.textContent = label;
          }
          option.addEventListener('click', function () {
            var source = document.getElementById('legacy-source');
            source.value = id;
            select2Field.querySelector('.select2-chosen').textContent = label;
            select2PickedExact = label === 'Computer Science';
            increment(label === 'Computer Science'
              ? 'select2-option-clicks' : 'select2-decoy-option-clicks');
            closeSelect2();
          });
          result.appendChild(option);
          results.appendChild(result);
        };
        if (!location.search.includes('select2-missing-exact-option')) addResult('Computer Science', 'cs-id');
        addResult('Economics', 'econ-id');
        dropdown.appendChild(results);
        document.body.appendChild(dropdown);
        select2Instance.dropdown = [dropdown];
        select2Instance.results = [results];
      });
    });
    document.getElementById('legacy-source').addEventListener('change', function () {
      increment('select2-changes');
      var exactState = this.value === 'cs-id'
        && select2Field.querySelector('.select2-chosen').textContent === 'Computer Science'
        && select2PickedExact;
      if (!exactState || location.search.includes('select2-sticky-invalid')) return;
      this.setAttribute('aria-invalid', 'false');
      select2Field.querySelector('.select2-error')?.remove();
    });
    var decoyField = document.createElement('div');
    decoyField.className = 'field';
    decoyField.innerHTML = '<label for="decoy-source">Optional legacy choice</label>'
      + '<div id="s2id_decoy-source" class="select2-container">'
      + '<a class="select2-choice" role="button"><span class="select2-chosen">Economics</span></a></div>'
      + '<select id="decoy-source" class="select2-offscreen" tabindex="-1">'
      + '<option selected>Economics</option></select>';
    document.getElementById('application').insertBefore(decoyField, document.getElementById('application-submit'));
    var decoyClicks = document.createElement('div');
    decoyClicks.id = 'select2-decoy-clicks';
    decoyClicks.textContent = '0';
    document.body.appendChild(decoyClicks);
    decoyField.querySelector('.select2-choice').addEventListener('click', function () {
      decoyClicks.textContent = String(Number(decoyClicks.textContent) + 1);
    });
    if (location.search.includes('select2-foreign-dropdown')) {
      select2Field.querySelector('.select2-container').classList.add('select2-dropdown-open');
      var foreignDropdown = document.createElement('div');
      foreignDropdown.id = 'select2-drop';
      foreignDropdown.className = 'select2-drop-active';
      var foreignOption = document.createElement('div');
      foreignOption.setAttribute('role', 'option');
      foreignOption.textContent = 'Computer Science';
      foreignOption.addEventListener('click', function () {
        increment('select2-foreign-option-clicks');
        document.getElementById('decoy-source').value = 'Computer Science';
      });
      foreignDropdown.appendChild(foreignOption);
      document.body.appendChild(foreignDropdown);
    }
  }
  if (location.search.includes('legacy-combobox')) {
    var legacyField = document.createElement('div');
    legacyField.className = 'field';
    legacyField.innerHTML = '<label for="legacy-combobox">Legacy combobox *</label>'
      + '<input id="legacy-combobox" role="combobox" aria-required="true" aria-invalid="true" value="Already selected">'
      + '<span>This requires an answer</span>';
    document.getElementById('application').insertBefore(legacyField, document.getElementById('application-submit'));
    var legacyProgress = document.createElement('div');
    legacyProgress.id = 'legacy-combobox-progress';
    document.body.appendChild(legacyProgress);
    var legacyControl = document.getElementById('legacy-combobox');
    var legacySteps = [];
    var recordLegacy = function (step) {
      legacySteps.push(step);
      legacyProgress.textContent = legacySteps.join(',');
    };
    legacyControl.addEventListener('click', function () { recordLegacy('click'); });
    legacyControl.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') recordLegacy('escape');
    });
    legacyControl.addEventListener('blur', function () {
      recordLegacy('blur');
      if (legacySteps.includes('click') && legacySteps.includes('escape')) clear('legacy-combobox');
    });
  }
  if (location.search.includes('stale-marker-before-submit')) {
    var stalePeer = document.createElement('input');
    stalePeer.id = 'stale-marker-peer';
    stalePeer.type = 'hidden';
    stalePeer.setAttribute('aria-invalid', 'true');
    stalePeer.setAttribute('data-litos-required-confirm', 'litos-required-confirm-8');
    stalePeer.setAttribute('data-litos-required-confirm-source', 'litos-required-confirm-8');
    stalePeer.setAttribute('data-litos-select2-confirm', 'litos-required-confirm-8');
    document.getElementById('application').appendChild(stalePeer);
  }
  document.getElementById('select').addEventListener('change', function () { clear('select'); });
  document.querySelector('label[for="radio"]').addEventListener('click', function () { clear('radio'); });
  document.getElementById('checkbox').addEventListener('click', function () {
    var clicks = document.getElementById('checkbox-clicks');
    clicks.textContent = String(Number(clicks.textContent) + 1);
  });
  document.getElementById('checkbox').addEventListener('change', function () {
    document.getElementById('checkbox-state').textContent = String(this.checked);
    clear('checkbox');
  });
  if (!location.search.includes('leave-custom-invalid')) {
    document.querySelector('#custom button').addEventListener('click', function () {
      var control = document.getElementById('custom');
      var selected = this.classList.toggle('_active_test');
      document.getElementById('custom-state').textContent = selected ? 'selected' : 'deselected';
      if (!location.search.includes('sticky-required-copy')) {
        control.setAttribute('aria-invalid', 'false');
        if (control.querySelector('span')) control.querySelector('span').remove();
      }
    });
  }
  var submitShape = new URLSearchParams(location.search).get('submit-shape');
  var submitLabel = new URLSearchParams(location.search).get('submit-label');
  if (submitLabel) document.getElementById('application-submit').textContent = submitLabel;
  if (location.search.includes('equal-final-candidates')) {
    var duplicate = document.createElement('button');
    duplicate.type = 'submit';
    duplicate.textContent = 'Submit application';
    document.getElementById('application').appendChild(duplicate);
  }
  if (location.search.includes('sole-continue')) document.getElementById('application-submit').textContent = 'Continue';
  if (location.search.includes('sole-linkedin')) document.getElementById('application-submit').textContent = 'Apply with LinkedIn';
  if (submitShape) {
    var original = document.getElementById('application-submit');
    var replacement;
    if (submitShape === 'button-default') {
      replacement = document.createElement('button');
      replacement.textContent = 'Submit application';
    } else if (submitShape === 'input-image') {
      replacement = document.createElement('input');
      replacement.type = 'image';
      replacement.alt = 'Submit application';
      replacement.setAttribute('aria-label', 'Submit application');
    } else if (submitShape === 'input-button') {
      replacement = document.createElement('input');
      replacement.type = 'button';
      replacement.value = 'Submit application';
      replacement.addEventListener('click', function () { this.form.requestSubmit(); });
    } else if (submitShape === 'role-button') {
      replacement = document.createElement('span');
      replacement.setAttribute('role', 'button');
      replacement.textContent = 'Submit application';
      replacement.addEventListener('click', function () { this.closest('form').requestSubmit(); });
    }
    replacement.id = 'application-submit';
    original.replaceWith(replacement);
  }
  document.getElementById('application').addEventListener('submit', function (event) {
    event.preventDefault();
    document.getElementById('submitted').textContent = 'yes';
    fetch('/record-submit', { method: 'POST' });
  });
</script>`;

let submissionCount = 0;
const server = http.createServer((request, response) => {
  if (request.url === '/record-submit') {
    submissionCount += 1;
    response.writeHead(204, { connection: 'close' });
    response.end();
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
  response.end(fixture);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-confirm-replay-'));
fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);
const confirmedSubmitActions = [
  { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' },
  { type: 'extract', selector: '#submitted' },
  { type: 'extract', selector: '#text', attribute: 'value' },
  { type: 'extract', selector: '.select__single-value' },
  { type: 'extract', selector: '#react-commits' },
  { type: 'extract', selector: '#react-option-clicks' },
  { type: 'extract', selector: '#react-multi-values' },
  { type: 'extract', selector: '#react-hidden', attribute: 'aria-invalid' },
  { type: 'extract', selector: '#custom button' },
  { type: 'extract', selector: '#custom-state' },
  { type: 'extract', selector: '#checkbox-state' },
  { type: 'extract', selector: '#checkbox-clicks' },
  { type: 'extract', selector: '#newsletter-error' },
  { type: 'extract', selector: '#file-state' }
];

async function replay(suffix = '', actions = confirmedSubmitActions) {
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: `http://127.0.0.1:${server.address().port}/${suffix}`,
    actions,
    allowSubmit: true,
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
  assert.equal(status, 0, `runner exited ${status}: ${stderr.split('\n').slice(0, 3).join(' ')}`);
  return JSON.parse(fs.readFileSync(path.join(workDir, 'stratus-result-0.json'), 'utf8'));
}

async function replayFailure(suffix) {
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: `http://127.0.0.1:${server.address().port}/${suffix}`,
    actions: [confirmedSubmitActions[0]],
    allowSubmit: true,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 }
  }));
  fs.rmSync(path.join(workDir, 'stratus-result-0.json'), { force: true });
  return await new Promise((resolve) => {
    const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'], {
      cwd: workDir,
      env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
    });
    child.stderr.resume();
    child.stdout.resume();
    child.on('close', resolve);
  });
}

const result = await replay();
assert.equal(result.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
assert.equal(result.extracted.find((entry) => entry.selector === '#text')?.value, 'Mehek Mandal');
assert.deepEqual(result.blockers, []);
assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
assert.equal(result.requiredFieldConfirmation.version, 2);
assert.equal(result.submitOutcome.pressed, true, 'the atomic click must feed current-main submit outcome reporting');
assert.equal(result.requiredFieldConfirmation.passes.length, 1);
const applicationPass = result.requiredFieldConfirmation.passes[0];
assert.equal(applicationPass.scope.requiredControlCount, 12);
assert.equal(applicationPass.requiredControls.length, 12);
assert.ok(applicationPass.requiredControls.every((control) => control.matchCount === 1));
assert.equal(applicationPass.attempts.length, 12);
assert.deepEqual(applicationPass.unresolved, []);
assert.equal(applicationPass.scope.sameNode, true);
assert.equal(applicationPass.submissionOutcome, 'clicked');
assert.deepEqual(new Set(applicationPass.attempts.map((attempt) => attempt.fieldType)), new Set([
  'text', 'date', 'select', 'react-select', 'radio', 'checkbox', 'custom', 'file'
]));
assert.ok(applicationPass.attempts.every((attempt) => ['confirmed', 'already_committed'].includes(attempt.outcome)));
assert.ok(applicationPass.attempts.every((attempt) => attempt.attemptCount === 1));
assert.equal(applicationPass.retries, 0);
assert.ok(applicationPass.attempts.every((attempt) => /^(?:#|\[data-litos-stable-id-v1=)/.test(attempt.selector)));
const bracketed = applicationPass.attempts.find((attempt) => attempt.label === 'Bracket question');
assert.match(bracketed?.selector || '', /^\[data-litos-stable-id-v1="v2-[a-f0-9]{24}-\d+"\]$/);
assert.equal(bracketed?.outcome, 'already_committed');
assert.equal(result.extracted.find((entry) => entry.selector === '.select__single-value')?.value, 'I Agree');
assert.equal(result.extracted.find((entry) => entry.selector === '#react-commits')?.value, '1');
assert.equal(result.extracted.find((entry) => entry.selector === '#custom button')?.value, 'Weekdays');
assert.equal(result.extracted.find((entry) => entry.selector === '#custom-state')?.value, 'selected');
assert.equal(result.extracted.find((entry) => entry.selector === '#checkbox-state')?.value, 'true');
assert.equal(result.extracted.find((entry) => entry.selector === '#checkbox-clicks')?.value, '0');
assert.equal(result.extracted.find((entry) => entry.selector === '#newsletter-error')?.value, 'This requires an answer');
assert.equal(result.extracted.find((entry) => entry.selector === '#file-state')?.value, 'resume.pdf');
assert.equal(applicationPass.attempts.find((attempt) => attempt.selector === '#resume')?.outcome, 'already_committed');

const stickyRequiredCopy = await replay('?sticky-required-copy');
assert.equal(
  stickyRequiredCopy.extracted.find((entry) => entry.selector === '#submitted')?.value,
  'yes',
  'filled controls whose exact answers survive replay must not be blocked by sticky required copy'
);
assert.equal(stickyRequiredCopy.requiredFieldConfirmation.status, 'confirmed');
assert.deepEqual(stickyRequiredCopy.requiredFieldConfirmation.passes[0].unresolved, []);

for (const reviewed of [
  { label: 'Interview Code of Conduct *', answer: 'I agree' },
  { label: 'When did you graduate from High School? *', answer: '2023' }
]) {
  const suffix = '?react-label=' + encodeURIComponent(reviewed.label)
    + '&react-answer=' + encodeURIComponent(reviewed.answer);
  const replayed = await replay(suffix);
  assert.equal(replayed.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
  assert.equal(replayed.extracted.find((entry) => entry.selector === '.select__single-value')?.value, reviewed.answer);
  assert.equal(replayed.extracted.find((entry) => entry.selector === '#react-commits')?.value, '1');
  const pass = replayed.requiredFieldConfirmation.passes[0];
  assert.equal(pass.scope.requiredControlCount, 12);
  assert.equal(pass.attempts.filter((attempt) => attempt.fieldType === 'react-select').length, 1);
}

const stickyCustomValidation = await replay('?leave-custom-invalid');
assert.equal(stickyCustomValidation.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
assert.equal(stickyCustomValidation.requiredFieldConfirmation.status, 'confirmed');
assert.equal(stickyCustomValidation.requiredFieldConfirmation.passes[0].unresolved.length, 0);
assert.equal(stickyCustomValidation.requiredFieldConfirmation.passes[0].attempts.find(
  (attempt) => attempt.selector === '#custom'
)?.attemptCount, 1);

const markedUnverifiedChoice = await replay('?marked-unverified-choice');
assert.equal(markedUnverifiedChoice.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.equal(markedUnverifiedChoice.requiredFieldConfirmation.status, 'blocked');
assert.ok(markedUnverifiedChoice.requiredFieldConfirmation.passes[0].unresolved.some(
  (entry) => /could not be confirmed/.test(entry)
));

const missingReactOption = await replay('?missing-react-option');
assert.equal(missingReactOption.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.equal(missingReactOption.extracted.find((entry) => entry.selector === '#react-commits')?.value, '0');
assert.equal(missingReactOption.requiredFieldConfirmation.status, 'blocked');
assert.equal(missingReactOption.requiredFieldConfirmation.passes[0].unresolved.includes('Privacy Statement *'), true);

const selectedSuperset = await replay('?react-selected-superset');
assert.equal(selectedSuperset.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.equal(selectedSuperset.extracted.find((entry) => entry.selector === '#react-commits')?.value, '0');
assert.equal(selectedSuperset.requiredFieldConfirmation.status, 'blocked');
assert.equal(selectedSuperset.requiredFieldConfirmation.passes[0].unresolved.includes('Privacy Statement *'), true);

const beforeReactSubmitOption = submissionCount;
const reactSubmitOption = await replay('?react-submit-option');
assert.equal(reactSubmitOption.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.equal(reactSubmitOption.extracted.find((entry) => entry.selector === '#react-option-clicks')?.value, '0');
assert.equal(reactSubmitOption.requiredFieldConfirmation.status, 'blocked');
assert.equal(
  submissionCount,
  beforeReactSubmitOption,
  'a submit-capable React option must never fire before the final gate'
);

const crossFieldGrid = await replay('?select-shell-grid-cross-field');
assert.equal(
  crossFieldGrid.extracted.find((entry) => entry.selector === '#submitted')?.value,
  '',
  'a selected dropdown must not answer a distinct empty required control in a shared select-shell wrapper'
);
assert.equal(crossFieldGrid.requiredFieldConfirmation.status, 'blocked');
assert.equal(crossFieldGrid.requiredFieldConfirmation.passes[0].unresolved.includes('Additional required answer *'), true);
assert.equal(crossFieldGrid.requiredFieldConfirmation.passes[0].unresolved.includes('Privacy Statement *'), false);

const delayedReact = await replay('?react-delay=2500');
assert.equal(delayedReact.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.equal(
  delayedReact.extracted.find((entry) => entry.selector === '#react-commits')?.value,
  '2',
  'the delayed first commit is followed by one bounded restoration of the same selected answer'
);
assert.equal(delayedReact.extracted.find((entry) => entry.selector === '.select__single-value')?.value, 'I Agree');
assert.equal(delayedReact.requiredFieldConfirmation.status, 'blocked');
assert.equal(delayedReact.requiredFieldConfirmation.passes[0].unresolved.includes('Privacy Statement *'), true);

const abbreviatedReact = await replay('?react-answer=United%20Arab%20Emirates%20%2B971&react-display=%2B971');
assert.equal(abbreviatedReact.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
assert.equal(
  abbreviatedReact.extracted.find((entry) => entry.selector === '.select__single-value')?.value,
  'United Arab Emirates +971',
  'the exact semantic option replaces the abbreviated display after its real commit'
);
assert.equal(abbreviatedReact.extracted.find((entry) => entry.selector === '#react-commits')?.value, '1');
assert.equal(abbreviatedReact.extracted.find((entry) => entry.selector === '#react-option-clicks')?.value, '1');
assert.equal(abbreviatedReact.requiredFieldConfirmation.status, 'confirmed');

const multiValueReact = await replay(
  '?react-multi',
  confirmedSubmitActions.filter((action) => action.selector !== '.select__single-value')
);
assert.equal(multiValueReact.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
assert.equal(multiValueReact.extracted.find((entry) => entry.selector === '#react-option-clicks')?.value, '0');
assert.equal(multiValueReact.extracted.find((entry) => entry.selector === '#react-commits')?.value, '0');
assert.equal(multiValueReact.extracted.find((entry) => entry.selector === '#react-multi-values')?.value, 'Alpha|Beta');
assert.equal(multiValueReact.requiredFieldConfirmation.status, 'confirmed');

const oneValueReact = await replay(
  '?react-multi-one',
  confirmedSubmitActions.filter((action) => action.selector !== '.select__single-value')
);
assert.equal(oneValueReact.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
assert.equal(oneValueReact.extracted.find((entry) => entry.selector === '#react-option-clicks')?.value, '0');
assert.equal(oneValueReact.extracted.find((entry) => entry.selector === '#react-commits')?.value, '0');
assert.equal(oneValueReact.extracted.find((entry) => entry.selector === '#react-multi-values')?.value, 'Alpha');
assert.equal(oneValueReact.requiredFieldConfirmation.status, 'confirmed');

const unmarkedMultiValueReact = await replay(
  '?react-multi-unmarked',
  confirmedSubmitActions.filter((action) => action.selector !== '.select__single-value')
);
assert.equal(unmarkedMultiValueReact.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
assert.equal(unmarkedMultiValueReact.extracted.find((entry) => entry.selector === '#react-option-clicks')?.value, '0');
assert.equal(unmarkedMultiValueReact.extracted.find((entry) => entry.selector === '#react-multi-values')?.value, 'Austin');
assert.equal(unmarkedMultiValueReact.requiredFieldConfirmation.status, 'confirmed');

const greenhouseHiddenSelectedMultiValue = await replay(
  '?react-multi-unmarked-missing&react-multi-selected-hidden&react-multi-no-aria',
  confirmedSubmitActions.filter((action) => action.selector !== '.select__single-value')
);
assert.equal(greenhouseHiddenSelectedMultiValue.extracted.find(
  (entry) => entry.selector === '#submitted'
)?.value, 'yes');
assert.equal(greenhouseHiddenSelectedMultiValue.extracted.find(
  (entry) => entry.selector === '#react-option-clicks'
)?.value, '0');
assert.equal(greenhouseHiddenSelectedMultiValue.extracted.find(
  (entry) => entry.selector === '#react-multi-values'
)?.value, 'Austin');
assert.equal(greenhouseHiddenSelectedMultiValue.requiredFieldConfirmation.status, 'confirmed');

for (const unsafeMultiValueCase of [
  'react-multi-unmarked-missing',
  'react-multi-unmarked-ambiguous',
  'react-multi-unmarked&react-submit-option',
  'react-multi-unmarked&react-multi-chip-changes',
  'react-multi-empty'
]) {
  const rejected = await replay(
    '?' + unsafeMultiValueCase,
    confirmedSubmitActions.filter((action) => action.selector !== '.select__single-value')
  );
  assert.equal(rejected.extracted.find((entry) => entry.selector === '#submitted')?.value, '', unsafeMultiValueCase);
  assert.equal(rejected.extracted.find((entry) => entry.selector === '#react-option-clicks')?.value, '0', unsafeMultiValueCase);
  assert.equal(rejected.requiredFieldConfirmation.status, 'blocked', unsafeMultiValueCase);
}

const hiddenInvalidOnly = await replay('?hidden-invalid-only');
assert.equal(hiddenInvalidOnly.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
assert.equal(hiddenInvalidOnly.extracted.find((entry) => entry.selector === '#react-commits')?.value, '1');
assert.equal(hiddenInvalidOnly.extracted.find((entry) => entry.selector === '#react-hidden')?.value, 'false');
assert.equal(hiddenInvalidOnly.requiredFieldConfirmation.passes[0].scope.requiredControlCount, 12);
assert.equal(hiddenInvalidOnly.requiredFieldConfirmation.passes[0].attempts.filter(
  (attempt) => attempt.label === 'Privacy Statement *'
).length, 1);

const hiddenInvalidStays = await replay('?hidden-invalid-only&keep-hidden-invalid');
assert.equal(hiddenInvalidStays.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
assert.equal(hiddenInvalidStays.extracted.find((entry) => entry.selector === '#react-commits')?.value, '1');
assert.equal(hiddenInvalidStays.extracted.find((entry) => entry.selector === '#react-hidden')?.value, 'true');
assert.equal(hiddenInvalidStays.requiredFieldConfirmation.status, 'confirmed');
assert.equal(hiddenInvalidStays.requiredFieldConfirmation.passes[0].unresolved.includes('Privacy Statement *'), false);

const select2Actions = [
  ...confirmedSubmitActions,
  { type: 'extract', selector: '#select2-clicks' },
  { type: 'extract', selector: '#select2-option-clicks' },
  { type: 'extract', selector: '#select2-decoy-option-clicks' },
  { type: 'extract', selector: '#select2-changes' },
  { type: 'extract', selector: '#select2-source-clicks' },
  { type: 'extract', selector: '#select2-foreign-option-clicks' },
  { type: 'extract', selector: '#select2-decoy-clicks' },
  { type: 'extract', selector: '.select2-container .select2-chosen' },
  { type: 'extract', selector: '#legacy-source', attribute: 'value' },
  { type: 'extract', selector: '#legacy-source option' }
];
const select2Confirmed = await replay('?select2-case', select2Actions);
assert.equal(select2Confirmed.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
assert.equal(select2Confirmed.extracted.find((entry) => entry.selector === '#select2-clicks')?.value, '1');
assert.equal(select2Confirmed.extracted.find((entry) => entry.selector === '#select2-option-clicks')?.value, '1');
assert.equal(select2Confirmed.extracted.find((entry) => entry.selector === '#select2-decoy-option-clicks')?.value, '0');
assert.equal(select2Confirmed.extracted.find((entry) => entry.selector === '#select2-changes')?.value, '1');
assert.equal(select2Confirmed.extracted.find((entry) => entry.selector === '#select2-source-clicks')?.value, '0');
assert.equal(select2Confirmed.extracted.find((entry) => entry.selector === '#select2-foreign-option-clicks')?.value, '0');
assert.equal(select2Confirmed.extracted.find((entry) => entry.selector === '#select2-decoy-clicks')?.value, '0');
assert.equal(select2Confirmed.extracted.find((entry) => entry.selector === '.select2-container .select2-chosen')?.value, 'Computer Science');
assert.equal(select2Confirmed.extracted.find((entry) => entry.selector === '#legacy-source option')?.value, 'Computer Science');
assert.equal(select2Confirmed.requiredFieldConfirmation.status, 'confirmed');
assert.equal(select2Confirmed.requiredFieldConfirmation.passes[0].scope.requiredControlCount, 13);
assert.equal(select2Confirmed.requiredFieldConfirmation.passes[0].attempts.find(
  (attempt) => attempt.label === 'Legacy choice *'
)?.outcome, 'confirmed');
assert.equal(select2Confirmed.requiredFieldConfirmation.passes[0].attempts.filter(
  (attempt) => attempt.fieldType === 'select2'
).length, 1);

const hiddenInputSelect2 = await replay(
  '?select2-case&select2-hidden-input',
  select2Actions.filter((action) => action.selector !== '#legacy-source option')
);
assert.equal(hiddenInputSelect2.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
assert.equal(hiddenInputSelect2.extracted.find((entry) => entry.selector === '#select2-clicks')?.value, '1');
assert.equal(hiddenInputSelect2.extracted.find((entry) => entry.selector === '#select2-option-clicks')?.value, '1');
assert.equal(hiddenInputSelect2.extracted.find((entry) => entry.selector === '#select2-decoy-option-clicks')?.value, '0');
assert.equal(hiddenInputSelect2.extracted.find((entry) => entry.selector === '#select2-changes')?.value, '1');
assert.equal(hiddenInputSelect2.extracted.find((entry) => entry.selector === '#select2-source-clicks')?.value, '0');
assert.equal(hiddenInputSelect2.extracted.find((entry) => entry.selector === '#select2-decoy-clicks')?.value, '0');
assert.equal(hiddenInputSelect2.extracted.find((entry) => entry.selector === '#legacy-source')?.value, 'cs-id');
assert.equal(hiddenInputSelect2.requiredFieldConfirmation.status, 'confirmed');
assert.equal(hiddenInputSelect2.requiredFieldConfirmation.passes[0].attempts.filter(
  (attempt) => attempt.fieldType === 'select2'
).length, 1);

const beforeSourceClickSubmit = submissionCount;
const sourceClickSubmit = await replay('?select2-case&select2-source-click-submit', select2Actions);
assert.equal(sourceClickSubmit.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
assert.equal(sourceClickSubmit.extracted.find((entry) => entry.selector === '#select2-source-clicks')?.value, '0');
assert.equal(sourceClickSubmit.extracted.find((entry) => entry.selector === '#select2-option-clicks')?.value, '1');
assert.equal(sourceClickSubmit.requiredFieldConfirmation.status, 'confirmed');
assert.equal(submissionCount, beforeSourceClickSubmit + 1, 'Select2 confirmation must submit only through the final bound control');

const beforeForeignDropdown = submissionCount;
const foreignDropdown = await replay('?select2-case&select2-foreign-dropdown', select2Actions);
assert.equal(foreignDropdown.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.equal(foreignDropdown.extracted.find((entry) => entry.selector === '#select2-clicks')?.value, '0');
assert.equal(foreignDropdown.extracted.find((entry) => entry.selector === '#select2-option-clicks')?.value, '0');
assert.equal(foreignDropdown.extracted.find((entry) => entry.selector === '#select2-foreign-option-clicks')?.value, '0');
assert.equal(foreignDropdown.requiredFieldConfirmation.status, 'blocked');
assert.equal(submissionCount, beforeForeignDropdown, 'a foreign active Select2 dropdown must never receive the target field click');

const beforeSubmitOption = submissionCount;
const submitOption = await replay('?select2-case&select2-submit-option', select2Actions);
assert.equal(submitOption.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.equal(submitOption.extracted.find((entry) => entry.selector === '#select2-option-clicks')?.value, '0');
assert.equal(submitOption.extracted.find((entry) => entry.selector === '#select2-source-clicks')?.value, '0');
assert.equal(submitOption.requiredFieldConfirmation.status, 'blocked');
assert.equal(submissionCount, beforeSubmitOption, 'a submit-capable role option must never fire before the final gate');

const beforeNestedSubmitOption = submissionCount;
const nestedSubmitOption = await replay('?select2-case&select2-nested-submit-option', select2Actions);
assert.equal(nestedSubmitOption.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.equal(nestedSubmitOption.extracted.find((entry) => entry.selector === '#select2-option-clicks')?.value, '0');
assert.equal(nestedSubmitOption.requiredFieldConfirmation.status, 'blocked');
assert.equal(
  submissionCount,
  beforeNestedSubmitOption,
  'a nested submit button inside a Select2 role option must never fire before the final gate'
);

const stickySelect2 = await replay('?select2-case&select2-sticky-invalid', select2Actions);
assert.equal(stickySelect2.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
assert.equal(stickySelect2.extracted.find((entry) => entry.selector === '#select2-clicks')?.value, '1');
assert.equal(stickySelect2.extracted.find((entry) => entry.selector === '#select2-option-clicks')?.value, '1');
assert.equal(stickySelect2.extracted.find((entry) => entry.selector === '#select2-decoy-option-clicks')?.value, '0');
assert.equal(stickySelect2.extracted.find((entry) => entry.selector === '#select2-changes')?.value, '1');
assert.equal(stickySelect2.extracted.find((entry) => entry.selector === '#select2-decoy-clicks')?.value, '0');
assert.equal(stickySelect2.requiredFieldConfirmation.status, 'confirmed');
assert.equal(stickySelect2.requiredFieldConfirmation.passes[0].unresolved.includes('Legacy choice *'), false);

const mismatchedSelect2 = await replay('?select2-case&select2-id-mismatch', select2Actions);
assert.equal(mismatchedSelect2.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.equal(mismatchedSelect2.extracted.find((entry) => entry.selector === '#select2-clicks')?.value, '0');
assert.equal(mismatchedSelect2.extracted.find((entry) => entry.selector === '#select2-option-clicks')?.value, '0');
assert.equal(mismatchedSelect2.extracted.find((entry) => entry.selector === '#select2-changes')?.value, '0');
assert.equal(mismatchedSelect2.extracted.find((entry) => entry.selector === '#select2-decoy-clicks')?.value, '0');
assert.equal(mismatchedSelect2.requiredFieldConfirmation.status, 'blocked');

for (const unsafeSelect2Case of ['select2-missing-exact-option', 'select2-source-display-mismatch']) {
  const rejected = await replay('?select2-case&' + unsafeSelect2Case, select2Actions);
  assert.equal(rejected.extracted.find((entry) => entry.selector === '#submitted')?.value, '', unsafeSelect2Case);
  assert.equal(rejected.extracted.find((entry) => entry.selector === '#select2-option-clicks')?.value, '0', unsafeSelect2Case);
  assert.equal(rejected.extracted.find((entry) => entry.selector === '#select2-decoy-option-clicks')?.value, '0', unsafeSelect2Case);
  assert.equal(rejected.extracted.find((entry) => entry.selector === '#select2-changes')?.value, '0', unsafeSelect2Case);
  assert.equal(rejected.requiredFieldConfirmation.status, 'blocked', unsafeSelect2Case);
}

const select2NoOpenerActions = select2Actions.filter((action) => (
  action.selector !== '.select2-container .select2-chosen'
));
for (const openerShape of ['zero', 'hidden', 'two']) {
  const rejected = await replay('?select2-case&select2-opener=' + openerShape, select2NoOpenerActions);
  assert.equal(rejected.extracted.find((entry) => entry.selector === '#submitted')?.value, '', openerShape);
  assert.equal(rejected.extracted.find((entry) => entry.selector === '#select2-clicks')?.value, '0', openerShape);
  assert.equal(rejected.extracted.find((entry) => entry.selector === '#select2-option-clicks')?.value, '0', openerShape);
  assert.equal(rejected.extracted.find((entry) => entry.selector === '#select2-changes')?.value, '0', openerShape);
  assert.equal(rejected.extracted.find((entry) => entry.selector === '#select2-decoy-clicks')?.value, '0', openerShape);
  assert.equal(rejected.requiredFieldConfirmation.status, 'blocked', openerShape);
}

const legacyCombobox = await replay('?legacy-combobox', [
  ...confirmedSubmitActions,
  { type: 'extract', selector: '#legacy-combobox-progress' }
]);
assert.equal(legacyCombobox.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
assert.equal(legacyCombobox.extracted.find((entry) => entry.selector === '#legacy-combobox-progress')?.value, 'click,escape,blur');
assert.equal(legacyCombobox.requiredFieldConfirmation.status, 'confirmed');
assert.equal(legacyCombobox.requiredFieldConfirmation.passes[0].attempts.find(
  (attempt) => attempt.label === 'Legacy combobox *'
)?.outcome, 'confirmed');

const staleMarkerActions = [
  ...confirmedSubmitActions,
  { type: 'extract', selector: '#stale-marker-peer', attribute: 'data-litos-required-confirm' },
  { type: 'extract', selector: '#stale-marker-peer', attribute: 'data-litos-required-confirm-source' },
  { type: 'extract', selector: '#stale-marker-peer', attribute: 'data-litos-select2-confirm' }
];
const staleMarkers = await replay('?stale-marker-before-submit', staleMarkerActions);
assert.equal(staleMarkers.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes');
assert.equal(staleMarkers.extracted.find((entry) => entry.selector === '#react-commits')?.value, '1');
assert.ok(staleMarkers.extracted.filter((entry) => entry.selector === '#stale-marker-peer').every(
  (entry) => entry.value === null
));
assert.equal(staleMarkers.requiredFieldConfirmation.status, 'confirmed');
assert.equal(staleMarkers.requiredFieldConfirmation.passes.length, 1);
assert.ok(staleMarkers.requiredFieldConfirmation.passes.every((pass) => pass.unresolved.length === 0));

for (const shape of ['button-default', 'input-image', 'input-button', 'role-button']) {
  const shaped = await replay('?submit-shape=' + shape);
  assert.equal(shaped.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes', shape + ' must be selected and clicked atomically');
  assert.equal(shaped.requiredFieldConfirmation.status, 'confirmed');
}

for (const label of [
  'Submit',
  'Apply',
  'Apply now',
  'Submit your application',
  'Submit the application',
  'Send your application',
  'Submit application with attachments',
  'Finish & apply'
]) {
  const labelled = await replay('?submit-label=' + encodeURIComponent(label));
  assert.equal(labelled.extracted.find((entry) => entry.selector === '#submitted')?.value, 'yes', label + ' must satisfy chooser policy v2');
  assert.equal(labelled.requiredFieldConfirmation.status, 'confirmed');
}

const replaced = await replay('?replace-submit');
assert.equal(replaced.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.equal(replaced.requiredFieldConfirmation.status, 'blocked');
assert.equal(replaced.requiredFieldConfirmation.passes[0].scope.sameNode, false);
assert.equal(replaced.requiredFieldConfirmation.passes[0].blockerReason, 'submit_node_replaced');
assert.equal(replaced.requiredFieldConfirmation.passes[0].submissionOutcome, 'blocked');

const scanFailure = await replay('?scan-exception');
assert.equal(scanFailure.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.equal(scanFailure.requiredFieldConfirmation.status, 'blocked');
assert.ok(scanFailure.requiredFieldConfirmation.passes[0].unresolved.includes('Required-field readiness scan failed'));

const beforeAmbiguous = submissionCount;
assert.notEqual(await replayFailure('?equal-final-candidates'), 0, 'equal top-scoring final controls must fail closed');
assert.equal(submissionCount, beforeAmbiguous, 'an equal top-score tie must not click either control');

for (const handoff of [
  '?sole-continue',
  '?sole-linkedin',
  '?submit-label=Next',
  '?submit-label=Finish',
  '?submit-label=' + encodeURIComponent('Complete application'),
  '?submit-label=' + encodeURIComponent('Finish application'),
  '?submit-label=' + encodeURIComponent('Submit application via Wellfound'),
  '?submit-label=' + encodeURIComponent('Submit application with recruiting partner'),
  '?submit-label=' + encodeURIComponent('Submit application feedback'),
  '?submit-label=' + encodeURIComponent('Submit application using Career Services'),
  '?submit-label=' + encodeURIComponent('Send application from recruiting partner'),
  '?submit-label=' + encodeURIComponent('Submit a support request'),
  '?submit-label=' + encodeURIComponent('Submit your question'),
  '?submit-label=' + encodeURIComponent('Sign in with Google'),
  '?submit-label=' + encodeURIComponent('Import profile')
]) {
  const before = submissionCount;
  assert.notEqual(await replayFailure(handoff), 0, handoff + ' must fail closed as a non-final control');
  assert.equal(submissionCount, before, handoff + ' must not be clicked');
}

const missingProof = await replay('', [
  { type: 'click', selector: 'button[type="submit"]', label: 'final_submit' },
  { type: 'extract', selector: '#submitted' }
]);
assert.equal(missingProof.extracted.find((entry) => entry.selector === '#submitted')?.value, '');
assert.ok(missingProof.blockers.includes('Required-field confirmation proof is missing or malformed'));
server.close();
console.log('required confirmation replay: exact affected controls commit and verify before one final submit');
