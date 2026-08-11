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
 * AND 'ats_state' WAS NOT NARROW ENOUGH EITHER. The first repair let any receipt the ATS's own state
 * produced overturn the control, but two different things carried that one name: a route the browser
 * is standing on, and a CSS class the page prints. Ashby publishes
 * '.ashby-application-form-success-container' for customer styling, so any page can write it,
 * including a Greenhouse code screen that has just refused a code. An earlier version of THIS FILE
 * demonstrated the forgery without noticing, minting a confirmed receipt on a page with no Ashby
 * involvement at all. So the verdict now requires 'ats_route', which is derived from location and
 * which no employer markup can forge, and the forged container is pinned below as a refusal.
 *
 * Every case drives the readers that actually ship, extracted from the runner string, over a real
 * browser, and feeds their real output into the expression that actually ships. Nothing here restates
 * the rule in its own words, because a restatement is what lets the two drift apart.
 *
 * The page is served over Greenhouse's own hostname, mapped to a loopback fixture server, because
 * the route arm reads location.hostname and location.pathname together and nothing on 127.0.0.1 can
 * reach it. Every case sets the path it wants, so the arm fires only where a case asks for it.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
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

/* Greenhouse's two board hostnames, US and EU data region, both pointed at the loopback fixture.
 * The EU one is here because it is the host the route regex used to miss entirely. */
const US_HOST = 'job-boards.greenhouse.io';
const EU_HOST = 'job-boards.eu.greenhouse.io';
const APPLICATION_PATH = '/embed/job_app';
const CONFIRMATION_PATH = '/embed/job_app/confirmation?for=cresta&token=fixture';

let browser;
let page;
let server;
let port;

test.before(async () => {
  server = http.createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', connection: 'close' });
    response.end('<!doctype html><html><body></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = server.address().port;
  browser = await chromium.launch({
    args: [`--host-resolver-rules=MAP ${US_HOST} 127.0.0.1, MAP ${EU_HOST} 127.0.0.1`],
  });
  page = await browser.newPage();
});
test.after(async () => {
  await browser?.close();
  server?.close();
});

/* Every case names the host and path it wants, so the route arm is never reached by accident and a
 * case that means to reach it says so. The body is written in and the path rewritten with
 * replaceState rather than navigated to, because a navigation would discard the DOM the case just
 * built, which on this path includes the code control the whole question is about. */
async function verdictFor(html, { host = US_HOST, path = APPLICATION_PATH } = {}) {
  if (!page.url().startsWith(`http://${host}:${port}/`)) {
    await page.goto(`http://${host}:${port}${APPLICATION_PATH}`);
  }
  await page.evaluate(([markup, nextPath]) => {
    history.replaceState({}, '', nextPath);
    document.body.innerHTML = markup;
  }, [html, path]);
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

test('a FORGED success container does not outrank a standing control', async () => {
  /* The forgery, and the one place this change set was briefly worse than the code it replaces.
   * '.ashby-application-form-success-container' is a CSS class Ashby publishes for customer styling,
   * so it is markup, and markup is something any page can print. This fixture is a Greenhouse code
   * screen that has just refused a code, with the class written onto it and no Ashby anywhere.
   *
   * The receipt really is confirmed/ats_state, which is asserted so the case cannot pass by the trap
   * failing to arm. The verdict is still a refusal, because a class name is not evidence of where
   * the browser is. Before this narrowing the same DOM produced 'accepted'. */
  const { verdict, receipt, standing } = await verdictFor(
    `<div class="ashby-application-form-success-container" style="height:60px;width:320px">
       Your application was successfully submitted.</div>${CHALLENGE}`,
  );
  assert.equal(receipt.state, 'confirmed');
  assert.equal(receipt.source, 'ats_state', 'the container arm fired, so the forgery is genuinely armed');
  assert.equal(standing?.kind, 'security_code');
  assert.equal(verdict, 'rejected');
});

test('an ats_route receipt DOES outrank a control that has not unmounted', async () => {
  /* The Cresta case, and the reason the tightening is a narrowing rather than a revert. Where the
   * browser is standing is set by the navigation, not by anything the employer writes, so this is
   * the one confirmation that may overturn a challenge the page is still showing. */
  const { verdict, receipt, standing } = await verdictFor(CHALLENGE, { path: CONFIRMATION_PATH });
  assert.equal(receipt.state, 'confirmed');
  assert.equal(receipt.source, 'ats_route');
  assert.match(receipt.evidence, /^greenhouse:.*\/confirmation$/);
  assert.equal(standing?.kind, 'security_code', 'the control is still up, which is what makes this the case it is');
  assert.equal(verdict, 'accepted');
});

test('the EU data region board confirms the same way', async () => {
  /* Greenhouse serves EU-resident customers from job-boards.eu.greenhouse.io, which the route regex
   * did not match. That was true at base too and is not a regression, but this change set is what
   * made the route arm load-bearing: without the optional label an EU application filed behind a
   * security code fell through to body text, which is no longer allowed to decide this, and would
   * have been reported refused. */
  const { verdict, receipt } = await verdictFor(CHALLENGE, { host: EU_HOST, path: CONFIRMATION_PATH });
  assert.equal(receipt.source, 'ats_route');
  assert.equal(verdict, 'accepted');
});

test('the confirmation ROUTE alone is not a confirmation while the form is up', async () => {
  // The gate that keeps the strong arm honest: standing on the route with an application form still
  // on screen is a page mid-navigation, not a filed application.
  const { receipt } = await verdictFor(
    '<form><input type="file"><button type="submit">Submit</button></form>',
    { path: CONFIRMATION_PATH },
  );
  assert.equal(receipt.formStillPresent, true);
  assert.notEqual(receipt.source, 'ats_route');
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
