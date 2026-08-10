/* WAS THE EMAILED CODE ACCEPTED, decided against real DOMs instead of against a story about them.
 *
 * WHY THIS FILE EXISTS. The verdict used to be "is the code control still attached", read one
 * networkidle after the resubmit, and that reported a filed Cresta application as a refusal. The
 * repair let a CONFIRMED receipt outrank the control. Review measured that the repair had inverted
 * the error rather than removed it, and the inversion is the worse direction: telling an applicant a
 * refused code went through is the one class of mistake this system must not make.
 *
 * THE MECHANISM, and it is structural rather than a near miss. readSubmitOutcome gates its weaker
 * arms on formStillPresent, which looks for input[type=file], input[type=email], textarea,
 * form button[type=submit] or form input[type=submit]. A Greenhouse security-code screen has none of
 * those: the code is eight maxLength=1 input[type=text] boxes, and the application form it replaced
 * is already gone. So on this entire path formStillPresent is false whatever is true, the body-text
 * arm is ungated, and any confirmation-shaped sentence decides the verdict. Measured on the shipped
 * readers, a refused code under "Thank you for applying" read as ACCEPTED, and the only near-miss
 * that survived did so because the fixture happened to spell type="submit" literally.
 *
 * So the verdict now requires source 'ats_state' to outrank a standing control, and these cases are
 * what hold that line. Every one of them drives the readers that actually ship, extracted from the
 * runner string, over a browser, and feeds their real output into the expression that actually
 * ships. Nothing here restates the rule in its own words, because a restatement is what lets the two
 * drift apart.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

function balancedFrom(index, openChar, closeChar) {
  let depth = 0;
  for (let i = index; i < SANDBOX_RUNNER.length; i += 1) {
    if (SANDBOX_RUNNER[i] === openChar) depth += 1;
    else if (SANDBOX_RUNNER[i] === closeChar) {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  throw new Error('unbalanced source at ' + index);
}

function extractEvaluateCallback(declaration) {
  const start = SANDBOX_RUNNER.indexOf(declaration);
  assert.notEqual(start, -1, `${declaration} must still be in the runner`);
  const open = SANDBOX_RUNNER.indexOf('(', SANDBOX_RUNNER.indexOf('page.evaluate', start));
  return SANDBOX_RUNNER.slice(open + 1, balancedFrom(open, '(', ')'));
}

/* The arrow is taken whole, parameters and body, so the test runs the shipped expression rather than
 * a retyping of it that could agree with a comment and disagree with the code. */
function extractVerdict() {
  const start = SANDBOX_RUNNER.indexOf('const securityCodeVerdict = ');
  assert.notEqual(start, -1, 'securityCodeVerdict must still be in the runner');
  const paramsOpen = SANDBOX_RUNNER.indexOf('(', start);
  const paramsClose = balancedFrom(paramsOpen, '(', ')');
  const bodyOpen = SANDBOX_RUNNER.indexOf('(', SANDBOX_RUNNER.indexOf('=>', paramsClose));
  return SANDBOX_RUNNER.slice(paramsOpen, balancedFrom(bodyOpen, '(', ')') + 1);
}

const READ_SUBMIT_OUTCOME = extractEvaluateCallback('const readSubmitOutcome = () => page.evaluate(');
const READ_SECURITY_CODE = extractEvaluateCallback('const readSecurityCodeChallenge = () => page.evaluate(');
const securityCodeVerdict = new Function(`return ${extractVerdict()};`)();

/* Greenhouse's own control, the same eight boxes test/security-code-replay.mjs transcribes from the
 * bundle the Cresta board serves: type=text, maxLength 1, aria-required, no autocomplete attribute.
 * They are the reason formStillPresent cannot see this screen. */
const BOXES = Array.from(
  { length: 8 },
  (_, index) => `<input id="security-input-${index}" type="text" aria-required="true" maxlength="1">`,
).join('');

const CHALLENGE = `
  <fieldset id="email-verification">
    <legend>A verification code was sent to mehekmandal05@gmail.com. To submit your application,
      enter the 8-character code to confirm you're a human.</legend>
    <label aria-hidden="true" for="security-input-0">Security code</label>
    <div class="email-verification__wrapper">${BOXES}</div>
  </fieldset>`;

const RECEIPT_SENTENCE = '<p>Thank you for applying. Your application has been received.</p>';

let browser;
let page;

test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { await browser?.close(); });

async function verdictFor(html) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  const receipt = await page.evaluate(`(${READ_SUBMIT_OUTCOME})()`);
  const standing = await page.evaluate(`(${READ_SECURITY_CODE})()`);
  return { verdict: securityCodeVerdict(receipt, standing), receipt, standing };
}

test('a refused code under a confirmation SENTENCE is refused, bare button', async () => {
  /* THE INVERSION, in the shape review measured it in. Greenhouse leaves the code control standing
   * when it refuses, and employer pages carry encouraging prose whether or not anything was filed.
   * Body text must not be able to overturn the control. */
  const { verdict, receipt, standing } = await verdictFor(
    `${RECEIPT_SENTENCE}<form novalidate>${CHALLENGE}<button>Verify</button></form>`,
  );
  // Asserted so the case cannot quietly stop testing what it says it tests: the weak arm really did
  // fire, and the control really is still there. Those two together are the whole defect.
  assert.equal(receipt.state, 'confirmed');
  assert.equal(receipt.source, 'page_text');
  assert.equal(standing?.kind, 'security_code');
  assert.equal(verdict, 'rejected');
});

test('a refused code under a confirmation SENTENCE is refused, no form element at all', async () => {
  // The React shape, which is the common one: no <form> in the tree, so formStillPresent has nothing
  // it could possibly find and the gate on the weak arm is not merely leaky, it is absent.
  const { verdict, receipt } = await verdictFor(
    `<div id="root">${RECEIPT_SENTENCE}${CHALLENGE}<button>Verify</button></div>`,
  );
  assert.equal(receipt.formStillPresent, false, 'the gate is dead on this shape, which is the point');
  assert.equal(verdict, 'rejected');
});

test('the verdict does not hang on the page spelling type="submit"', async () => {
  /* The near miss that made the old rule look safer than it was. A bare <button> inside a form IS a
   * submit button per HTML, but the formStillPresent selector wants the attribute, so the old rule
   * happened to survive only on pages that write it out. Both spellings must now agree. */
  const withAttribute = await verdictFor(
    `${RECEIPT_SENTENCE}<form novalidate>${CHALLENGE}<button type="submit">Verify</button></form>`,
  );
  const withoutAttribute = await verdictFor(
    `${RECEIPT_SENTENCE}<form novalidate>${CHALLENGE}<button>Verify</button></form>`,
  );
  assert.equal(withAttribute.verdict, 'rejected');
  assert.equal(withoutAttribute.verdict, withAttribute.verdict);
});

test('an ats_state receipt DOES outrank a control that has not unmounted', async () => {
  /* The Cresta case, and the reason the tightening is a narrowing rather than a revert. A published
   * ATS state hook is the employer's own machine-readable claim that the application is in, which is
   * a different kind of evidence from a sentence that happens to be on the page. In production this
   * arrives as the Greenhouse confirmation ROUTE; test/security-code-replay.mjs drives that shape
   * end to end, and this drives the container shape. */
  const { verdict, receipt, standing } = await verdictFor(
    `<div class="ashby-application-form-success-container" style="height:60px;width:320px">
       Your application was successfully submitted.</div>${CHALLENGE}`,
  );
  assert.equal(receipt.state, 'confirmed');
  assert.equal(receipt.source, 'ats_state');
  assert.equal(standing?.kind, 'security_code', 'the control is still up, which is what makes this the case it is');
  assert.equal(verdict, 'accepted');
});

test('an explicit ats_state refusal is a refusal even with the control gone', async () => {
  // The other direction, which the original control-only rule could not express at all: it read a
  // cleared control over a failure panel as acceptance.
  const { verdict, standing } = await verdictFor(
    `<div class="ashby-application-form-failure-container" style="height:60px;width:320px">
       We couldn't submit your application.</div>`,
  );
  assert.equal(standing, null);
  assert.equal(verdict, 'rejected');
});

test('a cleared control with nothing contrary on the page is acceptance', async () => {
  // The ordinary success path, where the view has finished swapping and there is simply nothing left
  // to be waiting for. Unchanged by any of this, and asserted so it stays that way.
  const { verdict } = await verdictFor('<p>Application status: complete.</p>');
  assert.equal(verdict, 'accepted');
});

test('a standing control with nothing else on the page is a refusal', async () => {
  // The genuine Greenhouse refusal: no receipt of any kind, the challenge simply still there.
  const { verdict, receipt } = await verdictFor(`<form novalidate>${CHALLENGE}<button>Verify</button></form>`);
  assert.equal(receipt.state, 'unknown');
  assert.equal(verdict, 'rejected');
});
