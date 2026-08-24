/* THE SUBMIT CHOOSER, RUN AGAINST PRODUCTION-SHAPED ATS DOM INSTEAD OF READ AS A STRING.
 *
 * The only coverage this chooser had was `assert.match(SANDBOX_RUNNER, /confirmAndSubmitPass/)`,
 * which asserts that a name appears in a string. It cannot catch a chooser that finds nothing and
 * throws, and it did not.
 *
 * Measured on the live kos.ai Ashby application page on 2026-08-11:
 *
 *   document.querySelectorAll('form').length   0
 *   input elements                             4, plus 1 textarea and 2 input[type=file]
 *   Submit Application button                  visible, enabled, final intent, NO form ancestor
 *   its ancestor chain                         button -> div#form -> div.ashby-job-posting-right-pane
 *
 * The viability filter required element.closest('form'), so the viable list was empty on every
 * Ashby application and the pass threw "Atomic submit control was missing or ambiguous" before any
 * click. Meanwhile the live Haize Labs Greenhouse page has exactly 1 form and must keep behaving
 * as it does today.
 *
 * Half of these cases exist because a first attempt at the fix was wrong in ways only a served
 * page could show: a container scope that competed with a real form let a header "Apply Now"
 * outscore an in-form "Submit" and take the click, and an innermost container smaller than the
 * application clicked with a required question elsewhere on the page still empty. Both are pinned
 * below.
 *
 * The stray-form cases were measured later, on the same shape. Requiring a form ancestor was
 * replaced by accepting ANY form ancestor, so a button that merely sat inside some form on the
 * page counted as a submit. On an Ashby application carrying one unrelated form, the runner
 * pressed the newsletter when its button said "Submit" and the filter when its button said
 * "Apply", and the application itself was unreachable either way, because a stray form holding a
 * final-intent control also switches the container path off. Those pages are served here too.
 *
 * Every test spawns the shipped runner against a served page and asserts on what happened: which
 * button was pressed, how many times, and which node the pass bound as its scope. Nothing here
 * matches on runner source text.
 */
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  ATOMIC_SUBMIT_V4_CAPABILITY,
  ATOMIC_SUBMIT_POLICY,
  ATOMIC_SUBMIT_POLICY_V4,
  EXACT_PAGE_URL_CAPABILITY,
  SANDBOX_RUNNER
} from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const HELPERS = `
  document.querySelectorAll('form input, form textarea, form select').forEach(function (control) {
    if (!control.name && control.id) control.name = control.id;
  });
  function attach(id) {
    var transfer = new DataTransfer();
    transfer.items.add(new File(['resume'], 'resume.pdf', { type: 'application/pdf' }));
    document.getElementById(id).files = transfer.files;
  }
  var lastActivatedSubmitter = null;
  document.addEventListener('click', function (event) {
    lastActivatedSubmitter = event.target.closest && event.target.closest('button, input[type="submit"], [role="button"]');
  }, true);
  function record(who) {
    var log = document.getElementById('submitted');
    log.textContent = log.textContent ? log.textContent + ',' + who : who;
    var submitter = lastActivatedSubmitter || document.activeElement;
    var form = submitter && submitter.form;
    var payload;
    if (form) {
      payload = new FormData(form,
        submitter instanceof HTMLButtonElement || submitter instanceof HTMLInputElement
          ? submitter : undefined);
    } else {
      payload = new FormData();
      var scope = submitter && submitter.closest('#form, [class*="application"], [data-application]');
      if (!scope) scope = document.getElementById('form');
      Array.from(scope ? scope.querySelectorAll('input, textarea, select') : []).forEach(function (control) {
        if (control.disabled) return;
        var name = control.name || control.id;
        if (!name) return;
        if (control instanceof HTMLInputElement
          && (control.type === 'checkbox' || control.type === 'radio') && !control.checked) return;
        if (control instanceof HTMLInputElement && control.type === 'file') {
          Array.from(control.files || []).forEach(function (file) { payload.append(name, file); });
        } else if (control instanceof HTMLSelectElement) {
          Array.from(control.selectedOptions).forEach(function (option) { payload.append(name, option.value); });
        } else {
          payload.append(name, control.value || '');
        }
      });
      if (submitter && (submitter.name || submitter.id)) {
        payload.append(submitter.name || submitter.id, submitter.value || '');
      }
    }
    navigator.sendBeacon('/record-click?who=' + encodeURIComponent(who), payload);
  }`;

/* The formless Ashby shape: a plain div#form holding every control, no <form> element anywhere on
 * the page, and the submit button as a sibling of the fields inside that div. */
const ASHBY = `<!doctype html><meta charset="utf-8"><title>Formless Ashby application</title>
<div id="root"><div class="_container_dea4p_28"><div class="_content_dea4p_70">
<div class="ashby-job-posting-right-pane">
<div id="form">
  <div class="field"><label for="name">Full name *</label><input id="name" required value="Mehek Mandal"></div>
  <div class="field"><label for="email">Email *</label><input id="email" type="email" required value="mehek@example.com"></div>
  <div class="field"><label for="phone">Phone *</label><input id="phone" type="tel" required value="+971501234567"></div>
  <div class="field"><label for="linkedin">LinkedIn</label><input id="linkedin" value="https://www.linkedin.com/in/mehek"></div>
  <div class="field"><label for="why">Why this role? *</label><textarea id="why" required>Because it fits.</textarea></div>
  <div class="field"><label for="resume">Resume *</label><input id="resume" type="file" required></div>
  <div class="field"><label for="cover">Cover letter</label><input id="cover" type="file"></div>
  <div class="_fieldEntry_1e3gg_28 ashby-application-form-field-entry" data-field-path="4c3852e7-e63c-44dc-956b-a819f456e945">
    <label class="_heading_f7cvd_52 _required_f7cvd_91 _label_1e3gg_42 ashby-application-form-question-title" for="4c3852e7-e63c-44dc-956b-a819f456e945">Prior US Government Employment?</label>
    <div class="_description_1e3gg_48 ashby-application-form-question-description"><p>Have you worked for the US government in the last 10 years?</p></div>
    <div class="_container_1svni_28 _yesno_1e3gg_148">
      <button class="_container_pjyt6_1 _option_1svni_32">Yes</button>
      <button class="_container_pjyt6_1 _option_1svni_32 _active_1svni_57">No</button>
      <input type="checkbox" class="_input_1svni_78" style="display:none" tabindex="-1" name="4c3852e7-e63c-44dc-956b-a819f456e945">
    </div>
  </div>
  <button id="submit" class="_button_zyh3g_28 _primary_zyh3g_97">Submit Application</button>
</div>
</div></div></div>
<div id="submitted"></div>
<script>${HELPERS}
  attach('resume');
  var ashbyParams = new URLSearchParams(location.search);
  if (ashbyParams.has('leave-government-unanswered')) {
    document.querySelector('button._active_1svni_57').classList.remove('_active_1svni_57');
  }
  if (ashbyParams.has('non-ashby-radio-peer')) {
    document.getElementById('submit').insertAdjacentHTML('beforebegin',
      '<fieldset id="ordinary-radio"><legend>Preferred shift *</legend>'
      + '<input id="day-shift" type="radio" name="shift" required><label for="day-shift">Day</label>'
      + '<input id="night-shift" type="radio" name="shift" checked><label for="night-shift">Night</label>'
      + '<button type="button">Details</button></fieldset>');
  }
  if (ashbyParams.has('fieldset-sibling-checkbox')) {
    document.getElementById('submit').insertAdjacentHTML('beforebegin',
      '<fieldset id="ordinary-checkbox"><legend>Applicant consent *</legend>'
      + '<input id="applicant-consent" type="checkbox" required><label for="applicant-consent">I consent</label>'
      + '<div class="_yesno_sibling"><button type="button" class="_active_sibling" style="display:none">Yes</button>'
      + '<button type="button" style="display:none">No</button></div></fieldset>');
  }
  document.getElementById('submit').addEventListener('click', function () { record('ashby'); });
</script>`;

/* The Greenhouse shape: one real form, plus the top-of-page Apply button that sits outside it. */
const GREENHOUSE = `<!doctype html><meta charset="utf-8"><title>Greenhouse application</title>
<div id="page">
  <div id="header"><h1>Software Engineering Intern</h1><button id="decoy">Apply</button></div>
  <form id="application" novalidate>
    <div class="field"><label for="gh-name">Full name *</label><input id="gh-name" required value="Mehek Mandal"></div>
    <div class="field"><label for="gh-email">Email *</label><input id="gh-email" type="email" required value="mehek@example.com"></div>
    <div class="field"><label for="gh-resume">Resume *</label><input id="gh-resume" type="file" required></div>
    <button id="submit" type="submit">Submit application</button>
  </form>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  attach('gh-resume');
  document.getElementById('decoy').addEventListener('click', function () { record('decoy'); });
  document.getElementById('application').addEventListener('submit', function (event) {
    event.preventDefault();
    record('greenhouse');
  });
</script>`;

/* THE OUTSCORING DECOY. The real submit is labelled "Submit", which is what SmartRecruiters,
 * Workday and Paylocity actually render, and it scores 1. The sticky header "Apply Now" scores 2
 * and has no form, but its walk climbs out of the header into the wrapper that also holds the
 * form's inputs. If a container may compete with a form, the decoy wins on score and the run
 * presses the wrong control on a real employer form. */
const OUTSCORING_DECOY = `<!doctype html><meta charset="utf-8"><title>Header apply over a real form</title>
<div id="wrapper">
  <div id="header"><button id="decoy">Apply Now</button></div>
  <form id="application" novalidate>
    <div class="field"><label for="d-name">Full name *</label><input id="d-name" required value="Mehek Mandal"></div>
    <div class="field"><label for="d-email">Email *</label><input id="d-email" type="email" required value="mehek@example.com"></div>
    <button id="submit" type="submit">Submit</button>
  </form>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('decoy').addEventListener('click', function () { record('decoy'); });
  document.getElementById('application').addEventListener('submit', function (event) {
    event.preventDefault();
    record('real');
  });
</script>`;

/* No form, and no qualifying ancestor either: the fields and the button are direct children of
 * body, so the only container that holds both is body itself. That is not a scope. */
const BODY_ONLY = `<!doctype html><meta charset="utf-8"><title>Body scope only</title>
<label for="name">Full name *</label><input id="name" required value="Mehek Mandal">
<label for="email">Email *</label><input id="email" type="email" required value="mehek@example.com">
<button id="submit">Submit Application</button>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('submit').addEventListener('click', function () { record('body'); });
</script>`;

/* Two controls with identical text inside the same formless container. Equal top score is the
 * ambiguity rule's exact trigger, and the container scope must not weaken it. */
const AMBIGUOUS = `<!doctype html><meta charset="utf-8"><title>Ambiguous formless</title>
<div id="root"><div id="form">
  <div class="field"><label for="name">Full name *</label><input id="name" required value="Mehek Mandal"></div>
  <div class="field"><label for="resume">Resume *</label><input id="resume" type="file" required></div>
  <button id="submit-a">Submit Application</button>
  <button id="submit-b">Submit Application</button>
</div></div>
<div id="submitted"></div>
<script>${HELPERS}
  attach('resume');
  document.getElementById('submit-a').addEventListener('click', function () { record('a'); });
  document.getElementById('submit-b').addEventListener('click', function () { record('b'); });
</script>`;

/* THE UNDER-SCOPED CONTAINER. The submit sits in a final section with the consent field, and the
 * employer's work authorisation question is one level up and empty. The innermost container holds
 * a field, so it qualifies on that test alone, and binding it would scan one answered checkbox and
 * click an incomplete application. */
const NESTED = `<!doctype html><meta charset="utf-8"><title>Nested under-scope</title>
<div id="outer">
  <div class="field"><label for="work">Work authorisation *</label><input id="work" required value=""></div>
  <div id="inner">
    <div class="field"><label for="consent">I agree *</label><input id="consent" required value="Yes"></div>
    <button id="submit">Submit Application</button>
  </div>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('submit').addEventListener('click', function () { record('nested'); });
</script>`;

/* The submit lives in a footer bar that holds no fields at all, so the nearest ancestor holding a
 * field is the wrapper above both. Nothing else on the page is required, so the wrapper is the
 * application and the run may press it. */
const FOOTER_BAR = `<!doctype html><meta charset="utf-8"><title>Submit outside the field container</title>
<div id="page">
  <div id="fields">
    <div class="field"><label for="f-name">Full name *</label><input id="f-name" required value="Mehek Mandal"></div>
    <div class="field"><label for="f-email">Email *</label><input id="f-email" type="email" required value="mehek@example.com"></div>
  </div>
  <div id="footer-bar"><button id="submit">Submit Application</button></div>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('submit').addEventListener('click', function () { record('footer'); });
</script>`;

/* The same shape with page furniture that is itself required and formless. The wrapper is the only
 * ancestor of the submit that holds fields, so the furniture is inside the bound scope and the
 * scan reports it. That is not a good outcome and it is the honest one: nothing in a formless DOM
 * says whether a required field beside the application belongs to it. The rule this pins is that
 * the run withholds the click rather than sending an application it cannot account for. */
const FOOTER_BAR_FURNITURE = `<!doctype html><meta charset="utf-8"><title>Furniture inside the wrapper</title>
<div id="page">
  <div id="fields">
    <div class="field"><label for="f-name">Full name *</label><input id="f-name" required value="Mehek Mandal"></div>
  </div>
  <div id="alerts">
    <div class="field"><label for="alert-email">Job alert email *</label><input id="alert-email" required value=""></div>
  </div>
  <div id="footer-bar"><button id="submit">Submit Application</button></div>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('submit').addEventListener('click', function () { record('furniture'); });
</script>`;

/* THE BAMBOOHR SHAPE: a formless application sitting beside a real <form> that is not an
 * application at all. The newsletter's email is required, and it must not veto the application,
 * because it belongs to its own form's submission.
 *
 * Its button used to say "Subscribe", which is not a final control at all, so this case never
 * exercised the veto its own name claims: the form path found nothing here whatever the scope
 * rules did. "Submit" is the label that makes it a real boundary, and it is the label the reviewer
 * measured taking the click on a live page. */
const SIBLING_FORM = `<!doctype html><meta charset="utf-8"><title>Formless application beside a real form</title>
<div id="page">
  <form id="newsletter">
    <div class="field"><label for="alerts">Job alert email *</label><input id="alerts" type="email" required value=""></div>
    <button id="subscribe" type="submit">Submit</button>
  </form>
  <div id="app-form">
    <div class="field"><label for="b-name">Full name *</label><input id="b-name" required value="Mehek Mandal"></div>
    <div class="field"><label for="b-email">Email *</label><input id="b-email" type="email" required value="mehek@example.com"></div>
    <div class="field"><label for="b-resume">Resume *</label><input id="b-resume" type="file" required></div>
    <button id="submit">Submit Application</button>
  </div>
  <div id="search"><input id="site-search" type="search" placeholder="Search jobs"></div>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  attach('b-resume');
  document.getElementById('submit').addEventListener('click', function () { record('bamboo'); });
  document.getElementById('newsletter').addEventListener('submit', function (event) {
    event.preventDefault();
    record('subscribe');
  });
</script>`;

/* THE STRAY FORM, which is the shape that made the runner press a control belonging to something
 * else on a real employer page.
 *
 * Same Ashby application as above, and one unrelated form beside it. Its field is answered, so
 * nothing stops the click but the choice of scope. Measured in Chromium before this fix: the
 * newsletter took the click, and the application was never pressed. Two things went wrong at once
 * and both are here. The stray form's button is a viable candidate on its own, and because it is
 * viable under the form rule it also switches the container path off, so the real application
 * cannot be selected even after the stray control loses.
 *
 * The three labels are the point of the three fixtures. "Submit" and "Apply" are what the reviewer
 * measured; "Subscribe" is the benign one, and it is here so that a fix which only recognises the
 * two reported labels cannot pass. */
const strayPage = (title, stray) => `<!doctype html><meta charset="utf-8"><title>` + title + `</title>
<div id="page">
` + stray + `
  <div id="app-form">
    <div class="field"><label for="a-name">Full name *</label><input id="a-name" required value="Mehek Mandal"></div>
    <div class="field"><label for="a-email">Email *</label><input id="a-email" type="email" required value="mehek@example.com"></div>
    <div class="field"><label for="a-phone">Phone *</label><input id="a-phone" type="tel" required value="+971501234567"></div>
    <div class="field"><label for="a-resume">Resume *</label><input id="a-resume" type="file" required></div>
    <button id="submit">Submit Application</button>
  </div>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  attach('a-resume');
  document.getElementById('submit').addEventListener('click', function () { record('application'); });
  document.getElementById('stray').addEventListener('submit', function (event) {
    event.preventDefault();
    record('stray');
  });
</script>`;

const NEWSLETTER = `  <form id="stray">
    <div class="field"><label for="alerts">Job alert email *</label><input id="alerts" type="email" required value="reader@example.com"></div>
    <button id="stray-submit" type="submit">Submit</button>
  </form>`;

/* A filter is made of choices, not of intake, which is why counting selects as evidence of an
 * application would hand this one the click. The keyword box is deliberately a plain text input
 * rather than type=search, so this case does not pass on the ARIA read alone. */
const FILTER = `  <form id="stray">
    <div class="field"><label for="keyword">Keyword</label><input id="keyword" type="text" value="engineer"></div>
    <div class="field"><label for="location">Location</label><select id="location"><option selected>Dubai</option></select></div>
    <div class="field"><label for="team">Team</label><select id="team"><option selected>Engineering</option></select></div>
    <button id="stray-submit" type="submit">Apply</button>
  </form>`;

const SUBSCRIBE = `  <form id="stray">
    <div class="field"><label for="alerts">Job alert email *</label><input id="alerts" type="email" required value="reader@example.com"></div>
    <button id="stray-submit" type="submit">Subscribe</button>
  </form>`;

const STRAY_NEWSLETTER = strayPage('Application beside a newsletter form', NEWSLETTER);
const STRAY_FILTER = strayPage('Application beside a filter form', FILTER);
const STRAY_SUBSCRIBE = strayPage('Application beside a subscribe form', SUBSCRIBE);

/* THE SAME STRAY FORM WITH NO APPLICATION ANYWHERE. Its field is answered and its button says
 * "Submit", so nothing except the scope rules stands between this run and a stranger's newsletter.
 * A run that cannot find an application refuses: a refusal costs a retry, and a wrong click cannot
 * be withdrawn. */
const STRAY_ONLY = `<!doctype html><meta charset="utf-8"><title>A stray form and no application</title>
<div id="page">
  <form id="stray">
    <div class="field"><label for="alerts">Job alert email *</label><input id="alerts" type="email" required value="reader@example.com"></div>
    <button id="stray-submit" type="submit">Submit</button>
  </form>
  <div id="posting"><h1>Software Engineering Intern</h1><p>Applications open until September.</p></div>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('stray').addEventListener('submit', function (event) {
    event.preventDefault();
    record('stray');
  });
</script>`;

/* THE FALSE-POSITIVE GUARD, and the case that matters most. Modelled on the live kos.ai posting:
 * name, email, a resume file input, and nothing else. Its button says "Submit", the weakest final
 * label there is, so nothing about the control itself can rescue this form. If the test for "is
 * this the application" is tuned by field count alone, this real application is the first thing it
 * throws away. */
const MINIMAL_APPLICATION = `<!doctype html><meta charset="utf-8"><title>A three field application</title>
<form id="application" novalidate>
  <div class="field"><label for="k-name">Full name *</label><input id="k-name" required value="Mehek Mandal"></div>
  <div class="field"><label for="k-email">Email *</label><input id="k-email" type="email" required value="mehek@example.com"></div>
  <div class="field"><label for="k-resume">Resume *</label><input id="k-resume" type="file" required></div>
  <button id="submit" type="submit">Submit</button>
</form>
<div id="submitted"></div>
<script>${HELPERS}
  attach('k-resume');
  document.getElementById('application').addEventListener('submit', function (event) {
    event.preventDefault();
    record('minimal');
  });
</script>`;

/* A real Greenhouse form with the same stray newsletter beside it. Nothing about which control is
 * pressed may change here: the application already outscores the newsletter today, and it has to
 * keep winning for the reason it wins now as well as the new one. */
const GREENHOUSE_STRAY = `<!doctype html><meta charset="utf-8"><title>Greenhouse beside a newsletter form</title>
<div id="page">
  <div id="header"><h1>Software Engineering Intern</h1><button id="decoy">Apply</button></div>
  <form id="stray">
    <div class="field"><label for="alerts">Job alert email *</label><input id="alerts" type="email" required value="reader@example.com"></div>
    <button id="stray-submit" type="submit">Submit</button>
  </form>
  <form id="application" novalidate>
    <div class="field"><label for="g-name">Full name *</label><input id="g-name" required value="Mehek Mandal"></div>
    <div class="field"><label for="g-email">Email *</label><input id="g-email" type="email" required value="mehek@example.com"></div>
    <div class="field"><label for="g-resume">Resume *</label><input id="g-resume" type="file" required></div>
    <button id="submit" type="submit">Submit application</button>
  </form>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  attach('g-resume');
  document.getElementById('decoy').addEventListener('click', function () { record('decoy'); });
  document.getElementById('stray').addEventListener('submit', function (event) {
    event.preventDefault();
    record('stray');
  });
  document.getElementById('application').addEventListener('submit', function (event) {
    event.preventDefault();
    record('greenhouse');
  });
</script>`;

/* Recruitee localizes its stock final button to the exact bare label "Senden" on German tenants.
 * Captured on the live CBS Consulting application on 2026-08-21. The page-level decoy proves the
 * new label still earns nothing by itself: only the copy inside the form this run addressed may
 * bind a submission scope. */
const RECRUITEE_GERMAN = `<!doctype html><meta charset="utf-8"><title>German Recruitee application</title>
<div id="page">
  <button id="page-send" type="button">Senden</button>
  <form id="application" novalidate>
    <div class="field"><label for="salutation">Allgemeine Anrede *</label><select id="salutation" required><option>Auswählen</option><option selected>Frau</option></select></div>
    <div class="field"><label for="candidate-name">Name *</label><input id="candidate-name" name="candidate.name" required value="Mehek Mandal"></div>
    <div class="field"><label for="candidate-email">E-Mail *</label><input id="candidate-email" name="candidate.email" type="email" required value="mehek@example.com"></div>
    <div class="field"><label for="candidate-phone">Telefon *</label><input id="candidate-phone" name="candidate.phone" type="tel" required value="+491234567890"></div>
    <div class="field"><label for="candidate-cv">Lebenslauf *</label><input id="candidate-cv" name="candidate.cv" type="file" required></div>
    <div class="field"><label for="candidate-letter">Anschreiben</label><input id="candidate-letter" name="candidate.coverLetterFile" type="file"></div>
    <fieldset><legend>Bevorzugter Arbeitsort</legend><label><input type="checkbox" name="workplace"> Berlin</label><label><input type="checkbox" name="workplace"> Remote</label></fieldset>
    <button id="application-send" type="submit">Senden</button>
  </form>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  attach('candidate-cv');
  attach('candidate-letter');
  document.getElementById('page-send').addEventListener('click', function () { record('page'); });
  document.getElementById('application').addEventListener('submit', function (event) {
    event.preventDefault();
    record('recruitee');
  });
</script>`;

/* ONE FIELD, ONE BUTTON, AND NOTHING ELSE TO GO ON. Structure cannot separate this from a
 * newsletter, because there is nothing here a newsletter does not also have: one email, required,
 * and a button reading "Submit". The two cases below serve this identical page and differ only in
 * whether the run was sent to fill that field first. A run that typed into this form was filling
 * it; a run that never touched it has no reason to believe it is an application. The field is
 * answered in the markup so the required-field gate is not what decides either case. */
const ONE_FIELD_FORM = `<!doctype html><meta charset="utf-8"><title>A one field form</title>
<form id="signup" novalidate>
  <div class="field"><label for="one-email">Email *</label><input id="one-email" type="email" required value="mehek@example.com"></div>
  <button id="submit" type="submit">Submit</button>
</form>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('signup').addEventListener('submit', function (event) {
    event.preventDefault();
    record('one-field');
  });
</script>`;

/* THE OTHER HALF OF DISQUALIFYING A FORM, and the one that bites.
 *
 * Refusing a form does not only withhold the click from that form. It also removes that form from
 * the test PR 42 uses to switch the container path off, so a page whose real application form
 * cannot be confirmed suddenly lets a formless region compete, and the click lands on the region
 * rather than on the form. Main presses the application on both pages below, because on main any
 * form at all switches the container path off.
 *
 * Both shapes are ordinary. The first is a continuation page carrying only voluntary
 * self-identification questions, which is the standard second phase on Greenhouse, Lever and
 * Workday. The second is a one question screening form, which Ashby and Workable render constantly.
 * Neither holds two text-entry controls and neither holds a file input, so both fail the form test
 * on structure alone, and the sticky "Apply Now" bar beside them holds an email box, which is
 * enough for the old container walk to accept it.
 *
 * The rule these pin: a run that has refused a form does not go looking for something else to
 * press. It either finds evidence that the formless region is the application, held to the same
 * test the form was held to, or it refuses. A refusal costs a retry. */
const stickyBarPage = (title, application, decoy) => `<!doctype html><meta charset="utf-8"><title>` + title + `</title>
<div id="page">
` + application + `
` + decoy + `
</div>
<div id="submitted"></div>
<script>${HELPERS}
  if (document.getElementById('decoy-cv')) attach('decoy-cv');
  document.getElementById('decoy-apply').addEventListener('click', function () { record('decoy'); });
  document.getElementById('real').addEventListener('submit', function (event) {
    event.preventDefault();
    record('application');
  });
</script>`;

/* THE THIN DECOY: one email box. It cannot clear an intake test on any reading, which is exactly
 * why it cannot be the only decoy in this file. */
const THIN_BAR = `  <div id="decoy">
    <div class="field"><label for="decoy-email">Email me about this role</label><input id="decoy-email" type="email" value="reader@example.com"></div>
    <button id="decoy-apply">Apply Now</button>
  </div>`;

/* THE DECOYS THAT CLEAR THE BAR, which is the version of the adversary that can actually win.
 *
 * A fixed intake bar is not enough on its own: a formless widget that collects a name and an email,
 * or an email and a CV upload, satisfies exactly the test the refused form failed, and React pages
 * render widgets like these with no <form> element at all, for the same reason Ashby renders none.
 * "Refer a friend", "Talk to a recruiter", "Get job alerts" and "Join our talent pool" are all this
 * shape, and all of them wear a final-intent label sooner or later.
 *
 * Paired with the refused application shapes below, both of these took the click before the gate
 * became a comparison rather than a threshold. */
const RECRUITER_WIDGET = `  <div id="decoy">
    <h2>Talk to a recruiter</h2>
    <div class="field"><label for="decoy-name">Your name</label><input id="decoy-name" value="Mehek Mandal"></div>
    <div class="field"><label for="decoy-email">Your email</label><input id="decoy-email" type="email" value="reader@example.com"></div>
    <button id="decoy-apply">Apply Now</button>
  </div>`;

const TALENT_POOL_WIDGET = `  <div id="decoy">
    <h2>Join our talent pool</h2>
    <div class="field"><label for="decoy-email">Your email</label><input id="decoy-email" type="email" value="reader@example.com"></div>
    <div class="field"><label for="decoy-cv">Attach a CV</label><input id="decoy-cv" type="file"></div>
    <button id="decoy-apply">Apply Now</button>
  </div>`;

const EEO_FORM = `  <form id="real" novalidate>
    <div class="field"><label for="race">Race *</label><select id="race" required><option value="Decline">Decline to self identify</option><option value="Asian" selected>Asian</option></select></div>
    <div class="field"><label for="gender">Gender *</label><select id="gender" required><option selected>Female</option></select></div>
    <div class="field"><label for="veteran">Veteran status *</label><select id="veteran" required><option selected>I am not a protected veteran</option></select></div>
    <button id="submit" type="submit">Submit</button>
  </form>`;

const SCREENING_FORM = `  <form id="real" novalidate>
    <div class="field"><label for="years">How many years of Python have you written? *</label><input id="years" required value="3"></div>
    <button id="submit" type="submit">Submit</button>
  </form>`;

const EEO_STICKY_BAR = stickyBarPage('Self identification page under a sticky bar', EEO_FORM, THIN_BAR);
const SCREENING_STICKY_BAR = stickyBarPage('One question screening under a sticky bar', SCREENING_FORM, THIN_BAR);
const EEO_RICH_DECOY = stickyBarPage('Self identification page beside a recruiter widget', EEO_FORM, RECRUITER_WIDGET);
const SCREENING_RICH_DECOY = stickyBarPage('Screening question beside a talent pool widget', SCREENING_FORM, TALENT_POOL_WIDGET);

/* An empty required field inside the container, and an unrelated block outside it carrying a live
 * validation error over a field that is not required. Only the first belongs to this application. */
const SCAN_BOUNDS = `<!doctype html><meta charset="utf-8"><title>Container scope bounds</title>
<div id="page">
  <div id="app-form">
    <div class="field"><label for="s-name">Full name *</label><input id="s-name" required value=""></div>
    <button id="submit">Submit Application</button>
  </div>
  <div id="aside">
    <div class="field"><label for="aside-note">Newsletter</label><input id="aside-note" aria-invalid="true" value="x"><span>This requires an answer</span></div>
  </div>
</div>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('submit').addEventListener('click', function () { record('scan-bounds'); });
</script>`;

/* THE RETAINED PAGE, TWICE. Phase zero binds a scope inside a shadow root. Phase one runs on the
 * same live Page after the DOM has moved on, and the candidate index that addressed the shadow
 * scope now addresses a light-DOM one. A marker left behind inside the shadow tree makes that
 * index match two nodes and throws for the rest of the session. */
const SHADOW = `<!doctype html><meta charset="utf-8"><title>Shadow scope across two passes</title>
<div id="host"></div>
<div id="light">
  <div class="field"><label for="l-name">Full name *</label><input id="l-name" required value="Mehek Mandal"></div>
  <button id="l-submit">Continue</button>
</div>
<button id="mutate">Refresh listing</button>
<div id="submitted"></div>
<script>${HELPERS}
  var root = document.getElementById('host').attachShadow({ mode: 'open' });
  root.innerHTML = '<div id="s-form"><div class="field"><label for="s-name">Full name *</label>'
    + '<input id="s-name" required value="Mehek Mandal"></div>'
    + '<button id="s-submit">Submit Application</button></div>';
  root.getElementById('s-submit').addEventListener('click', function () { record('shadow'); });
  document.getElementById('l-submit').addEventListener('click', function () { record('light'); });
  document.getElementById('mutate').addEventListener('click', function () {
    var shadowSubmit = root.getElementById('s-submit');
    if (shadowSubmit) shadowSubmit.remove();
    document.getElementById('l-submit').textContent = 'Submit Application';
  });
</script>`;

const WORKABLE_BARE_SEND = `<!doctype html><meta charset="utf-8"><title>Workable application</title>
<form id="application" action="/jobs/application" novalidate>
  <div class="field"><label for="first-name">First name *</label><input id="first-name" name="first_name" required></div>
  <div class="field"><label for="last-name">Last name *</label><input id="last-name" name="last_name" required></div>
  <div class="field"><label for="email">Email *</label><input id="email" name="email" type="email" required></div>
  <div class="field"><label for="resume">Resume *</label><input id="resume" name="resume" type="file" required></div>
  <button id="send" type="submit">Send</button>
</form>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('application').addEventListener('submit', function (event) {
    event.preventDefault();
    record('workable');
    document.getElementById('submitted').textContent = 'Thank you for applying';
  });
</script>`;

const CONTACT_BARE_SEND = `<!doctype html><meta charset="utf-8"><title>Contact form</title>
<form id="contact" action="/contact" novalidate>
  <label for="contact-email">Email</label><input id="contact-email" type="email">
  <label for="message">Message</label><textarea id="message"></textarea>
  <button id="send" type="submit">Send</button>
</form>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('contact').addEventListener('submit', function (event) {
    event.preventDefault();
    record('contact');
  });
</script>`;

const CANDIDATE_SUPPORT_BARE_SEND = `<!doctype html><meta charset="utf-8"><title>Candidate support</title>
<form id="candidate_contact" action="/candidate/support" novalidate>
  <label for="support-email">Email</label><input id="support-email" type="email">
  <label for="support-message">Message</label><textarea id="support-message"></textarea>
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('candidate_contact').addEventListener('submit', function (event) {
    event.preventDefault(); record('candidate-support');
  });
</script>`;

const APPLICATION_FEEDBACK_BARE_SEND = `<!doctype html><meta charset="utf-8"><title>Application feedback</title>
<form id="application_feedback" action="/application/feedback" novalidate>
  <label for="feedback-email">Email</label><input id="feedback-email" type="email">
  <label for="feedback-message">Feedback</label><textarea id="feedback-message"></textarea>
  <label for="feedback-resume">Resume</label><input id="feedback-resume" name="resume" type="file">
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('application_feedback').addEventListener('submit', function (event) {
    event.preventDefault(); record('application-feedback');
  });
</script>`;

const APPLICATION_SUPPORT_BARE_SEND = `<!doctype html><meta charset="utf-8"><title>Application support</title>
<form id="application_support" action="/application/support" novalidate>
  <label for="application-support-email">Email</label><input id="application-support-email" type="email">
  <label for="application-support-resume">Resume</label><input id="application-support-resume" name="resume" type="file">
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('application_support').addEventListener('submit', function (event) {
    event.preventDefault(); record('application-support');
  });
</script>`;

const applicationIdentityDecoyPage = (kind) => `<!doctype html><meta charset="utf-8"><title>Application ` + kind + `</title>
<form id="application_` + kind + `" action="/application/` + kind + `" novalidate>
  <label for="` + kind + `-email">Email</label><input id="` + kind + `-email" type="email">
  <label for="` + kind + `-resume">Resume</label><input id="` + kind + `-resume" name="resume" type="file">
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('application_` + kind + `').addEventListener('submit', function (event) {
    event.preventDefault(); record('application-` + kind + `');
  });
</script>`;

const FILL_BY_PHONE_FORMAT = `<!doctype html><meta charset="utf-8"><title>Application phone formatting</title>
<form id="application_form" novalidate>
  <div><label for="formatted-phone">Phone</label><input id="formatted-phone" name="phone" type="tel"></div>
  <label for="phone-resume">Resume</label><input id="phone-resume" name="candidate_resume" type="file">
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('formatted-phone').addEventListener('input', function (event) {
    if (event.currentTarget.value === '2135746270') event.currentTarget.value = '(213) 574-6270';
  });
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('formatted-phone');
  });
</script>`;

const FILL_BY_SELECT_LABEL = `<!doctype html><meta charset="utf-8"><title>Application select label</title>
<form id="application_form" novalidate>
  <div><label for="department">Department</label><select id="department">
    <option value="">Choose</option><option value="eng" label="Engineering">Engineering department</option>
  </select></div>
  <label for="select-resume">Resume</label><input id="select-resume" name="candidate_resume" type="file">
  <button id="send" type="submit">Send</button>
</form><button id="mutate-select-label" type="button">Mutate label</button><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('mutate-select-label').addEventListener('click', function () {
    document.querySelector('#department option[value="eng"]').label = 'Different department';
  });
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('select-label');
  });
</script>`;

const FILL_BY_SELECT_PUNCTUATION = `<!doctype html><meta charset="utf-8"><title>Application select punctuation</title>
<form id="application_form" novalidate>
  <div><label for="experience-band">Experience</label><select id="experience-band">
    <option value="">Choose</option><option value="10+">10+</option>
  </select></div>
  <label for="punctuation-resume">Resume</label><input id="punctuation-resume" name="candidate_resume" type="file">
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('select-punctuation');
  });
</script>`;

const FILL_BY_DATE_NORMALIZATION = `<!doctype html><meta charset="utf-8"><title>Application date normalization</title>
<form id="application_form" novalidate>
  <div><label for="graduation-date">Graduation date</label><input id="graduation-date" name="graduation_date" type="date"></div>
  <label for="date-resume">Resume</label><input id="date-resume" name="candidate_resume" type="file">
  <button id="send" type="submit">Send</button>
</form><button id="mutate-date" type="button">Mutate date</button><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('mutate-date').addEventListener('click', function () {
    document.getElementById('graduation-date').value = '2028-06-01';
  });
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('date-normalization');
  });
</script>`;

const WORKABLE_ROLE_SEND = WORKABLE_BARE_SEND
  .replace('<button id="send" type="submit">Send</button>', '<div id="send" role="button" tabindex="0">Send</div>')
  .replace("document.getElementById('application').addEventListener('submit'", "document.getElementById('send').addEventListener('click'");

const WORKABLE_EXPLICIT_ROLE = WORKABLE_BARE_SEND
  .replace('<button id="send" type="submit">Send</button>', '<div id="send" role="button" tabindex="0">Submit application</div>')
  .replace("document.getElementById('application').addEventListener('submit'", "document.getElementById('send').addEventListener('click'")
  .replace("record('workable');", "record('explicit-role');");

const WORKABLE_FORM_ACTION_OVERRIDE = WORKABLE_BARE_SEND
  .replace('<button id="send" type="submit">Send</button>', '<button id="send" type="submit" formaction="/contact">Send</button>');

const WORKABLE_EXPLICIT_OVERRIDE = WORKABLE_BARE_SEND
  .replace(
    '<button id="send" type="submit">Send</button>',
    '<button id="send" type="submit" formaction="/jobs/alternate" formmethod="post" formnovalidate>Submit application</button>'
  );

const WORKABLE_FORM_TARGET = WORKABLE_BARE_SEND
  .replace('<form id="application" action="/jobs/application" novalidate>', '<form id="application" action="/jobs/application" target="_blank" novalidate>');

const WORKABLE_BASE_TARGET = WORKABLE_BARE_SEND
  .replace('<title>Workable application</title>', '<base target="_blank"><title>Workable application</title>');

const WORKABLE_ASSOCIATION_DECOY = WORKABLE_BARE_SEND
  .replace(
    '<form id="application" action="/jobs/application" novalidate>',
    '<form id="support" action="/support" novalidate></form><form id="application" action="/jobs/application" novalidate>'
  )
  .replace('<button id="send" type="submit">Send</button>', '<button id="send" type="submit" form="support">Send</button>')
  .replace('</script>', `
  document.getElementById('support').addEventListener('submit', function (event) {
    event.preventDefault(); record('association-decoy');
  });
</script>`);

const WORKABLE_CONTROL_STATE_DRIFT = WORKABLE_BARE_SEND
  .replace('</form>', '</form><button id="mutate-control-state" type="button">Mutate controls</button>')
  .replace('</script>', `
  document.getElementById('mutate-control-state').addEventListener('click', function () {
    document.getElementById('email').readOnly = true;
    document.getElementById('resume').disabled = true;
  });
</script>`);

const WORKABLE_AMBIGUOUS_SEND = WORKABLE_BARE_SEND
  .replace('<button id="send" type="submit">Send</button>', '<button id="send-a" type="submit">Send</button><button id="send-b" type="submit">Send</button>');

const WORKABLE_EXPLICIT_WINS = WORKABLE_BARE_SEND
  .replace('<button id="send" type="submit">Send</button>', '<button id="send" type="submit">Send</button><button id="explicit" type="button">Send application</button>')
  .replace("document.getElementById('application').addEventListener('submit', function (event) {", "document.getElementById('explicit').addEventListener('click', function (event) {")
  .replace("record('workable');", "record('explicit');");

const WORKABLE_FORM_DRIFT = WORKABLE_BARE_SEND
  .replace('</form>', '</form><button id="rerender" type="button">Refresh form</button>')
  .replace('</script>', `
  document.getElementById('rerender').addEventListener('click', function () {
    var current = document.getElementById('application');
    var replacement = current.cloneNode(true);
    replacement.addEventListener('submit', function (event) {
      event.preventDefault();
      record('drifted-workable');
    });
    current.replaceWith(replacement);
  });
</script>`);

const WORKABLE_PROOF_LOSS_EXPLICIT_DECOY = `<!doctype html><meta charset="utf-8"><title>Bound application proof loss</title>
<form id="decoy" action="/newsletter" novalidate>
  <input name="email" value="news@example.com">
  <button id="decoy-submit" type="submit">Submit application</button>
</form>
<form id="application" action="/jobs/application" novalidate>
  <label for="first-name">First name *</label><input id="first-name" name="first_name" required>
  <label for="last-name">Last name *</label><input id="last-name" name="last_name" required>
  <label for="email">Email *</label><input id="email" name="email" type="email" required>
  <label for="resume">Resume *</label><input id="resume" name="resume" type="file" required>
  <button id="send" type="submit">Send</button>
</form>
<button id="drop-proofs" type="button">Refresh application</button><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('decoy').addEventListener('submit', function (event) {
    event.preventDefault(); record('explicit-decoy');
  });
  document.getElementById('application').addEventListener('submit', function (event) {
    event.preventDefault(); record('original-application');
  });
  document.getElementById('drop-proofs').addEventListener('click', function () {
    var current = document.getElementById('application');
    var replacement = current.cloneNode(true);
    replacement.addEventListener('submit', function (event) {
      event.preventDefault(); record('replacement-application');
    });
    current.replaceWith(replacement);
  });
</script>`;

const activationDriftPage = (mode) => `<!doctype html><meta charset="utf-8"><title>Activation drift</title>
<form id="application" method="post" action="/record-click?who=activation-native" novalidate>
  <label for="first-name">First name</label><input id="first-name" name="first_name">
  <label for="last-name">Last name</label><input id="last-name" name="last_name">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <label for="resume">Resume</label><input id="resume" name="resume" type="file">
  <input id="activation-job-id" name="job_id" type="hidden" value="A">
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  var activationSend = document.getElementById('send');
  if (` + JSON.stringify(mode) + ` === 'pointer') {
    activationSend.addEventListener('pointerdown', function () {
      document.getElementById('activation-job-id').value = 'B';
    });
    activationSend.addEventListener('click', function () { record('pointer-direct-transmit'); });
  } else {
    activationSend.addEventListener('click', function () {
      document.getElementById('activation-job-id').value = 'B';
      record('click-direct-transmit');
    });
  }
  document.getElementById('application').addEventListener('submit', function (event) {
    event.preventDefault(); record('activation-submit-transmit');
  });
</script>`;

const PRE_CHOOSER_AUTO_SUBMIT = `<!doctype html><meta charset="utf-8"><title>Pre-chooser transport containment</title>
<form id="application" method="post" action="/record-click?who=prechooser-native" novalidate>
  <label for="first-name">First name</label><input id="first-name" name="first_name">
  <label for="last-name">Last name</label><input id="last-name" name="last_name">
  <label for="email">Email</label><input id="email" name="email" type="email">
  <label for="resume">Resume</label><input id="resume" name="resume" type="file">
  <label for="prechooser-select">Location</label><select id="prechooser-select" name="location">
    <option value="">Choose</option><option value="Dubai">Dubai</option>
  </select>
  <button id="send-a" type="submit">Send</button><button id="send-b" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  var prechooserForm = document.getElementById('application');
  document.getElementById('email').addEventListener('input', function () {
    fetch('/record-click?who=prechooser-fill-fetch', { method: 'POST', body: 'field=email' }).catch(function () {});
    fetch('/record-click?who=prechooser-fill-get&email=' + encodeURIComponent(this.value)).catch(function () {});
    var image = new Image();
    image.src = '/record-click?who=prechooser-fill-image&email=' + encodeURIComponent(this.value);
    try { new EventSource('/record-click?who=prechooser-fill-eventsource&email=' + encodeURIComponent(this.value)); } catch (error) {}
    try { new WebSocket('ws://' + location.host + '/record-click?who=prechooser-fill-websocket'); } catch (error) {}
    try { new WebTransport('https://' + location.host + '/record-click?who=prechooser-fill-webtransport'); } catch (error) {}
    prechooserForm.requestSubmit(document.getElementById('send-a'));
  });
  document.getElementById('resume').addEventListener('change', function () {
    var request = new XMLHttpRequest();
    request.open('POST', '/record-click?who=prechooser-upload-xhr');
    request.send('field=resume');
  });
  document.getElementById('prechooser-select').addEventListener('change', function () {
    navigator.sendBeacon('/record-click?who=prechooser-select-beacon', 'field=location');
  });
  prechooserForm.addEventListener('submit', function (event) {
    event.preventDefault(); record('prechooser-submit-handler');
  });
</script>`;

const CROSS_FORM_OPTIN_DECOY = `<!doctype html><meta charset="utf-8"><title>Cross form opt-in decoy</title>
<form id="application_form" action="/native-real" method="post" novalidate>
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit" disabled>Send</button>
</form>
<form id="newsletter">
  <label><input id="newsletter-yes" type="radio" name="sms_opt_in" value="true">Yes</label>
  <label><input id="newsletter-no" type="radio" name="sms_opt_in" value="false">No</label>
</form><div id="submitted">cross form opt-in fixture</div>
<script>${HELPERS}
  document.getElementById('newsletter-no').addEventListener('change', function () { record('newsletter-decline'); });
</script>`;

const ACTION_BOUNDARY_DRIFT = `<!doctype html><meta charset="utf-8"><title>Applicant action binding drift</title>
<form id="application_form" action="/native-real" method="post" novalidate>
  <label for="boundary-email">Email</label><input id="boundary-email" name="email" type="email">
  <label for="boundary-resume">Resume</label><input id="boundary-resume" name="resume" type="file">
  <button id="send" type="submit">Send</button>
</form><div id="submitted">action boundary fixture</div>
<button id="arm-boundary" type="button">Arm boundary drift</button>
<script>
  var boundaryForm = document.getElementById('application_form');
  var nativeGetAttribute = boundaryForm.getAttribute;
  var boundaryArmed = false;
  var boundaryRead = false;
  document.getElementById('arm-boundary').addEventListener('click', function () {
    boundaryArmed = true;
  });
  boundaryForm.getAttribute = function (name) {
    var value = nativeGetAttribute.call(boundaryForm, name);
    if (name === 'action' && boundaryArmed && !boundaryRead) {
        boundaryRead = true;
        queueMicrotask(function () { boundaryForm.setAttribute('action', '/native-decoy'); });
    }
    return value;
  };
</script>`;

const JOB_ALERT_BARE_SEND = `<!doctype html><meta charset="utf-8"><title>Job alerts</title>
<form id="job-alert" action="/jobs/alerts" novalidate>
  <label for="alert-email">Email</label><input id="alert-email" type="email">
  <label for="keywords">Keywords</label><input id="keywords">
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('job-alert').addEventListener('submit', function (event) {
    event.preventDefault(); record('job-alert');
  });
</script>`;

const TALENT_POOL_BARE_SEND = `<!doctype html><meta charset="utf-8"><title>Talent network</title>
<form id="talent-network" action="/talent/network" novalidate>
  <label for="talent-name">Name</label><input id="talent-name">
  <label for="talent-email">Email</label><input id="talent-email" type="email">
  <label for="talent-resume">Resume</label><input id="talent-resume" name="resume_file" type="file">
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('talent-network').addEventListener('submit', function (event) {
    event.preventDefault(); record('talent-pool');
  });
</script>`;

const MINIMAL_FILE_DRIFT = `<!doctype html><meta charset="utf-8"><title>Application file drift</title>
<form id="application_form" novalidate>
  <label for="drift-email">Email</label><input id="drift-email" type="email">
  <label for="drift-resume">Resume</label><input id="drift-resume" name="candidate_resume" type="file">
  <button id="send" type="submit">Send</button>
</form><button id="mutate" type="button">Mutate</button><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('file-drift');
  });
  document.getElementById('mutate').addEventListener('click', function () {
    var input = document.getElementById('drift-resume');
    var original = input.files[0];
    var transfer = new DataTransfer();
    transfer.items.add(new File(['xxxxxx'], original.name, { type: original.type, lastModified: original.lastModified }));
    input.files = transfer.files;
  });
</script>`;

const CHOICE_DRIFT = `<!doctype html><meta charset="utf-8"><title>Application choice drift</title>
<form id="candidate_application" novalidate>
  <label for="choice-email">Email</label><input id="choice-email" type="email">
  <label for="choice-name">Name</label><input id="choice-name">
  <label for="choice-resume">Resume</label><input id="choice-resume" name="candidate_resume" type="file">
  <label for="choice-blocker">Required blocker *</label><input id="choice-blocker" required>
  <fieldset><legend>Authorized to work?</legend>
    <label id="yes-label"><input id="yes" name="authorization" type="radio" value="Yes">Yes</label>
    <label><input id="no" name="authorization" type="radio" value="No">No</label>
  </fieldset>
  <button id="send" type="submit">Send</button>
</form><button id="mutate" type="button">Mutate</button><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('candidate_application').addEventListener('submit', function (event) {
    event.preventDefault(); record('choice-drift');
  });
  document.getElementById('mutate').addEventListener('click', function () {
    document.getElementById('yes').value = 'Maybe';
    document.getElementById('yes-label').lastChild.data = 'Maybe';
  });
</script>`;

const REPARENT_DRIFT = `<!doctype html><meta charset="utf-8"><title>Application reparent drift</title>
<form id="application_source" novalidate>
  <div id="proof-fields">
    <label for="move-email">Email</label><input id="move-email" type="email">
    <label for="move-resume">Resume</label><input id="move-resume" name="resume_file" type="file">
  </div>
  <button id="source-send" type="submit">Send</button>
</form>
<form id="candidate_application" novalidate><button id="target-send" type="submit">Send</button></form>
<button id="mutate" type="button">Mutate</button><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('application_source').addEventListener('submit', function (event) {
    event.preventDefault(); record('source');
  });
  document.getElementById('candidate_application').addEventListener('submit', function (event) {
    event.preventDefault(); record('target');
  });
  document.getElementById('mutate').addEventListener('click', function () {
    document.getElementById('candidate_application').prepend(document.getElementById('proof-fields'));
  });
</script>`;

const confirmationDriftPage = (mode) => `<!doctype html><meta charset="utf-8"><title>Application confirmation drift</title>
<form id="application_form" novalidate>
  <label for="confirm-email">Email *</label><input id="confirm-email" type="email" required aria-invalid="true">
  <label for="confirm-resume">Resume</label><input id="confirm-resume" name="candidate_resume" type="file">
  ` + (mode === 'hidden' ? '<input id="job-id" type="hidden" name="job_id" value="csrf-low-entropy-secret">' : '') + `
  ` + (mode === 'consent' ? '<label><input id="optional-consent" type="checkbox" name="optional_consent" value="yes"> Optional consent</label>' : '') + `
  <button id="send" type="submit"` + (mode === 'value' ? ' name="action" value="apply"' : '') + `>Send</button>
  ` + (mode === 'sibling' ? '<button id="sibling" type="submit">Cancel</button>' : '') + `
</form>` + (mode === 'external-hidden'
  ? '<input id="external-job-id" type="hidden" form="application_form" name="job_id" value="external-job-secret">'
  : '') + `<button id="arm" type="button">Arm update</button><div id="submitted"></div>
<script>${HELPERS}
  var armed = false;
  document.getElementById('arm').addEventListener('click', function () { armed = true; });
  document.getElementById('confirm-email').addEventListener('input', function () {
    if (!armed) return;
    armed = false;
    if (document.getElementById('sibling')) {
      document.getElementById('sibling').textContent = 'Send';
    } else if (` + JSON.stringify(mode) + ` === 'value') {
      document.getElementById('send').value = 'withdraw';
    } else if (` + JSON.stringify(mode) + ` === 'class') {
      document.getElementById('application_form').classList.add('validated');
    } else if (` + JSON.stringify(mode) + ` === 'hidden') {
      document.getElementById('job-id').value = 'csrf-low-entropy-changed';
    } else if (` + JSON.stringify(mode) + ` === 'external-hidden') {
      document.getElementById('external-job-id').value = 'external-job-changed';
    } else if (` + JSON.stringify(mode) + ` === 'consent') {
      document.getElementById('optional-consent').checked = true;
    } else {
      var transfer = new DataTransfer();
      transfer.items.add(new File(['changed'], 'changed.pdf', { type: 'application/pdf', lastModified: 2 }));
      document.getElementById('confirm-resume').files = transfer.files;
    }
  });
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('confirmation-drift');
  });
</script>`;

const OVER_BOUND_SUBMITTED_STATE = `<!doctype html><meta charset="utf-8"><title>Over-bound application state</title>
<form id="application_form" novalidate>
  <label for="bound-email">Email *</label><input id="bound-email" type="email" required aria-invalid="true">
  <label for="bound-resume">Resume</label><input id="bound-resume" name="candidate_resume" type="file">
  ${Array.from({ length: 257 }, (_, index) => '<input type="hidden" name="state_' + index + '" value="A">').join('')}
  <button id="send" type="submit">Send</button>
</form><button id="arm-bound" type="button">Arm update</button><div id="submitted"></div>
<script>${HELPERS}
  var boundArmed = false;
  document.getElementById('arm-bound').addEventListener('click', function () { boundArmed = true; });
  document.getElementById('bound-email').addEventListener('input', function () {
    if (!boundArmed) return;
    boundArmed = false;
    document.querySelector('input[name="state_256"]').value = 'B';
  });
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('over-bound');
  });
</script>`;

const FORGED_SUCCESS_MARKERS = `<!doctype html><meta charset="utf-8"><title>Forged proof markers</title>
<form id="application_form" novalidate>
  <label for="forged-email">Email</label><input id="forged-email" type="email" value="attacker@example.com" data-litos-successful-address-v1="forged">
  <label for="forged-resume">Resume</label><input id="forged-resume" name="candidate_resume" type="file" data-litos-successful-address-v1="forged">
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  attach('forged-resume');
  var forged = [document.getElementById('forged-email'), document.getElementById('forged-resume')];
  new MutationObserver(function () {
    forged.forEach(function (control) {
      if (!control.hasAttribute('data-litos-successful-address-v1')) {
        control.setAttribute('data-litos-successful-address-v1', 'forged');
      }
    });
  }).observe(document.getElementById('application_form'), { subtree: true, attributes: true });
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('forged-proof');
  });
</script>`;

const WORKABLE_EXTERNAL_SUBMIT = WORKABLE_BARE_SEND
  .replace('<form id="application"', '<form id="newsletter"><input name="name" value="News"><input name="email" value="news@example.com"><button id="newsletter-submit" type="submit">Submit</button></form><form id="application"')
  .replace('</script>', `
  document.getElementById('newsletter').addEventListener('submit', function (event) {
    event.preventDefault(); record('newsletter-submit');
  });
</script>`);

const WORKABLE_DISABLED_WITH_EXTERNAL_SUBMIT = WORKABLE_EXTERNAL_SUBMIT
  .replace('<button id="send" type="submit">Send</button>', '<button id="send" type="submit" disabled>Send</button>');

const WORKABLE_EXPLICIT_ASSOCIATED_DECOY = WORKABLE_BARE_SEND
  .replace(
    '<form id="application" action="/jobs/application" novalidate>',
    '<form id="support" action="/support" novalidate></form><form id="application" action="/jobs/application" novalidate>'
  )
  .replace('<button id="send" type="submit">Send</button>', '<button id="wrong-explicit" type="submit" form="support">Submit application</button><button id="send" type="submit">Send</button>')
  .replace('</script>', `
  document.getElementById('support').addEventListener('submit', function (event) {
    event.preventDefault(); record('explicit-associated-decoy');
  });
</script>`);

const DIRECT_MARKER_REDIRECT = `<!doctype html><meta charset="utf-8"><title>Direct submit handles</title>
<form id="decoy-form"><input name="message" value="decoy"><button id="decoy-submit" type="submit">Cancel</button></form>
<form id="application_form" novalidate>
  <label for="direct-email">Email</label><input id="direct-email" type="email" value="applicant@example.com">
  <label for="direct-resume">Resume</label><input id="direct-resume" name="candidate_resume" type="file">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  attach('direct-resume');
  var moving = false;
  new MutationObserver(function (mutations) {
    if (moving) return;
    moving = true;
    mutations.forEach(function (mutation) {
      var attribute = mutation.attributeName;
      var value = mutation.target.getAttribute(attribute);
      if (!value) return;
      if (attribute === 'data-litos-submit-candidate-v2' && mutation.target.id === 'send') {
        mutation.target.removeAttribute(attribute);
        document.getElementById('decoy-submit').setAttribute(attribute, value);
      }
      if (attribute === 'data-litos-submit-scope-v2' && mutation.target.id === 'application_form') {
        mutation.target.removeAttribute(attribute);
        document.getElementById('decoy-form').setAttribute(attribute, value);
      }
    });
    moving = false;
  }).observe(document.documentElement, {
    subtree: true,
    attributes: true,
    attributeFilter: ['data-litos-submit-candidate-v2', 'data-litos-submit-scope-v2']
  });
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('direct-real');
  });
  document.getElementById('decoy-form').addEventListener('submit', function (event) {
    event.preventDefault(); record('direct-decoy');
  });
</script>`;

const FORMLESS_STATE_DRIFT = `<!doctype html><meta charset="utf-8"><title>Formless state drift</title>
<div id="form">
  <input id="container-job-id" type="hidden" name="job_id" value="A">
  <label for="container-email">Email *</label><input id="container-email" type="email" required aria-invalid="true">
  <label for="container-resume">Resume</label><input id="container-resume" name="candidate_resume" type="file">
  <button id="send" type="button">Submit application</button>
</div><button id="arm-container" type="button">Arm</button><div id="submitted"></div>
<script>${HELPERS}
  var containerArmed = false;
  document.getElementById('arm-container').addEventListener('click', function () { containerArmed = true; });
  document.getElementById('container-email').addEventListener('input', function () {
    if (!containerArmed) return;
    containerArmed = false;
    document.getElementById('container-job-id').value = 'B';
  });
  document.getElementById('send').addEventListener('click', function () { record('formless-state'); });
</script>`;

const EXTERNAL_ASSOCIATED_BARE_SEND = `<!doctype html><meta charset="utf-8"><title>External associated application</title>
<form id="application_form" action="/jobs/application" novalidate><button id="send" type="submit">Send</button></form>
<label for="external-email">Email</label><input id="external-email" form="application_form" type="email">
<label for="external-resume">Resume</label><input id="external-resume" form="application_form" name="candidate_resume" type="file">
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('external-associated');
  });
</script>`;

const PRE_CHOOSER_BASE_DRIFT = `<!doctype html><meta charset="utf-8"><base id="proof-base" href="/initial/"><title>Proof base drift</title>
<form id="application_form" action="jobs/application" method="post" novalidate>
  <label for="proof-email">Email</label><input id="proof-email" type="email">
  <label for="proof-resume">Resume</label><input id="proof-resume" name="candidate_resume" type="file">
  <button id="send" type="submit">Send</button>
</form><button id="mutate-proof" type="button">Mutate</button><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('mutate-proof').addEventListener('click', function () {
    document.getElementById('proof-base').href = '/changed/';
  });
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('pre-base-drift');
  });
</script>`;

const PRE_CHOOSER_METHOD_DRIFT = PRE_CHOOSER_BASE_DRIFT
  .replace("document.getElementById('proof-base').href = '/changed/';", "document.getElementById('application_form').method = 'get';")
  .replace("record('pre-base-drift');", "record('pre-method-drift');");

const SELECTOR_ID_TRANSFER = `<!doctype html><meta charset="utf-8"><title>Selector identity transfer</title>
<form id="application_source"><label for="transfer-email">Applicant email</label><input id="transfer-email" type="email"></form>
<form id="contact_decoy"><input id="decoy-email" type="email" value="decoy@example.com"><button id="decoy-submit" type="submit">Submit</button></form>
<button id="transfer-id" type="button">Transfer id</button><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('transfer-id').addEventListener('click', function () {
    document.getElementById('transfer-email').id = 'former-transfer-email';
    document.getElementById('decoy-email').id = 'transfer-email';
  });
  document.getElementById('contact_decoy').addEventListener('submit', function (event) {
    event.preventDefault(); record('selector-decoy');
  });
</script>`;

const failedChoicePage = (replaceFailedControl) => `<!doctype html><meta charset="utf-8"><title>Failed choice authority</title>
<form id="application_form" novalidate>
  <label for="failed-email">Email</label><input id="failed-email" type="email">
  <label for="failed-resume">Resume</label><input id="failed-resume" name="candidate_resume" type="file">
  <div id="authorization-question" class="field select__container">
    <label for="authorization">Work authorization</label>
    <div class="select__control"><div id="authorization-value" class="select__single-value" style="display:none"></div>
      <input id="authorization" role="combobox" aria-haspopup="listbox" aria-controls="authorization-options"></div>
  </div>
  <div id="authorization-options" role="listbox" style="display:none">
    <div id="wrong-authorization" role="option">Yes, definitely</div>
  </div>
  <button id="send" type="submit">Send</button>
</form><button id="replace-failed" type="button">Replace failed choice</button><div id="submitted"></div>
<script>${HELPERS}
  var question = document.getElementById('authorization-question');
  new MutationObserver(function () {
    if (question.hasAttribute('data-litos-unverified-choice')) {
      question.removeAttribute('data-litos-unverified-choice');
      if (` + JSON.stringify(replaceFailedControl) + `) {
        var replacement = question.cloneNode(true);
        replacement.querySelector('#authorization-value').style.display = '';
        replacement.querySelector('#authorization-value').textContent = 'No';
        question.replaceWith(replacement);
        question = replacement;
      }
    }
  }).observe(question, { attributes: true, attributeFilter: ['data-litos-unverified-choice'] });
  document.getElementById('authorization').addEventListener('click', function () {
    document.getElementById('authorization-options').style.display = '';
    this.setAttribute('aria-expanded', 'true');
  });
  document.getElementById('wrong-authorization').addEventListener('click', function () {
    var value = document.getElementById('authorization-value');
    value.style.display = '';
    value.textContent = 'No';
    document.getElementById('authorization-options').style.display = 'none';
    document.getElementById('authorization').setAttribute('aria-expanded', 'false');
  });
  document.getElementById('replace-failed').addEventListener('click', function () {
    if (!` + JSON.stringify(replaceFailedControl) + `) return;
    var current = document.getElementById('authorization-question');
    var replacement = current.cloneNode(true);
    replacement.querySelector('#authorization-value').style.display = '';
    replacement.querySelector('#authorization-value').textContent = 'No';
    current.replaceWith(replacement);
    question = replacement;
  });
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('failed-choice');
  });
</script>`;

const EXTERNAL_REQUIRED_CONTROL = `<!doctype html><meta charset="utf-8"><title>External required control</title>
<form id="application_form" action="/jobs/application" novalidate>
  <label for="external-required-email">Email</label><input id="external-required-email" type="email">
  <label for="external-required-resume">Resume</label><input id="external-required-resume" name="candidate_resume" type="file">
  <button id="send" type="submit">Send</button>
</form>
<label for="external-required-answer">Employer question *</label>
<input id="external-required-answer" form="application_form" name="employer_answer" required>
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('external-required');
  });
</script>`;

const WHOLE_FORM_FAILED_CHOICE = `<!doctype html><meta charset="utf-8"><title>Whole form failed choice</title>
<div id="form-host"><form id="application_form" novalidate>
  <div id="whole-question" class="field select__container">
    <label for="whole-choice">Work authorization</label>
    <div class="select__control"><div id="whole-value" class="select__single-value" style="display:none"></div>
      <input id="whole-choice" role="combobox" aria-haspopup="listbox" aria-controls="whole-options"></div>
  </div>
  <div id="whole-options" role="listbox" style="display:none">
    <div id="whole-wrong" role="option">Yes, definitely</div>
  </div>
  <button id="send" type="submit">Submit application</button>
</form></div>
<button id="replace-whole-form" type="button">Replace form</button><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('whole-choice').addEventListener('click', function () {
    document.getElementById('whole-options').style.display = '';
    this.setAttribute('aria-expanded', 'true');
  });
  document.getElementById('whole-wrong').addEventListener('click', function () {
    var value = document.getElementById('whole-value');
    value.style.display = '';
    value.textContent = 'No';
    document.getElementById('whole-options').style.display = 'none';
    document.getElementById('whole-choice').setAttribute('aria-expanded', 'false');
  });
  document.getElementById('replace-whole-form').addEventListener('click', function () {
    var current = document.getElementById('application_form');
    current.replaceWith(current.cloneNode(true));
  });
  document.addEventListener('submit', function (event) {
    if (event.target.id !== 'application_form') return;
    event.preventDefault(); record('whole-form-choice');
  });
</script>`;

const actionTargetSwapPage = (kind) => {
  const isSelect = kind === 'select';
  const isUpload = kind === 'upload';
  const target = isSelect
    ? '<select id="swap-target"><option value="">Choose</option><option value="yes">Yes</option></select>'
    : isUpload
      ? '<input id="swap-target" name="candidate_resume" type="file">'
      : '<input id="swap-target" placeholder="Applicant value">';
  const decoy = isSelect
    ? '<select id="decoy-target"><option value="">Choose</option><option value="yes">Yes</option></select>'
    : isUpload
      ? '<input id="decoy-target" name="candidate_resume" type="file">'
      : '<input id="decoy-target" placeholder="Applicant value">';
  return `<!doctype html><meta charset="utf-8"><title>Exact ${kind} target</title>
<form id="application_form" novalidate>
  <div id="swap-question"><label for="swap-target">Applicant value</label>${target}</div>
  <label for="stable-email">Email</label><input id="stable-email" type="email">
  <label for="stable-resume">Resume</label><input id="stable-resume" name="candidate_resume" type="file">
  <input id="shape-field" value="shape">
  <button id="send" type="submit">Send</button>
</form>
<form id="source_form">${decoy}</form><div id="submitted"></div>
<script>${HELPERS}
  var original = document.getElementById('swap-target');
  var decoy = document.getElementById('decoy-target');
  var swapped = false;
  function swapTargets() {
    if (swapped) return;
    swapped = true;
    var placeholder = document.createComment('swap');
    original.replaceWith(placeholder);
    decoy.replaceWith(original);
    placeholder.replaceWith(decoy);
    original.id = 'former-swap-target';
    decoy.id = 'swap-target';
  }
  if (` + JSON.stringify(kind === 'fill' || kind === 'fillByLabelText') + `) {
    var nativeGetAttribute = original.getAttribute.bind(original);
    original.getAttribute = function (name) {
      var value = nativeGetAttribute(name);
      if (name === 'placeholder' && !swapped) setTimeout(swapTargets, 0);
      return value;
    };
  }
  if (` + JSON.stringify(isSelect) + `) {
    original.addEventListener('change', function () {
      var selected = original.value;
      swapTargets();
      decoy.value = selected;
    });
  }
  if (` + JSON.stringify(isUpload) + `) {
    original.addEventListener('change', function () {
      var copied = new DataTransfer();
      for (var file of original.files) copied.items.add(file);
      swapTargets();
      decoy.files = copied.files;
    });
  }
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('${kind}-target-swap');
  });
</script>`;
};

const CUSTOM_SUBMIT_CHOICE = `<!doctype html><meta charset="utf-8"><title>Custom choice submit guard</title>
<form id="application_form" novalidate>
  <label for="custom-email">Email</label><input id="custom-email" type="email">
  <label for="custom-resume">Resume</label><input id="custom-resume" name="candidate_resume" type="file">
  <div id="custom-question" aria-required="true" aria-invalid="true">
    <span>Work authorization</span><button id="custom-selected" class="_selected_choice">Yes</button>
  </div>
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('custom-submit-choice');
  });
</script>`;

const lateChooserReparentPage = (explicit) => `<!doctype html><meta charset="utf-8"><title>Late chooser reparent</title>
<form id="application_form" novalidate>
  <label for="late-email">Email *</label><input id="late-email" type="email" required aria-invalid="true">
  <label for="late-resume">Resume</label><input id="late-resume" name="candidate_resume" type="file">
  ` + (explicit
    ? '<div id="send" role="button" tabindex="0">Submit application</div>'
    : '<button id="send" type="submit">Send</button>') + `
</form>
<form id="late-decoy"><input name="message" value="decoy"></form><div id="submitted"></div>
<script>${HELPERS}
  var nativeArrayBuffer = File.prototype.arrayBuffer;
  var hashReads = 0;
  var lateArmed = false;
  File.prototype.arrayBuffer = function () {
    hashReads += 1;
    if (hashReads >= 3) lateArmed = true;
    return nativeArrayBuffer.call(this);
  };
  var lateSubmit = document.getElementById('send');
  var innerTextGetter = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'innerText').get;
  Object.defineProperty(lateSubmit, 'innerText', {
    configurable: true,
    get: function () {
      var value = innerTextGetter.call(this);
      if (lateArmed) {
        lateArmed = false;
        this.setAttribute('data-late-reparent', '1');
      }
      return value;
    }
  });
  new MutationObserver(function () {
    if (lateSubmit.hasAttribute('data-late-reparent')) document.getElementById('late-decoy').append(lateSubmit);
  }).observe(lateSubmit, { attributes: true, attributeFilter: ['data-late-reparent'] });
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('late-original');
  });
  document.getElementById('late-decoy').addEventListener('submit', function (event) {
    event.preventDefault(); record('late-decoy');
  });
  ` + (explicit ? "lateSubmit.addEventListener('click', function () { record('late-explicit'); });" : '') + `
</script>`;

const REACTIVATED_UNRELATED_FORM = `<!doctype html><meta charset="utf-8"><title>Application reactivated unrelated form</title>
<form id="newsletter" novalidate>
  <label for="reactivated-newsletter">Newsletter email</label><input id="reactivated-newsletter" type="email">
</form>
<form id="application_form" novalidate>
  <label for="reactivated-email">Email *</label><input id="reactivated-email" type="email" required aria-invalid="true">
  <label for="reactivated-resume">Resume</label><input id="reactivated-resume" name="candidate_resume" type="file">
  <button id="send" type="submit">Send</button>
</form><button id="drift-unrelated" type="button">Drift unrelated proof</button><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('drift-unrelated').addEventListener('click', function () {
    document.getElementById('reactivated-newsletter').value = 'temporarily-different@example.com';
  });
  document.getElementById('reactivated-email').addEventListener('input', function () {
    document.getElementById('reactivated-newsletter').value = 'alerts@example.com';
  });
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('reactivated-unrelated');
  });
</script>`;

const LATE_BASE_HREF_DRIFT = `<!doctype html><meta charset="utf-8"><base id="base-url" href="/initial/"><title>Application base URL drift</title>
<form id="application_form" action="jobs/application" novalidate>
  <label for="base-email">Email *</label><input id="base-email" type="email" required aria-invalid="true">
  <label for="base-resume">Resume</label><input id="base-resume" name="candidate_resume" type="file">
  <button id="send" type="submit">Send</button>
</form><button id="arm-base" type="button">Arm base change</button><div id="submitted"></div>
<script>${HELPERS}
  var baseArmed = false;
  document.getElementById('arm-base').addEventListener('click', function () { baseArmed = true; });
  document.getElementById('base-email').addEventListener('input', function () {
    if (!baseArmed) return;
    baseArmed = false;
    document.getElementById('base-url').href = '/changed/';
  });
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('late-base-href');
  });
</script>`;

const HISTORY_PARITY = WORKABLE_BARE_SEND
  .replace('</form>', '</form><button id="history" type="button">History</button>')
  .replace('</script>', `
  document.getElementById('history').addEventListener('click', function () {
    history.pushState({}, '', location.pathname + '#application-step');
  });
</script>`);

const SHADOW_BARE_SEND = `<!doctype html><meta charset="utf-8"><title>Shadow application</title>
<div id="host"></div><div id="submitted"></div>
<script>${HELPERS}
  var root = document.getElementById('host').attachShadow({ mode: 'open' });
  root.innerHTML = '<form id="application_form"><label>Email<input id="shadow-email" type="email"></label>'
    + '<label>Resume<input id="shadow-resume" name="candidate_resume" type="file"></label>'
    + '<button id="shadow-send" type="submit">Send</button></form>';
  root.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('shadow-send');
  });
</script>`;

const WORKABLE_WITH_UNRELATED_FORM = WORKABLE_BARE_SEND.replace(
  '<form id="application"',
  '<form id="newsletter"><label for="newsletter-email">Newsletter email</label>'
    + '<input id="newsletter-email" type="email"><button type="button">Subscribe</button></form>'
    + '<form id="application"'
);

const TEXT_REPURPOSE_DRIFT = `<!doctype html><meta charset="utf-8"><title>Application text repurpose</title>
<form id="application_form" novalidate>
  <label id="identity-one" for="identity-email">Applicant email</label><input id="identity-email" name="applicant_email" type="email">
  <label id="identity-two" for="identity-name">Applicant name</label><input id="identity-name" name="applicant_name">
  <button id="send" type="submit">Send</button>
</form><button id="mutate" type="button">Mutate</button><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('text-repurpose');
  });
  document.getElementById('mutate').addEventListener('click', function () {
    var first = document.getElementById('identity-email');
    var second = document.getElementById('identity-name');
    first.id = 'support-email'; first.name = 'support_email';
    second.id = 'support-message'; second.name = 'support_message';
    document.getElementById('identity-one').htmlFor = first.id;
    document.getElementById('identity-one').textContent = 'Support email';
    document.getElementById('identity-two').htmlFor = second.id;
    document.getElementById('identity-two').textContent = 'Support message';
  });
</script>`;

const FAILED_TEXT_PERSISTENCE = `<!doctype html><meta charset="utf-8"><title>Application failed persistence</title>
<form id="candidate_application" novalidate>
  <label for="candidate-name">Applicant name</label><input id="candidate-name" name="applicant_name">
  <label for="candidate-resume">Resume</label><input id="candidate-resume" name="candidate_resume" type="file">
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('candidate-name').addEventListener('input', function (event) {
    if (event.currentTarget.value === 'Mehek') event.currentTarget.value = 'Different applicant';
  });
  document.getElementById('candidate_application').addEventListener('submit', function (event) {
    event.preventDefault(); record('failed-persistence');
  });
</script>`;

const ASYNC_TEXT_DRIFT = FAILED_TEXT_PERSISTENCE
  .replace('<title>Application failed persistence</title>', '<title>Application async text drift</title>')
  .replace(
    "if (event.currentTarget.value === 'Mehek') event.currentTarget.value = 'Different applicant';",
    "if (event.currentTarget.value === 'Mehek') { var control = event.currentTarget; setTimeout(function () { control.value = 'Different applicant'; }, 0); }"
  )
  .replace("record('failed-persistence');", "record('async-text-drift');");

const ASYNC_LABELLED_DIGIT_DRIFT = `<!doctype html><meta charset="utf-8"><title>Application labelled digit drift</title>
<form id="candidate_application" novalidate>
  <div><label for="experience-value">Years of experience</label><input id="experience-value" name="experience"></div>
  <label for="digit-resume">Resume</label><input id="digit-resume" name="candidate_resume" type="file">
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('experience-value').addEventListener('input', function (event) {
    if (event.currentTarget.value === '10') event.currentTarget.value = '10+';
  });
  document.getElementById('candidate_application').addEventListener('submit', function (event) {
    event.preventDefault(); record('labelled-digit-drift');
  });
</script>`;

const URL_HOP_START = `<!doctype html><meta charset="utf-8"><title>Application URL start</title>
<form id="candidate_application"><label>First<input id="first-hop"></label></form>
<script>
  document.getElementById('first-hop').addEventListener('input', function () {
    setTimeout(function () { location.href = '/url-hop-wrong'; }, 0);
  });
</script>`;

const URL_HOP_WRONG = `<!doctype html><meta charset="utf-8"><title>Wrong workflow</title>
<div id="wrong-ready"></div>
<form id="candidate_application">
  <label>Second<input id="second-hop"></label>
  <label><input type="radio" name="sms_opt_in" value="yes">Yes</label>
  <label><input id="decline-hop" type="radio" name="sms_opt_in" value="no">No</label>
  <button id="wrong-send" type="submit" disabled>Send</button>
</form>
<script>${HELPERS}
  document.getElementById('second-hop').addEventListener('input', function () { record('second-fill'); });
  document.getElementById('decline-hop').addEventListener('change', function () { record('optin-decline'); });
</script>`;

const INITIAL_REDIRECT_TARGET = `<!doctype html><meta charset="utf-8"><title>Redirected application</title>
<form id="application_form" action="/native-real" method="post" novalidate>
  <label for="redirect-email">Email</label><input id="redirect-email" name="email" type="email">
  <label for="redirect-resume">Resume</label><input id="redirect-resume" name="resume" type="file">
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('redirect-email').addEventListener('input', function () { record('redirect-email-fill'); });
  document.getElementById('redirect-resume').addEventListener('change', function () { record('redirect-resume-upload'); });
</script>`;

const nativeActivationPage = (mode) => `<!doctype html><meta charset="utf-8"><title>Native activation ${mode}</title>
<form id="application_form" action="/native-real" method="post" novalidate>
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Send</button>
</form>
<form id="decoy_form" action="/native-decoy" method="post"></form>
<div id="submitted">activation fixture</div>
<script>
  var activationMode = ${JSON.stringify(mode)};
  var applicationForm = document.getElementById('application_form');
  var decoyForm = document.getElementById('decoy_form');
  var submitControl = document.getElementById('send');
  var cachedNativeSubmit = HTMLFormElement.prototype.submit;
  if (['pointerdown', 'mousedown', 'focus', 'click'].includes(activationMode)) {
    submitControl.addEventListener(activationMode, function () {
      applicationForm.action = '/native-decoy';
    });
  }
  if (activationMode === 'submit-action') {
    applicationForm.addEventListener('submit', function () {
      applicationForm.action = '/native-decoy';
    });
  }
  if (activationMode === 'submit-association') {
    applicationForm.addEventListener('submit', function () {
      submitControl.setAttribute('form', 'decoy_form');
    });
  }
  if (activationMode === 'cached-direct-real' || activationMode === 'cached-direct-decoy') {
    submitControl.addEventListener('click', function (event) {
      event.preventDefault();
      cachedNativeSubmit.call(activationMode === 'cached-direct-real' ? applicationForm : decoyForm);
    });
  }
  if (activationMode === 'synthetic-witness') {
    submitControl.addEventListener('click', function (event) {
      event.preventDefault();
      applicationForm.dispatchEvent(new SubmitEvent('submit', {
        bubbles: true,
        cancelable: true,
        submitter: submitControl
      }));
      applicationForm.dispatchEvent(new FormDataEvent('formdata', {
        formData: new FormData()
      }));
      cachedNativeSubmit.call(applicationForm);
    });
  }
  if (activationMode === 'side-channels') {
    submitControl.addEventListener('click', function () {
      fetch('/record-click?who=activation-get&email=' + encodeURIComponent(document.getElementById('native-email').value))
        .catch(function () {});
      var image = new Image();
      image.src = '/record-click?who=activation-image';
      navigator.sendBeacon('/record-click?who=activation-ping', 'applicant=1');
      try { new EventSource('/record-click?who=activation-eventsource'); } catch (error) {}
      try { new WebSocket('ws://' + location.host + '/record-click?who=activation-websocket'); } catch (error) {}
      try { new WebTransport('https://' + location.host + '/record-click?who=activation-webtransport'); } catch (error) {}
    });
  }
</script>`;

const lateFinalChooserDriftPage = (mode) => `<!doctype html><meta charset="utf-8"><title>Late chooser drift ${mode}</title>
<form id="application_form" action="/native-real" method="post" novalidate>
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <input id="late-job-id" name="job_id" type="hidden" value="A">
  <button id="send" type="submit">Send</button>
</form><div id="submitted">late chooser fixture</div>
<script>
  var lateMode = ${JSON.stringify(mode)};
  var lateSend = document.getElementById('send');
  var originalRect = lateSend.getBoundingClientRect.bind(lateSend);
  var rectReads = 0;
  lateSend.getBoundingClientRect = function () {
    rectReads += 1;
    if (rectReads === 2) {
      if (lateMode === 'action') document.getElementById('application_form').action = '/native-decoy';
      if (lateMode === 'hidden') document.getElementById('late-job-id').value = 'B';
      if (lateMode === 'text') lateSend.textContent = 'Submit application';
    }
    return originalRect();
  };
</script>`;

const WORKABLE_NATIVE_ALLOWLIST = `<!doctype html><meta charset="utf-8"><title>Native Workable application</title>
<form id="application" action="/native-real" method="post" novalidate>
  <label for="workable-firstname">First name</label>
  <input id="workable-firstname" name="firstname">
  <label for="workable-email">Email</label>
  <input id="workable-email" name="email" type="email">
  <label for="workable-avatar">Avatar</label>
  <input id="workable-avatar" name="avatar" type="file">
  <label for="workable-resume">Resume</label>
  <input id="workable-resume" name="resume" type="file" data-ui="resume">
  <button id="send" type="submit">Send</button>
</form>
<form id="avatar-decoy">
  <input name="firstname"><input name="email"><input name="avatar" type="file">
</form>
<div id="submitted">native Workable fixture</div>`;

const NATIVE_SERIALIZER = `<!doctype html><meta charset="utf-8"><title>Native application serializer</title>
<form id="application_form" action="/native-real" method="post" enctype="application/x-www-form-urlencoded" novalidate>
  <label for="serializer-email">Email</label>
  <input id="serializer-email" name="email" type="email">
  <fieldset name="fieldset_must_not_serialize">
    <legend>Preferred role</legend>
    <label><input id="serializer-engineering" name="role" type="radio" value="engineering">Engineering</label>
    <label><input id="serializer-product" name="role" type="radio" value="product">Product</label>
  </fieldset>
  <output name="output_must_not_serialize">ignored</output>
  <label for="serializer-resume">Resume</label>
  <input id="serializer-resume" name="resume" type="file">
  <button id="send" name="decision" value="apply" type="submit">Send</button>
</form><div id="submitted">serializer fixture</div>`;

const nativeRedirectPage = (action) => `<!doctype html><meta charset="utf-8"><title>Native redirect application</title>
<form id="application_form" action="${action}" method="post" novalidate>
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Send</button>
</form><div id="submitted">redirect fixture</div>`;

const NATIVE_IFRAME_CLONE = `<!doctype html><meta charset="utf-8"><title>Native iframe clone application</title>
<form id="application_form" action="/native-real" method="post" novalidate>
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-name">Name</label><input id="native-name" name="name">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Send</button>
</form>
<iframe id="clone-frame"></iframe>
<div id="submitted">iframe clone fixture</div>
<script>
  var applicationForm = document.getElementById('application_form');
  var cloneFrame = document.getElementById('clone-frame');
  var cloneDocument = cloneFrame.contentDocument;
  cloneDocument.open();
  cloneDocument.write('<form id="clone_form" action="/native-real" method="post"><input name="email" value="applicant@example.com"><input name="name" value="Mehek"><input name="resume" type="file"></form>');
  cloneDocument.close();
  applicationForm.addEventListener('submit', function (event) {
    event.preventDefault();
    new FormData(applicationForm);
    var cloneForm = cloneDocument.getElementById('clone_form');
    cloneForm.action = applicationForm.action;
    cloneFrame.contentWindow.location.assign(cloneForm.action);
  });
</script>`;

const FIXTURES = {
  '/ashby': ASHBY,
  '/greenhouse': GREENHOUSE,
  '/outscoring-decoy': OUTSCORING_DECOY,
  '/body-only': BODY_ONLY,
  '/ambiguous': AMBIGUOUS,
  '/nested': NESTED,
  '/footer-bar': FOOTER_BAR,
  '/footer-bar-furniture': FOOTER_BAR_FURNITURE,
  '/sibling-form': SIBLING_FORM,
  '/stray-newsletter': STRAY_NEWSLETTER,
  '/stray-filter': STRAY_FILTER,
  '/stray-subscribe': STRAY_SUBSCRIBE,
  '/stray-only': STRAY_ONLY,
  '/minimal-application': MINIMAL_APPLICATION,
  '/greenhouse-stray': GREENHOUSE_STRAY,
  '/recruitee-german': RECRUITEE_GERMAN,
  '/one-field-form': ONE_FIELD_FORM,
  '/eeo-sticky-bar': EEO_STICKY_BAR,
  '/screening-sticky-bar': SCREENING_STICKY_BAR,
  '/eeo-rich-decoy': EEO_RICH_DECOY,
  '/screening-rich-decoy': SCREENING_RICH_DECOY,
  '/scan-bounds': SCAN_BOUNDS,
  '/shadow': SHADOW,
  '/workable-bare-send': WORKABLE_BARE_SEND,
  '/contact-bare-send': CONTACT_BARE_SEND,
  '/candidate-support-bare-send': CANDIDATE_SUPPORT_BARE_SEND,
  '/application-feedback-bare-send': APPLICATION_FEEDBACK_BARE_SEND,
  '/application-support-bare-send': APPLICATION_SUPPORT_BARE_SEND,
  '/application-profile-bare-send': applicationIdentityDecoyPage('profile'),
  '/application-status-bare-send': applicationIdentityDecoyPage('status'),
  '/fill-by-phone-format': FILL_BY_PHONE_FORMAT,
  '/fill-by-select-label': FILL_BY_SELECT_LABEL,
  '/fill-by-select-punctuation': FILL_BY_SELECT_PUNCTUATION,
  '/fill-by-date-normalization': FILL_BY_DATE_NORMALIZATION,
  '/workable-role-send': WORKABLE_ROLE_SEND,
  '/workable-explicit-role': WORKABLE_EXPLICIT_ROLE,
  '/workable-formaction-override': WORKABLE_FORM_ACTION_OVERRIDE,
  '/workable-explicit-override': WORKABLE_EXPLICIT_OVERRIDE,
  '/workable-form-target': WORKABLE_FORM_TARGET,
  '/workable-base-target': WORKABLE_BASE_TARGET,
  '/workable-association-decoy': WORKABLE_ASSOCIATION_DECOY,
  '/workable-control-state-drift': WORKABLE_CONTROL_STATE_DRIFT,
  '/workable-ambiguous-send': WORKABLE_AMBIGUOUS_SEND,
  '/workable-explicit-wins': WORKABLE_EXPLICIT_WINS,
  '/workable-form-drift': WORKABLE_FORM_DRIFT,
  '/workable-proof-loss-explicit-decoy': WORKABLE_PROOF_LOSS_EXPLICIT_DECOY,
  '/workable-activation-pointer-drift': activationDriftPage('pointer'),
  '/workable-activation-click-drift': activationDriftPage('click'),
  '/workable-prechooser-auto-submit': PRE_CHOOSER_AUTO_SUBMIT,
  '/cross-form-optin-decoy': CROSS_FORM_OPTIN_DECOY,
  '/action-boundary-drift': ACTION_BOUNDARY_DRIFT,
  '/job-alert-bare-send': JOB_ALERT_BARE_SEND,
  '/talent-pool-bare-send': TALENT_POOL_BARE_SEND,
  '/minimal-file-drift': MINIMAL_FILE_DRIFT,
  '/choice-drift': CHOICE_DRIFT,
  '/reparent-drift': REPARENT_DRIFT,
  '/confirmation-file-drift': confirmationDriftPage('file'),
  '/confirmation-sibling-drift': confirmationDriftPage('sibling'),
  '/confirmation-value-drift': confirmationDriftPage('value'),
  '/confirmation-class-change': confirmationDriftPage('class'),
  '/confirmation-hidden-drift': confirmationDriftPage('hidden'),
  '/confirmation-external-hidden-drift': confirmationDriftPage('external-hidden'),
  '/confirmation-consent-drift': confirmationDriftPage('consent'),
  '/over-bound-submitted-state': OVER_BOUND_SUBMITTED_STATE,
  '/forged-success-markers': FORGED_SUCCESS_MARKERS,
  '/workable-external-submit': WORKABLE_EXTERNAL_SUBMIT,
  '/workable-disabled-external-submit': WORKABLE_DISABLED_WITH_EXTERNAL_SUBMIT,
  '/workable-explicit-associated-decoy': WORKABLE_EXPLICIT_ASSOCIATED_DECOY,
  '/direct-marker-redirect': DIRECT_MARKER_REDIRECT,
  '/formless-state-drift': FORMLESS_STATE_DRIFT,
  '/external-associated-bare-send': EXTERNAL_ASSOCIATED_BARE_SEND,
  '/pre-chooser-base-drift': PRE_CHOOSER_BASE_DRIFT,
  '/pre-chooser-method-drift': PRE_CHOOSER_METHOD_DRIFT,
  '/selector-id-transfer': SELECTOR_ID_TRANSFER,
  '/failed-choice-strip': failedChoicePage(false),
  '/failed-choice-strip-v3': failedChoicePage(false).replace('>Send</button>', '>Submit</button>'),
  '/failed-choice-replace': failedChoicePage(true),
  '/external-required-control': EXTERNAL_REQUIRED_CONTROL,
  '/whole-form-failed-choice': WHOLE_FORM_FAILED_CHOICE,
  '/fill-target-swap': actionTargetSwapPage('fill'),
  '/fill-by-target-swap': actionTargetSwapPage('fillByLabelText'),
  '/select-target-swap': actionTargetSwapPage('select'),
  '/upload-target-swap': actionTargetSwapPage('upload'),
  '/custom-submit-choice': CUSTOM_SUBMIT_CHOICE,
  '/late-bare-reparent': lateChooserReparentPage(false),
  '/late-explicit-reparent': lateChooserReparentPage(true),
  '/reactivated-unrelated-form': REACTIVATED_UNRELATED_FORM,
  '/late-base-href-drift': LATE_BASE_HREF_DRIFT,
  '/history-parity': HISTORY_PARITY,
  '/shadow-bare-send': SHADOW_BARE_SEND,
  '/workable-unrelated-form': WORKABLE_WITH_UNRELATED_FORM,
  '/text-repurpose-drift': TEXT_REPURPOSE_DRIFT,
  '/failed-text-persistence': FAILED_TEXT_PERSISTENCE,
  '/async-text-drift': ASYNC_TEXT_DRIFT,
  '/async-labelled-digit-drift': ASYNC_LABELLED_DIGIT_DRIFT,
  '/url-hop-start': URL_HOP_START,
  '/url-hop-wrong': URL_HOP_WRONG,
  '/initial-redirect-target': INITIAL_REDIRECT_TARGET,
  '/native-activation-normal': nativeActivationPage('normal'),
  '/native-activation-pointerdown': nativeActivationPage('pointerdown'),
  '/native-activation-mousedown': nativeActivationPage('mousedown'),
  '/native-activation-focus': nativeActivationPage('focus'),
  '/native-activation-click': nativeActivationPage('click'),
  '/native-activation-submit-action': nativeActivationPage('submit-action'),
  '/native-activation-submit-association': nativeActivationPage('submit-association'),
  '/native-activation-cached-direct-real': nativeActivationPage('cached-direct-real'),
  '/native-activation-cached-direct-decoy': nativeActivationPage('cached-direct-decoy'),
  '/native-activation-synthetic-witness': nativeActivationPage('synthetic-witness'),
  '/native-activation-side-channels': nativeActivationPage('side-channels'),
  '/late-final-action-drift': lateFinalChooserDriftPage('action'),
  '/late-final-hidden-drift': lateFinalChooserDriftPage('hidden'),
  '/late-final-submit-text-drift': lateFinalChooserDriftPage('text'),
  '/workable-native-allowlist': WORKABLE_NATIVE_ALLOWLIST,
  '/native-activation-iframe-clone': NATIVE_IFRAME_CLONE,
  '/native-serializer-empty-file': NATIVE_SERIALIZER,
  '/native-serializer-populated-file': NATIVE_SERIALIZER,
  '/native-get-unsupported': nativeRedirectPage('/native-real').replace('method="post"', 'method="get"'),
  '/native-redirect-preserve-method': nativeRedirectPage('/native-redirect-307'),
  '/native-redirect-receipt': nativeRedirectPage('/native-receipt-redirect')
};

const clicks = [];
const transportRequests = [];
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/record-click') {
    clicks.push(url.searchParams.get('who'));
    response.writeHead(204, { connection: 'close' });
    response.end();
    return;
  }
  if (url.pathname === '/initial-redirect') {
    response.writeHead(302, { location: '/initial-redirect-target', connection: 'close' });
    response.end();
    return;
  }
  if (url.pathname === '/native-real'
    || url.pathname === '/native-decoy'
    || url.pathname === '/native-redirect-307'
    || url.pathname === '/native-receipt-redirect'
    || url.pathname === '/native-receipt') {
    const chunks = [];
    const recordedRequest = { method: request.method, path: url.pathname, body: null };
    transportRequests.push(recordedRequest);
    request.on('data', (chunk) => { chunks.push(chunk); });
    request.on('end', () => {
      recordedRequest.body = Buffer.concat(chunks).toString('utf8');
      if (url.pathname === '/native-redirect-307') {
        response.writeHead(307, { location: '/native-decoy', connection: 'close' });
        response.end();
        return;
      }
      if (url.pathname === '/native-receipt-redirect') {
        response.writeHead(303, { location: '/native-receipt', connection: 'close' });
        response.end();
        return;
      }
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
      response.end(`<!doctype html><meta charset="utf-8"><title>Application received</title>
        <div id="submitted">Thank you for applying</div>`);
    });
    return;
  }
  const body = FIXTURES[url.pathname];
  if (!body) {
    response.writeHead(404, { connection: 'close' });
    response.end('no fixture');
    return;
  }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
  response.end(body);
});
server.on('upgrade', (request, socket) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/record-click') clicks.push(url.searchParams.get('who'));
  socket.destroy();
});
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

const workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-formless-scope-'));
fs.writeFileSync(path.join(workDir, 'stratus-runner.cjs'), SANDBOX_RUNNER);

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

const resultPath = (phase) => path.join(workDir, 'stratus-result-' + phase + '.json');
const readResult = (phase) => (fs.existsSync(resultPath(phase))
  ? JSON.parse(fs.readFileSync(resultPath(phase), 'utf8'))
  : null);

function writeInput(fixture, extras, overrides, before = []) {
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: `http://127.0.0.1:${server.address().port}${fixture}`,
    actions: [...before, submitAction, { type: 'extract', selector: '#submitted' }, ...extras],
    allowSubmit: true,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    ...overrides
  }));
}

function startRunner() {
  const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'], {
    cwd: workDir,
    env: { ...process.env, NODE_PATH: path.join(process.cwd(), 'node_modules') }
  });
  child.stderr.resume();
  child.stdout.resume();
  return child;
}

/** Runs the shipped runner against one fixture. Returns the exit code and the result file if any.
 *  'before' is queued ahead of the submit action, which is how a run that actually fills something
 *  is expressed: the fills a real caller sends always precede its final submit. */
async function run(fixture, extras = [], before = []) {
  clicks.length = 0;
  writeInput(fixture, extras, {}, before);
  fs.rmSync(resultPath(0), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
  const status = await new Promise((resolve) => startRunner().on('close', resolve));
  return { status, result: readResult(0), clicks: [...clicks] };
}

const V4_APPLICATION_SCOPE_SELECTORS = Object.freeze({
  '/application-feedback-bare-send': '#application_feedback',
  '/application-support-bare-send': '#application_support',
  '/application-profile-bare-send': '#application_profile',
  '/application-status-bare-send': '#application_status',
  '/ashby': '.ashby-job-posting-right-pane',
  '/async-labelled-digit-drift': '#candidate_application',
  '/async-text-drift': '#candidate_application',
  '/candidate-support-bare-send': '#candidate_contact',
  '/choice-drift': '#candidate_application',
  '/confirmation-class-change': '#application_form',
  '/confirmation-consent-drift': '#application_form',
  '/confirmation-external-hidden-drift': '#application_form',
  '/confirmation-file-drift': '#application_form',
  '/confirmation-hidden-drift': '#application_form',
  '/confirmation-sibling-drift': '#application_form',
  '/confirmation-value-drift': '#application_form',
  '/contact-bare-send': '#contact',
  '/custom-submit-choice': '#application_form',
  '/direct-marker-redirect': '#application_form',
  '/external-associated-bare-send': '#application_form',
  '/external-required-control': '#application_form',
  '/failed-choice-replace': '#application_form',
  '/failed-choice-strip': '#application_form',
  '/failed-text-persistence': '#candidate_application',
  '/fill-by-date-normalization': '#application_form',
  '/fill-by-phone-format': '#application_form',
  '/fill-by-select-label': '#application_form',
  '/fill-by-select-punctuation': '#application_form',
  '/fill-by-target-swap': '#application_form',
  '/fill-target-swap': '#application_form',
  '/forged-success-markers': '#application_form',
  '/history-parity': '#application',
  '/initial-redirect': '#application_form',
  '/job-alert-bare-send': '#job-alert',
  '/late-bare-reparent': '#application_form',
  '/late-base-href-drift': '#application_form',
  '/late-explicit-reparent': '#application_form',
  '/minimal-file-drift': '#application_form',
  '/native-activation-cached-direct-decoy': '#application_form',
  '/native-activation-cached-direct-real': '#application_form',
  '/native-activation-click': '#application_form',
  '/native-activation-focus': '#application_form',
  '/native-activation-iframe-clone': '#application_form',
  '/native-activation-mousedown': '#application_form',
  '/native-activation-normal': '#application_form',
  '/native-activation-pointerdown': '#application_form',
  '/native-activation-submit-action': '#application_form',
  '/native-activation-submit-association': '#application_form',
  '/native-activation-synthetic-witness': '#application_form',
  '/native-activation-side-channels': '#application_form',
  '/late-final-action-drift': '#application_form',
  '/late-final-hidden-drift': '#application_form',
  '/late-final-submit-text-drift': '#application_form',
  '/native-get-unsupported': '#application_form',
  '/native-redirect-preserve-method': '#application_form',
  '/native-redirect-receipt': '#application_form',
  '/native-serializer-empty-file': '#application_form',
  '/native-serializer-populated-file': '#application_form',
  '/over-bound-submitted-state': '#application_form',
  '/pre-chooser-base-drift': '#application_form',
  '/pre-chooser-method-drift': '#application_form',
  '/reactivated-unrelated-form': '#application_form',
  '/reparent-drift': '#application_source',
  '/selector-id-transfer': '#application_source',
  '/select-target-swap': '#application_form',
  '/shadow-bare-send': '#application_form',
  '/talent-pool-bare-send': '#talent-network',
  '/text-repurpose-drift': '#application_form',
  '/upload-target-swap': '#application_form',
  '/url-hop-start': '#candidate_application',
  '/whole-form-failed-choice': '#application_form',
  '/workable-ambiguous-send': '#application',
  '/workable-activation-click-drift': '#application',
  '/workable-activation-pointer-drift': '#application',
  '/workable-association-decoy': '#application',
  '/workable-bare-send': '#application',
  '/workable-base-target': '#application',
  '/workable-control-state-drift': '#application',
  '/workable-disabled-external-submit': '#application',
  '/workable-explicit-associated-decoy': '#application',
  '/workable-explicit-override': '#application',
  '/workable-explicit-role': '#application',
  '/workable-explicit-wins': '#application',
  '/workable-external-submit': '#application',
  '/workable-form-drift': '#application',
  '/workable-form-target': '#application',
  '/workable-formaction-override': '#application',
  '/workable-proof-loss-explicit-decoy': '#application',
  '/workable-prechooser-auto-submit': '#application',
  '/cross-form-optin-decoy': '#application_form',
  '/action-boundary-drift': '#application_form',
  '/workable-role-send': '#application',
  '/workable-unrelated-form': '#application',
  '/workable-native-allowlist': 'form:has(input[name="firstname"]):has(input[name="email"]):has(input[type="file"][data-ui="resume"])'
});

function v4ApplicationScopeFor(fixture) {
  const fixturePath = fixture.split('?')[0];
  if (Object.hasOwn(V4_APPLICATION_SCOPE_SELECTORS, fixturePath)) {
    return V4_APPLICATION_SCOPE_SELECTORS[fixturePath];
  }
  throw new Error('runV4 fixture must declare an application scope classification: ' + fixturePath);
}

async function runV4(fixture, before = [], extras = []) {
  clicks.length = 0;
  transportRequests.length = 0;
  const expectedPageUrl = `http://127.0.0.1:${server.address().port}${fixture}`;
  const applicationScopeSelector = v4ApplicationScopeFor(fixture);
  const v4Submit = {
    ...submitAction,
    chooserPolicy: ATOMIC_SUBMIT_POLICY_V4,
    expectedPageUrl
  };
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: expectedPageUrl,
    actions: [
      { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl },
      {
        type: 'requireCapability',
        value: ATOMIC_SUBMIT_V4_CAPABILITY,
        optional: false,
        ...(applicationScopeSelector ? { applicationScopeSelector } : {})
      },
      ...before,
      v4Submit,
      { type: 'extract', selector: '#submitted' },
      ...extras
    ],
    allowSubmit: true,
    screenshot: true,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 }
  }));
  fs.rmSync(resultPath(0), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-screenshot-0.png'), { force: true });
  const status = await new Promise((resolve) => startRunner().on('close', resolve));
  const errorFile = path.join(workDir, 'stratus-error.json');
  return {
    status,
    result: readResult(0),
    error: fs.existsSync(errorFile) ? JSON.parse(fs.readFileSync(errorFile, 'utf8')) : null,
    clicks: [...clicks],
    requests: [...transportRequests],
    screenshot: fs.existsSync(path.join(workDir, 'stratus-screenshot-0.png'))
  };
}

async function runV3Prepare(fixture, actions) {
  clicks.length = 0;
  const expectedPageUrl = `http://127.0.0.1:${server.address().port}${fixture}`;
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: expectedPageUrl,
    actions: [
      { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl },
      ...actions
    ],
    allowSubmit: false,
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 }
  }));
  fs.rmSync(resultPath(0), { force: true });
  fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
  const status = await new Promise((resolve) => startRunner().on('close', resolve));
  return { status, result: readResult(0), clicks: [...clicks] };
}

const valueOf = (result, selector) => result.extracted.find((entry) => entry.selector === selector)?.value;

test.after(() => { server.close(); fs.rmSync(workDir, { recursive: true, force: true }); });

const workableV4Fills = () => [
  { type: 'fill', selector: '#first-name', value: 'Mehek', label: 'first_name' },
  { type: 'fill', selector: '#last-name', value: 'Mandal', label: 'last_name' },
  { type: 'fill', selector: '#email', value: 'applicant@example.com', label: 'email' },
  {
    type: 'upload',
    selector: '#resume',
    label: 'resume',
    file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
  }
];

const minimalV4Fills = (emailSelector, resumeSelector) => [
  { type: 'fill', selector: emailSelector, value: 'applicant@example.com', label: 'email' },
  {
    type: 'upload',
    selector: resumeSelector,
    label: 'resume',
    file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
  }
];

const nativeSerializerV4Fills = (populateFile) => [
  { type: 'fill', selector: '#serializer-email', value: 'applicant@example.com', label: 'email' },
  { type: 'fillByLabelText', text: 'Preferred role', value: 'Engineering', label: 'preferred_role' },
  ...(populateFile ? [{
    type: 'upload',
    selector: '#serializer-resume',
    label: 'resume',
    file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
  }] : [])
];

const assertScriptInterceptedNativeTransport = (
  result,
  blockerReason = 'submit_transport_unsupported',
  chooserOutcome = 'selected'
) => {
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, blockerReason);
  assert.equal(result.finalSubmitChooser.outcome, chooserOutcome);
};

const assertUnsupportedNativeSubmitter = (result) => {
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_payload_unverifiable');
  assert.equal(result.finalSubmitChooser.outcome, 'selected');
};

test('v4 blocks a Workable-like bare Send whose script intercepts native transport', async () => {
  const { status, result, error, clicks: recorded, screenshot } = await runV4(
    '/workable-bare-send',
    workableV4Fills()
  );
  assert.equal(status, 0, JSON.stringify({ error, result }));
  assert.deepEqual(recorded, [], JSON.stringify({ result, requests: transportRequests }));
  assert.equal(screenshot, true);
  assertScriptInterceptedNativeTransport(result);
  assert.deepEqual(result.finalSubmitChooser, {
    version: 1,
    policyName: 'litos-final-submit',
    policyVersion: 4,
    grammarHash: ATOMIC_SUBMIT_POLICY_V4.grammarHash,
    submitKind: 'application',
    outcome: 'selected',
    candidateCount: 1,
    viableCandidateCount: 1,
    topScore: 0,
    topScoreCount: 1,
    addressedScopeCount: 1,
    bareSendCandidateCount: 1
  });
  assert.equal(result.exactPageUrlProof.beforeFinalChooser, result.exactPageUrlProof.expected);
  assert.equal(result.exactPageUrlProof.beforeSubmit, result.exactPageUrlProof.expected);
});

test('v3 prepare runs retain the old URL-proof shape and never write successful-address markers', async () => {
  const { status, result, clicks: recorded } = await runV3Prepare('/one-field-form', [
    { type: 'fill', selector: '#one-email', value: 'updated@example.com', label: 'email' },
    { type: 'extract', selector: '#one-email', attribute: 'data-litos-successful-address-v1' },
    { type: 'extract', selector: '#one-email', attribute: 'data-litos-successful-address-target-v1' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.deepEqual(Object.keys(result.exactPageUrlProof).sort(), [
    'beforeActions', 'beforeApplicantData', 'beforeSubmit', 'expected'
  ]);
  assert.equal(result.extracted[0].value, null);
  assert.equal(result.extracted[1].value, null);
  assert.equal(result.finalSubmitChooser, undefined);
});

test('v4 returns a screenshot-backed no-click result for a contact form bare Send', async () => {
  const { status, result, clicks: recorded, screenshot } = await runV4(
    '/contact-bare-send',
    [
      { type: 'fill', selector: '#contact-email', value: 'applicant@example.com', label: 'contact_email' },
      { type: 'fill', selector: '#message', value: 'Hello', label: 'message' }
    ],
    [{ type: 'extract', selector: '#contact-email', attribute: 'data-litos-successful-address-v1' }]
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(screenshot, true);
  assertScriptInterceptedNativeTransport(result);
  assert.equal(result.finalSubmitChooser.candidateCount, 1);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 1);
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
  assert.equal(result.finalSubmitChooser.bareSendCandidateCount, 1);
  assert.equal(result.exactPageUrlProof.beforeFinalChooser, result.exactPageUrlProof.expected);
  assert.equal(valueOf(result, '#contact-email'), null);
});

test('v4 refuses bare Send on a candidate support form', async () => {
  const { status, result, clicks: recorded, screenshot } = await runV4('/candidate-support-bare-send', [
    { type: 'fill', selector: '#support-email', value: 'applicant@example.com' },
    { type: 'fill', selector: '#support-message', value: 'Please help' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(screenshot, true);
  assertScriptInterceptedNativeTransport(result);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 1);
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
});

test('v4 refuses bare Send on an application feedback form', async () => {
  const { status, result, clicks: recorded } = await runV4('/application-feedback-bare-send', [
    { type: 'fill', selector: '#feedback-email', value: 'applicant@example.com' },
    { type: 'fill', selector: '#feedback-message', value: 'Feedback' },
    {
      type: 'upload', selector: '#feedback-resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 1);
});

test('v4 refuses bare Send on a resume-bearing application support form', async () => {
  const { status, result, clicks: recorded } = await runV4('/application-support-bare-send', [
    { type: 'fill', selector: '#application-support-email', value: 'applicant@example.com' },
    {
      type: 'upload', selector: '#application-support-resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 1);
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
});

for (const decoyKind of ['profile', 'status']) {
  test('v4 refuses bare Send on a resume-bearing application ' + decoyKind + ' form', async () => {
    const { status, result, clicks: recorded } = await runV4('/application-' + decoyKind + '-bare-send', [
      { type: 'fill', selector: '#' + decoyKind + '-email', value: 'applicant@example.com' },
      {
        type: 'upload', selector: '#' + decoyKind + '-resume',
        file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
      }
    ]);
    assert.equal(status, 0);
    assert.deepEqual(recorded, []);
    assertScriptInterceptedNativeTransport(result);
    assert.equal(result.finalSubmitChooser.viableCandidateCount, 1);
    assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
  });
}

test('v4 accepts fillByLabelText phone formatting as a verified bare-Send proof', async () => {
  const { status, result, clicks: recorded } = await runV4('/fill-by-phone-format', [
    { type: 'fillByLabelText', text: 'Phone', value: '2135746270' },
    {
      type: 'upload', selector: '#phone-resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
});

test('v4 accepts a native option label as a verified bare-Send proof', async () => {
  const { status, result, clicks: recorded } = await runV4('/fill-by-select-label', [
    { type: 'fillByLabelText', text: 'Department', value: 'Engineering' },
    {
      type: 'upload', selector: '#select-resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
});

test('v4 does not authorize a punctuation-different single native option as the requested proof', async () => {
  const { status, result, clicks: recorded } = await runV4('/fill-by-select-punctuation', [
    { type: 'fillByLabelText', text: 'Experience', value: '10' },
    {
      type: 'upload', selector: '#punctuation-resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
});

test('v4 invalidates a native select proof when only its selected option label changes', async () => {
  const { status, result, clicks: recorded } = await runV4('/fill-by-select-label', [
    { type: 'fillByLabelText', text: 'Department', value: 'Engineering' },
    {
      type: 'upload', selector: '#select-resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    },
    { type: 'click', selector: '#mutate-select-label' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
});

test('v4 accepts a normalized date control as a verified bare-Send proof', async () => {
  const { status, result, clicks: recorded } = await runV4('/fill-by-date-normalization', [
    { type: 'fillByLabelText', text: 'Graduation date', value: 'May 2028' },
    {
      type: 'upload', selector: '#date-resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
});

test('v4 invalidates a normalized date proof that moves to another calendar point', async () => {
  const { status, result, clicks: recorded } = await runV4('/fill-by-date-normalization', [
    { type: 'fillByLabelText', text: 'Graduation date', value: 'May 2028' },
    {
      type: 'upload', selector: '#date-resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    },
    { type: 'click', selector: '#mutate-date' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
});

test('v4 does not let one successful email fill authorize an application-looking bare Send', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-bare-send', [
    { type: 'fill', selector: '#email', value: 'applicant@example.com', label: 'email' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
});

test('v4 records successful unlabeled fills as chooser proofs', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-bare-send', [
    { type: 'fill', selector: '#first-name', value: 'Mehek' },
    { type: 'fill', selector: '#last-name', value: 'Mandal' },
    {
      type: 'upload', selector: '#resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.finalSubmitChooser.outcome, 'selected');
  assert.equal(result.finalSubmitChooser.topScore, 0);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 1);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
});

test('v4 never records a nonempty but different failed text persistence as proof', async () => {
  const { status, result, clicks: recorded, screenshot } = await runV4('/failed-text-persistence', [
    { type: 'fill', selector: '#candidate-name', value: 'Mehek', label: 'first_name' },
    {
      type: 'upload', selector: '#candidate-resume', label: 'resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(screenshot, true);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.candidateCount, 1);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
  assert.equal(result.exactPageUrlProof.beforeFinalChooser, result.exactPageUrlProof.expected);
});

test('v4 rechecks action intent when an async repaint follows successful text verification', async () => {
  const { status, result, clicks: recorded } = await runV4('/async-text-drift', [
    { type: 'fill', selector: '#candidate-name', value: 'Mehek' },
    {
      type: 'upload', selector: '#candidate-resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
});

test('v4 does not treat labelled 10 and already-repainted 10+ as the same proof', async () => {
  const { status, result, clicks: recorded } = await runV4('/async-labelled-digit-drift', [
    { type: 'fillByLabelText', text: 'Years of experience', value: '10' },
    {
      type: 'upload', selector: '#digit-resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
});

test('v4 checks the exact URL again before every later applicant-data action', async () => {
  const { status, result, clicks: recorded } = await runV4('/url-hop-start', [
    { type: 'fill', selector: '#first-hop', value: 'first' },
    { type: 'waitForSelector', selector: '#wrong-ready', timeout: 5000 },
    { type: 'fill', selector: '#second-hop', value: 'must-not-land' }
  ]);
  assert.equal(status, 1);
  assert.equal(result, null);
  assert.deepEqual(recorded, []);
});

test('v4 checks the exact URL before chooser scanning or opt-in decline', async () => {
  const { status, result, clicks: recorded } = await runV4('/url-hop-start', [
    { type: 'fill', selector: '#first-hop', value: 'first' },
    { type: 'waitForSelector', selector: '#wrong-ready', timeout: 5000 }
  ]);
  assert.equal(status, 1);
  assert.equal(result, null);
  assert.deepEqual(recorded, []);
});

test('v4 rejects an initial navigation redirect before applicant actions', async () => {
  const { status, result, clicks: recorded, requests } = await runV4('/initial-redirect', [
    ...minimalV4Fills('#redirect-email', '#redirect-resume')
  ]);
  assert.equal(status, 1);
  assert.equal(result, null);
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
});

test('v4 native activation submits only the caller-bound real application endpoint', async () => {
  const { status, result, error, clicks: recorded, requests, screenshot } = await runV4(
    '/native-activation-normal',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(status, 0, JSON.stringify({ error, requests, screenshot }));
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, [{
    method: 'POST',
    path: '/native-real',
    body: 'email=applicant%40example.com&resume=resume.pdf'
  }], JSON.stringify(result));
  assert.equal(result.submitOutcome.pressed, true);
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(result.finalSubmitChooser.outcome, 'selected');
});

test('v4 Workable allowlist selector binds exactly one native application form', async () => {
  const { status, result, error, clicks: recorded, requests } = await runV4(
    '/workable-native-allowlist',
    [
      { type: 'fill', selector: '#workable-firstname', value: 'Mehek', label: 'first_name' },
      { type: 'fill', selector: '#workable-email', value: 'applicant@example.com', label: 'email' },
      {
        type: 'upload', selector: '#workable-resume', label: 'resume',
        file: {
          name: 'resume.pdf', mimeType: 'application/pdf',
          base64: Buffer.from('resume').toString('base64')
        }
      }
    ]
  );
  assert.equal(status, 0, JSON.stringify(error));
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, [{
    method: 'POST',
    path: '/native-real',
    body: 'firstname=Mehek&email=applicant%40example.com&avatar=&resume=resume.pdf'
  }], JSON.stringify(result));
  assert.equal(result.submitOutcome.pressed, true);
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(result.requiredFieldConfirmation.passes[0].scope.scopeKind, 'form');
  assert.equal(result.finalSubmitChooser.outcome, 'selected');
});

test('v4 rejects a native GET application form before any request', async () => {
  const { status, result, error, clicks: recorded, requests } = await runV4(
    '/native-get-unsupported',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(status, 0, JSON.stringify(error));
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_transport_unsupported');
  assert.equal(result.finalSubmitChooser.outcome, 'selected');
});

test('v4 blocks a POST-preserving 307 redirect after the caller-bound endpoint', async () => {
  const { status, result, error, clicks: recorded, requests } = await runV4(
    '/native-redirect-preserve-method',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(status, 0, JSON.stringify(error));
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, [{
    method: 'POST',
    path: '/native-redirect-307',
    body: 'email=applicant%40example.com&resume=resume.pdf'
  }]);
  assert.equal(result.submitOutcome.pressed, true);
  assert.equal(result.submitOutcome.transportDisposition, 'write_redirect_blocked');
  assert.equal(result.submitOutcome.observationDisposition, 'post_submit_observation_failed');
});

test('v4 allows a normal GET receipt redirect after the caller-bound POST', async () => {
  const { status, result, error, clicks: recorded, requests } = await runV4(
    '/native-redirect-receipt',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(status, 0, JSON.stringify(error));
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, [
    {
      method: 'POST',
      path: '/native-receipt-redirect',
      body: 'email=applicant%40example.com&resume=resume.pdf'
    },
    { method: 'GET', path: '/native-receipt', body: '' }
  ]);
  assert.equal(result.submitOutcome.pressed, true);
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
});

for (const serializerCase of [
  {
    name: 'an empty',
    fixture: '/native-serializer-empty-file',
    populateFile: false,
    body: 'email=applicant%40example.com&role=engineering&resume=&decision=apply'
  },
  {
    name: 'a populated',
    fixture: '/native-serializer-populated-file',
    populateFile: true,
    body: 'email=applicant%40example.com&role=engineering&resume=resume.pdf&decision=apply'
  }
]) {
  test('v4 native urlencoded serializer preserves field order with ' + serializerCase.name + ' file', async () => {
    const { status, result, error, clicks: recorded, requests } = await runV4(
      serializerCase.fixture,
      nativeSerializerV4Fills(serializerCase.populateFile)
    );
    assert.equal(status, 0, JSON.stringify(error));
    assert.deepEqual(recorded, []);
    assert.deepEqual(requests, [{ method: 'POST', path: '/native-real', body: serializerCase.body }], JSON.stringify(result));
    assert.equal(result.submitOutcome.pressed, true);
    assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
    assert.equal(result.finalSubmitChooser.outcome, 'selected');
  });
}

test('v4 synthetic SubmitEvent and FormDataEvent witnesses cannot authorize a native write', async () => {
  const { status, result, clicks: recorded, requests } = await runV4(
    '/native-activation-synthetic-witness',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'binding_changed');
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_identity_changed');
});

test('v4 rejects a matching-destination native navigation issued by an iframe clone', async () => {
  const { status, result, clicks: recorded, requests } = await runV4('/native-activation-iframe-clone', [
    { type: 'fill', selector: '#native-email', value: 'applicant@example.com', label: 'email' },
    { type: 'fill', selector: '#native-name', value: 'Mehek', label: 'name' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'activation_blocked', JSON.stringify(result));
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_transport_unpinned');
});

test('v4 blocks GET image ping and alternate transports during authorized activation', async () => {
  const { status, result, error, clicks: recorded, requests } = await runV4(
    '/native-activation-side-channels',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(status, 0, JSON.stringify(error));
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'activation_blocked');
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_transport_unpinned');
});

for (const [label, fixture] of [
  ['form action', '/late-final-action-drift'],
  ['hidden job id', '/late-final-hidden-drift'],
  ['submit text', '/late-final-submit-text-drift']
]) {
  test('v4 immutable approval blocks late ' + label + ' drift during the final chooser', async () => {
    const { status, result, clicks: recorded, requests } = await runV4(
      fixture,
      minimalV4Fills('#native-email', '#native-resume')
    );
    assert.equal(status, 0);
    assert.deepEqual(recorded, []);
    assert.deepEqual(requests, []);
    assert.equal(result.submitOutcome.pressed, false);
    assert.equal(result.requiredFieldConfirmation.status, 'blocked');
    assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'form_identity_changed');
    assert.equal(result.finalSubmitChooser.outcome, 'selected');
    assert.equal(result.exactPageUrlProof.beforeFinalChooser, result.exactPageUrlProof.expected);
  });
}

for (const activationMutation of [
  ['pointerdown', 'pointerdown', 'protected_surface_mutated'],
  ['mousedown', 'mousedown', 'protected_surface_mutated'],
  ['focus', 'focus', 'protected_surface_mutated'],
  ['click', 'click', 'protected_surface_mutated'],
  ['submit-time action', 'submit-action', 'protected_surface_mutated'],
  ['submit-time association', 'submit-association', 'protected_surface_mutated'],
  ['cached native direct submit to the real form', 'cached-direct-real', 'submit_event_unobserved'],
  ['cached native direct submit to the decoy form', 'cached-direct-decoy', 'submit_event_unobserved']
]) {
  test('v4 blocks ' + activationMutation[0] + ' transport mutation at the final activation boundary', async () => {
    const { status, result, error, clicks: recorded, requests } = await runV4(
      '/native-activation-' + activationMutation[1],
      minimalV4Fills('#native-email', '#native-resume')
    );
    assert.equal(status, 0, JSON.stringify(error));
    assert.deepEqual(recorded, []);
    assert.deepEqual(requests, [], 'neither the real nor decoy endpoint may receive a request');
    assert.equal(result.submitOutcome.pressed, false);
    assert.equal(result.finalSubmitChooser.outcome, 'binding_changed');
    assert.equal(result.requiredFieldConfirmation.status, 'blocked');
    assert.equal(
      result.requiredFieldConfirmation.passes[0].blockerReason,
      activationMutation[2]
    );
  });
}

test('v4 refuses a role button bare Send even on a successfully populated application form', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-role-send', workableV4Fills());
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.candidateCount, 0);
  assert.equal(result.finalSubmitChooser.bareSendCandidateCount, 1);
});

test('v4 preserves explicit application wording but refuses a non-native role button', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-explicit-role', workableV4Fills());
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertUnsupportedNativeSubmitter(result);
  assert.equal(result.finalSubmitChooser.topScore, 3);
});

test('v4 refuses bare Send when the submitter overrides the application form action', async () => {
  const { status, result, clicks: recorded, screenshot } = await runV4(
    '/workable-formaction-override',
    workableV4Fills()
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(screenshot, true);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.candidateCount, 0);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
  assert.equal(result.finalSubmitChooser.bareSendCandidateCount, 1);
  assert.equal(result.exactPageUrlProof.beforeFinalChooser, result.exactPageUrlProof.expected);
});

test('v4 refuses bare Send when the application form targets a new browsing context', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-form-target', workableV4Fills());
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.candidateCount, 0);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
  assert.equal(result.finalSubmitChooser.bareSendCandidateCount, 1);
});

test('v4 refuses bare Send when the document base targets a new browsing context', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-base-target', workableV4Fills());
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.candidateCount, 0);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
  assert.equal(result.finalSubmitChooser.bareSendCandidateCount, 1);
});

test('v4 scopes native bare Send to its associated form, not its nearest ancestor form', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-association-decoy', workableV4Fills());
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.candidateCount, 1);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
  assert.equal(result.finalSubmitChooser.bareSendCandidateCount, 1);
});

test('v4 invalidates text and file proofs that become read-only or disabled before submission', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-control-state-drift', [
    ...workableV4Fills(),
    { type: 'click', selector: '#mutate-control-state' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 1);
});

test('v4 treats equal bare Send controls as ambiguous and clicks neither', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-ambiguous-send', workableV4Fills());
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation, null);
  assert.equal(result.finalSubmitChooser.outcome, 'ambiguous_submit');
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 2);
  assert.equal(result.finalSubmitChooser.topScore, 0);
  assert.equal(result.finalSubmitChooser.topScoreCount, 2);
});

test('v4 explicit application wording outranks bare Send but cannot authorize a non-native button', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-explicit-wins', workableV4Fills());
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertUnsupportedNativeSubmitter(result);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 2);
  assert.equal(result.finalSubmitChooser.topScore, 3);
  assert.equal(result.finalSubmitChooser.topScoreCount, 1);
});

test('v4 revalidates successful controls and refuses after the application form is replaced', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-form-drift', [
    ...workableV4Fills(),
    { type: 'click', selector: '#rerender', label: 'refresh_form' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 0);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
});

test('v4 proof loss cannot redirect to an explicit submit on another form', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/workable-proof-loss-explicit-decoy',
    [...workableV4Fills(), { type: 'click', selector: '#drop-proofs', label: 'refresh_application' }]
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
});

test('v4 activation capture blocks pointerdown drift before a direct click transport', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/workable-activation-pointer-drift', workableV4Fills()
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason,
    'protected_surface_mutated');
  assert.equal(result.finalSubmitChooser.outcome, 'binding_changed');
});

test('v4 activation capture blocks click drift before form or direct network handlers transmit', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/workable-activation-click-drift', workableV4Fills()
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason,
    'protected_surface_mutated');
  assert.equal(result.finalSubmitChooser.outcome, 'binding_changed');
});

test('v4 no-click blocks pre-chooser POST GET image ping WebSocket WebTransport and EventSource', async () => {
  const { status, result, clicks: recorded, requests } = await runV4('/workable-prechooser-auto-submit', [
    ...workableV4Fills(),
    { type: 'select', selector: '#prechooser-select', value: 'Dubai', label: 'location' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation, null);
  assert.equal(result.finalSubmitChooser.outcome, 'ambiguous_submit');
});

test('v4 opt-in decline never clicks a radio on an unrelated form', async () => {
  const { status, result, clicks: recorded, requests } = await runV4(
    '/cross-form-optin-decoy',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
});

test('v4 binds form semantics before an applicant action and refuses action drift', async () => {
  const { status, result, clicks: recorded, requests } = await runV4('/action-boundary-drift', [
    { type: 'click', selector: '#arm-boundary', label: 'arm_boundary_drift' },
    {
      type: 'fill',
      selector: '#boundary-email',
      value: 'applicant@example.com',
      label: 'email',
      optional: true
    }
  ], [
    { type: 'extract', selector: '#boundary-email', attribute: 'value' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'application_scope_invalid');
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason,
    'application_scope_semantics_changed');
  assert.equal(result.extracted.find((entry) => entry.selector === '#boundary-email')?.value, '');
});

test('v4 refuses a two-field job alert form with native bare Send', async () => {
  const { status, result, clicks: recorded, requests } = await runV4('/job-alert-bare-send', [
    { type: 'fill', selector: '#alert-email', value: 'applicant@example.com' },
    { type: 'fill', selector: '#keywords', value: 'engineering' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assertScriptInterceptedNativeTransport(result);
  assert.equal(result.exactPageUrlProof.beforeFinalChooser, result.exactPageUrlProof.expected);
  assert.equal(result.exactPageUrlProof.beforeSubmit, result.exactPageUrlProof.expected);
});

test('v4 refuses a populated talent network even when its resume upload succeeded', async () => {
  const { status, result, clicks: recorded, requests } = await runV4('/talent-pool-bare-send', [
    { type: 'fill', selector: '#talent-name', value: 'Mehek' },
    { type: 'fill', selector: '#talent-email', value: 'applicant@example.com' },
    {
      type: 'upload', selector: '#talent-resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assertScriptInterceptedNativeTransport(result);
  assert.equal(result.exactPageUrlProof.beforeFinalChooser, result.exactPageUrlProof.expected);
  assert.equal(result.exactPageUrlProof.beforeSubmit, result.exactPageUrlProof.expected);
});

test('v4 accepts snake_case application and resume identity tokens', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/minimal-file-drift',
    minimalV4Fills('#drift-email', '#drift-resume')
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
});

test('v4 invalidates a substituted one-file resume proof', async () => {
  const { status, result, clicks: recorded } = await runV4('/minimal-file-drift', [
    ...minimalV4Fills('#drift-email', '#drift-resume'),
    { type: 'click', selector: '#mutate' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
});

test('v4 invalidates a checked choice whose value and label drift', async () => {
  const { status, result, clicks: recorded } = await runV4('/choice-drift', [
    {
      type: 'upload', selector: '#choice-resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    },
    { type: 'fillByLabelText', text: 'Authorized to work?', value: 'Yes' },
    { type: 'click', selector: '#mutate' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
});

test('v4 accepts a verified fillByLabelText choice as one of two proofs', async () => {
  const { status, result, clicks: recorded } = await runV4('/choice-drift', [
    {
      type: 'upload', selector: '#choice-resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    },
    { type: 'fillByLabelText', text: 'Authorized to work?', value: 'Yes' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.finalSubmitChooser.outcome, 'selected');
  assert.equal(result.finalSubmitChooser.topScore, 0);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
});

test('v4 invalidates successful controls reparented into another form', async () => {
  const { status, result, clicks: recorded } = await runV4('/reparent-drift', [
    ...minimalV4Fills('#move-email', '#move-resume'),
    { type: 'click', selector: '#mutate' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
});

test('v4 invalidates same-node text controls repurposed to another workflow', async () => {
  const { status, result, clicks: recorded } = await runV4('/text-repurpose-drift', [
    { type: 'fill', selector: '#identity-email', value: 'applicant@example.com' },
    { type: 'fill', selector: '#identity-name', value: 'Mehek' },
    { type: 'click', selector: '#mutate' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
});

test('v4 revalidates proofs after required-field confirmation mutates a file', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/confirmation-file-drift',
    [...minimalV4Fills('#confirm-email', '#confirm-resume'), { type: 'click', selector: '#arm' }]
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
});

test('v4 reruns the chooser and refuses sibling text drift to a second bare Send', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/confirmation-sibling-drift',
    [...minimalV4Fills('#confirm-email', '#confirm-resume'), { type: 'click', selector: '#arm' }]
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'ambiguous_submit');
});

test('v4 refuses a same-node submitter value change during confirmation', async () => {
  const { status, result, error, clicks: recorded } = await runV4(
    '/confirmation-value-drift',
    [...minimalV4Fills('#confirm-email', '#confirm-resume'), { type: 'click', selector: '#arm' }]
  );
  assert.equal(status, 0, JSON.stringify(error));
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'form_identity_changed');
});

test('v4 keeps exact proof handles valid when confirmation adds a form validation class', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/confirmation-class-change',
    [...minimalV4Fills('#confirm-email', '#confirm-resume'), { type: 'click', selector: '#arm' }]
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
});

test('v4 refuses a late base URL change that alters the resolved form action', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/late-base-href-drift',
    [...minimalV4Fills('#base-email', '#base-resume'), { type: 'click', selector: '#arm-base' }]
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'form_identity_changed');
});

test('v4 final chooser globally counts an unrelated form proof reactivated during confirmation', async () => {
  const { status, result, clicks: recorded } = await runV4('/reactivated-unrelated-form', [
    { type: 'fill', selector: '#reactivated-newsletter', value: 'alerts@example.com' },
    ...minimalV4Fills('#reactivated-email', '#reactivated-resume'),
    { type: 'click', selector: '#drift-unrelated' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_chooser_changed');
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 2);
});

test('v4 keeps proof handles valid across a same-document history hash update', async () => {
  const { status, result, clicks: recorded } = await runV4('/history-parity', [
    ...workableV4Fills(),
    { type: 'click', selector: '#history' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
});

test('v4 fails closed for a script-handled shadow-root form under native-only transport', async () => {
  const { status, result, clicks: recorded, requests } = await runV4(
    '/shadow-bare-send',
    minimalV4Fills('#shadow-email', '#shadow-resume')
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assertScriptInterceptedNativeTransport(result);
  assert.equal(result.exactPageUrlProof.beforeFinalChooser, result.exactPageUrlProof.expected);
  assert.equal(result.exactPageUrlProof.beforeSubmit, result.exactPageUrlProof.expected);
});

test('v4 refuses bare Send when this run also successfully populated an unrelated form', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-unrelated-form', [
    { type: 'fill', selector: '#newsletter-email', value: 'alerts@example.com' },
    ...workableV4Fills()
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 2);
});

test('v4 ignores forged successful-address attributes and clicks nothing', async () => {
  const { status, result, clicks: recorded, screenshot } = await runV4('/forged-success-markers');
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(screenshot, true);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 0);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
});

test('v4 no-click is terminal before a later generic click', async () => {
  const { status, result, clicks: recorded } = await runV4('/contact-bare-send', [
    { type: 'fill', selector: '#contact-email', value: 'applicant@example.com' },
    { type: 'fill', selector: '#message', value: 'Hello' }
  ], [{ type: 'click', selector: '#send' }]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.match(result.skipped.join('\n'), /skipped after the atomic submit decision became terminal/);
});

test('v4 no-click is terminal before a later Enter press', async () => {
  const { status, result, clicks: recorded } = await runV4('/contact-bare-send', [
    { type: 'fill', selector: '#contact-email', value: 'applicant@example.com' },
    { type: 'fill', selector: '#message', value: 'Hello' }
  ], [{ type: 'press', selector: '#contact-email', value: 'Enter' }]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.match(result.skipped.join('\n'), /skipped after the atomic submit decision became terminal/);
});

for (const drift of [
  ['hidden', '/confirmation-hidden-drift'],
  ['external hidden', '/confirmation-external-hidden-drift'],
  ['optional consent', '/confirmation-consent-drift']
]) {
  test('v4 binds ' + drift[0] + ' submitted state through confirmation', async () => {
    const { status, result, clicks: recorded } = await runV4(
      drift[1],
      [...minimalV4Fills('#confirm-email', '#confirm-resume'), { type: 'click', selector: '#arm' }]
    );
    assert.equal(status, 0);
    assert.deepEqual(recorded, []);
    assert.equal(result.submitOutcome.pressed, false);
    assert.equal(result.requiredFieldConfirmation.status, 'blocked');
    assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'form_identity_changed');
  });
}

test('v4 returned fingerprints do not expose deterministic submitted values', async () => {
  const first = await runV4(
    '/confirmation-hidden-drift',
    [...minimalV4Fills('#confirm-email', '#confirm-resume'), { type: 'click', selector: '#arm' }]
  );
  const second = await runV4(
    '/confirmation-hidden-drift',
    [...minimalV4Fills('#confirm-email', '#confirm-resume'), { type: 'click', selector: '#arm' }]
  );
  assert.equal(first.status, 0);
  assert.equal(second.status, 0);
  const serialized = JSON.stringify(first.result);
  const deterministicSecretHash = crypto.createHash('sha256').update('csrf-low-entropy-secret').digest('hex');
  assert.doesNotMatch(serialized, /csrf-low-entropy-secret/);
  assert.equal(serialized.includes(deterministicSecretHash), false);
  assert.notEqual(
    first.result.requiredFieldConfirmation.passes[0].scope.formFingerprint,
    second.result.requiredFieldConfirmation.passes[0].scope.formFingerprint
  );
});

test('v4 blocks an initially over-bound submitted-control inventory', async () => {
  const { status, result, clicks: recorded } = await runV4('/over-bound-submitted-state', [
    ...minimalV4Fills('#bound-email', '#bound-resume'),
    { type: 'click', selector: '#arm-bound' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.match(result.requiredFieldConfirmation.passes[0].unresolved.join('\n'), /submitted controls/);
});

test('v4 requires two distinct successful controls, not two uploads to one resume', async () => {
  const upload = {
    type: 'upload', selector: '#drift-resume',
    file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
  };
  const { status, result, clicks: recorded } = await runV4('/minimal-file-drift', [upload, upload]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
});

test('v4 proof-authorized bare Send cannot be outranked by an external Submit form', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-external-submit', workableV4Fills());
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
  assert.equal(result.finalSubmitChooser.topScore, 0);
});

test('v4 disabled proof-authorized Send prevents an enabled external Submit from winning', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/workable-disabled-external-submit', workableV4Fills()
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
});

test('v4 native explicit submit uses its associated form and cannot submit a decoy', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/workable-explicit-associated-decoy', workableV4Fills()
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
  assert.equal(recorded.includes('explicit-associated-decoy'), false);
});

test('v4 refuses a submit-capable selected custom choice during confirmation', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/custom-submit-choice', minimalV4Fills('#custom-email', '#custom-resume')
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
});

for (const variant of ['bare', 'explicit']) {
  test('v4 direct handles refuse late ' + variant + ' submitter reparenting', async () => {
    const { status, result, clicks: recorded } = await runV4(
      '/late-' + variant + '-reparent', minimalV4Fills('#late-email', '#late-resume')
    );
    assert.equal(status, 0);
    assert.deepEqual(recorded, []);
    assert.equal(result.submitOutcome.pressed, false);
    assert.equal(result.requiredFieldConfirmation.status, 'blocked');
    assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_chooser_changed');
  });
}

test('v4 fails closed when a genuinely formless application has no caller-bound form', async () => {
  const { status, result, clicks: recorded, requests } = await runV4('/ashby');
  assert.equal(status, 0);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'application_scope_invalid');
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
});

test('v4 preserves explicit native submitter override semantics', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/workable-explicit-override', workableV4Fills()
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result, 'submit_request_unobserved', 'activation_blocked');
  assert.equal(result.finalSubmitChooser.topScore, 3);
});

test('v4 publishes no candidate or scope marker authority for an observer to redirect', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/direct-marker-redirect',
    minimalV4Fills('#direct-email', '#direct-resume'),
    [
      { type: 'extract', selector: '#send', attribute: 'data-litos-submit-candidate-v2' },
      { type: 'extract', selector: '#application_form', attribute: 'data-litos-submit-scope-v2' },
      { type: 'extract', selector: '#decoy-submit', attribute: 'data-litos-submit-candidate-v2' },
      { type: 'extract', selector: '#decoy-form', attribute: 'data-litos-submit-scope-v2' }
    ]
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
  for (const selector of ['#send', '#application_form', '#decoy-submit', '#decoy-form']) {
    assert.equal(valueOf(result, selector), null);
  }
});

test('v3 chooser markers remain mirrors and cannot redirect the selected submitter or scope', async () => {
  const { status, result, clicks: recorded } = await run('/direct-marker-redirect');
  assert.equal(status, 0);
  assert.deepEqual(recorded, ['direct-real']);
  assert.equal(result.submitOutcome.pressed, true);
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
});

test('v4 accepts successful controls externally associated with the application form', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/external-associated-bare-send',
    minimalV4Fills('#external-email', '#external-resume')
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
  assert.equal(result.finalSubmitChooser.topScore, 0);
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
});

for (const semantics of ['base', 'method']) {
  test('v4 invalidates successful proofs after pre-chooser form ' + semantics + ' drift', async () => {
    const { status, result, clicks: recorded } = await runV4(
      '/pre-chooser-' + semantics + '-drift',
      [
        ...minimalV4Fills('#proof-email', '#proof-resume'),
        { type: 'click', selector: '#mutate-proof' }
      ]
    );
    assert.equal(status, 0);
    assert.deepEqual(recorded, []);
    assert.equal(result.submitOutcome.pressed, false);
    assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
    assert.equal(result.finalSubmitChooser.addressedScopeCount, 0);
  });
}

test('v4 does not re-resolve a transferred addressed selector into a decoy form', async () => {
  const { status, result, clicks: recorded } = await runV4('/selector-id-transfer', [
    { type: 'fill', selector: '#transfer-email', value: 'applicant@example.com', label: 'email' },
    { type: 'click', selector: '#transfer-id' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
});

for (const variant of ['strip', 'replace']) {
  test('v4 runner-owned failed choice remains a blocker after DOM ' + variant, async () => {
    const { status, result, clicks: recorded } = await runV4(
      '/failed-choice-' + variant,
      [
        ...minimalV4Fills('#failed-email', '#failed-resume'),
        {
          type: 'fillByLabelText',
          text: 'Work authorization',
          value: 'Yes',
          label: 'work_authorization',
          optional: true
        },
        ...(variant === 'replace' ? [{ type: 'click', selector: '#replace-failed' }] : [])
      ],
      [{ type: 'extract', selector: '#authorization-question', attribute: 'data-litos-unverified-choice' }]
    );
    assert.equal(status, 0);
    assert.deepEqual(recorded, []);
    assert.equal(result.submitOutcome.pressed, false);
    assert.equal(result.requiredFieldConfirmation.status, 'blocked');
    assert.match(result.requiredFieldConfirmation.passes[0].unresolved.join('\n'), /choice this run could not/);
    assert.equal(valueOf(result, '#authorization-question'), null);
  });
}

test('v3 private failed-choice authority survives removal of its legacy marker mirror', async () => {
  const { status, result, clicks: recorded } = await run(
    '/failed-choice-strip-v3',
    [],
    [
      ...minimalV4Fills('#failed-email', '#failed-resume'),
      {
        type: 'fillByLabelText',
        text: 'Work authorization',
        value: 'Yes',
        label: 'work_authorization',
        optional: true
      }
    ]
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.match(result.requiredFieldConfirmation.passes[0].unresolved.join('\n'), /choice this run could not/);
});

test('v4 keeps a detached whole-form failed choice as a global refusal', async () => {
  const { status, result, clicks: recorded, requests } = await runV4('/whole-form-failed-choice', [
    {
      type: 'fillByLabelText',
      text: 'Work authorization',
      value: 'Yes',
      label: 'work_authorization',
      optional: true
    },
    { type: 'click', selector: '#replace-whole-form' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation, null);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.exactPageUrlProof.beforeFinalChooser, result.exactPageUrlProof.expected);
  assert.equal(result.exactPageUrlProof.beforeSubmit, null);
});

test('v4 blocks an empty required control externally associated with the form', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/external-required-control',
    minimalV4Fills('#external-required-email', '#external-required-resume')
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.match(
    result.requiredFieldConfirmation.passes[0].unresolved.join('\n'),
    /Employer question/
  );
});

const resumeUpload = (selector) => ({
  type: 'upload',
  selector,
  label: 'resume',
  file: {
    name: 'resume.pdf',
    mimeType: 'application/pdf',
    base64: Buffer.from('resume').toString('base64')
  }
});

for (const targetSwap of [
  {
    kind: 'fill',
    fixture: '/fill-target-swap',
    actions: [
      resumeUpload('#stable-resume'),
      { type: 'fill', selector: '#swap-target', value: 'Mehek', label: 'name', optional: true }
    ]
  },
  {
    kind: 'fillByLabelText',
    fixture: '/fill-by-target-swap',
    actions: [
      resumeUpload('#stable-resume'),
      { type: 'fillByLabelText', text: 'Applicant value', value: 'Mehek', label: 'name', optional: true }
    ]
  },
  {
    kind: 'select',
    fixture: '/select-target-swap',
    actions: [
      resumeUpload('#stable-resume'),
      { type: 'select', selector: '#swap-target', value: 'yes', label: 'answer', optional: true }
    ]
  },
  {
    kind: 'upload',
    fixture: '/upload-target-swap',
    actions: [
      { type: 'fill', selector: '#stable-email', value: 'applicant@example.com', label: 'email' },
      { ...resumeUpload('#swap-target'), optional: true }
    ]
  }
]) {
  test('v4 pins the exact ' + targetSwap.kind + ' target through mutation and readback', async () => {
    const { status, result, clicks: recorded } = await runV4(targetSwap.fixture, targetSwap.actions);
    assert.equal(status, 0);
    assert.deepEqual(recorded, []);
    assert.equal(result.submitOutcome.pressed, false);
    assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
    assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
  });
}

test('a formless Ashby application binds the field container and submits exactly once', async () => {
  const { status, result, clicks: recorded } = await run('/ashby', [
    { type: 'extract', selector: '#form', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#root', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '.ashby-job-posting-right-pane', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: 'button._active_1svni_57' },
    { type: 'extract', selector: 'input[name="4c3852e7-e63c-44dc-956b-a819f456e945"]', attribute: 'checked' }
  ]);
  assert.equal(status, 0, 'the run must not abort on a page with no form element');
  assert.deepEqual(recorded, ['ashby'], 'the submit control is pressed exactly once');
  assert.equal(valueOf(result, '#submitted'), 'ashby');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(result.submitOutcome.pressed, true);
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.equal(pass.submissionOutcome, 'clicked');
  assert.equal(pass.scope.scopeKind, 'container');
  assert.equal(pass.scope.sameNode, true);
  assert.deepEqual(pass.unresolved, []);
  const priorGovernment = pass.attempts.find((attempt) => attempt.label === 'Prior US Government Employment?');
  assert.equal(priorGovernment?.fieldType, 'checkbox');
  assert.equal(priorGovernment?.outcome, 'already_committed');
  assert.equal(valueOf(result, 'button._active_1svni_57'), 'No');
  assert.equal(valueOf(result, 'input[name="4c3852e7-e63c-44dc-956b-a819f456e945"]'), null,
    'confirming No must not flip Ashby\'s unchecked boolean backing input to Yes');
  // The nearest ancestor holding field controls is div#form, not the pane above it and not the root.
  // Ashby's answer pills are buttons too, so the final candidate's DOM index is intentionally opaque.
  assert.match(valueOf(result, '#form') || '', /^\d+$/);
  assert.equal(valueOf(result, '.ashby-job-posting-right-pane'), null);
  assert.equal(valueOf(result, '#root'), null);
});

test('an unanswered Ashby yes/no still blocks the atomic submit', async () => {
  const { status, result, clicks: recorded } = await run('/ashby?leave-government-unanswered');
  assert.equal(status, 0, 'a truthful atomic refusal is a completed managed run');
  assert.deepEqual(recorded, [], 'no submit control is pressed while the required pill has no selection');
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.submitOutcome.pressed, false);
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.equal(pass.submissionOutcome, 'blocked');
  assert.ok(pass.unresolved.includes('Prior US Government Employment?'));
  const priorGovernment = pass.attempts.find((attempt) => attempt.label === 'Prior US Government Employment?');
  assert.equal(priorGovernment?.fieldType, 'checkbox');
  assert.equal(priorGovernment?.outcome, 'failed');
});

test('a non-Ashby radio group keeps its checked peer despite an unrelated button', async () => {
  const { status, result, clicks: recorded } = await run('/ashby?non-ashby-radio-peer');
  assert.equal(status, 0);
  assert.deepEqual(recorded, ['ashby'], 'an ordinary button must not short-circuit checked radio peers');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(result.requiredFieldConfirmation.passes[0].unresolved.length, 0);
});

test('a hidden active sibling cannot answer an ordinary unchecked fieldset checkbox', async () => {
  const { status, result, clicks: recorded } = await run('/ashby?fieldset-sibling-checkbox');
  assert.equal(status, 0);
  assert.deepEqual(recorded, [], 'selected-looking sibling furniture must not authorize submit');
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.submitOutcome.pressed, false);
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.ok(pass.unresolved.includes('I consent'));
  const consent = pass.attempts.find((attempt) => attempt.label === 'I consent');
  assert.equal(consent?.fieldType, 'checkbox');
  assert.equal(consent?.outcome, 'failed');
});

test('the Greenhouse shape still binds its real form and ignores the Apply button outside it', async () => {
  const { status, result, clicks: recorded } = await run('/greenhouse', [
    { type: 'extract', selector: '#application', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#page', attribute: 'data-litos-submit-scope-v2' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, ['greenhouse'], 'the in-form submit is pressed, and the decoy never is');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.equal(pass.scope.scopeKind, 'form', 'a form ancestor still wins outright');
  assert.equal(pass.submissionOutcome, 'clicked');
  assert.equal(valueOf(result, '#application'), '1', 'candidate 1 is the in-form submit');
  // The decoy resolves no scope at all on a page that has a viable in-form candidate, so nothing
  // above the form is ever a submission scope.
  assert.equal(valueOf(result, '#page'), null);
});

test('German Recruitee binds exact Senden only inside the addressed application form', async () => {
  const { status, result, clicks: recorded } = await run('/recruitee-german', [
    { type: 'extract', selector: '#application', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#page', attribute: 'data-litos-submit-scope-v2' }
  ], [
    { type: 'fill', selector: 'input[name="candidate.name"]', value: 'Mehek Mandal', label: 'name' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, ['recruitee'], 'only the form-bound Senden control is pressed');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(result.requiredFieldConfirmation.passes[0].scope.scopeKind, 'form');
  assert.match(valueOf(result, '#application') || '', /^\d+$/);
  assert.equal(valueOf(result, '#page'), null, 'a page-level Senden control has no submission scope');
});

test('a header Apply Now cannot outscore the real in-form Submit', async () => {
  const { status, result, clicks: recorded } = await run('/outscoring-decoy', [
    { type: 'extract', selector: '#application', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#wrapper', attribute: 'data-litos-submit-scope-v2' }
  ]);
  assert.equal(status, 0);
  // "Apply Now" scores 2 and "Submit" scores 1, so score alone would press the wrong control.
  assert.deepEqual(recorded, ['real'], 'the form submit is pressed and the header decoy is not');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(result.requiredFieldConfirmation.passes[0].scope.scopeKind, 'form');
  assert.equal(valueOf(result, '#application'), '1');
  assert.equal(valueOf(result, '#wrapper'), null, 'the wrapper is never a scope while a form is viable');
});

test('a submit whose only container would be body fails closed and clicks nothing', async () => {
  const { status, result, clicks: recorded } = await run('/body-only');
  assert.notEqual(status, 0, 'no scope means no submit, and the run stops');
  assert.equal(result, null, 'a failed pass writes no result packet');
  assert.deepEqual(recorded, [], 'nothing on the page may be pressed');
});

test('two equally scored final controls in one container stay ambiguous and click nothing', async () => {
  const { status, result, clicks: recorded } = await run('/ambiguous');
  assert.notEqual(status, 0, 'an equal top-score tie must fail closed on a formless page too');
  assert.equal(result, null);
  assert.deepEqual(recorded, [], 'neither candidate may be pressed');
});

test('a container smaller than the application refuses rather than clicking past a required field', async () => {
  const { status, result, clicks: recorded } = await run('/nested');
  assert.notEqual(status, 0, 'a required field outside the container is unresolvable, not ignorable');
  assert.equal(result, null);
  assert.deepEqual(recorded, [], 'the empty work authorisation question withholds the click');
});

test('a submit outside the field container binds the wrapper that holds both', async () => {
  const { status, result, clicks: recorded } = await run('/footer-bar', [
    { type: 'extract', selector: '#page', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#footer-bar', attribute: 'data-litos-submit-scope-v2' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, ['footer'], 'a footer submit over a complete form still sends once');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.equal(pass.scope.scopeKind, 'container');
  assert.equal(pass.scope.requiredControlCount, 2, 'both application fields are in scope');
  assert.equal(valueOf(result, '#page'), '0');
  assert.equal(valueOf(result, '#footer-bar'), null, 'a box with no fields is not a scope');
});

test('required page furniture inside the bound wrapper withholds the click', async () => {
  const { status, result, clicks: recorded } = await run('/footer-bar-furniture');
  assert.equal(status, 0);
  assert.deepEqual(recorded, [], 'an unexplained required field in scope is never clicked past');
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.submitOutcome.pressed, false);
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.equal(pass.submissionOutcome, 'blocked');
  assert.ok(pass.unresolved.some((entry) => /Job alert email/.test(entry)), 'and it says what stopped it');
});

test('a real form beside a formless application does not veto that application', async () => {
  const { status, result, clicks: recorded } = await run('/sibling-form', [
    { type: 'extract', selector: '#app-form', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#newsletter', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#alerts', attribute: 'value' }
  ]);
  assert.equal(status, 0);
  // The newsletter's email is required and empty, but it belongs to its own form's submission.
  assert.deepEqual(recorded, ['bamboo'], 'the application is sent and the newsletter is never pressed');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.equal(pass.scope.scopeKind, 'container');
  assert.equal(pass.scope.requiredControlCount, 3, 'only the application fields are scanned');
  // The newsletter's button is candidate 0 and says "Submit", so it is a final control by the
  // grammar. What stops it vetoing the container path is that its form is one email field: it
  // collects nothing an application collects, so it is not a submission scope at all.
  assert.equal(valueOf(result, '#newsletter'), null);
  assert.equal(valueOf(result, '#app-form'), '1');
  assert.equal(valueOf(result, '#alerts'), '', 'the newsletter field is untouched');
});

test('a stray newsletter form whose button says Submit never takes the click', async () => {
  const { status, result, clicks: recorded } = await run('/stray-newsletter', [
    { type: 'extract', selector: '#app-form', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#stray', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#alerts', attribute: 'value' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, ['application'], 'the application is pressed and the newsletter is not');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.equal(pass.scope.scopeKind, 'container', 'the formless application is still reachable');
  assert.equal(pass.submissionOutcome, 'clicked');
  assert.equal(valueOf(result, '#app-form'), '1', 'candidate 1 is the application submit');
  assert.equal(valueOf(result, '#stray'), null, 'a one field newsletter is not a submission scope');
  assert.equal(valueOf(result, '#alerts'), 'reader@example.com', 'the newsletter is untouched');
});

test('a stray filter form whose button says Apply never takes the click', async () => {
  const { status, result, clicks: recorded } = await run('/stray-filter', [
    { type: 'extract', selector: '#app-form', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#stray', attribute: 'data-litos-submit-scope-v2' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, ['application'], 'the application is pressed and the filter is not');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(result.requiredFieldConfirmation.passes[0].scope.scopeKind, 'container');
  assert.equal(valueOf(result, '#app-form'), '1');
  assert.equal(valueOf(result, '#stray'), null, 'a keyword box and two selects are not an application');
});

test('the benign stray label is decided the same way as the two reported ones', async () => {
  // "Subscribe" is not a final control, so this page was already submitted correctly. It is here
  // to fail any fix that recognises the labels it was told about instead of the shape of the form.
  const { status, result, clicks: recorded } = await run('/stray-subscribe', [
    { type: 'extract', selector: '#app-form', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#stray', attribute: 'data-litos-submit-scope-v2' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, ['application'], 'the application is pressed and Subscribe is not');
  assert.equal(result.requiredFieldConfirmation.passes[0].scope.scopeKind, 'container');
  assert.equal(valueOf(result, '#app-form'), '1');
  assert.equal(valueOf(result, '#stray'), null);
});

test('a page carrying only a stray form and no application clicks nothing', async () => {
  const { status, result, clicks: recorded } = await run('/stray-only');
  // Clicks first, deliberately: what this case is about is the control that gets pressed, and a
  // failure that names the exit code before the click hides which form was submitted.
  assert.deepEqual(recorded, [], 'a stranger\'s form is never pressed to satisfy a submit action');
  assert.notEqual(status, 0, 'no application means no submit, and the run stops');
  assert.equal(result, null, 'a failed pass writes no result packet');
});

test('a three field application with a bare Submit is not mistaken for a stray form', async () => {
  const { status, result, clicks: recorded } = await run('/minimal-application', [
    { type: 'extract', selector: '#application', attribute: 'data-litos-submit-scope-v2' }
  ]);
  assert.equal(status, 0, 'the smallest real application must still submit');
  assert.deepEqual(recorded, ['minimal'], 'name, email and a resume is an application');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.equal(pass.scope.scopeKind, 'form');
  assert.equal(pass.submissionOutcome, 'clicked');
  assert.equal(valueOf(result, '#application'), '0');
});

test('a one field form this run never touched is not submitted', async () => {
  const { status, result, clicks: recorded } = await run('/one-field-form');
  assert.deepEqual(recorded, [], 'a form with no more in it than a newsletter has is not pressed');
  assert.notEqual(status, 0);
  assert.equal(result, null);
});

test('a one field form this run was sent to fill is the application', async () => {
  const { status, result, clicks: recorded } = await run('/one-field-form', [
    { type: 'extract', selector: '#signup', attribute: 'data-litos-submit-scope-v2' }
  ], [
    { type: 'fill', selector: '#one-email', value: 'mehek@example.com', label: 'Email' }
  ]);
  assert.equal(status, 0, 'the same page, submitted, because this run filled it');
  assert.deepEqual(recorded, ['one-field'], 'the form this run typed into is the one it submits');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(result.requiredFieldConfirmation.passes[0].scope.scopeKind, 'form');
  assert.equal(valueOf(result, '#signup'), '0');
});

test('a self identification page under a sticky bar presses neither of them', async () => {
  const { status, result, clicks: recorded } = await run('/eeo-sticky-bar');
  assert.deepEqual(recorded, [], 'the sticky bar is not a consolation prize for refusing the form');
  assert.notEqual(status, 0, 'a form this run cannot confirm ends the run, it does not redirect it');
  assert.equal(result, null);
});

test('the same self identification page submits its own form once the run has answered it', async () => {
  const { status, result, clicks: recorded } = await run('/eeo-sticky-bar', [
    { type: 'extract', selector: '#real', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#decoy', attribute: 'data-litos-submit-scope-v2' }
  ], [
    { type: 'fill', selector: '#race', value: 'Asian', label: 'Race' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, ['application'], 'the form this run answered is the one it submits');
  assert.equal(result.requiredFieldConfirmation.passes[0].scope.scopeKind, 'form');
  assert.equal(valueOf(result, '#real'), '0', 'candidate 0 is the form submit');
  assert.equal(valueOf(result, '#decoy'), null, 'the bar is never a scope while the form is viable');
});

test('a one question screening form under a sticky bar presses neither of them', async () => {
  const { status, result, clicks: recorded } = await run('/screening-sticky-bar');
  assert.deepEqual(recorded, [], 'one answered question is not enough to press anything on this page');
  assert.notEqual(status, 0);
  assert.equal(result, null);
});

test('the same screening page submits its own form once the run has filled it', async () => {
  const { status, result, clicks: recorded } = await run('/screening-sticky-bar', [], [
    { type: 'fill', selector: '#years', value: '3', label: 'Years of Python' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, ['application'], 'the filled form wins over the formless bar');
  assert.equal(result.requiredFieldConfirmation.passes[0].scope.scopeKind, 'form');
});

test('a refused form beside a decoy that clears the intake bar still presses neither', async () => {
  /* The decoy collects a name and an email, which is exactly what the refused form failed to show.
   * A threshold cannot separate them, because the decoy is over it. Only the two things a decoy
   * cannot manufacture can: this run's own record of what it wrote, and a label that names the
   * application. The decoy has neither. */
  const { status, result, clicks: recorded } = await run('/eeo-rich-decoy', [
    { type: 'extract', selector: '#decoy', attribute: 'data-litos-submit-scope-v2' }
  ]);
  assert.deepEqual(recorded, [], 'a richer decoy is still not this run\'s application');
  assert.notEqual(status, 0);
  assert.equal(result, null);
});

test('a refused form beside a decoy carrying a file input still presses neither', async () => {
  // The other half of the intake test, bought just as cheaply: one email and a CV upload.
  const { status, result, clicks: recorded } = await run('/screening-rich-decoy');
  assert.deepEqual(recorded, [], 'an upload box does not make a widget the application either');
  assert.notEqual(status, 0);
  assert.equal(result, null);
});

test('the rich decoy page submits the real form once the run has answered it', async () => {
  const { status, result, clicks: recorded } = await run('/eeo-rich-decoy', [
    { type: 'extract', selector: '#real', attribute: 'data-litos-submit-scope-v2' },
    { type: 'extract', selector: '#decoy', attribute: 'data-litos-submit-scope-v2' }
  ], [
    { type: 'fill', selector: '#race', value: 'Asian', label: 'Race' }
  ]);
  assert.equal(status, 0, 'refusing the decoy must not cost the page its own submit');
  assert.deepEqual(recorded, ['application'], 'the answered form wins over the richer decoy');
  assert.equal(result.requiredFieldConfirmation.passes[0].scope.scopeKind, 'form');
  assert.equal(valueOf(result, '#real'), '0');
  assert.equal(valueOf(result, '#decoy'), null);
});

test('a real Greenhouse form beside a stray form is chosen exactly as it is today', async () => {
  const { status, result, clicks: recorded } = await run('/greenhouse-stray', [
    { type: 'extract', selector: '#application', attribute: 'data-litos-submit-scope-v2' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, ['greenhouse'], 'the application form is pressed, and only it');
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(result.requiredFieldConfirmation.passes[0].scope.scopeKind, 'form');
  assert.equal(valueOf(result, '#application'), '2', 'candidate 2 is the in-form submit');
});

test('the container scope bounds the required-field scan to its own fields', async () => {
  // The block outside the container carries a live "This requires an answer" over a field this run
  // never filled. A scope that leaked up to the page would report it and blame the wrong form.
  const { status, result, clicks: recorded } = await run('/scan-bounds');
  assert.equal(status, 0);
  assert.deepEqual(recorded, [], 'an empty required field in scope withholds the click');
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.submitOutcome.pressed, false);
  const pass = result.requiredFieldConfirmation.passes[0];
  assert.equal(pass.scope.scopeKind, 'container');
  assert.equal(pass.scope.requiredControlCount, 1);
  assert.equal(pass.attempts.length, 1);
  assert.match(pass.attempts[0].label || '', /Full name/);
  assert.equal(pass.attempts[0].outcome, 'failed');
  assert.ok(pass.unresolved.some((entry) => /Full name/.test(entry)), 'the in-scope field blocks');
  assert.doesNotMatch(JSON.stringify(pass.unresolved), /unmatched validation error/i, 'the aside is not this form');
  assert.doesNotMatch(JSON.stringify(pass.attempts), /Newsletter/i);
});

test('a shadow scope from an earlier pass cannot break the next pass on a retained page', async () => {
  /* Phase zero binds a scope inside the shadow root and clicks it. Phase one runs against the same
   * Page after the shadow submit is gone, so candidate index 0 now belongs to the light DOM. The
   * marker clearing has to cross the shadow boundary, because the read-back locator does: if it
   * does not, index 0 matches two nodes and every later pass on this session throws. */
  clicks.length = 0;
  fs.rmSync(resultPath(0), { force: true });
  fs.rmSync(resultPath(1), { force: true });
  const continuationInput = path.join(workDir, 'stratus-continuation-input.json');
  fs.rmSync(continuationInput, { force: true });
  fs.rmSync(path.join(workDir, 'stratus-continuation-ready.json'), { force: true });
  writeInput('/shadow', [], {
    requestContinuation: true,
    continuationCheckpoint: true,
    continuationTtlSeconds: 20,
    continuationExpiresAt: new Date(Date.now() + 20_000).toISOString()
  });
  const child = startRunner();
  const closed = new Promise((resolve) => child.on('close', resolve));
  const waitFor = async (file, timeoutMs = 60_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!fs.existsSync(file) && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
    return fs.existsSync(file);
  };
  assert.ok(await waitFor(resultPath(0)), 'phase zero must produce a result');
  const first = readResult(0);
  assert.equal(first.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(first.requiredFieldConfirmation.passes[0].scope.scopeKind, 'container');
  assert.deepEqual(clicks, ['shadow'], 'phase zero presses the control inside the shadow root');
  fs.writeFileSync(continuationInput, JSON.stringify({
    actions: [
      { type: 'click', selector: '#mutate' },
      submitAction,
      { type: 'extract', selector: '#submitted' },
      { type: 'extract', selector: '#light', attribute: 'data-litos-submit-scope-v2' }
    ],
    screenshot: false
  }));
  assert.ok(await waitFor(resultPath(1)), 'the second pass on the retained page must not throw');
  const second = readResult(1);
  assert.equal(second.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(valueOf(second, '#light'), '0', 'the light-DOM container is the only node carrying index 0');
  assert.deepEqual(clicks, ['shadow', 'light'], 'exactly one click per pass, on the current control');
  assert.equal(await closed, 0);
});
