/* THE CONFIRMATION READER, RUN AGAINST A REAL DOM INSTEAD OF READ AS A STRING.
 *
 * test/managed-browser.test.js pins this code with `assert.match(SANDBOX_RUNNER, /...container/)`,
 * which asserts that a class name appears in a string. That cannot catch a reader that finds the
 * container and draws the wrong conclusion from it, and it did not: every case below returned
 * `confirmed` on the first version of this code, with the suite fully green.
 *
 * What makes these worth a browser rather than a jsdom stub is that all of them are LAYOUT bugs.
 * A container collapsed to `height: 0`, one at `opacity: 0`, one parked off-screen: jsdom reports
 * zeroes for every rectangle and cannot tell any of them apart from the visible case.
 *
 * The stakes are asymmetric and the tests are written to that asymmetry. A missed confirmation
 * costs one re-check. A false confirmation tells Mehek an application was filed that no employer
 * ever received, and she stops following up on it. So every ambiguous shape here is required to
 * return 'unknown', never 'confirmed'.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* Extracted from the shipped runner string rather than copied. A copy would let the test keep
 * passing while the real reader drifted, which is the exact failure this file exists to end. */
function extractReader() {
  const start = SANDBOX_RUNNER.indexOf('const readSubmitOutcome = () => page.evaluate(');
  assert.notEqual(start, -1, 'readSubmitOutcome must still be in the runner');
  const open = SANDBOX_RUNNER.indexOf('(', SANDBOX_RUNNER.indexOf('page.evaluate', start));
  let depth = 0;
  for (let i = open; i < SANDBOX_RUNNER.length; i += 1) {
    const ch = SANDBOX_RUNNER[i];
    if (ch === '(') depth += 1;
    else if (ch === ')') {
      depth -= 1;
      if (depth === 0) return SANDBOX_RUNNER.slice(open + 1, i);
    }
  }
  throw new Error('could not find the end of the readSubmitOutcome callback');
}

const READER = extractReader();

const FORM = `
  <form>
    <label>Email<input type="text" name="email" /></label>
    <label>Resume<input type="file" name="resume" /></label>
    <button type="submit">Submit Application</button>
  </form>`;

let browser;
let page;

test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { await browser?.close(); });

async function read(html) {
  await page.goto('about:blank');
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  return page.evaluate(`(${READER})()`);
}

async function readAt(url, html) {
  const handler = (route) => route.fulfill({
    status: 200,
    contentType: 'text/html',
    body: `<!doctype html><html><body>${html}</body></html>`,
  });
  await page.route(url, handler);
  try {
    await page.goto(url);
    return await page.evaluate(`(${READER})()`);
  } finally {
    await page.unroute(url, handler);
  }
}

test('an empty success container over a live form is NOT a submitted application', async () => {
  // An empty div collapses to zero height, so this one is caught by the visibility rule rather than
  // by the corroboration rule. Both roads have to lead to 'unknown', which is why the assertion is
  // on the state and not on which arm rejected it.
  const outcome = await read(`<div class="ashby-application-form-success-container"></div>${FORM}`);
  assert.equal(outcome.state, 'unknown');
  assert.equal(outcome.formStillPresent, true);
});

test('a VISIBLE but wordless success container names why it is not trusted', async () => {
  // Given a size by CSS, so it clears the visibility rule and reaches the corroboration rule. This
  // is the mount-then-fill-in case: the panel is on the page before the sentence arrives.
  const outcome = await read(
    `<div class="ashby-application-form-success-container" style="height:40px;width:200px"> </div>${FORM}`,
  );
  assert.equal(outcome.state, 'unknown');
  // The caller has to be able to say WHY it does not know, or the packet lands in a generic
  // needs_attention that nobody can act on.
  assert.equal(outcome.source, 'ats_state_unconfirmed');
  assert.equal(outcome.formStillPresent, true);
});

test('a filled success container over a live form is still NOT submitted', async () => {
  const outcome = await read(
    `<div class="ashby-application-form-success-container">Success. Thank you for submitting your application.</div>${FORM}`,
  );
  assert.equal(outcome.state, 'unknown', 'the form is still there, so nothing was sent');
});

for (const [name, style] of [
  ['collapsed to zero height', 'height:0; overflow:hidden'],
  ['fully transparent', 'opacity:0'],
  ['parked off-screen', 'position:absolute; left:-9999px'],
  ['zero width', 'width:0; overflow:hidden'],
]) {
  test(`a success container ${name} is not visible and confirms nothing`, async () => {
    const outcome = await read(
      `<div class="ashby-application-form-success-container" style="${style}">Thank you for submitting your application.</div>${FORM}`,
    );
    assert.notEqual(outcome.state, 'confirmed', `${name} must not read as a filed application`);
  });
}

test('display:none stays excluded, as it always was', async () => {
  const outcome = await read(
    `<div class="ashby-application-form-success-container" style="display:none">Thank you for submitting.</div>${FORM}`,
  );
  assert.notEqual(outcome.state, 'confirmed');
});

test('the real Ashby success state IS confirmed, form gone', async () => {
  // The shape Ashby actually mounts: container, role=status, the employer's own sentence, no form.
  const outcome = await read(`
    <div class="ashby-application-form-success-container">
      <div role="status" aria-live="polite">Success<p>Thank you for submitting your application to Skydio.</p></div>
    </div>`);
  assert.equal(outcome.state, 'confirmed');
  assert.equal(outcome.source, 'ats_state');
  assert.equal(outcome.formStillPresent, false);
  assert.match(outcome.message, /Thank you for submitting your application/);
});

test('the failure container still wins over a success container on the same page', async () => {
  const outcome = await read(`
    <div class="ashby-application-form-success-container">Thank you for submitting your application.</div>
    <div class="ashby-application-form-failure-container">We couldn't submit your application.</div>`);
  assert.equal(outcome.state, 'rejected');
});

test('aria-live="off" means do not announce, so it cannot confirm anything', async () => {
  // "off" is the value that explicitly suppresses announcement. The bare [aria-live] selector
  // matched it and read a live form as a filed application.
  const outcome = await read(`<div aria-live="off">Thank you for submitting your application.</div>${FORM}`);
  assert.notEqual(outcome.state, 'confirmed');
});

test('a confirmation sentence over a form whose email field is type=text is not a confirmation', async () => {
  // The form probe used to look only for input[type=file], input[type=email] and textarea. A form
  // using type="text" for email read as absent, and the body-text arm confirmed with the Submit
  // button still on the page.
  const outcome = await read(`
    <p>Thank you for applying. We have received your application.</p>
    <form><label>Email<input type="text" name="email" /></label><button type="submit">Submit</button></form>`);
  assert.notEqual(outcome.state, 'confirmed');
  assert.equal(outcome.formStillPresent, true, 'a live submit button is the counter-witness');
});

test('body text alone confirms only once the form is genuinely gone', async () => {
  const outcome = await read('<p>Thank you for submitting your application. We will be in touch.</p>');
  assert.equal(outcome.state, 'confirmed');
  assert.equal(outcome.source, 'page_text');
});

const TEAMTAILOR_RECEIPT = `
  <main>
    <h1>Thanks for applying</h1>
    <p>We have received your application and we will be reviewing it shortly.</p>
    <form action="/connect"><input type="hidden" name="authenticity_token" value="signed"><button type="submit">Connect</button></form>
  </main>`;

test('a measured Teamtailor receipt is not vetoed by its separate post-submit Connect form', async () => {
  // Transcribed from Fully run 885b0ae5 on 2026-08-24. The page showed this receipt and confetti,
  // then offered an unrelated talent-network action whose button happened to use type=submit.
  const outcome = await readAt(
    'https://fully.teamtailor.com/jobs/6360832-internship/applications/new',
    TEAMTAILOR_RECEIPT,
  );
  assert.equal(outcome.formStillPresent, false);
  assert.equal(outcome.state, 'confirmed');
  assert.equal(outcome.source, 'page_text');
  assert.match(outcome.message, /We have received your application/);
});

test('the same Teamtailor-looking HTML off the measured ATS host stays unknown', async () => {
  const outcome = await read(TEAMTAILOR_RECEIPT);
  assert.equal(outcome.formStillPresent, true);
  assert.equal(outcome.state, 'unknown');
});

test('Teamtailor receipt prose over any remaining application field stays unknown', async () => {
  const outcome = await readAt(
    'https://fully.teamtailor.com/jobs/6360832-internship/applications/new',
    TEAMTAILOR_RECEIPT.replace('</main>', '<input name="candidate[first_name]" type="text"></main>'),
  );
  assert.equal(outcome.formStillPresent, true);
  assert.equal(outcome.state, 'unknown');
});

const WORKABLE_RECEIPT = `
  <main data-ui="successful-submit">
    <h1>Thank you!</h1>
    <p role="status">Your application has been submitted successfully.</p>
  </main>`;

test('the published Workable success state confirms on the exact tenant job success URL', async () => {
  const outcome = await readAt(
    'https://apply.workable.com/max-borges-agency/j/20E78CBA92/apply/?success',
    WORKABLE_RECEIPT,
  );
  assert.equal(outcome.formStillPresent, false);
  assert.equal(outcome.state, 'confirmed');
  assert.equal(outcome.source, 'ats_state');
  assert.equal(outcome.evidence, '[data-ui="successful-submit"]');
  assert.match(outcome.message, /submitted successfully/i);
});

test('the provider-preserved lowercase Workable token confirms the same published success state', async () => {
  const outcome = await readAt(
    'https://apply.workable.com/max-borges-agency/j/20e78cba92/apply/?success',
    WORKABLE_RECEIPT,
  );
  assert.equal(outcome.state, 'confirmed');
  assert.equal(outcome.source, 'ats_state');
});

test('a separate Workable follow-up survey form does not veto its published success state', async () => {
  const outcome = await readAt(
    'https://apply.workable.com/max-borges-agency/j/20E78CBA92/apply/?success',
    `${WORKABLE_RECEIPT}<form data-ui="candidate-survey"><textarea></textarea><button type="submit">Submit survey</button></form>`,
  );
  assert.equal(outcome.state, 'confirmed');
  assert.equal(outcome.source, 'ats_state');
  assert.equal(outcome.formStillPresent, false);
});

for (const [name, url, html] of [
  ['off the Workable host', 'https://careers.example.test/max-borges-agency/j/20E78CBA92/apply/?success', WORKABLE_RECEIPT],
  ['without its success URL state', 'https://apply.workable.com/max-borges-agency/j/20E78CBA92/apply/', WORKABLE_RECEIPT],
  ['with extra success query state', 'https://apply.workable.com/max-borges-agency/j/20E78CBA92/apply/?success&source=retry', WORKABLE_RECEIPT],
  ['over a live application form', 'https://apply.workable.com/max-borges-agency/j/20E78CBA92/apply/?success', `${WORKABLE_RECEIPT}<form data-ui="application-form"><button type="submit">Apply</button></form>`],
  ['without a status message inside the success state', 'https://apply.workable.com/max-borges-agency/j/20E78CBA92/apply/?success', '<main data-ui="successful-submit"><h1>Thank you!</h1></main><p role="status">Your application has been submitted successfully.</p>'],
]) {
  test(`a Workable-looking success hook ${name} stays unknown`, async () => {
    const outcome = await readAt(url, html);
    assert.equal(outcome.state, 'unknown');
    assert.equal(outcome.source, 'ats_state_unconfirmed');
  });
}

for (const label of ['Continue', 'Next', 'Finish', 'Complete application', 'Retry', 'Please wait']) {
  test(`receipt-shaped prose over a live ${label} form stays unknown`, async () => {
    const outcome = await read(`
      <p>Thank you for applying. We have received your application.</p>
      <form>
        <label>Email<input type="text" name="email"></label>
        <label>Phone<input type="text" name="phone"></label>
        <button type="submit">${label}</button>
      </form>`);
    assert.equal(outcome.formStillPresent, true);
    assert.equal(outcome.state, 'unknown');
  });
}

test('an ordinary unsubmitted application page is unknown, not confirmed', async () => {
  // Application pages are full of encouraging prose. None of it is a receipt.
  const outcome = await read(`
    <h1>Software Engineering Intern</h1>
    <p>Thanks for your interest in Deepgram. We review every application.</p>${FORM}`);
  assert.equal(outcome.state, 'unknown');
});

// No captured evidence exists anywhere for what a real breezy.hr or workable.com post-submit page
// looks like (measured 2026-08-20 - see the comment beside this arm in managed-browser.js). Until
// a dedicated arm exists for either, an unrecognised page must still hand back what it actually saw
// rather than nulling it out, so the NEXT real submission to either produces the ground truth a
// real arm can be built from, instead of another silent no_confirmation_state with nothing to learn.
test('a page no arm recognises still reports what it actually said, tagged distinctly', async () => {
  // Deliberately outside CONFIRMED_TEXT and REJECTED_TEXT: this is what a real breezy.hr or
  // workable.com post-submit page might say, and until either is measured this must NOT be able to
  // resolve as 'confirmed' - it must fall through and still be legible.
  const outcome = await read('<h1>You are all set</h1><p>Our recruiting team will follow up soon.</p>');
  assert.equal(outcome.state, 'unknown');
  assert.equal(outcome.source, 'unmatched_page_text');
  assert.match(outcome.message, /You are all set/);
  assert.match(outcome.message, /Our recruiting team will follow up soon/);
});

// A false 'confirmed' tells Mehek an application was filed that no employer received, so capturing
// this evidence must never be able to promote itself into one - only 'page_text' (the CONFIRMED_TEXT
// arm, gated on the form being gone) may return state: 'confirmed'.
test('the captured evidence never promotes an unrecognised page to confirmed', async () => {
  const outcome = await read('<h1>You are all set</h1><p>Our recruiting team will follow up soon.</p>' + FORM);
  assert.equal(outcome.state, 'unknown');
  assert.equal(outcome.source, 'unmatched_page_text');
});

/* A FORM THAT SAYS ITS ERRORS OUT LOUD HAS REFUSED THE PRESS. Transcribed from the live
 * transparent-hiring.breezy.hr receipt (run 549604ee, 2026-08-20): "A response is required"
 * beside a required video recorder and "Your application contains errors" under the pressed
 * button, with the whole form still standing - and the old reading reported it unverified. */
test('a client-validation sentence over a live form is a proven rejection', async () => {
  const outcome = await read(`
    <form>
      <input type="email" value="a@b.c" />
      <div class="recorder"><button type="button">Record Video</button></div>
      <span style="color:red">A response is required</span>
      <button type="submit">Submit Application</button>
      <div style="color:red">Your application contains errors</div>
    </form>`);
  assert.equal(outcome.state, 'rejected');
  assert.equal(outcome.source, 'client_validation');
  assert.equal(outcome.formStillPresent, true);
  assert.match(outcome.message, /Your application contains errors/);
  assert.match(outcome.message, /1 required response still missing/);
});

test('the word required decorating a label never reads as a refusal', async () => {
  const outcome = await read(`
    <form>
      <label>Email (required)</label><input type="email" />
      <span>This field is required</span>
      <button type="submit">Submit Application</button>
    </form>`);
  assert.equal(outcome.state, 'unknown');
});

test('the validation sentence with the form gone falls through to the ordinary arms', async () => {
  const outcome = await read('<p>Your application contains errors</p>');
  assert.notEqual(outcome.source, 'client_validation');
});

/* THE BREEZY FORM THE READER CALLED GONE. Measured live (transparent-hiring.breezy.hr, 2026-08-20):
 * no <form> element, email typed as type="text", file input hidden behind an Upload Resume button -
 * every old formStillPresent selector missed, which disarmed the client-validation arm and left the
 * confirmation arms leaning on a gate that was open. */
test('a submit-shaped button says the form is still here, whatever it is wrapped in', async () => {
  const outcome = await read(`
    <div class="application">
      <input type="text" name="email" value="a@b.c" />
      <button type="button">Upload Resume</button>
      <span style="color:red">A response is required</span>
      <button type="button">Submit Application</button>
      <div style="color:red">Your application contains errors</div>
    </div>
    <p>Thank you for applying</p>`);
  assert.equal(outcome.formStillPresent, true);
  assert.equal(outcome.state, 'rejected');
  assert.equal(outcome.source, 'client_validation');
});

test('a link that merely mentions applying does not resurrect a submitted form', async () => {
  const outcome = await read(`
    <p>Thank you for applying to our team. We have received your application.</p>
    <a role="button" href="/jobs">See more roles and apply for another position</a>`);
  assert.equal(outcome.formStillPresent, false);
  assert.equal(outcome.state, 'confirmed');
});

/* A BARE RECEIPT PAGE. See the arm in readSubmitOutcome: a page that is nothing but one line of
 * thanks, with no form left on it, is the confirmation many boards actually render, and it used to
 * fall through to 'unknown' because no fuller phrase and no ATS hook was present. The safety
 * asymmetry above still rules: every ambiguous shape here must stay 'unknown'. */
test('a page that is only "Thank you" with no form is a confirmation, and the line is the message', async () => {
  const outcome = await read('<main><h1>Thank you</h1></main>');
  assert.equal(outcome.state, 'confirmed');
  assert.equal(outcome.evidence, 'body_bare_receipt');
  assert.equal(outcome.message, 'Thank you');
  assert.equal(outcome.formStillPresent, false);
});

test('a page that is only "Application received" confirms with that line', async () => {
  const outcome = await read('<p>Application received</p><p>We will be in touch.</p>');
  assert.equal(outcome.state, 'confirmed');
  // The fuller phrase arm already owns this line (evidence 'body'); the bare arm is its backstop.
  assert.ok(['body', 'body_bare_receipt'].includes(outcome.evidence), outcome.evidence);
  assert.match(outcome.message, /Application received/);
});

test('"Thank you" beside a live form is NOT a confirmation', async () => {
  const outcome = await read(`<p>Thank you</p>${FORM}`);
  assert.equal(outcome.state, 'unknown');
  assert.equal(outcome.formStillPresent, true);
});

test('a short error page that says thank you is NOT a confirmation', async () => {
  const outcome = await read('<p>Something went wrong. Thank you for your patience. Please try again.</p>');
  assert.equal(outcome.state, 'unknown');
});

test('a long page with a thank-you footer and no form is NOT a bare receipt', async () => {
  const filler = '<p>' + 'Join our team and build the future of logistics with us. '.repeat(20) + '</p>';
  const outcome = await read(`${filler}<footer>Thank you for visiting</footer>`);
  assert.equal(outcome.state, 'unknown');
});

/* THE REFUTATION OF THE FIRST CUT, pinned. Every one of these wears a thank-you and none is a
 * receipt; each must stay unknown, and the asymmetry in this file's header is the reason. */
for (const [name, html] of [
  ['a closed posting', '<p>Thanks for your interest. This position is no longer accepting applications.</p>'],
  ['not hiring', '<p>Thank you, but we are not currently hiring.</p>'],
  ['an email-verification interstitial', '<p>Thanks! Please check your email to confirm your address.</p>'],
  ['a timed-out session', '<p>Thank you. Your session has timed out.</p>'],
  ['a not-found page', '<h1>Page not found</h1><p>Thanks for visiting.</p>'],
  ['an assessment gate', '<p>Thank you. Please complete the assessment to finish your application</p>'],
  ['a talent-network join', '<p>Thanks, we\'ll be in touch about our talent network</p>'],
  ['a saved draft', '<p>Thanks! Your application has been saved as a draft.</p><button>Continue</button>'],
  ['a wizard step with a Next button', '<p>Thanks! Step 1 of 3 complete.</p><button>Next</button>'],
  ['a filled position', '<p>Thank you for your interest, but this position has been filled.</p>'],
  ['a withdrawn application', '<p>Your application has been withdrawn. Thank you.</p>'],
  ['a cookie-consent screen', '<p>We use cookies. Thanks for understanding.</p><button>Accept</button><button>Reject</button>'],
  ['a submitting spinner', '<p>Thanks, submitting your application...</p>'],
  ['a processing transient', '<p>Thank you! Processing...</p>'],
  ['a form living in an iframe', '<p>Join us. Thanks for your interest!</p><iframe src="about:blank" style="width:300px;height:200px"></iframe>'],
  ['a declined application', '<p>Thank you. Your application has been declined.</p>'],
]) {
  test(`${name} that says thank you is NOT a bare receipt`, async () => {
    const outcome = await read(html);
    assert.notEqual(outcome.state, 'confirmed', name);
  });
}

test('the genuine bare receipts still confirm', async () => {
  for (const html of ['<h1>Thank you</h1>', '<p>Thanks! We\'ll be in touch.</p>', '<p>Thanks for applying</p>',
    '<p>Thank you for your application</p>', '<p>Thank you! Your application has been sent.</p>']) {
    const outcome = await read(html);
    assert.equal(outcome.state, 'confirmed', html);
    assert.ok(['body', 'body_bare_receipt'].includes(outcome.evidence), `${html}: ${outcome.evidence}`);
  }
});

test('a form hidden from view still refuses the bare arm', async () => {
  for (const style of ['display:none', 'visibility:hidden']) {
    const outcome = await read(`<p>Thank you</p><div style="${style}">${FORM}</div>`);
    assert.notEqual(outcome.state, 'confirmed', style);
  }
});

test('"successfully submitted" must name the application', async () => {
  for (const html of ['<p>Your message was successfully sent</p>', '<p>Feedback successfully submitted</p>', '<p>Your resume was successfully submitted</p>']) {
    assert.notEqual((await read(html)).state, 'confirmed', html);
  }
  assert.equal((await read('<p>Your application was successfully submitted</p>')).state, 'confirmed');
});
