// R-100 regression: an optional action that is meant to wait must actually wait.
//
// test/managed-browser.test.js pins the SHAPE of the runner string. This runs it. SANDBOX_RUNNER
// ships to the sandbox as a string, so nothing type-checks it and nothing else in the suite ever
// executes it; the defect it covers survived several deploys precisely because every existing test
// could only read it.
//
// The replay is faithful to executeSandboxRun(): same runner string, same stratus-input.json /
// stratus-result.json file protocol, same `node stratus-runner.cjs` invocation. Only the sandbox
// and its preinstalled Playwright are replaced, by test/managed-runner-shim.cjs.
//
// The page is a local fixture, never an employer's. It reproduces the mechanism that matters:
// clicking a button renders a panel a beat later, which is what Greenhouse does when you click
// "Apply for this job". The old pre-check tested for that panel at the one instant it could not be
// there, so the run typed into a form that did not exist yet, and an optional waitForSelector
// aimed at the same panel was cancelled before its timeout ever started.
//
// Two delays on purpose, and they now show the same thing from both sides: a control that renders
// late is reached only when the caller DECLARES a wait for it. waitForSelector keeps its own
// timeout and is exempt from the pre-check; everything else keeps the instantaneous snapshot it
// always had. An earlier version of the fix also gave every optional action a 1500ms settle grace,
// which measured identically on two live Greenhouse forms while costing about 4.3s a run, so the
// grace is gone and case 2 pins what that gives up.

import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ATOMIC_SUBMIT_POLICY, SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
// Late enough that the pre-check's snapshot cannot see it, which is the point: without a declared
// wait this control is skipped. Sized on the live measurement that motivated the dropped grace:
// Greenhouse's asynchronously loaded School and Discipline options arrived 563ms and 555ms late.
const QUICK_PANEL_MS = 700;
// Slower again, so only an honoured waitForSelector can reach it.
const SLOW_PANEL_MS = 2500;

// How late the discipline menu renders. Past the old flat 150ms, inside the new bounded wait, and
// sized on the live measurement: Greenhouse's asynchronously loaded menus arrived 555-563ms after
// the control was touched.
const MENU_RENDER_MS = 600;

const fixture = `<!doctype html><meta charset="utf-8"><title>Replay Fixture</title>
<button id="apply">Apply for this job</button>
<button id="apply-slow">Apply for this job (slow board)</button>
<div id="quick-panel"></div>
<div id="slow-panel"></div>
<div id="email-echo"></div>
<div id="slow-email-echo"></div>
<label for="start_month">Start month</label>
<select id="start_month"><option value=""></option><option value="5">May</option></select>
<label for="native_value">Major code</label>
<select id="native_value"><option value=""></option><option value="cs">Computer Science</option></select>
<!-- Lever custom-card selects copied from the live Palantir internship form on 2026-08-11.
     Discovery correctly returns the durable name selectors below. The fill pass sends ordinary
     fill actions to those selectors, so the runner must dispatch from the native control shape. -->
<div class="section page-centered application-form" data-qa="additional-cards">
  <h4 data-qa="card-name">University</h4>
  <ul><li class="application-question custom-question"><div>
    <div class="application-label full-width dropdown"><div class="text">Which university are you currently attending or did you last attend?</div></div>
    <div class="application-field full-width required-field"><div class="application-dropdown">
      <select name="cards[3da58b41-acf5-40a1-945e-c7f047ef8050][field0]" required>
        <option value="">Click Here</option>
        <option value="University of Southern California">University of Southern California</option>
        <option value="Other (School Not Listed)">Other (School Not Listed)</option>
      </select>
    </div></div>
  </div></li></ul>
</div>
<div class="section page-centered application-form" data-qa="additional-cards">
  <h4 data-qa="card-name">Year of Graduation</h4>
  <ul><li class="application-question custom-question"><div>
    <div class="application-label full-width dropdown"><div class="text">Please include your intended graduation year.</div></div>
    <div class="application-field full-width required-field"><div class="application-dropdown">
      <select name="cards[026d7ce7-7ca4-44ed-9db6-1c7857707f0e][field0]" required>
        <option value="">Select...</option>
        <option value="2027">2027</option>
        <option value="2028">2028</option>
        <option value="2029">2029</option>
      </select>
    </div></div>
  </div></li></ul>
</div>
<div class="section page-centered application-form" data-qa="additional-cards">
  <h4 data-qa="card-name">University Major</h4>
  <ul><li class="application-question custom-question"><div>
    <div class="application-label full-width dropdown"><div class="text">What is your major?</div></div>
    <div class="application-field full-width required-field"><div class="application-dropdown">
      <select name="cards[c2bf8591-ecbb-4de6-bf0b-e8ea17f8afa2][field0]" required>
        <option value="">Select...</option>
        <option value="Computer Science">Computer Science</option>
        <option value="Computer Engineering">Computer Engineering</option>
        <option value="Other">Other</option>
      </select>
    </div></div>
  </div></li></ul>
</div>
<!-- SPONSORSHIP AND WORK AUTHORISATION, in the shape Lever and Greenhouse actually serve them: a
     short answer that is a PREFIX of the true longer one, sitting on the same list. Every option
     text below is the ordinary vocabulary of these two questions. A matcher that accepts containment
     answers each of these questions with whichever line the employer listed first, which is a false
     statement about visa status made under the applicant's name.
     Both orders are on the page, because the answer must not depend on the order. -->
<label for="sponsorship_prefix_first">Will you now or in the future require sponsorship?</label>
<select id="sponsorship_prefix_first">
  <option value="">Select...</option>
  <option>I do not require sponsorship</option>
  <option>I do not require sponsorship now, but will in the future</option>
  <option>I require sponsorship now</option>
</select>
<label for="work_auth_prefix_first">Are you legally authorized to work in the United States?</label>
<select id="work_auth_prefix_first">
  <option value="">Select...</option>
  <option>I am authorized to work</option>
  <option>I am authorized to work only with a student visa</option>
  <option>I am not authorized to work</option>
</select>
<label for="sponsorship_prefix_last">Sponsorship, longer answer listed first</label>
<select id="sponsorship_prefix_last">
  <option value="">Select...</option>
  <option>I do not require sponsorship now, but will in the future</option>
  <option>I do not require sponsorship</option>
</select>
<!-- An exact answer that sits BELOW a looser candidate. DOM order must not reach it first. -->
<label for="exact_below">What is your field of study?</label>
<select id="exact_below">
  <option value="">Select...</option>
  <option>Computer Science and Engineering</option>
  <option>Computer Science, Business Administration</option>
  <option>Computer Science</option>
</select>
<!-- Two options that are both containment relatives of the answer and neither of them the answer.
     There is no right pick here, so there must be no pick. -->
<label for="ambiguous_auth">Work authorization, no exact answer on the list</label>
<select id="ambiguous_auth">
  <option value="">Select...</option>
  <option>I am authorized to work in the United States for any employer</option>
  <option>I am authorized to work in the United States only with a student visa</option>
</select>
<!-- The page rewrites the choice after the write, which is what a form that normalises its own
     input does. verifyFilled is the only thing standing between that and a field reported answered
     while the control holds a different declaration. -->
<label for="snapback_auth">Work authorization (the page normalises the choice)</label>
<select id="snapback_auth">
  <option value="">Select...</option>
  <option>I am authorized to work</option>
  <option>I am authorized to work only with a student visa</option>
</select>
<label for="plain">End year</label><input id="plain" type="text">
<div id="plain-echo"></div>
<input id="aimed" type="text">
<label for="combo">Overall GPA</label><div id="combo-shell"><input id="combo" role="combobox" aria-expanded="false"></div>
<div id="keytarget"></div>
<!-- The overlay half of the live Deepgram Ashby graduation field, kept as its own block so the
     dismissal can be measured against a next question. Named differently from the field-entry block
     below only so getByText has one answer. Focusing it opens
     a calendar that does NOT close when the value is committed, and it is absolutely positioned over
     the question below - over that question's control AND its label. #covers publishes what
     document.elementFromPoint says about the next control, because the runner cannot run
     elementFromPoint itself and a verdict has to come from the run that happened. The calendar
     closes on Escape and on nothing else here, which is what makes the dismissal's aim visible. -->
<div id="date-block" style="position: relative">
  <label for="grad_year">Anticipated Completion Date</label>
  <input id="grad_year" type="text" autocomplete="off">
  <div id="calendar" style="display: none; position: absolute; left: 0; top: 100%; z-index: 30; width: 320px; height: 200px; background: #fff; border: 1px solid #ccc">May 2028</div>
</div>
<label for="how_heard">How did you hear about this role?</label>
<input id="how_heard" type="text">
<div id="covers"></div>
<div id="calendar-dismissed"></div>
<!-- 'Expected Graduation Year' EXACTLY as the live Deepgram Ashby form serves it, copied out of the
     page on 2026-08-09. Two things about this markup are the whole point and neither is the date:
       - the input carries NO id and NO name, which is why the fill action the backend built for it
         is aimed at the field-entry DIV. locator.fill() throws on a div.
       - react-datepicker parses on a Tab keydown and on nothing else. fill() plus dispatched input
         and change events - what every other fill on the page does - leaves it holding raw text and
         holding no date, which is how a filled-looking field reported "required and is still
         empty". Measured: fill('2028-05-01') then blur() reads back 2028-05-01 uncommitted; the
         same write then Tab reads back 05/01/2028.
     The parse below is the measured behaviour and not a convenience: an unparseable string is left
     alone, a bare year becomes the FIRST OF JANUARY of that year, and everything else normalises to
     MM/DD/YYYY. The January is the reason a bare year is refused rather than typed. -->
<div class="_fieldEntry_1e3gg_28 ashby-application-form-field-entry" data-field-path="407cc864-6d10-4427-bc5e-71598c5e593f">
  <label class="_heading_f7cvd_52" for="407cc864-6d10-4427-bc5e-71598c5e593f">Expected Graduation Year</label>
  <div class="react-datepicker-wrapper"><div class="react-datepicker__input-container">
    <input type="text" placeholder="Pick date..." class="_input_gc9ve_28" required value=""></div></div>
</div>
<!-- The same widget with two controls in the block, so a wrapper that speaks for two questions is
     refused rather than guessed at. -->
<div data-field-path="two-controls">
  <label>Enrolment window</label>
  <div class="react-datepicker-wrapper"><div class="react-datepicker__input-container">
    <input type="text" placeholder="Pick date..." class="from"></div></div>
  <div class="react-datepicker-wrapper"><div class="react-datepicker__input-container">
    <input type="text" placeholder="Pick date..." class="to"></div></div>
</div>
<!-- 'extract' reads text, and an input has none, so what each picker is holding is echoed here the
     same way the phone fields echo theirs. -->
<!-- The native month control, which demands a month and a year and no day. A day on file loses its
     day here, which the control asked it to; a bare year is refused here too, because a month
     control demands a month and a year does not name one. -->
<label for="grad_month">Expected graduation</label>
<input id="grad_month" type="month">
<div id="grad-echo"></div>
<div id="from-echo"></div>
<div id="to-echo"></div>
<!-- THE CONTRAST CASE for the phone rule, and the reason it is wrapped in its own block: a phone
     field with NO country control anywhere in its group must keep its full international number.
     Loose in the body it would find the country React Select in the application form below, which
     is exactly the over-reach the ancestor walk is bounded to prevent. -->
<div id="lone-phone-block">
  <label for="lone_phone">Mobile number</label>
  <input id="lone_phone" type="tel">
</div>
<!-- fill() sets the value PROPERTY, which no attribute read can see; the page's own input listener
     echoes each one into the node named after it, and 'extract' reads that back. -->
<div id="req_phone-echo"></div>
<div id="lone_phone-echo"></div>
<!-- A job description, copied in shape from the live DRW and Virtu Greenhouse postings. The bullet
     contains the answer text and is a plain <li> loose in the page. Sweeping the document for
     'li' containing the answer clicked exactly this and called the Discipline field answered. -->
<ul id="jd">
  <li>Are pursuing a bachelor's, master's or PhD in mathematics, economics, physics, statistics, computer science or any engineering discipline</li>
</ul>
<!-- A React Select, reproduced down to the parts that bite: the answer lives in a
     .select__single-value node and not on the input; the menu renders LATE; and the container holds
     a "Clear selections" <button> alongside the combobox. -->
<div class="select__container" id="discipline-shell">
  <div class="select__control">
    <div class="select__value-container">
      <div class="select__placeholder" id="discipline-placeholder">Select...</div>
      <div class="select__input-container"><input id="discipline" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off"></div>
    </div>
    <button type="button" class="select__clear-indicator" aria-label="Clear selections">x</button>
    <button type="button" class="select__dropdown-indicator" aria-label="Toggle flyout">v</button>
  </div>
</div>
<!-- GREENHOUSE'S PHONE COUNTRY CONTROL, copied node for node off the live rendered DOM.
     Captured 2026-08-09 from job-boards.greenhouse.io/embed/job_app?for=redwoodmaterials&token=6126784004,
     one of the 24 forms behind this user's stored "choice value did not persist after fill" reports.

     The one property that matters, and the reason a hand-written select would prove nothing: the
     MENU ROW reads "United Arab Emirates +971" and the CHOSEN value renders as a flag element plus
     the bare dial code. The live markup, verbatim:

       <div class="select__single-value"><div class="iti__flag iti__ae"></div><span>+971</span></div>

     So the answer lands, readChoiceState reads the right node, and the text it finds has nothing in
     common with the country name that was asked for. The distractor rows exist so a verification
     that merely notices "something is selected" cannot pass this case. -->
<div class="select__container" id="country-shell">
  <!-- The live label carries a required asterisk. This one deliberately does not: the pre-submit
       gate case below asserts an exact blocker list, and a required control loose in the page (this
       one is outside #app-form on purpose, so it cannot disturb the phone rule either) would add a
       fourth blocker to it. The asterisk has nothing to do with how the chosen value renders, which
       is the only property this fixture exists to reproduce. -->
  <label id="country-label" for="country" class="label select__label">Country</label>
  <div class="select-shell">
    <div><div class="select__control">
      <div class="select__value-container">
        <div class="select__placeholder" id="country-placeholder"></div>
        <div class="select__input-container"><input id="country" class="select__input" role="combobox" aria-haspopup="true" aria-autocomplete="list" aria-expanded="false" autocomplete="off"></div>
      </div>
      <div class="select__indicators"><button type="button" class="icon-button" aria-label="Toggle flyout" tabindex="-1">v</button></div>
    </div></div>
  </div>
</div>
<div id="country-shown"></div>
<!-- ─── THE SAME TWO QUESTIONS, ON THE THREE CONTROLS THAT ARE NOT A NATIVE SELECT ───────────────
     Sponsorship and work authorisation are asked on every board in this corpus, and only Lever asks
     them with a <select>. Greenhouse serves them as a React Select or as a radio group; Ashby serves
     them as a pair of buttons beside a display:none checkbox that holds the value. All three of
     those paths read their option list with a bidirectional containment test and took the FIRST hit,
     so on the ordinary list - a short answer sitting above the longer one it is a prefix of - the
     declaration that reached the employer was chosen by the board's own ordering.
     The rows below are the ordinary vocabulary of these questions, and the option text is deliberately
     not identical across the three controls: the point is the shape, not the wording. -->
<div class="select__container" id="sponsor-choice-shell">
  <label for="sponsor-choice">Will you now or in the future require visa sponsorship?</label>
  <div class="select__control">
    <div class="select__value-container">
      <div class="select__placeholder">Select...</div>
      <div class="select__input-container"><input id="sponsor-choice" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off"></div>
    </div>
  </div>
</div>
<div id="sponsor-choice-chosen"></div>
<div class="select__container" id="auth-choice-shell">
  <label for="auth-choice">Work authorization, no exact answer on the menu</label>
  <div class="select__control">
    <div class="select__value-container">
      <div class="select__placeholder">Select...</div>
      <div class="select__input-container"><input id="auth-choice" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off"></div>
    </div>
  </div>
</div>
<div id="auth-choice-chosen"></div>
<div class="select__container" id="study-choice-shell">
  <label for="study-choice">Primary field of study</label>
  <div class="select__control">
    <div class="select__value-container">
      <div class="select__placeholder">Select...</div>
      <div class="select__input-container"><input id="study-choice" role="combobox" aria-autocomplete="list" aria-expanded="false" autocomplete="off"></div>
    </div>
  </div>
</div>
<div id="study-choice-chosen"></div>
<fieldset id="sponsor-radio-block" data-field-path="sponsorship-radio-group" data-choice-echo="sponsor-radio-chosen">
  <label>Do you need visa sponsorship for employment?</label>
  <div><input type="radio" id="sponsor-radio-0" name="sponsorship_radio_group"><label for="sponsor-radio-0">I do not require sponsorship</label></div>
  <div><input type="radio" id="sponsor-radio-1" name="sponsorship_radio_group"><label for="sponsor-radio-1">I do not require sponsorship now, but will in the future</label></div>
</fieldset>
<div id="sponsor-radio-chosen"></div>
<fieldset id="auth-radio-block" data-field-path="authorization-radio-group" data-choice-echo="auth-radio-chosen">
  <label>Select the work authorization that applies to you</label>
  <div><input type="radio" id="auth-radio-0" name="authorization_radio_group"><label for="auth-radio-0">I am authorized to work in the United States for any employer</label></div>
  <div><input type="radio" id="auth-radio-1" name="authorization_radio_group"><label for="auth-radio-1">I am authorized to work in the United States only with a student visa</label></div>
</fieldset>
<div id="auth-radio-chosen"></div>
<!-- Ashby's option pills, in the shape D-01 records: two plain buttons carrying no role, no value
     and no aria-checked, beside one display:none checkbox whose label is the QUESTION rather than an
     answer. The pill text is short because Ashby's is: pickOptionPill ignores anything over forty
     characters, which is what keeps it from pressing a page's action buttons. -->
<div class="_fieldEntry_pills ashby-application-form-field-entry" data-field-path="pill-authorization">
  <label class="_heading_pills" for="pill-auth-mirror">Are you authorized to work in the United States?</label>
  <input id="pill-auth-mirror" type="checkbox" style="display:none">
  <button type="button" class="_option_pills" data-pill="pill-auth">Authorized to work</button>
  <button type="button" class="_option_pills" data-pill="pill-auth">Authorized to work with a visa</button>
</div>
<div id="pill-auth-chosen"></div>
<div class="_fieldEntry_pills ashby-application-form-field-entry" data-field-path="pill-ambiguous">
  <label class="_heading_pills" for="pill-amb-mirror">Confirm the work authorization on file</label>
  <input id="pill-amb-mirror" type="checkbox" style="display:none">
  <button type="button" class="_option_pills" data-pill="pill-amb">Authorized to work, no visa</button>
  <button type="button" class="_option_pills" data-pill="pill-amb">Authorized to work with a visa</button>
</div>
<div id="pill-amb-chosen"></div>
<!-- novalidate deliberately: with the browser's own required-field validation on, an empty required
     input stops the form submitting all by itself, and a gate that did nothing would look like a
     gate that worked. Turning it off leaves the gate as the only thing between the click and the
     submission, which is what is being tested. Greenhouse validates in JavaScript, not natively. -->
<form id="app-form" novalidate>
  <div class="field"><label for="req_name">Full name</label><input id="req_name" type="text" required></div>
  <div class="field"><label for="req_email">Email</label><input id="req_email" type="text" required></div>
  <!-- R-103, reproduced: Greenhouse puts the phone number and its country React Select in ONE
       fieldset, so the country's rendered "+971" used to make the whole block read as answered and
       an empty required number invisible to the gate. -->
  <fieldset class="phone-input">
    <label for="req_phone">Phone</label>
    <div class="select__container">
      <div class="select__single-value">+971</div>
      <input id="req_country" type="text" role="combobox" aria-required="true">
    </div>
    <input id="req_phone" type="tel" required>
  </fieldset>
  <p class="legend">* indicates a required field</p>
  <button id="submit-btn" type="submit">Submit application</button>
</form>
<form id="delayed-receipt-form" novalidate style="display:none">
  <label for="delayed-receipt-email">Email</label>
  <input id="delayed-receipt-email" type="email" required>
  <button id="delayed-receipt-submit" type="submit">Submit Application</button>
</form>
<div id="delayed-receipt-result"></div>
<div id="delayed-receipt-submit-count">submission-count:0</div>
<div id="submitted"></div>
<script>
  // fill() sets the value PROPERTY, which no attribute read can see, so the page echoes it into a
  // node the runner's own 'extract' can read back.
  document.addEventListener('input', function (event) {
    var echo = document.getElementById(event.target.id + '-echo');
    if (echo) echo.textContent = event.target.value;
  });
  // A form that rewrites its own choice on change. Real boards do this to collapse answers they
  // treat as equivalent; here it is the only way to put a control into a state the chooser did not
  // ask for, which is the one state verification exists to catch.
  document.getElementById('snapback_auth').addEventListener('change', function (event) {
    if (event.target.selectedIndex === 2) event.target.selectedIndex = 1;
  });
  // Where a keystroke actually LANDED. An unaimed page.keyboard.press() with nothing focused reports
  // BODY; a press aimed at an element reports that element's id.
  document.addEventListener('keydown', function (event) {
    document.getElementById('keytarget').textContent = event.target.id || event.target.tagName;
  });
  // The fixture form never leaves the page, so a replay can prove the gate let a click THROUGH
  // without anything being submitted anywhere.
  document.getElementById('app-form').addEventListener('submit', function (event) {
    event.preventDefault();
    document.getElementById('submitted').textContent = 'yes';
  });
  if (new URLSearchParams(location.search).get('receipt') === 'ashby') {
    document.getElementById('app-form').style.display = 'none';
    document.getElementById('delayed-receipt-form').style.display = 'block';
  }
  document.getElementById('delayed-receipt-form').addEventListener('submit', function (event) {
    event.preventDefault();
    var countNode = document.getElementById('delayed-receipt-submit-count');
    var count = Number(countNode.textContent.split(':')[1] || '0') + 1;
    countNode.textContent = 'submission-count:' + count;
    setTimeout(function () {
      document.getElementById('delayed-receipt-form').remove();
      document.getElementById('delayed-receipt-result').innerHTML = '<div class="ashby-application-form-success-container"><div role="status" aria-live="polite">Success. Thank you for submitting your application to kos.ai.</div></div>';
    }, 3600);
  });
  document.getElementById('apply').addEventListener('click', function () {
    setTimeout(function () {
      document.getElementById('quick-panel').innerHTML = '<input id="email" type="text">';
    }, ${QUICK_PANEL_MS});
  });
  document.getElementById('apply-slow').addEventListener('click', function () {
    setTimeout(function () {
      document.getElementById('slow-panel').innerHTML = '<input id="slow-email" type="text">';
    }, ${SLOW_PANEL_MS});
  });

  // ---- The calendar that commits its value and stays open over the next question ----
  var grad = document.getElementById('grad_year');
  var calendar = document.getElementById('calendar');
  function openCalendar() { calendar.style.display = 'block'; }
  grad.addEventListener('focus', openCalendar);
  grad.addEventListener('click', openCalendar);
  // Escape and nothing else. A click elsewhere does not close it, so a run that passes this case
  // passes it by having aimed a keystroke at the field.
  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') return;
    if (calendar.style.display !== 'block') return;
    calendar.style.display = 'none';
    document.getElementById('calendar-dismissed').textContent = 'yes';
  });
  // ---- react-datepicker, parsing on Tab and on nothing else ----
  //
  // A behavioural model of the measured control, not a copy of the library. Everything it does here
  // was observed on the live Deepgram form: the raw text stays exactly as typed until a Tab keydown
  // arrives, and only then is it parsed, normalised to MM/DD/YYYY, or erased.
  var MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
  function parseTyped(raw) {
    var text = String(raw || '').trim();
    if (!text) return null;
    var iso = text.match(/^((?:19|20)\\d{2})-(\\d{1,2})-(\\d{1,2})$/);
    if (iso) return { y: +iso[1], m: +iso[2], d: +iso[3] };
    var named = text.match(/^([a-z]+)\\.?\\s+(\\d{1,2})?,?\\s*((?:19|20)\\d{2})$/i);
    if (named) {
      var index = -1;
      for (var i = 0; i < MONTHS.length; i += 1) if (MONTHS[i].indexOf(named[1].toLowerCase()) === 0) index = i;
      // 'Spring 2028' is not a month, so this is where the library falls back to the year alone -
      // and a year alone becomes the first of January.
      if (index < 0) return null;
      return { y: +named[3], m: index + 1, d: named[2] ? +named[2] : 1 };
    }
    var slash = text.match(/^(\\d{1,2})\\/(\\d{1,2})\\/((?:19|20)\\d{2})$/);
    if (slash) return { y: +slash[3], m: +slash[1], d: +slash[2] };
    var year = text.match(/^((?:19|20)\\d{2})$/);
    if (year) return { y: +year[1], m: 1, d: 1 };
    return null;
  }
  function pad(value) { return value < 10 ? '0' + value : String(value); }
  var ECHOES = ['grad-echo', 'from-echo', 'to-echo'];
  Array.prototype.forEach.call(document.querySelectorAll('.react-datepicker__input-container input'), function (input, position) {
    var echo = document.getElementById(ECHOES[position]);
    function publish() { if (echo) echo.textContent = input.value; }
    input.addEventListener('input', publish);
    input.addEventListener('keydown', function (event) {
      if (event.key !== 'Tab') return;
      var point = parseTyped(input.value);
      // Unparseable text is erased, exactly as the live control erases '05/2028'.
      input.value = point ? pad(point.m) + '/' + pad(point.d) + '/' + point.y : '';
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  // Polled rather than computed once: the overlay's geometry settles a frame after the style
  // change, and the runner's next action follows a fill by a few milliseconds.
  setInterval(function () {
    var next = document.getElementById('how_heard');
    var box = next.getBoundingClientRect();
    var over = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
    document.getElementById('covers').textContent = (over && over.id === 'calendar') ? 'yes' : 'no';
  }, 50);

  // ---- React Select, faithfully enough to reproduce the two ways an answer was destroyed ----
  var TAXONOMY = ['Business Administration', 'Computer Engineering', 'Computer Science', 'Economics', 'Finance', 'Mathematics'];
  var shell = document.getElementById('discipline-shell');
  var input = document.getElementById('discipline');
  var control = shell.querySelector('.select__control');
  var chosen = '';
  var menuTimer = null;
  var suppressInput = false;
  function renderChosen() {
    var existing = shell.querySelector('.select__single-value');
    if (existing) existing.remove();
    var placeholder = document.getElementById('discipline-placeholder');
    if (chosen) {
      if (placeholder) placeholder.style.display = 'none';
      var node = document.createElement('div');
      node.className = 'select__single-value';
      node.textContent = chosen;
      shell.querySelector('.select__value-container').prepend(node);
    } else if (placeholder) {
      placeholder.style.display = '';
    }
  }
  function closeMenu() {
    if (menuTimer) { clearTimeout(menuTimer); menuTimer = null; }
    var menu = shell.querySelector('.select__menu');
    if (menu) menu.remove();
    input.setAttribute('aria-expanded', 'false');
  }
  function openMenu() {
    closeMenu();
    input.setAttribute('aria-expanded', 'true');
    // LATE, on purpose. The old code looked for options 150ms after the click and fell through to a
    // page-wide sweep every single time.
    menuTimer = setTimeout(function () {
      menuTimer = null;
      var query = input.value.trim().toLowerCase();
      var matches = TAXONOMY.filter(function (entry) { return !query || entry.toLowerCase().indexOf(query) >= 0; });
      var menu = document.createElement('div');
      menu.className = 'select__menu';
      menu.setAttribute('role', 'listbox');
      matches.forEach(function (entry, index) {
        var option = document.createElement('div');
        option.className = 'select__option';
        option.setAttribute('role', 'option');
        option.id = 'react-select-discipline-option-' + index;
        option.textContent = entry;
        option.addEventListener('mousedown', function (event) {
          event.preventDefault();
          chosen = entry;
          suppressInput = true;
          input.value = '';
          suppressInput = false;
          renderChosen();
          closeMenu();
        });
        menu.appendChild(option);
      });
      shell.appendChild(menu);
    }, ${MENU_RENDER_MS});
  }
  control.addEventListener('mousedown', function (event) {
    if (event.target.classList.contains('select__clear-indicator')) return;
    if (input.getAttribute('aria-expanded') === 'true') closeMenu(); else openMenu();
  });
  shell.querySelector('.select__clear-indicator').addEventListener('click', function () {
    // What React Select's clear indicator does, and what the old control sweep clicked.
    chosen = '';
    renderChosen();
  });
  input.addEventListener('input', function () {
    if (suppressInput) return;
    // backspaceRemovesValue: emptying the search box of a select that HOLDS a value deletes the
    // value. Playwright's fill('') arrives here.
    if (input.value === '' && chosen) { chosen = ''; renderChosen(); }
    openMenu();
  });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeMenu();
  });

  // ---- The phone Country React Select, behaving the way the live one does ----
  //
  // Same widget family as the discipline control above, and deliberately a SEPARATE fixture rather
  // than a flag on that one, because the defect is not in the selecting. It is that this control
  // renders what it is holding as a dial code while its menu row carries the country name, and only
  // a control that does both can show that.
  var COUNTRIES = [
    { row: 'United Arab Emirates +971', shown: '+971' },
    { row: 'United States +1', shown: '+1' },
    { row: 'United Kingdom +44', shown: '+44' },
    { row: 'Japan +81', shown: '+81' }
  ];
  var countryShell = document.getElementById('country-shell');
  // React Select renders its menu INSIDE its own container - the .select-shell div, not the outer
  // .select__container that also holds the label. The distinction is load-bearing rather than
  // cosmetic: the runner scopes its option clicks to the nearest select-shell/select__container
  // ancestor of the input precisely so it can never click a job-description bullet, and a fixture
  // that hung the menu one level too high would put every option out of that scope and test nothing.
  var countryMenuHost = countryShell.querySelector('.select-shell');
  var countryInput = document.getElementById('country');
  var countryControl = countryShell.querySelector('.select__control');
  var countryValues = countryShell.querySelector('.select__value-container');
  var countryChosen = null;
  var countryTimer = null;
  function renderCountry() {
    var existing = countryShell.querySelector('.select__single-value');
    if (existing) existing.remove();
    var placeholder = document.getElementById('country-placeholder');
    document.getElementById('country-shown').textContent = countryChosen ? countryChosen.shown : '';
    if (!countryChosen) { if (placeholder) placeholder.style.display = ''; return; }
    if (placeholder) placeholder.style.display = 'none';
    // The live node, reproduced exactly: a flag element carrying no text, then the dial code. The
    // country name appears nowhere inside it.
    var node = document.createElement('div');
    node.className = 'select__single-value';
    var flag = document.createElement('div');
    flag.className = 'iti__flag';
    var span = document.createElement('span');
    span.textContent = countryChosen.shown;
    node.appendChild(flag);
    node.appendChild(span);
    countryValues.prepend(node);
  }
  function closeCountryMenu() {
    if (countryTimer) { clearTimeout(countryTimer); countryTimer = null; }
    var menu = countryShell.querySelector('.select__menu');
    if (menu) menu.remove();
    countryInput.setAttribute('aria-expanded', 'false');
  }
  function openCountryMenu() {
    closeCountryMenu();
    countryInput.setAttribute('aria-expanded', 'true');
    countryTimer = setTimeout(function () {
      countryTimer = null;
      var query = countryInput.value.trim().toLowerCase();
      var menu = document.createElement('div');
      menu.className = 'select__menu';
      menu.setAttribute('role', 'listbox');
      COUNTRIES.filter(function (entry) {
        return !query || entry.row.toLowerCase().indexOf(query) >= 0;
      }).forEach(function (entry, index) {
        var option = document.createElement('div');
        option.className = 'select__option';
        option.setAttribute('role', 'option');
        option.id = 'react-select-country-option-' + index;
        option.textContent = entry.row;
        option.addEventListener('mousedown', function (event) {
          event.preventDefault();
          countryChosen = entry;
          countryInput.value = '';
          renderCountry();
          closeCountryMenu();
        });
        menu.appendChild(option);
      });
      countryMenuHost.appendChild(menu);
    }, ${MENU_RENDER_MS});
  }
  countryControl.addEventListener('mousedown', function () {
    if (countryInput.getAttribute('aria-expanded') === 'true') closeCountryMenu(); else openCountryMenu();
  });
  countryInput.addEventListener('input', function () { openCountryMenu(); });
  document.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') closeCountryMenu();
  });

  // ---- The sponsorship and work authorisation controls, one per widget family ----
  //
  // Built from one factory rather than copied three times: the widget is not what is under test, the
  // OPTION LIST is, and the three lists below differ only in the way real boards' lists differ. Same
  // late menu as the discipline control, because a menu that is already there when the control is
  // clicked would not be a React Select.
  function reactSelect(shellId, inputId, echoId, rows) {
    var host = document.getElementById(shellId);
    var box = document.getElementById(inputId);
    var control = host.querySelector('.select__control');
    var values = host.querySelector('.select__value-container');
    var placeholder = host.querySelector('.select__placeholder');
    var echo = document.getElementById(echoId);
    var picked = '';
    var timer = null;
    var suppress = false;
    function render() {
      var existing = host.querySelector('.select__single-value');
      if (existing) existing.remove();
      echo.textContent = picked;
      if (!picked) { placeholder.style.display = ''; return; }
      placeholder.style.display = 'none';
      var node = document.createElement('div');
      node.className = 'select__single-value';
      node.textContent = picked;
      values.prepend(node);
    }
    function close() {
      if (timer) { clearTimeout(timer); timer = null; }
      var menu = host.querySelector('.select__menu');
      if (menu) menu.remove();
      box.setAttribute('aria-expanded', 'false');
    }
    function open() {
      close();
      box.setAttribute('aria-expanded', 'true');
      timer = setTimeout(function () {
        timer = null;
        var query = box.value.trim().toLowerCase();
        var menu = document.createElement('div');
        menu.className = 'select__menu';
        menu.setAttribute('role', 'listbox');
        rows.filter(function (row) {
          return !query || row.toLowerCase().indexOf(query) >= 0;
        }).forEach(function (row, index) {
          var node = document.createElement('div');
          node.className = 'select__option';
          node.setAttribute('role', 'option');
          node.id = shellId + '-option-' + index;
          node.textContent = row;
          node.addEventListener('mousedown', function (event) {
            event.preventDefault();
            picked = row;
            suppress = true;
            box.value = '';
            suppress = false;
            render();
            close();
          });
          menu.appendChild(node);
        });
        host.appendChild(menu);
      }, ${MENU_RENDER_MS});
    }
    control.addEventListener('mousedown', function () {
      if (box.getAttribute('aria-expanded') === 'true') close(); else open();
    });
    box.addEventListener('input', function () {
      if (suppress) return;
      if (box.value === '' && picked) { picked = ''; render(); }
      open();
    });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); });
  }
  // A short answer listed above the longer one it is a prefix of, and the longer row spelled without
  // the comma the applicant wrote. Character-for-character the stored answer is on no row here; the
  // second row IS that answer once case and punctuation are normalised away, and the first row says
  // the opposite thing about her future.
  reactSelect('sponsor-choice-shell', 'sponsor-choice', 'sponsor-choice-chosen', [
    'I do not require sponsorship',
    'I do not require sponsorship now but will in the future'
  ]);
  // Two rows that both contain the stored answer and neither of which is it.
  reactSelect('auth-choice-shell', 'auth-choice', 'auth-choice-chosen', [
    'I am authorized to work in the United States for any employer',
    'I am authorized to work in the United States only with a student visa'
  ]);
  // The exact answer listed last, under two looser relatives of it.
  reactSelect('study-choice-shell', 'study-choice', 'study-choice-chosen', [
    'Computer Science and Engineering',
    'Computer Science, Business Administration',
    'Computer Science'
  ]);

  // Which radio a run left ticked, published for 'extract' the same way the pickers publish theirs.
  Array.prototype.forEach.call(document.querySelectorAll('[data-choice-echo]'), function (block) {
    var echo = document.getElementById(block.getAttribute('data-choice-echo'));
    block.addEventListener('change', function () {
      var ticked = block.querySelector('input:checked');
      var label = ticked && document.querySelector('label[for="' + ticked.id + '"]');
      echo.textContent = label ? label.textContent : '';
    });
  });

  // The pills. React would re-render these; what matters to the runner is the selected-state signal
  // it reads back, so the pressed pill carries aria-pressed and its siblings lose it.
  document.addEventListener('click', function (event) {
    var pill = event.target.closest && event.target.closest('[data-pill]');
    if (!pill) return;
    var group = pill.getAttribute('data-pill');
    Array.prototype.forEach.call(document.querySelectorAll('[data-pill="' + group + '"]'), function (other) {
      other.setAttribute('aria-pressed', other === pill ? 'true' : 'false');
    });
    document.getElementById(group + '-chosen').textContent = pill.textContent;
  });
</script>`;

const server = http.createServer((request, response) => {
  // 'close' matters: a keep-alive socket stops Chromium ever reporting networkidle.
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
  response.end(fixture);
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}/`;

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-replay-'));
fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);

// `options` carries whatever the run-level input needs, which today means allowSubmit. It defaults
// to absent, so every case below that does not ask for it runs under the default-deny submit guard,
// which is the shape of a real prepare run.
async function replay(actions, options = {}) {
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: base,
    actions,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    ...options
  }));
  fs.rmSync(path.join(workDir, 'stratus-result-0.json'), { force: true });
  // spawn, never spawnSync: the fixture server lives in this process, and spawnSync would block the
  // event loop so the page could never load.
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

// D-009 provider contract. A React Select remains inputType=text at the DOM layer, so the role and
// the exact capability must travel together. A non-discovery response must not advertise a
// discovery schema it did not return.
{
  const discovery = await replay([{ type: 'discover' }]);
  const combo = discovery.discovered.find((field) => field.durableSelector === '#combo');
  assert.ok(combo, 'the combobox fixture must be discovered: ' + JSON.stringify(discovery.discovered));
  assert.deepEqual(
    { inputType: combo.inputType, role: combo.role },
    { inputType: 'text', role: 'combobox' },
    'the Stratus provider wire must match the backend ManagedDiscoveredQuestion shape'
  );
  assert.deepEqual(discovery.capabilities, ['discovery-control-role-v1']);

  const ordinary = await replay([{ type: 'extract', selector: 'title' }]);
  assert.equal(Object.hasOwn(ordinary, 'capabilities'), false,
    'capability advertisement belongs only to a result that ran discovery');
}

// 1. An optional waitForSelector must wait. It is the one action whose entire job is to wait, and
//    the pre-check used to answer "not there" before its timeout ever started. This is exactly the
//    'greenhouse_application_form_ready' action the Litos backend emits after clicking Apply, and
//    exactly the deliberate render delay jobExtract uses to let a client-rendered board paint.
{
  const result = await replay([
    { type: 'click', selector: '#apply-slow', label: 'open_application_form', optional: true },
    { type: 'waitForSelector', selector: '#slow-email', label: 'application_form_ready', optional: true, timeout: 8000 },
    { type: 'fill', selector: '#slow-email', value: 'person@example.com', label: 'email', optional: true },
    { type: 'extract', selector: '#slow-email-echo' }
  ]);
  assert.equal(valueOf(result, '#slow-email-echo'), 'person@example.com',
    'an optional waitForSelector must hold the run until its element exists');
  assert.deepEqual(result.filledFields, ['email'], 'the field must be reported filled, not skipped');
}

// 2. What the narrowing gives up, stated out loud. A control that renders a beat late and that no
//    caller declared a wait for is now SKIPPED rather than waited for, and reported. Declaring the
//    wait is what fixes it, and that is the caller's job. The inline <select> is the contrast case:
//    its options are in the page from first paint, so it always worked and must keep working.
{
  const undeclared = await replay([
    { type: 'click', selector: '#apply', label: 'open_application_form', optional: true },
    { type: 'fill', selector: '#email', value: 'person@example.com', label: 'email', optional: true },
    { type: 'select', selector: '#start_month', value: '5', label: 'start_month', optional: true },
    { type: 'extract', selector: '#start_month' }
  ]);
  assert.deepEqual(undeclared.skipped, ['email: nothing matched #email'],
    'a late control with no declared wait is skipped, and says so, got ' + JSON.stringify(undeclared.skipped));
  assert.equal(valueOf(undeclared, '#start_month'), 'May', 'the inline-options contrast case must keep working');

  const declared = await replay([
    { type: 'click', selector: '#apply', label: 'open_application_form', optional: true },
    { type: 'waitForSelector', selector: '#email', label: 'form_ready', optional: true, timeout: 5000 },
    { type: 'fill', selector: '#email', value: 'person@example.com', label: 'email', optional: true },
    { type: 'extract', selector: '#email-echo' }
  ]);
  assert.equal(valueOf(declared, '#email-echo'), 'person@example.com',
    'declaring the wait is what fills a late control, and it must work');
  assert.deepEqual(declared.skipped, [], 'nothing was missing once the wait was declared');
}

// Lever discovery returns native select controls with durable name selectors. Those questions are
// built as ordinary fill actions because the selector already identifies one exact control. A fill
// action still has to dispatch on the control it reaches: locator.fill() cannot operate on a
// native select. This is the exact shape that left University, Year of Graduation, and University
// Major empty on production packet c1ddd420 after question discovery had resolved all three.
{
  const university = '[name="cards[3da58b41-acf5-40a1-945e-c7f047ef8050][field0]"]';
  const graduation = '[name="cards[026d7ce7-7ca4-44ed-9db6-1c7857707f0e][field0]"]';
  const major = '[name="cards[c2bf8591-ecbb-4de6-bf0b-e8ea17f8afa2][field0]"]';
  const result = await replay([
    { type: 'fill', selector: university, value: 'University of Southern California', label: 'question:university', optional: true },
    { type: 'fill', selector: graduation, value: '2028', label: 'question:year of graduation', optional: true },
    { type: 'fill', selector: major, value: 'Computer Science', label: 'question:university major', optional: true },
    { type: 'extract', selector: `${university} option:checked` },
    { type: 'extract', selector: `${graduation} option:checked` },
    { type: 'extract', selector: `${major} option:checked` }
  ]);
  assert.equal(valueOf(result, `${university} option:checked`), 'University of Southern California');
  assert.equal(valueOf(result, `${graduation} option:checked`), '2028');
  assert.equal(valueOf(result, `${major} option:checked`), 'Computer Science');
  assert.deepEqual(result.filledFields, [
    'question:university',
    'question:year of graduation',
    'question:university major'
  ]);
  assert.deepEqual(result.skipped, []);
}

// SPONSORSHIP AND WORK AUTHORISATION ARE ANSWERED EXACTLY OR NOT AT ALL.
//
// The matcher that shipped accepted containment in both directions for texts over six characters,
// and the chooser took the first option that satisfied it. On the ordinary Lever and Greenhouse
// lists below, a short answer is a prefix of the true longer one, so the run selected the shorter
// line and then reported the field filled. That is a false declaration about visa status and work
// authorisation, sent to an employer under the applicant's name, and it is invisible from both ends
// of the run. Five cases, and each one is about the answer being the answer.
{
  // 1. The truthful answer is listed SECOND, under a shorter option that is its prefix.
  const result = await replay([
    {
      type: 'fill',
      selector: '#sponsorship_prefix_first',
      value: 'I do not require sponsorship now, but will in the future',
      label: 'question:sponsorship',
      optional: true
    },
    { type: 'extract', selector: '#sponsorship_prefix_first option:checked' }
  ]);
  assert.equal(
    valueOf(result, '#sponsorship_prefix_first option:checked'),
    'I do not require sponsorship now, but will in the future',
    'a shorter option that is a prefix of the stored answer must never be sent in its place'
  );
  assert.deepEqual(result.filledFields, ['question:sponsorship']);
  assert.deepEqual(result.skipped, []);
}
{
  // 2. The same shape on the work authorisation question, and the reverse order alongside it, so
  //    the verdict is pinned as order independent rather than accidentally right once.
  const result = await replay([
    {
      type: 'fill',
      selector: '#work_auth_prefix_first',
      value: 'I am authorized to work only with a student visa',
      label: 'question:work authorization',
      optional: true
    },
    {
      type: 'fill',
      selector: '#sponsorship_prefix_last',
      value: 'I do not require sponsorship now, but will in the future',
      label: 'question:sponsorship order',
      optional: true
    },
    { type: 'extract', selector: '#work_auth_prefix_first option:checked' },
    { type: 'extract', selector: '#sponsorship_prefix_last option:checked' }
  ]);
  assert.equal(
    valueOf(result, '#work_auth_prefix_first option:checked'),
    'I am authorized to work only with a student visa',
    'the prefix option listed first must not answer a question it does not answer'
  );
  assert.equal(
    valueOf(result, '#sponsorship_prefix_last option:checked'),
    'I do not require sponsorship now, but will in the future',
    'the same list in the opposite order must reach the same answer'
  );
  assert.deepEqual(result.filledFields, ['question:work authorization', 'question:sponsorship order']);
  assert.deepEqual(result.skipped, []);
}
{
  // 3. An exact answer sitting BELOW two looser candidates. Position must not beat exactness.
  const result = await replay([
    { type: 'fill', selector: '#exact_below', value: 'Computer Science', label: 'question:field of study', optional: true },
    { type: 'extract', selector: '#exact_below option:checked' }
  ]);
  assert.equal(valueOf(result, '#exact_below option:checked'), 'Computer Science',
    'an exact option must win wherever it sits in the list');
  assert.deepEqual(result.filledFields, ['question:field of study']);
  assert.deepEqual(result.skipped, []);
}
{
  // 4. Two containment relatives and no exact answer. There is no right pick, so there is no pick,
  //    and the applicant is told which answer went looking. This is what an unanswerable field has
  //    always done, and an ambiguous one is unanswerable.
  const result = await replay([
    {
      type: 'fill',
      selector: '#ambiguous_auth',
      value: 'I am authorized to work in the United States',
      label: 'question:ambiguous authorization',
      optional: true
    },
    { type: 'extract', selector: '#ambiguous_auth option:checked' }
  ]);
  assert.equal(valueOf(result, '#ambiguous_auth option:checked'), 'Select...',
    'an ambiguous list must be left exactly as it was found');
  assert.deepEqual(result.filledFields, []);
  assert.deepEqual(result.skipped, [
    'question:ambiguous authorization: no option matched "I am authorized to work in the United States", left for you to choose'
  ]);
}
{
  // 5. Verification fails closed. The page rewrites the choice to a substring relative of the stored
  //    answer after the write lands. The old check asked optionMatches about the same pair the
  //    chooser had just used, so it could only ever agree; a control holding "I am authorized to
  //    work" must not report a field answered "only with a student visa".
  const result = await replay([
    {
      type: 'fill',
      selector: '#snapback_auth',
      value: 'I am authorized to work only with a student visa',
      label: 'question:snapback authorization',
      optional: true
    },
    { type: 'extract', selector: '#snapback_auth option:checked' }
  ]);
  assert.equal(valueOf(result, '#snapback_auth option:checked'), 'I am authorized to work',
    'the fixture must actually rewrite the choice, or this case proves nothing');
  assert.deepEqual(result.filledFields, [], 'a control the page moved is not a field that was filled');
  assert.deepEqual(result.skipped, ['question:snapback authorization: choice value did not persist after fill']);
}

// THE SAME RULE ON THE CONTROLS THAT ARE NOT A NATIVE SELECT.
//
// The five cases above fixed the <select>, which is how Lever asks these two questions. Greenhouse
// asks them with a React Select or a radio group and Ashby with a pair of buttons, and all three of
// those paths still took the first option a bidirectional containment test accepted. On these lists
// that is the shorter line, so the same false declaration about visa status went to the employer
// through a different widget. Four runs, covering the three paths in both directions: the answer
// must be reached wherever the board put it, and an ambiguous list must be left alone and reported.
{
  // 1. A React Select whose longer row is the answer and whose shorter row is a prefix of it. The
  //    board spells its row without the comma the applicant wrote, so nothing on the menu is the
  //    answer character for character - and the rule that reaches past that must be exactness after
  //    normalisation, not a substring rule that finds "I do not require sponsorship" instead.
  //    The second control is the same list shape with the exact answer listed LAST, under two looser
  //    relatives of it, so position cannot beat exactness here either.
  const result = await replay([
    {
      type: 'fill',
      selector: '#sponsor-choice',
      value: 'I do not require sponsorship now, but will in the future',
      label: 'question:sponsorship menu',
      optional: true
    },
    { type: 'fill', selector: '#study-choice', value: 'Computer Science', label: 'question:field of study menu', optional: true },
    { type: 'extract', selector: '#sponsor-choice-chosen' },
    { type: 'extract', selector: '#study-choice-chosen' }
  ]);
  assert.equal(
    valueOf(result, '#sponsor-choice-chosen'),
    'I do not require sponsorship now but will in the future',
    'a menu row that is a prefix of the stored answer must never be clicked in its place'
  );
  assert.equal(valueOf(result, '#study-choice-chosen'), 'Computer Science',
    'an exact row must win wherever the menu lists it');
  assert.deepEqual(result.filledFields, ['question:sponsorship menu', 'question:field of study menu']);
  assert.deepEqual(result.skipped, []);
}
{
  // 2. A React Select offering two rows that both contain the answer and neither of which is it.
  //    There is no right row, so there is no click, and the applicant is told which answer went
  //    looking - the same verdict, in the same words, as the native select's ambiguous list.
  const result = await replay([
    {
      type: 'fill',
      selector: '#auth-choice',
      value: 'I am authorized to work in the United States',
      label: 'question:ambiguous authorization menu',
      optional: true
    },
    { type: 'extract', selector: '#auth-choice-chosen' }
  ]);
  assert.equal(valueOf(result, '#auth-choice-chosen'), '',
    'an ambiguous menu must be left exactly as it was found');
  assert.deepEqual(result.filledFields, []);
  assert.deepEqual(result.skipped, [
    'question:ambiguous authorization menu: no option matched "I am authorized to work in the United States", left for you to choose'
  ]);
}
{
  // 3. The radio group and the option pills, both answered with the longer of two options whose
  //    shorter sibling is listed first. The radio group is Greenhouse's shape for these questions and
  //    the pills are Ashby's; before this, both ticked the line above the answer.
  const result = await replay([
    {
      type: 'fillByLabelText',
      text: 'Do you need visa sponsorship for employment?',
      value: 'I do not require sponsorship now, but will in the future',
      label: 'question:sponsorship radios',
      optional: true
    },
    {
      type: 'fillByLabelText',
      text: 'Are you authorized to work in the United States?',
      value: 'Authorized to work with a visa',
      label: 'question:authorization pills',
      optional: true
    },
    { type: 'extract', selector: '#sponsor-radio-chosen' },
    { type: 'extract', selector: '#pill-auth-chosen' }
  ]);
  assert.equal(
    valueOf(result, '#sponsor-radio-chosen'),
    'I do not require sponsorship now, but will in the future',
    'the radio whose label IS the answer must be the one ticked, not the one above it'
  );
  assert.equal(valueOf(result, '#pill-auth-chosen'), 'Authorized to work with a visa',
    'the pill whose text IS the answer must be the one pressed');
  assert.deepEqual(result.filledFields, ['question:sponsorship radios', 'question:authorization pills']);
  assert.deepEqual(result.skipped, []);
}
{
  // 4. The same two widgets with an ambiguous list, in one run. Neither may be answered, both must be
  //    reported, and the report has to name the answer that went looking so a question the applicant
  //    can finish in one click does not read as a fault in Litos.
  const result = await replay([
    {
      type: 'fillByLabelText',
      text: 'Select the work authorization that applies to you',
      value: 'I am authorized to work in the United States',
      label: 'question:ambiguous authorization radios',
      optional: true
    },
    {
      type: 'fillByLabelText',
      text: 'Confirm the work authorization on file',
      value: 'Authorized to work',
      label: 'question:ambiguous authorization pills',
      optional: true
    },
    { type: 'extract', selector: '#auth-radio-chosen' },
    { type: 'extract', selector: '#pill-amb-chosen' }
  ]);
  assert.equal(valueOf(result, '#auth-radio-chosen'), '', 'no radio may be ticked on an ambiguous group');
  assert.equal(valueOf(result, '#pill-amb-chosen'), '', 'no pill may be pressed on an ambiguous pair');
  assert.deepEqual(result.filledFields, []);
  assert.deepEqual(result.skipped, [
    'question:ambiguous authorization radios: more than one option here could be'
      + ' "I am authorized to work in the United States", so none was chosen, left for you to choose',
    'question:ambiguous authorization pills: no option matched "Authorized to work", left for you to choose'
  ]);
}

// Native option values are machine data and need not repeat the visible label. selectNativeOption
// chooses a known label first and a known value second, so verification must accept either
// representation of the same selected option. Before this regression, the value fallback selected
// `cs`, then verifyFilled read
// only `Computer Science` and falsely reported that the choice had not persisted.
{
  const result = await replay([
    { type: 'fill', selector: '#native_value', value: 'cs', label: 'question:major code', optional: true },
    { type: 'extract', selector: '#native_value option:checked' }
  ]);
  assert.equal(valueOf(result, '#native_value option:checked'), 'Computer Science');
  assert.deepEqual(result.filledFields, ['question:major code']);
  assert.deepEqual(result.skipped, []);
  assert.ok(result.elapsedMs < 5000,
    `a value-only native option must not wait for an absent label, took ${result.elapsedMs}ms`);
}

// A native answer absent from both labels and values is left untouched and reported immediately.
// Before the option snapshot, each speculative selectOption call waited for an option that the DOM
// had already proved was not present.
{
  const result = await replay([
    { type: 'fill', selector: '#native_value', value: 'not-an-option', label: 'question:major code', optional: true },
    { type: 'extract', selector: '#native_value option:checked' }
  ]);
  assert.equal(valueOf(result, '#native_value option:checked'), '');
  assert.deepEqual(result.filledFields, []);
  assert.deepEqual(result.skipped, [
    'question:major code: no option matched "not-an-option", left for you to choose'
  ]);
  assert.ok(result.elapsedMs < 5000,
    `an unmatched native option must return from the option snapshot, took ${result.elapsedMs}ms`);
}

// 3. The cost. Six absent optional selectors in a row, exactly Greenhouse's cookie preflight. Each
//    is one instantaneous snapshot, so six of them cost about as much as none: the measured reason
//    the settle grace was dropped is that on two live Greenhouse forms it spent its whole 5000ms
//    budget here and on selectors like these, and changed no filled field and no blocker.
{
  const selectors = [
    '#onetrust-accept-btn-handler',
    '.onetrust-close-btn-handler',
    'button:has-text("Allow All")',
    'button:has-text("Accept All Cookies")',
    'button:has-text("Accept Cookies")',
    'button:has-text("Confirm My Choices")'
  ];
  const result = await replay([
    ...selectors.map((selector, index) => ({ type: 'click', selector, label: `greenhouse_cookie_preflight:${index}`, optional: true })),
    { type: 'extract', selector: 'title' }
  ]);
  assert.equal(valueOf(result, 'title'), 'Replay Fixture', 'the run must continue past every absent optional action');
  assert.equal(result.skipped.length, 6, 'every absent optional action is reported');
  for (const [index, entry] of result.skipped.entries()) {
    assert.match(entry, new RegExp(`^greenhouse_cookie_preflight:${index}: nothing matched `));
    // No grace, so no duration is claimed. A message that says "after 1500ms" is the dropped design.
    assert.doesNotMatch(entry, /after \d+ms$/);
  }
  // The slack covers browser startup and page load on a cold machine, not waiting.
  assert.ok(result.elapsedMs < 5000, `six absent optional selectors must cost nothing, took ${result.elapsedMs}ms`);
}

// 5. THE MERGE ITSELF. Two branches rewrote this loop for different reasons and both intents have
//    to survive together, so one run exercises both: an optional waitForSelector that must hold the
//    run open, and a press that must land on the element it names rather than on the form. Checked
//    in one run because the failure mode being guarded against is a resolution that keeps one side's
//    behaviour and silently drops the other's.
{
  const result = await replay([
    { type: 'click', selector: '#apply-slow', label: 'open_application_form', optional: true },
    { type: 'waitForSelector', selector: '#slow-email', label: 'application_form_ready', optional: true, timeout: 8000 },
    { type: 'fill', selector: '#slow-email', value: 'person@example.com', label: 'email', optional: true },
    { type: 'press', selector: '#aimed', value: 'Enter', label: 'aimed_press' },
    { type: 'extract', selector: '#slow-email-echo' },
    { type: 'extract', selector: '#keytarget' }
  ]);
  assert.equal(valueOf(result, '#slow-email-echo'), 'person@example.com',
    'the optional waitForSelector must still hold the run open after the merge');
  assert.equal(valueOf(result, '#keytarget'), 'aimed',
    'the press must still land on the element it names after the merge, not on the page');
}

// 6. An optional press keeps its selector now, so for the first time it reaches the pre-check above.
//    An Enter aimed at a shut choice control is withheld, and an optional press whose target is not
//    on the page at all is skipped rather than delivered to whatever holds focus.
{
  const withheld = await replay([
    { type: 'press', selector: '#combo', value: 'Enter', label: 'question_confirm', optional: true },
    { type: 'extract', selector: '#keytarget' }
  ]);
  assert.equal(valueOf(withheld, '#keytarget'), '',
    'Enter on a choice control with no menu open must not reach the page at all');
  assert.ok(withheld.skipped.some((entry) => /question_confirm: Enter withheld/.test(entry)),
    'the withheld keystroke must be reported, got ' + JSON.stringify(withheld.skipped));

  const absent = await replay([
    { type: 'press', selector: '#not-on-this-page', value: 'Enter', label: 'question_confirm', optional: true },
    { type: 'extract', selector: '#keytarget' }
  ]);
  assert.equal(valueOf(absent, '#keytarget'), '',
    'an optional press whose target is absent must not fire at the page');
  assert.deepEqual(absent.skipped, ['question_confirm: nothing matched #not-on-this-page'],
    'and it must say so, got ' + JSON.stringify(absent.skipped));
}

// 7. The pre-submit gate, both directions, against the merged loop. An incomplete form must not be
//    submitted and must say which fields are empty; a complete one must go through untouched. The
//    fixture carries the form's own "* indicates a required field" legend on purpose: an early
//    version of the gate matched it and would have refused every Greenhouse submission there is.
//
//    Every case here runs with allowSubmit, and it has to. These are the AUTHORIZED submit run: the
//    run-level guard that stops a fill run submitting is deliberately not installed on it, which
//    leaves the pre-submit gate as the only thing between the click and the submission. That is the
//    same reason the fixture's form is novalidate. Without allowSubmit the two refusal cases below
//    would still go green, and they would be green because the guard stopped the submit and not
//    because the gate did - a test passing for the wrong reason is how a gate rots unnoticed.
{
  const blocked = await replay([
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' },
    { type: 'extract', selector: '#submitted' }
  ], { allowSubmit: true });
  assert.equal(valueOf(blocked, '#submitted'), '', 'an incomplete form must not be submitted');
  assert.deepEqual(blocked.blockers.sort(), [
    '"Email" could not be confirmed',
    '"Full name" could not be confirmed',
    '"Phone" could not be confirmed'
  ], 'the gate must name the empty fields, got ' + JSON.stringify(blocked.blockers));

  const fill = (selector, value) => ({ type: 'fill', selector, value, label: selector.slice(1) });
  const allowed = await replay([
    fill('#req_name', 'Mehek Mandal'),
    fill('#req_email', 'person@example.com'),
    fill('#req_phone', '+971 50 123 4567'),
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' },
    { type: 'extract', selector: '#submitted' }
  ], { allowSubmit: true });
  assert.equal(valueOf(allowed, '#submitted'), 'yes', 'a complete form must not be blocked');
  assert.deepEqual(allowed.blockers, [], 'a complete form must produce no blockers, got ' + JSON.stringify(allowed.blockers));

  // R-103. Everything filled EXCEPT the phone number, which shares its fieldset with an answered
  // country select. The gate used to read that fieldset as a whole, find the country's "+971", and
  // let the submit through. "Phone is required." is one of the six messages from the incident that
  // built this gate, so it was blind to the field it exists to catch.
  const phoneEmpty = await replay([
    fill('#req_name', 'Mehek Mandal'),
    fill('#req_email', 'person@example.com'),
    { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' },
    { type: 'extract', selector: '#submitted' }
  ], { allowSubmit: true });
  assert.equal(valueOf(phoneEmpty, '#submitted'), '',
    'an empty required control beside an answered choice control must still stop the submit');
  // Asserted on 'skipped', not only on 'blockers': the runner has a SECOND, older required-field
  // scan that runs after the loop and reports the same field, so a blockers-only assertion passes
  // even when the gate saw nothing and let the click through. This line is the gate's alone.
  assert.ok(phoneEmpty.skipped.some((entry) => /atomic confirmation blocked submission/.test(entry)),
    'the GATE, not the post-loop scan, must be what withheld the click, got ' + JSON.stringify(phoneEmpty.skipped));
  assert.deepEqual(phoneEmpty.blockers.sort(), ['"Phone" could not be confirmed'],
    'the gate must name the phone, and must not blame the answered country, got ' + JSON.stringify(phoneEmpty.blockers));
}

// A choice control is answered from its OWN menu, and an answer already on the form survives every
// later candidate.
//
// Both halves were measured on live Greenhouse forms on 2026-08-08, and both reported success while
// leaving the control on "Select...":
//   - DRW and Virtu: the fallback locator swept the page for 'li' containing "Computer Science" and
//     clicked a bullet in the job description, because the properly scoped attempt was made as an
//     instant count() 150ms after the click, before the menu had rendered.
//   - Five Rings: Discipline was correctly set to "Computer Science" and then emptied by a later
//     candidate, twice over - an empty fill lands as a backspace on the always-empty search box, and
//     the control sweep clicks the "Clear selections" button.
{
  const disciplineText = (result) => (valueOf(result, '#discipline-shell') || '').replace(/\s+/g, ' ').trim();

  const answered = await replay([
    { type: 'click', selector: '#discipline', label: 'discipline_open', optional: true },
    { type: 'fill', selector: '#discipline', value: 'Computer Science', label: 'discipline', optional: true },
    { type: 'extract', selector: '#discipline-shell' }
  ]);
  assert.match(disciplineText(answered), /Computer Science/,
    'the option must be taken from the control\'s own menu once it renders, got ' + JSON.stringify(disciplineText(answered)));
  assert.ok(!/Are pursuing a bachelor/.test(disciplineText(answered)), 'the job description must not end up in the control');
  assert.deepEqual(answered.filledFields, ['discipline'], 'and it must be reported filled, got ' + JSON.stringify(answered));

  // A second candidate that matches nothing. It must leave the first answer exactly where it was,
  // and must say so rather than claiming a fill.
  const survives = await replay([
    { type: 'click', selector: '#discipline', label: 'discipline:0_open', optional: true },
    { type: 'fill', selector: '#discipline', value: 'Computer Science', label: 'discipline:0', optional: true },
    { type: 'click', selector: '#discipline', label: 'discipline:1_open', optional: true },
    { type: 'fill', selector: '#discipline', value: 'Astrophysics', label: 'discipline:1', optional: true },
    { type: 'extract', selector: '#discipline-shell' }
  ]);
  assert.match(disciplineText(survives), /Computer Science/,
    'a later candidate that matches nothing must not clear an answer that matched, got ' + JSON.stringify(disciplineText(survives)));
  assert.ok(survives.filledFields.includes('discipline:0'), 'the candidate that worked is still reported filled');
  assert.ok(survives.skipped.some((entry) => /^discipline:1: left the answer already on the form/.test(entry)),
    'the candidate that missed must be reported honestly, got ' + JSON.stringify(survives.skipped));

  // Nothing on the ladder matches. The control must be left for the applicant and reported as such,
  // never typed into and then read back out of its own search box.
  const unmatchable = await replay([
    { type: 'click', selector: '#discipline', label: 'discipline_open', optional: true },
    { type: 'fill', selector: '#discipline', value: 'Computer Science & Business Administration, Finance Emphasis', label: 'discipline', optional: true },
    { type: 'extract', selector: '#discipline-shell' }
  ]);
  assert.match(disciplineText(unmatchable), /Select\.\.\./,
    'an answer that is on no list must leave the control untouched, got ' + JSON.stringify(disciplineText(unmatchable)));
  assert.deepEqual(unmatchable.filledFields, [], 'and it must NOT be reported filled, got ' + JSON.stringify(unmatchable.filledFields));
  assert.ok(unmatchable.skipped.some((entry) => /^discipline: no option matched .*left for you to choose$/.test(entry)),
    'and the applicant must be told, got ' + JSON.stringify(unmatchable.skipped));
}

// 8. A DATE PICKER MUST NOT BE LEFT STANDING OVER THE NEXT QUESTION.
//
// Measured on the live Deepgram Ashby form: filling 'Expected Graduation Year' leaves a May 2028
// calendar open, physically covering the following question AND its label. elementFromPoint over
// that control returns the calendar, so anything aimed there hits the calendar rather than the
// field, and the screenshot the applicant approves shows a question she cannot read.
//
// The submit assertion is the other half and is not decoration. The last time a keystroke was used
// to commit a value it was an unaimed global 'press Enter' that reached the FORM: five bounced
// applications and five emailed Greenhouse security codes. This case runs WITHOUT allowSubmit and
// still asserts nothing was submitted, so a dismissal that could ever reach a submit control fails
// here rather than on someone's application.
{
  const result = await replay([
    { type: 'fill', selector: '#grad_year', value: 'May 2028', label: 'education_end_year_field' },
    { type: 'extract', selector: '#covers' },
    { type: 'extract', selector: '#calendar-dismissed' },
    { type: 'extract', selector: '#submitted' }
  ]);
  assert.equal(valueOf(result, '#covers'), 'no',
    'the calendar must not be left covering the next question, got ' + JSON.stringify(valueOf(result, '#covers')));
  assert.equal(valueOf(result, '#calendar-dismissed'), 'yes',
    'and it must have been dismissed by an aimed Escape, not left to close itself');
  assert.deepEqual(result.filledFields, ['education_end_year_field'],
    'the value still has to be committed and reported, got ' + JSON.stringify(result));
  assert.equal(valueOf(result, '#submitted'), '',
    'NOTHING may be submitted by a dismissal keystroke');
}

// 9. THE DIAL CODE THAT WAS WRITTEN TWICE, and its mirror image, in one run.
//
// Cresta's live form rejected '+971 567417451' with 'Phone number is too short' while the country
// control beside it already read +971. #req_phone reproduces that shape: Greenhouse puts the number
// and its country React Select in ONE fieldset, and the fixture's select is showing +971.
//
// #lone_phone is the mirror image and matters just as much. It is a phone field with no country
// control in its group, so it must receive the FULL international number. Stripping there would
// produce a number the employer cannot dial, with nothing on the page saying so - the worse of the
// two bugs, and the one a board-by-board special case walks straight into.
{
  const result = await replay([
    { type: 'fill', selector: '#req_phone', value: '+971 567417451', label: 'phone' },
    { type: 'fill', selector: '#lone_phone', value: '+971 567417451', label: 'mobile' },
    { type: 'extract', selector: '#req_phone-echo' },
    { type: 'extract', selector: '#lone_phone-echo' }
  ]);
  assert.equal(valueOf(result, '#req_phone-echo'), '567417451',
    'a phone field whose own group already shows +971 takes the national number, got '
    + JSON.stringify(valueOf(result, '#req_phone-echo')));
  assert.equal(valueOf(result, '#lone_phone-echo'), '+971 567417451',
    'a phone field with no country control beside it keeps its country, got '
    + JSON.stringify(valueOf(result, '#lone_phone-echo')));
  // Reported against what was WRITTEN. Verifying a stripped number against the international form
  // would turn a correct fill into 'value did not persist after fill'.
  assert.deepEqual(result.filledFields.sort(), ['mobile', 'phone'],
    'both fills must be reported filled, got ' + JSON.stringify(result));
}

/* 10. A CONTROL THAT SHOWS THE DIAL CODE FOR THE COUNTRY IT IS HOLDING IS HOLDING THE COUNTRY.
 *
 * The measured cause of the largest single answer-loss class in the corpus: 45 stored packets carry
 * "choice value did not persist after fill", and 43 of them are this one control. Greenhouse's phone
 * Country React Select takes "United Arab Emirates" from the menu row "United Arab Emirates +971"
 * and then renders the chosen value as a flag plus "+971". readChoiceState read that correctly; the
 * verification compared "+971" against "United Arab Emirates", found nothing in common, and reported
 * an answer that was sitting on the form as one Litos had lost. Reproduced on 23 of the 24 live
 * employer forms behind those reports on 2026-08-09.
 *
 * Three assertions, and the last two are what keep the widening honest:
 *   - the answer that DID land is reported filled;
 *   - #country-shown proves it landed, independently of anything the runner says;
 *   - an answer the control is NOT holding is still reported as lost. Without that this test would
 *     pass just as well against a verification that had been deleted.
 */
{
  const landed = await replay([
    { type: 'fill', selector: '#country', value: 'United Arab Emirates', label: 'phone_country', optional: true },
    { type: 'extract', selector: '#country-shown' }
  ]);
  assert.equal(valueOf(landed, '#country-shown'), '+971',
    'the fixture must actually be holding the country before anything is claimed about it, got '
    + JSON.stringify(valueOf(landed, '#country-shown')));
  assert.deepEqual(landed.filledFields, ['phone_country'],
    'a country the control is visibly holding must be reported filled, got ' + JSON.stringify(landed));
  assert.deepEqual(landed.skipped, [], 'and nothing about it may be reported lost, got ' + JSON.stringify(landed.skipped));

  // THE NEGATIVE CONTROL. Nothing on this menu carries "Atlantis", so no row is clicked, the control
  // stays empty, and the run must say so rather than widen its way to a pass.
  const missing = await replay([
    { type: 'fill', selector: '#country', value: 'Atlantis', label: 'phone_country', optional: true },
    { type: 'extract', selector: '#country-shown' }
  ]);
  assert.equal(valueOf(missing, '#country-shown'), '',
    'the control must still be empty, got ' + JSON.stringify(valueOf(missing, '#country-shown')));
  assert.deepEqual(missing.filledFields, [],
    'an answer that never reached the control must never be reported filled, got ' + JSON.stringify(missing));
  assert.ok(missing.skipped.some((entry) => /^phone_country: no option matched "Atlantis"/.test(entry)),
    'and the applicant must be told which answer was not on the list, got ' + JSON.stringify(missing.skipped));
}

/* THE NO-CHALLENGE PATH FINISHES IN ONE PHASE.
 *
 * Skydio packet 13bccb2d, 2026-08-09. requestContinuation is set on every managed submit, because
 * the caller cannot know in advance whether a form will demand an emailed code. This fixture has no
 * code control and never will, so there is no second phase to run - and the runner used to sit here
 * anyway until the continuation TTL ran out, while the caller waited on the other side and then
 * reported "Managed browser continuation timed out" on a submit that had nothing to do with a
 * continuation.
 *
 * The deadline is the assertion. `continuationExpiresAt` is 20 seconds out; a runner that idles for
 * a continuation cannot exit inside 8, and a runner that knows there is nothing to wait for exits
 * as soon as it has closed the browser.
 */
{
  const result0 = path.join(workDir, 'stratus-result-0.json');
  fs.rmSync(result0, { force: true });
  fs.rmSync(path.join(workDir, 'stratus-result-1.json'), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-continuation-input.json'), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-continuation-ready.json'), { force: true });
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: base,
    actions: [{ type: 'fill', selector: '#plain', value: 'one-phase', label: 'proof' }],
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    requestContinuation: true,
    continuationExpiresAt: new Date(Date.now() + 20_000).toISOString(),
    allowedHost: new URL(base).hostname
  }));
  const startedAt = Date.now();
  const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'], {
    cwd: workDir,
    env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.resume();
  const exitCode = await new Promise((resolve) => {
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve('timeout'); }, 8_000);
    child.on('close', (code) => { clearTimeout(timer); resolve(code); });
  });
  assert.equal(exitCode, 0,
    `a run with no security-code challenge must finish in one phase and exit, got ${exitCode} after `
    + `${Date.now() - startedAt}ms: ${stderr}`);
  const single = JSON.parse(fs.readFileSync(result0, 'utf8'));
  assert.equal(single.continuationOffered, false,
    'the runner must report that it is not holding a continuation open, got ' + JSON.stringify(single.continuationOffered));
  assert.equal(fs.existsSync(path.join(workDir, 'stratus-continuation-ready.json')), false,
    'no continuation was warranted, so none may be advertised');
  assert.equal(single.filledFields[0], 'proof', 'the single phase still does the work: ' + JSON.stringify(single.filledFields));
}

// A continuation must operate on the same Page and BrowserContext. The first phase writes a value
// into the fixture without submitting anything. The second phase extracts it without a URL or a
// reload. A new browser or page would return an empty string.
//
// `continuationCheckpoint` is what asks for one now. The runner offers a continuation only when the
// page presents a security-code control or the caller explicitly checkpoints, so this test says
// which of the two it means rather than relying on requestContinuation alone - which used to hold a
// continuation open on every form in existence.
{
  const result0 = path.join(workDir, 'stratus-result-0.json');
  const result1 = path.join(workDir, 'stratus-result-1.json');
  fs.rmSync(result0, { force: true });
  fs.rmSync(result1, { force: true });
  fs.rmSync(path.join(workDir, 'stratus-continuation-input.json'), { force: true });
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: base,
    actions: [{ type: 'fill', selector: '#plain', value: 'same-page-proof', label: 'proof' }],
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    requestContinuation: true,
    continuationCheckpoint: true,
    continuationExpiresAt: new Date(Date.now() + 15_000).toISOString(),
    allowedHost: new URL(base).hostname
  }));
  const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'], {
    cwd: workDir,
    env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.resume();
  const waitForFile = async (file, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(file) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(fs.existsSync(file), `runner did not create ${path.basename(file)}: ${stderr}`);
  };
  await waitForFile(result0);
  assert.equal(JSON.parse(fs.readFileSync(result0, 'utf8')).filledFields[0], 'proof');
  fs.writeFileSync(path.join(workDir, 'stratus-continuation-input.json'), JSON.stringify({
    actions: [{ type: 'extract', selector: '#plain-echo' }],
    screenshot: false,
    fullPage: false
  }));
  await waitForFile(result1);
  const continued = JSON.parse(fs.readFileSync(result1, 'utf8'));
  assert.equal(valueOf(continued, '#plain-echo'), 'same-page-proof', 'continuation must retain page state from phase one');
  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(exitCode, 0, `continuation runner exited ${exitCode}: ${stderr}`);
}

/* A PRESSED UNKNOWN RESULT GETS ONE EMPTY-ACTION SECOND READ.
 *
 * The fixture delays kos.ai's published Ashby success container until after the runner's bounded
 * initial wait. Phase zero must report pressed+unknown and offer a 15-second one-shot capability.
 * Phase one carries no actions. Its confirmed result therefore proves two things together: the
 * same page was retained, and finalSubmitPressed survived from phase zero rather than being
 * manufactured by another click. */
{
  const result0 = path.join(workDir, 'stratus-result-0.json');
  const result1 = path.join(workDir, 'stratus-result-1.json');
  const continuationInput = path.join(workDir, 'stratus-continuation-input.json');
  fs.rmSync(result0, { force: true });
  fs.rmSync(result1, { force: true });
  fs.rmSync(continuationInput, { force: true });
  fs.rmSync(path.join(workDir, 'stratus-continuation-ready.json'), { force: true });
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: `${base}?receipt=ashby`,
    actions: [
      { type: 'fill', selector: '#delayed-receipt-email', value: 'routing@example.test', label: 'email' },
      { type: 'confirmAndSubmit', selector: 'button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]', chooserPolicy: ATOMIC_SUBMIT_POLICY, label: 'final_submit', optional: false, maxRetries: 1, contractVersion: 2, submitKind: 'application' }
    ],
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    allowSubmit: true,
    requestContinuation: true,
    continuationTtlSeconds: 120,
    continuationExpiresAt: new Date(Date.now() + 120_000).toISOString(),
    allowedHost: new URL(base).hostname
  }));
  const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'], {
    cwd: workDir,
    env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
  });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk; });
  child.stdout.resume();
  const waitForFile = async (file, timeoutMs = 10_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(file) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    assert.ok(fs.existsSync(file), `runner did not create ${path.basename(file)}: ${stderr}`);
  };
  await waitForFile(result0);
  const first = JSON.parse(fs.readFileSync(result0, 'utf8'));
  assert.equal(first.submitOutcome.pressed, true);
  assert.equal(first.submitOutcome.state, 'unknown');
  assert.match(first.text, /submission-count:1/, 'phase zero must dispatch exactly one submit');
  assert.equal(first.continuationOffered, true);
  const remainingMs = Date.parse(first.continuationExpiresAt) - Date.now();
  assert.ok(remainingMs > 10_000 && remainingMs <= 15_000,
    'receipt observation must use its own short lifetime, got ' + remainingMs + 'ms');
  await new Promise((resolve) => setTimeout(resolve, 1000));
  fs.writeFileSync(continuationInput, JSON.stringify({ actions: [], screenshot: false, fullPage: false }));
  await waitForFile(result1);
  const second = JSON.parse(fs.readFileSync(result1, 'utf8'));
  assert.equal(second.submitOutcome.pressed, true, 'empty phase one retains the phase-zero click fact');
  assert.equal(second.submitOutcome.state, 'confirmed');
  assert.equal(second.submitOutcome.source, 'ats_state');
  assert.equal(second.submitOutcome.evidence, '.ashby-application-form-success-container');
  assert.match(second.text, /submission-count:1/, 'the empty observation must not dispatch another submit');
  assert.equal(second.url, first.url, 'the empty observation must retain the same employer page URL');
  assert.deepEqual(second.requiredFieldConfirmation, null, 'phase one ran no confirmation or submit action');
  const exitCode = await new Promise((resolve) => child.on('close', resolve));
  assert.equal(exitCode, 0, `receipt observation runner exited ${exitCode}: ${stderr}`);
}

/* 12. THE ASHBY GRADUATION DATE PICKER, end to end, against the markup the live board serves.
 *
 * Production packet 59fb48ae (Deepgram, Ashby, 2026-08-09) filled name, email, phone, resume, both
 * essays, work authorisation, sponsorship and all three EEO questions, and shipped with one field
 * empty and the submit withheld for it: '"Expected Graduation Year" is required and is still empty'.
 *
 * Every case below fails against the previous runner, and for two different reasons. The write was
 * aimed at a DIV, because that input has no id and no name and the wrapper is the only thing
 * discovery could name; and the picker parses on a Tab keydown that the plain fill path never sent.
 *
 * The last case is the one that is not about mechanism. A bare year is what this packet actually
 * carried, and there is no honest way to put it on a control that insists on a day.
 */
const GRAD = '[data-field-path="407cc864-6d10-4427-bc5e-71598c5e593f"]';
const GRAD_ECHO = '#grad-echo';
{
  // A full date on file goes on unchanged, and the normalised read-back is not a lost fill.
  const exact = await replay([
    { type: 'fill', selector: GRAD, value: '2028-05-15', label: 'graduation', optional: true },
    { type: 'extract', selector: GRAD_ECHO }
  ]);
  assert.equal(valueOf(exact, GRAD_ECHO), '05/15/2028',
    'a full date must reach the control through a wrapper selector, got ' + JSON.stringify(valueOf(exact, GRAD_ECHO)));
  assert.deepEqual(exact.filledFields, ['graduation'],
    'and the picker rewriting it to its own format is not a lost answer, got ' + JSON.stringify(exact));

  /* THE CONVENTION. A month on file, a control that insists on a day, and the day it is given is
   * the FIRST of that month.
   *
   * Stated here because a reader should be able to disagree with it deliberately. The year and the
   * month are exactly what is on file and neither moves; the first is the canonical widening of a
   * month-precision date, and it is what ISO 8601, every date library and this picker itself
   * produce from the same input; and no employer screen can read a different month out of it. The
   * day is the only invented part and it is the only part nothing is decided on. */
  const month = await replay([
    { type: 'fill', selector: GRAD, value: 'May 2028', label: 'graduation', optional: true },
    { type: 'extract', selector: GRAD_ECHO }
  ]);
  assert.equal(valueOf(month, GRAD_ECHO), '05/01/2028',
    'a month on file is widened to the first of that month, got ' + JSON.stringify(valueOf(month, GRAD_ECHO)));
  assert.deepEqual(month.filledFields, ['graduation'],
    'and it must be reported filled, got ' + JSON.stringify(month));

  /* AND THE REFUSAL, which is the case the Deepgram packet is.
   *
   * "2028" is what reached the runner. Typing it and tabbing off leaves 01/01/2028 - the picker
   * picks January by itself - and January is wrong about a person who graduates in May by four
   * months. That is not a missing day, it is the wrong answer to the question an internship screens
   * on, so nothing is written and the run says what was missing. The control must be left EMPTY:
   * a plausible wrong date is worse than a blank, because the blank is reported to her and the date
   * is not. */
  const bareYear = await replay([
    { type: 'fill', selector: GRAD, value: '2028', label: 'graduation', optional: true },
    { type: 'extract', selector: GRAD_ECHO }
  ]);
  assert.equal(valueOf(bareYear, GRAD_ECHO), '',
    'a year must never be widened into a month nobody stated, got ' + JSON.stringify(valueOf(bareYear, GRAD_ECHO)));
  assert.deepEqual(bareYear.filledFields, [],
    'and it must not be reported filled, got ' + JSON.stringify(bareYear.filledFields));
  assert.ok(bareYear.skipped.some((entry) => /^graduation: this control is a date picker and needs a full date/.test(entry)),
    'and the run must say exactly what was missing, got ' + JSON.stringify(bareYear.skipped));

  // A term is a year and not a month, for the same reason and with the same outcome. Spring ends in
  // April, May or June depending on the school, and the picker turns it into the first of January.
  const term = await replay([
    { type: 'fill', selector: GRAD, value: 'Spring 2028', label: 'graduation', optional: true },
    { type: 'extract', selector: GRAD_ECHO }
  ]);
  assert.equal(valueOf(term, GRAD_ECHO), '',
    'a term names no month, got ' + JSON.stringify(valueOf(term, GRAD_ECHO)));

  // A wrapper holding two pickers speaks for two questions, and the answer is written to neither.
  const ambiguous = await replay([
    { type: 'fill', selector: '[data-field-path="two-controls"]', value: '2028-05-15', label: 'window', optional: true },
    { type: 'extract', selector: '#from-echo' },
    { type: 'extract', selector: '#to-echo' }
  ]);
  assert.equal(valueOf(ambiguous, '#from-echo'), '',
    'a block holding two controls must not be guessed at');
  assert.deepEqual(ambiguous.filledFields, [], 'and nothing may be reported filled, got ' + JSON.stringify(ambiguous));
  assert.ok(ambiguous.skipped.some((entry) => /does not name a control Litos can type into/.test(entry)),
    'and the run must say so, got ' + JSON.stringify(ambiguous.skipped));

  // The native month control: a day on file narrows to the month the control asked for, and a bare
  // year is refused here for the same reason it is refused on a day control.
  const nativeMonth = await replay([
    { type: 'fill', selector: '#grad_month', value: '2028-05-15', label: 'graduation', optional: true },
    { type: 'extract', selector: '#grad_month', attribute: 'value' }
  ]);
  assert.deepEqual(nativeMonth.filledFields, ['graduation'],
    'a month control must accept a full date at its own precision, got ' + JSON.stringify(nativeMonth));
  const monthYearOnly = await replay([
    { type: 'fill', selector: '#grad_month', value: '2028', label: 'graduation', optional: true }
  ]);
  assert.deepEqual(monthYearOnly.filledFields, [],
    'a year names no month, got ' + JSON.stringify(monthYearOnly));
  assert.ok(monthYearOnly.skipped.some((entry) => /needs a full date, but the answer on file is only the year/.test(entry)),
    'and the run must say so, got ' + JSON.stringify(monthYearOnly.skipped));

  // The same control reached by its LABEL rather than by a selector takes the same path, so the two
  // fill branches cannot drift into answering this question two different ways.
  const byLabel = await replay([
    { type: 'fillByLabelText', text: 'Expected Graduation Year', value: 'May 2028', label: 'graduation', optional: true },
    { type: 'extract', selector: GRAD_ECHO }
  ]);
  assert.equal(valueOf(byLabel, GRAD_ECHO), '05/01/2028',
    'fillByLabelText must commit the same way, got ' + JSON.stringify(valueOf(byLabel, GRAD_ECHO)));
  assert.deepEqual(byLabel.filledFields, ['graduation'], 'got ' + JSON.stringify(byLabel));
}

server.close();
fs.rmSync(workDir, { recursive: true, force: true });
console.log('managed runner replay: an optional waitForSelector waits, a press lands where it is aimed, a choice is taken from the control\'s own menu and never undone by a later candidate, a sponsorship or work authorization question is answered exactly or left for her on a native select, a React Select menu, a radio group and a pair of option pills alike, and never verified by the predicate that chose it, a graduation date picker is reached through the wrapper that names it and is never given a month nobody stated, and the pre-submit gate holds in both directions');
