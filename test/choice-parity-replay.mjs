/* THE SAME QUESTION, RENDERED FOUR WAYS, MUST GIVE THE SAME ANSWER OR REFUSE.
 *
 * Sponsorship and work authorisation are asked by Greenhouse, Lever and Ashby as native selects,
 * radio groups, pill buttons and React Selects, and until this suite existed only the native select
 * had a test. The other three shared one predicate - bidirectional substring containment above six
 * characters - and each took the FIRST option that satisfied it, so the answer that went to the
 * employer was decided by the order the employer happened to list its rows in. On this vocabulary
 * every row is a containment relative of its neighbours:
 *
 *   I do not require sponsorship          <-> I do not require sponsorship now, but will in the future
 *   I am authorized to work               <-> I am authorized to work only with a student visa
 *
 * so both directions are reachable and both are a false statement about visa status, made to an
 * employer, under the applicant's own name, and invisible from either end of the run. The native
 * select is the higher-volume path on Lever; radios, pills and React Selects are the higher-volume
 * paths on Greenhouse and Ashby, which is where most of this corpus lives.
 *
 * WHY THIS DRIVES THE SHIPPED RUNNER AGAINST SERVED PAGES. SANDBOX_RUNNER travels to the sandbox as
 * a string. Nothing type-checks it, and an assertion that some text appears inside it proves only
 * that the text is there: this repo has already shipped a production defect behind a source-string
 * pin that was still passing. Every case below writes stratus-input.json, runs
 * `node stratus-runner.cjs` exactly as executeSandboxRun does, and reads the verdict out of
 * stratus-result-0.json. The fixtures are the markup these boards actually serve - Ashby's pill pair
 * with its display:none mirror checkbox, Greenhouse's React Select with a late menu and a
 * .select__single-value - so a case can only pass by the runner having chosen correctly on a page
 * that behaves like the real one.
 *
 * THE ASYMMETRY EVERY ASSERTION ENCODES. A control this runner declines costs the applicant a
 * minute. A control it answers WRONGLY puts a false legal declaration on a real application and
 * reports it to her as filled. So the cases that require NO click are as load-bearing as the ones
 * that require one, and every case asserts filledFields and skipped as well as the page.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ATOMIC_SUBMIT_POLICY, SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

// How late a React Select's menu renders. Sized on the live measurement behind the bounded menu
// wait: Greenhouse's asynchronously loaded menus arrived 555-563ms after the control was touched.
const MENU_RENDER_MS = 400;
// How long the reordering select stays disabled after its trigger fires. See the reorder case: the
// gap between the runner's option snapshot and its write is a few milliseconds, so this only has to
// be comfortably longer than that to put the re-render inside the window.
const REORDER_DELAY_MS = 700;

const SPONSOR_SHORT = 'I do not require sponsorship';
const SPONSOR_LONG = 'I do not require sponsorship now, but will in the future';
const SPONSOR_YES = 'I require sponsorship now';
// The same truthful answer as the employer writes it when it drops the comma. One character, and on
// a literal-only exact tier it is the difference between the right row and its false prefix.
const SPONSOR_LONG_NO_COMMA = 'I do not require sponsorship now but will in the future';
const AUTH_US = 'I am authorized to work in the United States';
const AUTH_US_ANY = 'I am authorized to work in the United States for any employer';
const AUTH_US_STUDENT = 'I am authorized to work in the United States only with a student visa';
const AUTH_SHORT = 'I am authorized to work';
const AUTH_STUDENT = 'I am authorized to work only with a student visa';
const STUDY_ROWS = ['Computer Science and Engineering', 'Computer Science, Business Administration', 'Computer Science'];
const SPONSOR_NO_LONG = 'No, I do not require sponsorship now, but will in the future';
const SPONSOR_NO_SHORT = 'No, I do not require sponsorship';
const SPONSOR_NO_YES = 'Yes, I require sponsorship now';
/* THE SAME QUESTION IN FOUR LANGUAGES THAT NEGATE BY AFFIXING, so the row that says the OPPOSITE of
 * the stored answer contains the stored answer. English cannot produce this shape: "I do not require
 * sponsorship" does not contain "I require sponsorship". Every menu below offers only the negation,
 * which is the shape a substring query answers with exactly one row and no ambiguity to guard. */
const NEGATED = [
  { id: 'zh-visa', question: 'Visa sponsorship, Chinese', stored: '需要工作签证担保', row: '不需要工作签证担保' },
  { id: 'zh-auth', question: 'Work authorization, Chinese', stored: '有工作授权', row: '没有工作授权' },
  { id: 'ja-visa', question: 'Visa sponsorship, Japanese', stored: 'ビザのサポートは必要', row: 'ビザのサポートは必要ありません' },
  { id: 'ko-visa', question: 'Visa sponsorship, Korean', stored: '스폰서십이 필요', row: '스폰서십이 필요하지 않습니다' }
];
const VETERAN_CLAIM = 'I identify as one or more of the classifications of protected veteran';
const NOT_ABOVE = 'I do not identify with any of the above';
const REAL_OPT_OUT = 'I do not want to answer';

const escapeHtml = (value) => String(value)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/* Ashby's EEO and work-eligibility shape: a real radio group inside a fieldset, each input named by
   its own label element. optionTextOf reads that label, which is why the label carries the option
   text and the legend carries the question. */
function radioBlock(id, question, options) {
  const rows = options.map((option, index) => `
    <div><span><input type="radio" id="${id}-${index}" name="${id}"></span>
      <label for="${id}-${index}">${escapeHtml(option)}</label></div>`).join('');
  return `<fieldset data-block="${id}"><legend>${escapeHtml(question)}</legend>${rows}
    <div id="${id}-answer"></div></fieldset>`;
}

/* Ashby's pill shape, copied in structure from the live form: plain buttons carrying the answer
   text, beside ONE input[type=checkbox] that is off-screen and whose label is the QUESTION rather
   than an answer. That mirror input is what sends this question down the checkbox arm, and the
   buttons are the only thing on the block that is an option. */
function pillBlock(id, question, options) {
  const pills = options.map((option, index) =>
    `<button type="button" id="${id}-${index}">${escapeHtml(option)}</button>`).join('');
  return `<div class="_fieldEntry_1e3gg_28" data-block="${id}">
    <label class="_heading_f7cvd_52" for="${id}-mirror">${escapeHtml(question)}</label>
    <input id="${id}-mirror" type="checkbox" style="position:absolute;left:-9999px">
    <div class="_pills_">${pills}</div>
    <div id="${id}-answer"></div></div>`;
}

/* Greenhouse's React Select, reproduced down to the parts that bite: the chosen value lives in its
   own .select__single-value node rather than on the input, the placeholder is its own node so an
   untouched control can be told from an answered one, and the menu renders LATE and inside the
   widget's own container. 'renders' is what the widget displays once a row is taken, which is the
   row text everywhere except the one case that exists to show a widget abbreviating it.

   THE CLEAR INDICATOR IS PART OF THE SHAPE and is not decoration. Greenhouse's React Selects carry
   one, the runner's CLEAR_CONTROL_RE exists solely because clicking it wiped a correct answer, and
   it is what a withdrawal presses when a clicked row turns out not to be the answer. A fixture
   without it cannot show either half: not the chooser leaving it alone, and not the withdrawal
   finding it. 'clearable' is false for the one block that exists to show what happens when a
   control offers no way back. */
function reactBlock(id, question, options, renders = null, clearable = true) {
  const clear = clearable
    ? `<button type="button" class="select__clear-indicator" aria-label="Clear selection"></button>`
    : '';
  return `<div class="select__container" data-block="${id}" data-react-select="${id}">
    <label for="${id}-input">${escapeHtml(question)}</label>
    <div class="select__control">
      <div class="select__value-container">
        <div class="select__placeholder">Select...</div>
        <div class="select__input-container">
          <input id="${id}-input" class="select__input" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off"></div>
      </div>
      ${clear}
    </div>
    <script type="application/json" class="select__rows">${JSON.stringify({ options, renders })}</script>
    <div id="${id}-answer"></div><div id="${id}-shown"></div></div>`;
}

/* A COMBOBOX THAT IS NOT AN INPUT, which is the shape that had no verifier behind it.
 *
 * fillByLabelText resolves the question's block, then looks inside it for a textarea, an input or a
 * select. Every other block in this file has one - the pill block its mirror checkbox, the React
 * block its .select__input, the Select2 block its #s2-input - so the branch taken when the block
 * has NONE was never entered by this suite, and that branch was the one reporting a field filled
 * without ever reading the control back.
 *
 * The markup is the shape Ashby and Workday serve: a '<div role="combobox" aria-haspopup="listbox">'
 * that displays its own chosen value, a menu that renders in the block a beat later, a clear
 * affordance, and not one input, textarea or select anywhere in the block. The value is published
 * in a .select__single-value node because that is the one rendering readChoiceState can read; a
 * control that publishes nothing is a different case and the Select2 block already covers it. */
function ariaBlock(id, question, options, clearable = true) {
  const clear = clearable
    ? `<button type="button" class="clear-answer" aria-label="Clear selection"></button>`
    : '';
  return `<div class="select-shell" data-block="${id}" data-aria-select="${id}">
    <label id="${id}-label">${escapeHtml(question)}</label>
    <div class="aria-control" role="combobox" aria-haspopup="listbox" aria-expanded="false" aria-labelledby="${id}-label" tabindex="0">
      <div class="select__placeholder">Select...</div>
    </div>
    ${clear}
    <script type="application/json" class="select__rows">${JSON.stringify({ options })}</script>
    <div id="${id}-answer"></div><div id="${id}-shown"></div></div>`;
}

// One case rendered all three ways, so a single replay proves the three paths agree rather than
// proving each of them separately against a different page.
function trio(id, question, options, renders = null) {
  return radioBlock(`radio-${id}`, `${question}, radio`, options)
    + pillBlock(`pill-${id}`, `${question}, pills`, options)
    + reactBlock(`react-${id}`, `${question}, react select`, options, renders);
}

const fixture = `<!doctype html><meta charset="utf-8"><title>Choice Parity Fixture</title>
${trio('long-second', 'Sponsorship, truthful answer listed second', [SPONSOR_SHORT, SPONSOR_LONG, SPONSOR_YES])}
${trio('long-first', 'Sponsorship, truthful answer listed first', [SPONSOR_LONG, SPONSOR_SHORT])}
${trio('short-stored', 'Sponsorship, longer row listed first', [SPONSOR_LONG, SPONSOR_SHORT])}
${trio('exact-below', 'Field of study, exact answer listed last', STUDY_ROWS)}
${trio('ambiguous', 'Work authorization, no exact answer on the list', [AUTH_US_ANY, AUTH_US_STUDENT])}
<!-- EXACTLY ONE near match and no exact one. Two was never the dangerous number; one was, because a
     containment tier takes it without hesitating and neither the radio path nor the pill path has a
     verification stage behind it. -->
${trio('one-near-miss', 'Sponsorship, only a near match on the list', [SPONSOR_SHORT, SPONSOR_YES])}
<!-- The same shape on work authorisation, and the row is 61 characters. Under the old 40 character
     pill ceiling that row was invisible and the pill refused by accident; admitting it without
     removing the containment tier turned that accident into a false declaration. -->
${trio('long-near-miss', 'Work authorization, only a near match on the list', [AUTH_US_ANY, 'I require sponsorship'])}
<!-- The menu does not carry her answer at all, only a PREFIX of it, and that prefix is the exact
     reversal of what she said. Nothing on the list is ambiguous, so no rule that counts rows can
     help: it is the reach itself that has to go. -->
${trio('prefix-only', 'Sponsorship, only a prefix of the answer on the list', [SPONSOR_NO_SHORT, SPONSOR_NO_YES])}
${NEGATED.map((entry) => trio(entry.id, entry.question, [entry.row])).join('\n')}
<!-- The dial code widening, on a script normalising erases: the row names the country and the extra
     material carries no letters, which is exactly what separates it from a negation. -->
${trio('ja-country', 'Country, Japanese', ['日本 +81', 'アメリカ +1'])}
<!-- SELECT2 v3, the shape readChoiceState cannot read. Its chosen value lives in .select2-chosen
     and not in a React Select node, so the control comes back 'unknown' however correctly it was
     answered. Two things are being measured here at once: a hasText query matches the list, the row
     AND the row's own label, all three by the same CSS, so counting nodes would call one offered row
     three and clicking .first() would click the whole list; and what the applicant is told when the
     answer lands on a control that does not publish what it is holding. -->
<div class="s2-block" data-block="select2-major">
  <label for="s2-input">What is your field of study, Select2</label>
  <div class="select2-container"><a class="select2-choice" role="button"><span class="select2-chosen">Select...</span></a></div>
  <input id="s2-input" class="select2-input" role="combobox" aria-expanded="false" autocomplete="off">
  <div id="s2-menu"></div>
  <div id="select2-major-answer"></div>
</div>
<!-- The employer omits the comma the stored answer carries. -->
${trio('punctuation', 'Sponsorship, employer drops the comma', [SPONSOR_SHORT, SPONSOR_LONG_NO_COMMA])}
<!-- Punctuation that carries the whole meaning of the answer, on a list that normalises to one
     string. The literal match has to be taken before anything is normalised. -->
${trio('punctuation-only', 'Which language do you know best', ['C++', 'C#'])}
${trio('not-above', 'Veteran status, no opt-out on the list', [VETERAN_CLAIM, NOT_ABOVE])}
${trio('opt-out', 'Veteran status, an opt-out on the list', [VETERAN_CLAIM, NOT_ABOVE, REAL_OPT_OUT])}
<!-- The widget renders what it is holding as a SHORTER RELATIVE of the row that set it, which is a
     different declaration and not an abbreviation. Contrast the country control, whose rendering
     ("+971" for "United Arab Emirates +971") has no words in common with the answer at all. -->
${reactBlock('react-shortens', 'Work authorization (the widget shortens what it holds)', [AUTH_STUDENT], { [AUTH_STUDENT]: AUTH_SHORT })}
<!-- THE BLOCK WITH NO INPUT IN IT. Both cases are the same control and the same menu; only the list
     differs, so the pair separates "this branch verifies" from "this branch refuses everything". -->
${ariaBlock('aria-near-miss', 'Work authorization, combobox that is not an input', [AUTH_US_STUDENT])}
${ariaBlock('aria-exact', 'Work authorization, combobox that is not an input, exact row present', [AUTH_US_ANY, AUTH_US_STUDENT, AUTH_US])}
<!-- TWO QUESTIONS, ONE VOCABULARY, which is every form that asks anything twice.
     Q1's listbox is always rendered, the way a consent block is; Q2 opens its own menu on demand.
     Both offer a row named exactly "No". Nothing about Q1 is unusual and nothing about it is being
     filled: the run is asked for Q2 only. -->
<div class="consent-block" data-block="consent">
  <div id="consent-label">Do you consent to a background check</div>
  <div role="listbox" aria-labelledby="consent-label">
    <div role="option" id="consent-yes">Yes</div>
    <div role="option" id="consent-no">No</div>
  </div>
  <div id="consent-answer"></div>
</div>
<div class="sponsor-block" data-block="sponsor-combobox">
  <label id="sponsor-combobox-label">Will you now or in the future require sponsorship</label>
  <button type="button" id="sponsor-combobox-control" aria-haspopup="listbox" aria-expanded="false">Select...</button>
  <div id="sponsor-combobox-menu"></div>
  <div id="sponsor-combobox-answer"></div>
</div>
<!-- Native selects. Every case below is the same defect family reached through selectNativeOption. -->
<label for="native_long_second">Sponsorship, native select</label>
<select id="native_long_second">
  <option value="">Select...</option>
  <option>${SPONSOR_SHORT}</option>
  <option>${SPONSOR_LONG}</option>
</select>
<label for="native_short_stored">Sponsorship, native select, longer row first</label>
<select id="native_short_stored">
  <option value="">Select...</option>
  <option>${SPONSOR_LONG}</option>
  <option>${SPONSOR_SHORT}</option>
</select>
<label for="native_not_above">Veteran status, native select, no opt-out</label>
<select id="native_not_above">
  <option value="">Select...</option>
  <option>${VETERAN_CLAIM}</option>
  <option>${NOT_ABOVE}</option>
</select>
<label for="native_opt_out">Veteran status, native select, an opt-out</label>
<select id="native_opt_out">
  <option value="">Select...</option>
  <option>${VETERAN_CLAIM}</option>
  <option>${NOT_ABOVE}</option>
  <option>${REAL_OPT_OUT}</option>
</select>
<label for="native_punctuation">Sponsorship, native select, employer drops the comma</label>
<select id="native_punctuation">
  <option value="">Select...</option>
  <option>${SPONSOR_SHORT}</option>
  <option>${SPONSOR_LONG_NO_COMMA}</option>
</select>
<label for="native_language">Which language do you know best, native select</label>
<select id="native_language">
  <option value="">Select...</option>
  <option>C++</option>
  <option>C#</option>
</select>
<!-- Two rows that are the same answer written twice. Not a collision: whichever is taken, the
     employer reads the same word. -->
<label for="native_case">Are you authorized to work</label>
<select id="native_case">
  <option value="">Select...</option>
  <option>Yes</option>
  <option>YES</option>
</select>
<!-- normalized() keeps only [a-z0-9], so "10+" and "10" arrive at the normalised tier as one string.
     Here the literal answer IS on the list and must be taken. -->
<label for="native_collision">Years of experience</label>
<select id="native_collision">
  <option value="">Select...</option>
  <option>10+</option>
  <option>10</option>
</select>
<!-- And here it is not, so the two rows really are indistinguishable once normalised. -->
<label for="native_true_collision">Years of experience, no literal row</label>
<select id="native_true_collision">
  <option value="">Select...</option>
  <option>10+</option>
  <option>10.</option>
</select>
<label for="native_no_collision">Years of experience, distinct rows</label>
<select id="native_no_collision">
  <option value="">Select...</option>
  <option>9</option>
  <option>10</option>
</select>
<!-- An option named by its label ATTRIBUTE, which is what the runner's own snapshot reads and what
     Playwright matches a label write against. Its text and its value say something else. -->
<label for="native_label_attr">Gender</label>
<select id="native_label_attr">
  <option value="">Select...</option>
  <option label="Prefer not to say">row-two-text</option>
</select>
<!-- THE RE-RENDER RACE. The snapshot and the write are separated by an await, and a board that
     reorders its options in that gap moves every index. Triggering it from a control the runner
     fills one action earlier is what makes the window deterministic rather than a coin toss: the
     select is disabled synchronously on that fill, so the write has to wait for it, and the reorder
     lands while it waits. An index write takes whatever now sits at that position. -->
<label for="race_trigger">Preferred name</label>
<input id="race_trigger" type="text">
<label for="native_reorder">Sponsorship, board reorders its own options</label>
<select id="native_reorder">
  <option value="">Select...</option>
  <option>${SPONSOR_SHORT}</option>
  <option>${SPONSOR_LONG}</option>
</select>
<div id="reorder-happened">no</div>
<script>
  // ---- Radio groups publish what is ticked ----
  Array.prototype.forEach.call(document.querySelectorAll('fieldset[data-block]'), function (block) {
    block.addEventListener('change', function (event) {
      var label = block.querySelector('label[for="' + event.target.id + '"]');
      document.getElementById(block.getAttribute('data-block') + '-answer').textContent = label ? label.textContent : '';
    });
  });

  // ---- Pills publish what is pressed, and mark themselves selected ----
  //
  // aria-pressed is one of the selected-state signals the runner reads back before it will report a
  // pill as answered, and setting rather than toggling is deliberate: the runner presses a second
  // time only when the first press left no signal, and a toggle would then turn the answer off.
  // Scoped to the pill row itself. Every block in this file carries data-block, and the React and
  // combobox blocks now carry a clear button, so a bare 'button' query would have wired their clear
  // indicator up as an option and had it publish an answer.
  Array.prototype.forEach.call(document.querySelectorAll('div[data-block]._pillHost, div[data-block]'), function (block) {
    var pills = block.querySelectorAll('._pills_ button');
    if (!pills.length) return;
    Array.prototype.forEach.call(pills, function (pill) {
      pill.addEventListener('click', function () {
        Array.prototype.forEach.call(pills, function (other) { other.setAttribute('aria-pressed', 'false'); });
        pill.setAttribute('aria-pressed', 'true');
        var answer = document.getElementById(block.getAttribute('data-block') + '-answer');
        if (answer) answer.textContent = pill.textContent;
      });
    });
  });

  // ---- React Selects ----
  Array.prototype.forEach.call(document.querySelectorAll('[data-react-select]'), function (shell) {
    var config = JSON.parse(shell.querySelector('.select__rows').textContent);
    var input = shell.querySelector('input[role="combobox"]');
    var control = shell.querySelector('.select__control');
    var values = shell.querySelector('.select__value-container');
    var answer = document.getElementById(shell.getAttribute('data-block') + '-answer');
    var timer = null;
    var chosen = '';
    function renderChosen() {
      var existing = shell.querySelector('.select__single-value');
      if (existing) existing.remove();
      var placeholder = shell.querySelector('.select__placeholder');
      if (!chosen) { if (placeholder) placeholder.style.display = ''; answer.textContent = ''; return; }
      if (placeholder) placeholder.style.display = 'none';
      var shown = (config.renders && config.renders[chosen]) || chosen;
      var node = document.createElement('div');
      node.className = 'select__single-value';
      node.textContent = shown;
      values.prepend(node);
      answer.textContent = shown;
      // A WITNESS THE WITHDRAWAL CANNOT ERASE. '-answer' is what the control is holding NOW and is
      // the thing an employer would receive; '-shown' is what it was ever made to hold, and it is
      // never cleared. Without it a case asserting an empty control cannot tell a row that was
      // clicked and taken back from a row that was never clicked at all, and those are the two
      // outcomes it exists to distinguish.
      document.getElementById(shell.getAttribute('data-block') + '-shown').textContent = shown;
    }
    function closeMenu() {
      if (timer) { clearTimeout(timer); timer = null; }
      var menu = shell.querySelector('.select__menu');
      if (menu) menu.remove();
      input.setAttribute('aria-expanded', 'false');
    }
    function openMenu() {
      closeMenu();
      input.setAttribute('aria-expanded', 'true');
      timer = setTimeout(function () {
        timer = null;
        var query = input.value.trim().toLowerCase();
        var menu = document.createElement('div');
        menu.className = 'select__menu';
        menu.setAttribute('role', 'listbox');
        config.options.filter(function (row) {
          return !query || row.toLowerCase().indexOf(query) >= 0;
        }).forEach(function (row, index) {
          var option = document.createElement('div');
          option.className = 'select__option';
          option.setAttribute('role', 'option');
          option.id = shell.getAttribute('data-block') + '-option-' + index;
          option.textContent = row;
          option.addEventListener('mousedown', function (event) {
            event.preventDefault();
            chosen = row;
            input.value = '';
            renderChosen();
            closeMenu();
          });
          menu.appendChild(option);
        });
        shell.appendChild(menu);
      }, ${MENU_RENDER_MS});
    }
    control.addEventListener('mousedown', function () {
      if (input.getAttribute('aria-expanded') === 'true') closeMenu(); else openMenu();
    });
    input.addEventListener('input', function () { openMenu(); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeMenu(); });
  });

  // ---- The combobox that is not an input ----
  //
  // Same lifecycle as the React Selects above and the same late menu, minus the search input. The
  // clear button is what a withdrawal presses; it carries no text, only an aria-label, exactly as a
  // React Select's SVG indicator does, so nothing that reads button TEXT can mistake it for an
  // option.
  Array.prototype.forEach.call(document.querySelectorAll('[data-aria-select]'), function (shell) {
    var config = JSON.parse(shell.querySelector('.select__rows').textContent);
    var control = shell.querySelector('[role="combobox"]');
    var answer = document.getElementById(shell.getAttribute('data-block') + '-answer');
    var clear = shell.querySelector('.clear-answer');
    var timer = null;
    function renderChosen(row) {
      var existing = shell.querySelector('.select__single-value');
      if (existing) existing.remove();
      var placeholder = shell.querySelector('.select__placeholder');
      if (!row) { if (placeholder) placeholder.style.display = ''; answer.textContent = ''; return; }
      if (placeholder) placeholder.style.display = 'none';
      var node = document.createElement('div');
      node.className = 'select__single-value';
      node.textContent = row;
      control.appendChild(node);
      answer.textContent = row;
      // See the React block above: '-shown' records what this control was ever made to hold and is
      // never cleared, so an empty '-answer' can be told from a click that never happened.
      document.getElementById(shell.getAttribute('data-block') + '-shown').textContent = row;
    }
    function closeMenu() {
      if (timer) { clearTimeout(timer); timer = null; }
      var menu = shell.querySelector('.select__menu');
      if (menu) menu.remove();
      control.setAttribute('aria-expanded', 'false');
    }
    function openMenu() {
      closeMenu();
      control.setAttribute('aria-expanded', 'true');
      timer = setTimeout(function () {
        timer = null;
        var menu = document.createElement('div');
        menu.className = 'select__menu';
        menu.setAttribute('role', 'listbox');
        config.options.forEach(function (row, index) {
          var option = document.createElement('div');
          option.className = 'select__option';
          option.setAttribute('role', 'option');
          option.id = shell.getAttribute('data-block') + '-option-' + index;
          option.textContent = row;
          option.addEventListener('mousedown', function (event) {
            event.preventDefault();
            renderChosen(row);
            closeMenu();
          });
          menu.appendChild(option);
        });
        shell.appendChild(menu);
      }, ${MENU_RENDER_MS});
    }
    control.addEventListener('mousedown', function () {
      if (control.getAttribute('aria-expanded') === 'true') closeMenu(); else openMenu();
    });
    if (clear) clear.addEventListener('click', function () { closeMenu(); renderChosen(''); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeMenu(); });
  });

  // ---- The clear indicator the React Selects carry ----
  Array.prototype.forEach.call(document.querySelectorAll('[data-react-select] .select__clear-indicator'), function (clear) {
    clear.addEventListener('click', function () {
      var shell = clear.closest('[data-react-select]');
      var existing = shell.querySelector('.select__single-value');
      if (existing) existing.remove();
      var placeholder = shell.querySelector('.select__placeholder');
      if (placeholder) placeholder.style.display = '';
      document.getElementById(shell.getAttribute('data-block') + '-answer').textContent = '';
    });
  });

  // ---- Two questions that share a vocabulary ----
  //
  // Q1 is a listbox that is on the page from the start, which is what a consent block looks like.
  // Nothing here is special: it publishes what it is given, exactly as the radio blocks do.
  Array.prototype.forEach.call(document.querySelectorAll('.consent-block [role="option"]'), function (row) {
    row.addEventListener('click', function () {
      document.getElementById('consent-answer').textContent = row.textContent;
    });
    row.addEventListener('mousedown', function (event) {
      event.preventDefault();
      document.getElementById('consent-answer').textContent = row.textContent;
    });
  });
  (function () {
    var control = document.getElementById('sponsor-combobox-control');
    var menu = document.getElementById('sponsor-combobox-menu');
    var answer = document.getElementById('sponsor-combobox-answer');
    // Rendered synchronously, for the same reason the Select2 block below is: nothing about this
    // block scopes a menu for it, so the runner gives it the flat 150ms settle rather than waiting
    // on a widget it recognises. A fixture whose menu arrives after that window would be measuring
    // the wait instead of the scoping, and the scoping is the thing under test.
    function open() {
      if (control.getAttribute('aria-expanded') === 'true') { menu.innerHTML = ''; control.setAttribute('aria-expanded', 'false'); return; }
      control.setAttribute('aria-expanded', 'true');
      menu.innerHTML = '<div role="listbox">'
        + '<div role="option" id="sponsor-yes">Yes</div><div role="option" id="sponsor-no">No</div></div>';
      Array.prototype.forEach.call(menu.querySelectorAll('[role="option"]'), function (row) {
        function take(event) {
          if (event) event.preventDefault();
          control.textContent = row.textContent;
          answer.textContent = row.textContent;
          menu.innerHTML = '';
          control.setAttribute('aria-expanded', 'false');
        }
        row.addEventListener('mousedown', take);
        row.addEventListener('click', take);
      });
    }
    control.addEventListener('click', open);
  }());

  // ---- Select2 v3, rendered synchronously because nothing scopes a menu for it ----
  (function () {
    var block = document.querySelector('.s2-block');
    var menu = document.getElementById('s2-menu');
    var chosen = block.querySelector('.select2-chosen');
    var answer = document.getElementById('select2-major-answer');
    var ROWS = ['Computer Science', 'Computer Engineering', 'Economics'];
    function open() {
      menu.innerHTML = '<ul class="select2-results">' + ROWS.map(function (row) {
        return '<li class="select2-result"><div class="select2-result-label">' + row + '</div></li>';
      }).join('') + '</ul>';
      Array.prototype.forEach.call(menu.querySelectorAll('li.select2-result'), function (li) {
        li.addEventListener('mousedown', function (event) {
          event.preventDefault();
          chosen.textContent = li.textContent;
          answer.textContent = li.textContent;
          menu.innerHTML = '';
        });
        li.addEventListener('click', function () {
          chosen.textContent = li.textContent;
          answer.textContent = li.textContent;
          menu.innerHTML = '';
        });
      });
    }
    block.querySelector('.select2-choice').addEventListener('mousedown', open);
    block.querySelector('.select2-choice').addEventListener('click', open);
    document.getElementById('s2-input').addEventListener('input', open);
  }());

  // ---- The board that reorders and relabels its own options mid-write ----
  var reorder = document.getElementById('native_reorder');
  document.getElementById('race_trigger').addEventListener('input', function () {
    if (reorder.disabled) return;
    reorder.disabled = true;
    setTimeout(function () {
      reorder.innerHTML = '';
      ['Select...', ${JSON.stringify(SPONSOR_LONG)}, ${JSON.stringify(SPONSOR_SHORT)}].forEach(function (text, index) {
        var option = document.createElement('option');
        option.textContent = text;
        option.value = index === 0 ? '' : text;
        reorder.appendChild(option);
      });
      reorder.disabled = false;
      document.getElementById('reorder-happened').textContent = 'yes';
    }, ${REORDER_DELAY_MS});
  });
</script>`;

/* THE SAME NEAR MISS, ON A FORM WITH A SUBMIT BUTTON, so the last step can be measured rather than
 * read.
 *
 * A refused choice leaves the false row selected. The withdrawal takes it back where the control
 * offers a way; this control deliberately offers none, which is why reactBlock's clear indicator is
 * switched off here. So the question is what the PRE-SUBMIT GATE does with a required control that
 * is holding an answer nobody chose: it is not empty, and empty was the only thing that gate knew
 * how to stop on.
 *
 * Served separately from the fixture above because a form carrying a submit control changes what
 * every other replay's end-of-run readiness scan sees, and none of those cases is about submitting.
 *
 * Everything else on the form is answered before the run starts, so the only thing that can block
 * this submit is the work-authorisation control. A gate that blocked because the name field was
 * empty would prove nothing about the case.
 */
const gateFixture = `<!doctype html><meta charset="utf-8"><title>Choice Gate Fixture</title>
<form id="application" novalidate>
  <div class="field"><label for="full-name">Full name</label><input id="full-name" required value="Mehek Mandal"></div>
  <div class="field"><label for="email-field">Email</label><input id="email-field" type="email" required value="mehek@example.com"></div>
  ${reactBlock('gate-auth', 'Work authorization, required and unclearable', [AUTH_US_STUDENT], null, false)
    .replace('role="combobox"', 'role="combobox" aria-required="true"')}
  <button id="application-submit" type="submit">Submit application</button>
</form>
<div id="submitted"></div>
<script>
  Array.prototype.forEach.call(document.querySelectorAll('[data-react-select]'), function (shell) {
    var config = JSON.parse(shell.querySelector('.select__rows').textContent);
    var input = shell.querySelector('input[role="combobox"]');
    var control = shell.querySelector('.select__control');
    var values = shell.querySelector('.select__value-container');
    var answer = document.getElementById(shell.getAttribute('data-block') + '-answer');
    var chosen = '';
    function renderChosen() {
      var existing = shell.querySelector('.select__single-value');
      if (existing) existing.remove();
      var placeholder = shell.querySelector('.select__placeholder');
      if (!chosen) { if (placeholder) placeholder.style.display = ''; answer.textContent = ''; return; }
      if (placeholder) placeholder.style.display = 'none';
      var node = document.createElement('div');
      node.className = 'select__single-value';
      node.textContent = chosen;
      values.prepend(node);
      answer.textContent = chosen;
    }
    function closeMenu() {
      var menu = shell.querySelector('.select__menu');
      if (menu) menu.remove();
      input.setAttribute('aria-expanded', 'false');
    }
    function openMenu() {
      closeMenu();
      input.setAttribute('aria-expanded', 'true');
      var menu = document.createElement('div');
      menu.className = 'select__menu';
      menu.setAttribute('role', 'listbox');
      config.options.forEach(function (row, index) {
        var option = document.createElement('div');
        option.className = 'select__option';
        option.setAttribute('role', 'option');
        option.id = shell.getAttribute('data-block') + '-option-' + index;
        option.textContent = row;
        option.addEventListener('mousedown', function (event) {
          event.preventDefault();
          chosen = row;
          input.value = '';
          renderChosen();
          closeMenu();
        });
        menu.appendChild(option);
      });
      shell.appendChild(menu);
    }
    control.addEventListener('mousedown', function () {
      if (input.getAttribute('aria-expanded') === 'true') closeMenu(); else openMenu();
    });
    input.addEventListener('input', function () { openMenu(); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') closeMenu(); });
  });
  document.getElementById('application').addEventListener('submit', function (event) {
    event.preventDefault();
    document.getElementById('submitted').textContent = 'yes';
  });
</script>`;

const server = http.createServer((request, response) => {
  // 'close' matters: a keep-alive socket stops Chromium ever reporting networkidle.
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
  response.end(request.url && request.url.startsWith('/gate') ? gateFixture : fixture);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-choice-'));
fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);

/* allowSubmit is off for every case but the gate one, and that is not a detail. With it off the
 * runner installs a hard document-level guard that swallows every submit event, so #submitted stays
 * empty no matter what the gate decides and a case asserting it would pass on a runner that presses
 * the button with a false declaration on the form. The gate case turns the guard OFF so the form's
 * own handler is the thing that answers, which is the only way to measure whether the click was
 * withheld or merely absorbed. */
async function replay(actions, { url = base, allowSubmit = false } = {}) {
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url,
    actions,
    allowSubmit,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 2400 }
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

const valueOf = (result, selector) => result.extracted.find((entry) => entry.selector === selector)?.value;

// The three renderings of one case, asked the same question with the same stored answer, and read
// back from the same kind of node. Anything that differs between them is the defect.
const RENDERINGS = ['radio', 'pill', 'react'];
const ask = (id, question, value) => RENDERINGS.map((rendering) => ({
  type: 'fillByLabelText',
  text: `${question}, ${rendering === 'react' ? 'react select' : rendering === 'pill' ? 'pills' : 'radio'}`,
  value,
  label: `question:${id}:${rendering}`,
  optional: true
}));
const readBack = (id) => RENDERINGS.map((rendering) => ({ type: 'extract', selector: `#${rendering}-${id}-answer` }));
const answers = (result, id) => RENDERINGS.map((rendering) => valueOf(result, `#${rendering}-${id}-answer`));
const labels = (id) => RENDERINGS.map((rendering) => `question:${id}:${rendering}`);

const ambiguousReason = (value) => 'more than one of the options offered is a near match for "'
  + value + '" and none of them is it exactly, so choosing between them would be a guess,'
  + ' left for you to choose';
const oneNearMissReason = (value) => 'the closest option offered is a near match for "'
  + value + '" rather than exactly it, so it may be a different answer, left for you to choose';
const unmatchedReason = (value) => `no option matched "${value}", left for you to choose`;

/* ---------------------------------------------------------------------------------------------
 * 1. THE TRUTHFUL ANSWER IS LISTED SECOND, UNDER A SHORTER ROW THAT IS ITS PREFIX.
 *
 * The stored answer is the long one. Under containment the short row matches it, comes first, and
 * was taken on all three renderings. What goes to the employer is then "I do not require
 * sponsorship" from an applicant who will require it, which is the declaration this whole suite is
 * about.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    ...ask('long-second', 'Sponsorship, truthful answer listed second', SPONSOR_LONG),
    ...readBack('long-second')
  ]);
  assert.deepEqual(answers(result, 'long-second'), [SPONSOR_LONG, SPONSOR_LONG, SPONSOR_LONG],
    'a shorter row that is a prefix of the stored answer must never be sent in its place');
  assert.deepEqual(result.filledFields, labels('long-second'));
  assert.deepEqual(result.skipped, []);
}

/* ---------------------------------------------------------------------------------------------
 * 2. THE SAME LIST WITH THE TRUTHFUL ANSWER FIRST. The verdict must be the employer's rendering
 * order's business only in the sense that it is nobody's: same answer, both orders, all three
 * renderings.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    ...ask('long-first', 'Sponsorship, truthful answer listed first', SPONSOR_LONG),
    ...readBack('long-first')
  ]);
  assert.deepEqual(answers(result, 'long-first'), [SPONSOR_LONG, SPONSOR_LONG, SPONSOR_LONG],
    'the same list in the opposite order must reach the same answer');
  assert.deepEqual(result.filledFields, labels('long-first'));
  assert.deepEqual(result.skipped, []);
}

/* ---------------------------------------------------------------------------------------------
 * 3. THE STORED ANSWER IS THE SHORT ONE AND THE LONG ROW IS LISTED FIRST.
 *
 * The mirror image, and the direction that is easiest to overlook: an applicant who does NOT
 * require sponsorship had "I do not require sponsorship now, but will in the future" sent for her,
 * because that row contains her answer and sits above it.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    ...ask('short-stored', 'Sponsorship, longer row listed first', SPONSOR_SHORT),
    ...readBack('short-stored')
  ]);
  assert.deepEqual(answers(result, 'short-stored'), [SPONSOR_SHORT, SPONSOR_SHORT, SPONSOR_SHORT],
    'a longer row that contains the stored answer must never be sent in its place');
  assert.deepEqual(result.filledFields, labels('short-stored'));
  assert.deepEqual(result.skipped, []);
}

/* ---------------------------------------------------------------------------------------------
 * 4. AN EXACT ANSWER SITTING BELOW TWO LOOSER CANDIDATES. Position must not beat exactness, and the
 * whole list has to be read before anything is taken.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    ...ask('exact-below', 'Field of study, exact answer listed last', 'Computer Science'),
    ...readBack('exact-below')
  ]);
  assert.deepEqual(answers(result, 'exact-below'), ['Computer Science', 'Computer Science', 'Computer Science'],
    'an exact option must win wherever it sits in the list');
  assert.deepEqual(result.filledFields, labels('exact-below'));
  assert.deepEqual(result.skipped, []);
}

/* ---------------------------------------------------------------------------------------------
 * 5. TWO CONTAINMENT MATCHES AND NO EXACT ONE. There is no right pick, so there must be no pick.
 *
 * This is the case built during review against the React Select path specifically: a stored
 * "I am authorized to work in the United States" against rows offering "for any employer" and "only
 * with a student visa". Both contain the answer, and .first() made the employer's rendering order
 * decide a work-authorisation declaration. It is asserted here on all three renderings, because the
 * floor has to be the same wherever the question is served from.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    ...ask('ambiguous', 'Work authorization, no exact answer on the list', AUTH_US),
    ...readBack('ambiguous')
  ]);
  assert.deepEqual(answers(result, 'ambiguous'), ['', '', ''],
    'an ambiguous list must be left exactly as it was found');
  assert.deepEqual(result.filledFields, []);
  assert.deepEqual(result.skipped, labels('ambiguous').map((label) => `${label}: ${ambiguousReason(AUTH_US)}`),
    'and the applicant is told it was ambiguous rather than told her answer was missing');
}

/* ---------------------------------------------------------------------------------------------
 * 6. A WIDGET THAT SHORTENS WHAT IT HOLDS INTO A DIFFERENT DECLARATION IS A LOST ANSWER.
 *
 * verifyChoiceInContainer used to ask optionMatches - the same containment predicate that had just
 * chosen the row - whether the control was holding the right answer, so on this family it could
 * only ever agree. A control left showing "I am authorized to work" after a run that chose "only
 * with a student visa" was reported filled.
 *
 * The contrast that keeps this honest is the phone country control in managed-runner-replay, whose
 * rendering ("+971" for the row "United Arab Emirates +971") shares no words with the answer at all
 * and still verifies. A near miss fails; an abbreviation does not.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    {
      type: 'fillByLabelText',
      text: 'Work authorization (the widget shortens what it holds)',
      value: AUTH_STUDENT,
      label: 'question:shortened',
      optional: true
    },
    { type: 'extract', selector: '#react-shortens-answer' },
    { type: 'extract', selector: '#react-shortens-shown' }
  ]);
  assert.equal(valueOf(result, '#react-shortens-shown'), AUTH_SHORT,
    'the fixture must actually shorten the value, or this case proves nothing');
  assert.deepEqual(result.filledFields, [], 'a control holding a different declaration is not a filled field');
  // And the different declaration does not stay on the form. "I am authorized to work" left
  // standing for a stored "...only with a student visa" is the same false statement whether or not
  // the run also reported it, and the report is not what the employer reads.
  assert.equal(valueOf(result, '#react-shortens-answer'), '',
    'a control the verifier refused is put back the way the run found it');
  assert.deepEqual(result.skipped, ['question:shortened: choice value did not persist after fillByLabelText']);
}

/* ---------------------------------------------------------------------------------------------
 * 7. "I DO NOT IDENTIFY WITH ANY OF THE ABOVE" IS NOT A REFUSAL.
 *
 * It is a substantive claim about her - none of the listed races, none of the listed veteran
 * classifications - and an employer records and reports it as an answer. The refusal matcher used
 * to accept it, because it made the volition verb optional, so a stored "Decline to self-identify"
 * selected it whenever no true opt-out sat beside it. Native select, radio and React Select, since
 * the EEO block is served as all three.
 * ------------------------------------------------------------------------------------------- */
{
  const stored = 'Decline to self-identify';
  const result = await replay([
    ...ask('not-above', 'Veteran status, no opt-out on the list', stored),
    { type: 'fill', selector: '#native_not_above', value: stored, label: 'question:not-above:native', optional: true },
    ...readBack('not-above'),
    { type: 'extract', selector: '#native_not_above option:checked' }
  ]);
  assert.deepEqual(answers(result, 'not-above'), ['', '', ''],
    'a stored refusal must never be able to state something about her');
  assert.equal(valueOf(result, '#native_not_above option:checked'), 'Select...');
  assert.deepEqual(result.filledFields, []);
  assert.deepEqual(
    result.skipped,
    [...labels('not-above'), 'question:not-above:native'].map((label) => `${label}: ${unmatchedReason(stored)}`)
  );
}

/* And the opt-out path itself is untouched: a list that offers a real refusal, worded the
 * employer's own way rather than hers, is still answered. This is the half the intent matcher exists
 * for, and a fix that broke it would be a different defect wearing the same clothes. */
{
  const stored = 'Decline to self-identify';
  const result = await replay([
    ...ask('opt-out', 'Veteran status, an opt-out on the list', stored),
    { type: 'fill', selector: '#native_opt_out', value: stored, label: 'question:opt-out:native', optional: true },
    ...readBack('opt-out'),
    { type: 'extract', selector: '#native_opt_out option:checked' }
  ]);
  assert.deepEqual(answers(result, 'opt-out'), [REAL_OPT_OUT, REAL_OPT_OUT, REAL_OPT_OUT],
    'an opt-out worded the employer\'s own way is still reached');
  assert.equal(valueOf(result, '#native_opt_out option:checked'), REAL_OPT_OUT);
  assert.deepEqual(result.filledFields, [...labels('opt-out'), 'question:opt-out:native']);
  assert.deepEqual(result.skipped, []);
}

/* ---------------------------------------------------------------------------------------------
 * 8. THE LITERAL ANSWER IS TAKEN BEFORE ANYTHING IS NORMALISED, AND A REAL COLLISION IS REFUSED.
 *
 * normalized() keeps only [a-z0-9], so "10+" and "10" are one string by the time a normalised tier
 * sees them, as are "C++", "C#" and "C". Comparing normalised first did two opposite kinds of
 * damage: the answer "10" took "10+" because it was listed first and verifyFilled agreed across the
 * same collision, and then refusing every collision threw away literal answers that were sitting
 * right there, so a stored "C++" on a list offering C++ and C# was handed back.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    { type: 'fill', selector: '#native_collision', value: '10', label: 'question:collision', optional: true },
    { type: 'fill', selector: '#native_true_collision', value: '10', label: 'question:true-collision', optional: true },
    { type: 'fill', selector: '#native_language', value: 'C++', label: 'question:language', optional: true },
    { type: 'fill', selector: '#native_case', value: 'Yes', label: 'question:case', optional: true },
    ...ask('punctuation-only', 'Which language do you know best', 'C++'),
    { type: 'extract', selector: '#native_collision option:checked' },
    { type: 'extract', selector: '#native_true_collision option:checked' },
    { type: 'extract', selector: '#native_language option:checked' },
    { type: 'extract', selector: '#native_case option:checked' },
    ...readBack('punctuation-only')
  ]);
  assert.equal(valueOf(result, '#native_collision option:checked'), '10',
    'the row that literally says the answer is the answer, whatever it normalises to');
  assert.equal(valueOf(result, '#native_true_collision option:checked'), 'Select...',
    'with no literal row, "10+" and "10." are one string and neither can be chosen');
  assert.equal(valueOf(result, '#native_language option:checked'), 'C++',
    'C++ is not C# and is not C, and normalising is what loses that');
  assert.equal(valueOf(result, '#native_case option:checked'), 'Yes',
    'two rows that are the same answer written twice are not a collision');
  assert.deepEqual(answers(result, 'punctuation-only'), ['C++', 'C++', 'C++'],
    'and the same on every custom rendering, including the menu named by Playwright');
  assert.deepEqual(result.filledFields, [
    'question:collision', 'question:language', 'question:case', ...labels('punctuation-only')
  ]);
  assert.deepEqual(result.skipped, [`question:true-collision: ${unmatchedReason('10')}`]);
}

/* ---------------------------------------------------------------------------------------------
 * 9. AN OPTION NAMED BY ITS LABEL ATTRIBUTE IS CHOSEN AS THAT NAME AND READ BACK AS THAT NAME.
 *
 * The snapshot names an option 'option.label || option.textContent'. verifyFilled read only
 * textContent and value, so <option label="X">Y</option> was selected correctly and then reported
 * not filled: a verification that reads a different attribute from the one the chooser read.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    { type: 'fill', selector: '#native_label_attr', value: 'Prefer not to say', label: 'question:label-attr', optional: true },
    { type: 'extract', selector: '#native_label_attr option:checked' }
  ]);
  assert.equal(valueOf(result, '#native_label_attr option:checked'), 'row-two-text',
    'the option carrying that label is the one selected');
  assert.deepEqual(result.filledFields, ['question:label-attr'], 'and it is reported filled');
  assert.deepEqual(result.skipped, []);
}

/* ---------------------------------------------------------------------------------------------
 * 10. THE RE-RENDER RACE.
 *
 * The option snapshot and the write are separated by an await. Writing by INDEX takes whatever now
 * sits at that position, and a board that reorders and relabels in that window hands over its
 * neighbour: measured on this fixture, an index write landed on "I do not require sponsorship" for
 * a stored "I do not require sponsorship now, but will in the future". verifyFilled catches it and
 * the field fails closed, so nothing false is submitted, but a fill that could have been right
 * should be right. Writing by the LABEL the chooser matched on makes Playwright re-resolve the name
 * against the live DOM.
 *
 * Deliberately distinct from the snapback case in managed-runner-replay, which is a different
 * mechanism: there the page rewrites the CHOICE after a correct write, here the page rewrites the
 * LIST before the write resolves.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    { type: 'fill', selector: '#race_trigger', value: 'Mehek', label: 'question:preferred name', optional: true },
    { type: 'fill', selector: '#native_reorder', value: SPONSOR_LONG, label: 'question:reordering board', optional: true },
    { type: 'extract', selector: '#reorder-happened' },
    { type: 'extract', selector: '#native_reorder option:checked' }
  ]);
  assert.equal(valueOf(result, '#reorder-happened'), 'yes',
    'the fixture must actually reorder inside the write window, or this case proves nothing');
  assert.equal(valueOf(result, '#native_reorder option:checked'), SPONSOR_LONG,
    'a write addressed by label survives a list that moved under it');
  assert.deepEqual(result.filledFields, ['question:preferred name', 'question:reordering board']);
  assert.deepEqual(result.skipped, []);
}

/* ---------------------------------------------------------------------------------------------
 * 11. EXACTLY ONE NEAR MATCH IS THE DANGEROUS NUMBER, NOT TWO.
 *
 * The stored answer is the long truthful one and the list holds its false prefix and nothing else
 * that resembles it. A containment tier takes that prefix without hesitating: one candidate, no
 * ambiguity to guard against, straight into filledFields. Neither the radio path nor the pill path
 * has any verification stage behind it, so nothing downstream ever looks at it again.
 *
 * The React Select column reaches the same verdict by a different route in each of the two cases
 * below, and both are asserted as they are rather than as anyone would like them. Here the rows are
 * SHORTER than the answer, so no widened tier matches at all and the menu is simply refused. In the
 * case after this one the row is LONGER and contains the answer, so the widened tier does match: it
 * clicks, and the verifier then refuses the near miss. That widening stays because it is the only
 * way to reach "United Arab Emirates +971" for a stored "United Arab Emirates", and it is
 * indistinguishable by text from this.
 *
 * BOTH CASES ASSERT THE PAGE, and the second one used to slice its React column off before
 * comparing, with a note saying filledFields being empty was the guarantee. It is not. An empty
 * filledFields describes the REPORT; the employer reads the FORM, and the form was left holding the
 * row the verifier had just refused. What makes the guarantee real is that the refusal is now
 * withdrawn from the control as well as from the report.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    ...ask('one-near-miss', 'Sponsorship, only a near match on the list', SPONSOR_LONG),
    ...readBack('one-near-miss')
  ]);
  assert.deepEqual(
    answers(result, 'one-near-miss'), ['', '', ''],
    'no rendering may tick the false prefix of the stored answer'
  );
  assert.deepEqual(result.filledFields, [], 'and none of the three may report this field as answered');
  assert.deepEqual(result.skipped, [
    `question:one-near-miss:radio: ${oneNearMissReason(SPONSOR_LONG)}`,
    `question:one-near-miss:pill: ${oneNearMissReason(SPONSOR_LONG)}`,
    `question:one-near-miss:react: ${unmatchedReason(SPONSOR_LONG)}`
  ]);
}

/* The same shape on work authorisation, and the near match is 61 characters long. Under the pill
 * picker's old 40 character ceiling that row was invisible, so the pill refused for the wrong
 * reason; admitting it without removing the containment tier turned that accidental refusal into a
 * false work-authorisation declaration reported as filled. Both halves have to hold at once. */
{
  const result = await replay([
    ...ask('long-near-miss', 'Work authorization, only a near match on the list', AUTH_US),
    ...readBack('long-near-miss'),
    { type: 'extract', selector: '#react-long-near-miss-shown' }
  ]);
  assert.equal(valueOf(result, '#react-long-near-miss-shown'), AUTH_US_ANY,
    'the React column must really have clicked the near miss, or the empty control below proves nothing');
  assert.deepEqual(answers(result, 'long-near-miss'), ['', '', ''],
    'and a row the verifier refused must not still be selected when the run walks away');
  assert.deepEqual(result.filledFields, []);
  assert.deepEqual(result.skipped, [
    `question:long-near-miss:radio: ${oneNearMissReason(AUTH_US)}`,
    `question:long-near-miss:pill: ${oneNearMissReason(AUTH_US)}`,
    'question:long-near-miss:react: choice value did not persist after fillByLabelText'
  ]);
}

/* ---------------------------------------------------------------------------------------------
 * 12. ONE CHARACTER OF EMPLOYER PUNCTUATION MUST NOT FLIP THE ANSWER.
 *
 * The stored answer carries a comma and the employer's row does not. Native, radio and pill compare
 * with punctuation normalised away and reach it. The React Select exact tier was a LITERAL regex, so
 * it missed, and the miss was not a refusal: it fell through to the widened tiers, whose query still
 * carried the comma, and then to the shorter-name rule, which clicked "I do not require
 * sponsorship". The highest-volume Greenhouse rendering was the one that got it wrong.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    ...ask('punctuation', 'Sponsorship, employer drops the comma', SPONSOR_LONG),
    { type: 'fill', selector: '#native_punctuation', value: SPONSOR_LONG, label: 'question:punctuation:native', optional: true },
    ...readBack('punctuation'),
    { type: 'extract', selector: '#native_punctuation option:checked' }
  ]);
  assert.deepEqual(
    answers(result, 'punctuation'),
    [SPONSOR_LONG_NO_COMMA, SPONSOR_LONG_NO_COMMA, SPONSOR_LONG_NO_COMMA],
    'the employer spelled the same answer, and all four renderings must read it that way'
  );
  assert.equal(valueOf(result, '#native_punctuation option:checked'), SPONSOR_LONG_NO_COMMA);
  assert.deepEqual(result.filledFields, [...labels('punctuation'), 'question:punctuation:native']);
  assert.deepEqual(result.skipped, []);
}

/* ---------------------------------------------------------------------------------------------
 * 13. A PREFIX OF HER ANSWER IS NOT HER ANSWER, AND ITS GUARD COULD NEVER HAVE FIRED.
 *
 * The menu offers "No, I do not require sponsorship" and nothing else that resembles the stored
 * answer, which says she will require it in the future. A rule that clicked a row named by a
 * contiguous run of the answer's own words took that prefix, and optionMatches then verified it, so
 * the field was reported filled. Exactly one run matched, so counting rows was never going to stop
 * it. This is the same false declaration as the near-miss cases above arriving by a different route,
 * which is why it gets its own case rather than being folded into one of them.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    ...ask('prefix-only', 'Sponsorship, only a prefix of the answer on the list', SPONSOR_NO_LONG),
    ...readBack('prefix-only')
  ]);
  assert.deepEqual(answers(result, 'prefix-only'), ['', '', ''],
    'the prefix says the opposite of the answer and must not be clicked on any rendering');
  assert.deepEqual(result.filledFields, []);
  assert.deepEqual(result.skipped, [
    `question:prefix-only:radio: ${oneNearMissReason(SPONSOR_NO_LONG)}`,
    `question:prefix-only:pill: ${oneNearMissReason(SPONSOR_NO_LONG)}`,
    `question:prefix-only:react: ${unmatchedReason(SPONSOR_NO_LONG)}`
  ]);
}

/* ---------------------------------------------------------------------------------------------
 * 14. A NEGATION IS NOT THE ANSWER IT NEGATES, ON THE SCRIPTS WHERE IT CONTAINS IT.
 *
 * normalized() keeps only [a-z0-9], so it erases Chinese, Japanese and Korean entirely, and every
 * guard in the chooser and the verifier alike was off at once on this shape:
 *   - optionMatches returns false on its first line for anything that normalises to nothing, so the
 *     near-miss refusal that stops this in English never fired;
 *   - the punctuation-tolerant exact tier produces no pattern for a non-Latin answer by design;
 *   - the widened tier is a SUBSTRING query, and here the false row is a strict superstring of the
 *     true answer, so it matched, and it matched exactly once;
 *   - and the clicked-row rule then accepted it, because the row and the rendered value are the
 *     same string.
 * Measured before this change: the React Select clicked the negation on all four languages and
 * reported it filled. It declared "I do not need visa sponsorship" for an applicant who stored the
 * opposite. Radio, pill and native were safe only incidentally, because removing their containment
 * tier removed the path that reaches it.
 * ------------------------------------------------------------------------------------------- */
for (const entry of NEGATED) {
  const result = await replay([
    ...ask(entry.id, entry.question, entry.stored),
    ...readBack(entry.id)
  ]);
  assert.deepEqual(answers(result, entry.id), ['', '', ''],
    `${entry.row} is the negation of ${entry.stored} and must not be clicked on any rendering`);
  assert.deepEqual(result.filledFields, [], `nor reported as answered: ${entry.id}`);
  assert.equal(result.skipped.length, 3, `and all three must say so: ${JSON.stringify(result.skipped)}`);
}

/* And the widening that has to survive it, on the same script: the row names the country, the widget
 * renders a dial code, and the material the row ADDS carries no letters. That is the property that
 * separates it from a negation, and it is the case 43 of 45 stored reports turn on.
 *
 * Only the custom-menu path reaches it, and the assertion says so rather than pretending otherwise.
 * Radio and pill have no widened tier at all since the containment tier came out of the ranking they
 * share with the native select, so a row that is not exactly the answer is refused there. That is
 * the cost of the fix and it is paid on a control no board renders as a radio group: Greenhouse
 * serves the phone country as a React Select. Refusing is the failure direction anyway. */
{
  const result = await replay([
    ...ask('ja-country', 'Country, Japanese', '日本'),
    ...readBack('ja-country')
  ]);
  assert.deepEqual(answers(result, 'ja-country'), ['', '', '日本 +81'],
    'a row that adds only a dial code to the answer is still the answer on the path that widens');
  assert.deepEqual(result.filledFields, ['question:ja-country:react']);
  assert.equal(result.skipped.length, 2, JSON.stringify(result.skipped));
}

/* ---------------------------------------------------------------------------------------------
 * 15. A CONTROL THAT CANNOT REPORT WHAT IT IS HOLDING IS NOT A CONTROL THAT LOST THE ANSWER.
 *
 * readChoiceState only recognises a React Select, so every other custom combobox comes back
 * 'unknown' and what it hands over is the whole block's text. Two separate things are pinned here.
 *
 * The CLICK: Select2 renders '<ul class="select2-results"><li class="select2-result"><div
 * class="select2-result-label">', and all three match the same CSS. Counting nodes would see three
 * offers for one row and refuse; taking .first() of them clicks the whole LIST, whose centre is
 * whichever row happens to sit in the middle regardless of the answer.
 *
 * The REPORT: the answer lands, and the runner cannot read it back. Telling her the value did not
 * persist sends her to redo work that is already correct, so this shape gets its own sentence.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    {
      type: 'fillByLabelText',
      text: 'What is your field of study, Select2',
      value: 'Computer Science',
      label: 'question:select2 major',
      optional: true
    },
    { type: 'extract', selector: '#select2-major-answer' }
  ]);
  assert.equal(valueOf(result, '#select2-major-answer'), 'Computer Science',
    'the right row is clicked, and the row is the li rather than the list that contains it');
  assert.deepEqual(result.filledFields, [], 'a control that cannot be read back is not reported answered');
  assert.deepEqual(result.skipped, ['question:select2 major: the answer was entered but this control'
    + ' does not report what it is holding, so Litos could not read it back: please confirm it']);
}

/* ---------------------------------------------------------------------------------------------
 * 16. A COMBOBOX THAT IS NOT AN INPUT, WHICH IS THE BRANCH THAT NEVER READ THE CONTROL BACK.
 *
 * fillByLabelText looks inside the question's block for a textarea, an input or a select, and when
 * it finds none it hands the block to fillCustomChoice. Three of the four fillCustomChoice call
 * sites in the runner then verify what landed; this one reported the field filled the moment the
 * chooser said it had clicked. Every other block in this file carries an input of some kind - the
 * pill block its mirror checkbox, the React block its .select__input, the Select2 block its
 * #s2-input - so no case here had ever entered it.
 *
 * Measured on this page before the repair, one stored answer against one menu offering only its
 * false superstring: radio, pill and checkbox all refused it as a near match, the React Select
 * clicked and its verifier took it back, and this branch clicked the same row and reported the
 * field answered. The identical menu was refused on every rendering the suite had a fixture for and
 * accepted on the one it did not.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    {
      type: 'fillByLabelText',
      text: 'Work authorization, combobox that is not an input',
      value: AUTH_US,
      label: 'question:aria-near-miss',
      optional: true
    },
    { type: 'extract', selector: '#aria-near-miss-answer' },
    { type: 'extract', selector: '#aria-near-miss-shown' }
  ]);
  assert.equal(valueOf(result, '#aria-near-miss-shown'), AUTH_US_STUDENT,
    'the widened tier must really have clicked the false row, or nothing below is being measured');
  // Asserted as one object so a regression reports the whole verdict rather than whichever half of
  // it happened to be checked first. The page is what the employer receives and the two lists are
  // what the applicant is told, and this defect got past review by having them disagree.
  assert.deepEqual({
    page: valueOf(result, '#aria-near-miss-answer'),
    filled: result.filledFields,
    skipped: result.skipped
  }, {
    page: '',
    filled: [],
    skipped: ['question:aria-near-miss: choice value did not persist after fillByLabelText']
  });
}

/* And the same control, the same branch and the same stored answer, on a menu that DOES offer it.
 * Without this the repair above is indistinguishable from a branch that refuses everything, which
 * would be its own defect: a question this runner can answer exactly and hands back instead is a
 * field the applicant fills by hand for no reason. The exact row is listed last, under two rows
 * that contain the answer, so position cannot be what finds it. */
{
  const result = await replay([
    {
      type: 'fillByLabelText',
      text: 'Work authorization, combobox that is not an input, exact row present',
      value: AUTH_US,
      label: 'question:aria-exact',
      optional: true
    },
    { type: 'extract', selector: '#aria-exact-answer' }
  ]);
  assert.equal(valueOf(result, '#aria-exact-answer'), AUTH_US,
    'the exact row is taken from below two containment relatives, and the control keeps it');
  assert.deepEqual(result.filledFields, ['question:aria-exact']);
  assert.deepEqual(result.skipped, []);
}

/* ---------------------------------------------------------------------------------------------
 * 17. ONE ANSWER MUST LAND ON THE QUESTION IT WAS ASKED ABOUT.
 *
 * Two questions, both offering a row named exactly "No": an always-rendered consent listbox, and a
 * sponsorship combobox that opens its own menu. The run is asked for the sponsorship question only.
 *
 * The exact tier was the only tier in the chooser with no ambiguity guard AND the only one still
 * allowed to search the whole page, on a comment claiming a row named exactly her answer is her
 * answer wherever it is rendered. Measured before the repair: the consent question was answered
 * "No", the sponsorship question was left empty, and the sponsorship question was reported filled.
 * A consent nobody asked for, ticked under her name, is what this file calls the worst outcome
 * available to it.
 *
 * THE SPONSORSHIP CONTROL PUBLISHES NOTHING readChoiceState can read - it is a button, not a React
 * Select - so the right row lands and the run still asks her to confirm it. That is the existing
 * verdict for an unreadable control and it is asserted as it is rather than as anyone would like
 * it. What is not negotiable is the consent row.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    {
      type: 'fillByLabelText',
      text: 'Will you now or in the future require sponsorship',
      value: 'No',
      label: 'question:sponsor-combobox',
      optional: true
    },
    { type: 'extract', selector: '#consent-answer' },
    { type: 'extract', selector: '#sponsor-combobox-answer' }
  ]);
  assert.deepEqual({
    consent: valueOf(result, '#consent-answer'),
    sponsorship: valueOf(result, '#sponsor-combobox-answer'),
    filled: result.filledFields,
    skipped: result.skipped
  }, {
    consent: '',
    sponsorship: 'No',
    filled: [],
    skipped: ['question:sponsor-combobox: the answer was entered but this control does not report'
      + ' what it is holding, so Litos could not read it back: please confirm it']
  });
}

/* ---------------------------------------------------------------------------------------------
 * 18. A CONTROL HOLDING A WRONG ANSWER IS NOT AN EMPTY ONE, AND THE GATE ONLY KNEW ABOUT EMPTY.
 *
 * This is the whole path, driven end to end: a required React Select whose menu offers only the
 * false superstring of the stored answer, on a form with a real submit control, through the atomic
 * confirm-and-submit protocol that production uses.
 *
 * The widened tier clicks the row, the verifier refuses it, and the withdrawal cannot take it back
 * because this control has no clear affordance. So the control is left holding a work-authorisation
 * declaration nobody chose. Measured before the repair: readSubmitReadiness read the rendered value,
 * called the field answered, returned zero blockers, and the run pressed Submit. The applicant's
 * only notice was one line saying the choice value did not persist.
 *
 * The submit is what makes this measurable rather than argued: #submitted is written by the form's
 * own handler and by nothing else.
 * ------------------------------------------------------------------------------------------- */
{
  const result = await replay([
    {
      type: 'fillByLabelText',
      text: 'Work authorization, required and unclearable',
      value: AUTH_US,
      label: 'question:gate-auth',
      optional: true
    },
    {
      type: 'confirmAndSubmit',
      selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]',
      chooserPolicy: ATOMIC_SUBMIT_POLICY,
      label: 'final_submit',
      optional: false,
      maxRetries: 1,
      contractVersion: 2,
      submitKind: 'application'
    },
    { type: 'extract', selector: '#submitted' },
    { type: 'extract', selector: '#gate-auth-answer' }
  ], { url: `${base}gate`, allowSubmit: true });
  assert.equal(valueOf(result, '#gate-auth-answer'), AUTH_US_STUDENT,
    'the fixture must actually leave the false row on an unclearable control, or this case proves nothing');
  assert.deepEqual({
    submitted: valueOf(result, '#submitted'),
    pressed: result.submitOutcome.pressed,
    status: result.requiredFieldConfirmation.status,
    outcome: result.requiredFieldConfirmation.passes[0].submissionOutcome,
    filled: result.filledFields
  }, {
    submitted: '',
    pressed: false,
    status: 'blocked',
    outcome: 'blocked',
    filled: []
  }, 'a form holding a work-authorisation answer nobody chose must not be submitted');
  assert.ok(
    result.blockers.some((message) => /Work authorization.*is now showing something that is not that answer/.test(message)),
    'and the run names the control rather than calling it empty, got ' + JSON.stringify(result.blockers)
  );
}

server.close();
console.log('choice parity replay: native selects, radios, pills and react selects answer alike or refuse');
