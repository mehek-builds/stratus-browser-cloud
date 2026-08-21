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
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { ATOMIC_SUBMIT_POLICY, SANDBOX_RUNNER } from '../src/managed-browser.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const HELPERS = `
  function attach(id) {
    var transfer = new DataTransfer();
    transfer.items.add(new File(['resume'], 'resume.pdf', { type: 'application/pdf' }));
    document.getElementById(id).files = transfer.files;
  }
  function record(who) {
    var log = document.getElementById('submitted');
    log.textContent = log.textContent ? log.textContent + ',' + who : who;
    navigator.sendBeacon('/record-click?who=' + who);
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
  '/shadow': SHADOW
};

const clicks = [];
const server = http.createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  if (url.pathname === '/record-click') {
    clicks.push(url.searchParams.get('who'));
    response.writeHead(204, { connection: 'close' });
    response.end();
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

const valueOf = (result, selector) => result.extracted.find((entry) => entry.selector === selector)?.value;

test.after(() => { server.close(); fs.rmSync(workDir, { recursive: true, force: true }); });

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
