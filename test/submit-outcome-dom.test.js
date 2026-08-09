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
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  return page.evaluate(`(${READER})()`);
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

test('an ordinary unsubmitted application page is unknown, not confirmed', async () => {
  // Application pages are full of encouraging prose. None of it is a receipt.
  const outcome = await read(`
    <h1>Software Engineering Intern</h1>
    <p>Thanks for your interest in Deepgram. We review every application.</p>${FORM}`);
  assert.equal(outcome.state, 'unknown');
});
