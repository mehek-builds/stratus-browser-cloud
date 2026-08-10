/* THE CAPTCHA PREDICATE, RUN AGAINST A REAL DOM INSTEAD OF READ AS A STRING.
 *
 * WHAT THIS FILE IS PAYING FOR. The predicate it pins replaced a single count of
 * 'iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i]'. reCAPTCHA v3 and invisible v2
 * render <div class="grecaptcha-badge"> on pages that ask a person for NOTHING, and that div matches
 * [class*="captcha" i]. Greenhouse and Ashby mount it on essentially every posting. 48 of the
 * applicant's 158 packets were labelled "CAPTCHA requires your attention" on that basis: the single
 * largest blocker in the pipeline, and almost all of it was the badge.
 *
 * WHY A BROWSER AND NOT A STUB. Every discrimination below is a LAYOUT or a CASCADE question:
 * whether a node has a box, whether an ancestor collapsed it, what closest() finds walking up a real
 * tree, what a <textarea> holds in its value PROPERTY when it has no value attribute. jsdom reports
 * zeroes for every rectangle and cannot tell any of the hidden cases apart from the visible one.
 *
 * THE ASYMMETRY THE ASSERTIONS ENCODE. A false "no captcha" lets one submit run into a wall and the
 * post-submit readers see no receipt: recoverable. A false "captcha" strands a finished application
 * and hands it back to a person to redo by hand. So the burden is on the positive: nothing here is
 * allowed to report a challenge without a visible, unsolved widget outside the badge.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* Extracted from the shipped runner string rather than copied, for the same reason as
 * test/submit-outcome-dom.test.js: a copy lets this file keep passing while the real predicate
 * drifts, which is the exact failure the ordinary suite's assert.match-on-a-string already had. */
function extractPredicate() {
  const start = SANDBOX_RUNNER.indexOf('const readUnresolvedCaptcha = () => page.evaluate(');
  assert.notEqual(start, -1, 'readUnresolvedCaptcha must still be in the runner');
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
  throw new Error('could not find the end of the readUnresolvedCaptcha callback');
}

const PREDICATE = extractPredicate();

/* The real form under all of this. Present in every fixture because the badge cases are only
 * interesting over a page that is otherwise perfectly submittable: that is the shape of all 48. */
const FORM = `
  <form>
    <label>Email<input type="text" name="email" /></label>
    <label>Resume<input type="file" name="resume" /></label>
    <button type="submit">Submit Application</button>
  </form>`;

/* Transcribed from what reCAPTCHA v3 actually mounts, not sketched: a positioned badge container
 * wrapping the anchor iframe, plus the response textarea, which on v3 is EMPTY until the token is
 * minted at submit time. The empty token is the trap - a predicate that read tokens without first
 * asking whether anything visible is being challenged would call this page blocked. */
const V3_BADGE = `
  <div class="grecaptcha-badge" style="width:256px;height:60px;position:fixed;bottom:14px;right:14px">
    <div class="grecaptcha-logo">
      <iframe title="reCAPTCHA"
        src="https://www.google.com/recaptcha/api2/anchor?ar=1&amp;k=6Ld_ad8&amp;size=invisible&amp;cb=x"
        width="256" height="60"></iframe>
    </div>
    <div class="grecaptcha-error"></div>
    <textarea id="g-recaptcha-response" name="g-recaptcha-response" class="g-recaptcha-response"
      style="width:250px;height:40px;border:1px solid #c1c1c1;display:none"></textarea>
  </div>`;

/* A v2 checkbox widget as Greenhouse embeds it when a board really does gate on one. Given an
 * explicit box because an empty div has no height and would be excluded by the visibility rule
 * rather than by anything this file means to test. Google renders it 304x78. */
const V2_WIDGET = `
  <div class="g-recaptcha" data-sitekey="6Ld_v2_key" style="width:304px;height:78px">
    <iframe title="reCAPTCHA" src="https://www.google.com/recaptcha/api2/anchor?ar=1&amp;k=6Ld_v2_key"
      width="304" height="78"></iframe>
  </div>`;

let browser;
let page;

test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { await browser?.close(); });

async function read(html) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  return page.evaluate(`(${PREDICATE})()`);
}

test('the invisible reCAPTCHA badge alone is NOT a challenge', async () => {
  // THE 48-PACKET CASE. Nothing on this page asks a human for anything: the score comes from
  // behaviour and the token is minted on submit. A person filling this form by hand clicks Submit
  // and never sees a challenge.
  assert.equal(await read(`${FORM}${V3_BADGE}`), false);
});

test('the badge is excluded as a container, not just as a node', async () => {
  // The badge div and its child anchor iframe both match the challenge selector, and they match it
  // for different reasons. A self-only check would miss the iframe, a descendant-only check would
  // miss the div. Stripped to the badge alone so nothing else can be what carries the answer.
  assert.equal(await read(V3_BADGE), false);
});

test('a visible v2 widget OUTSIDE the badge is still a challenge', async () => {
  // The contrast case, and the reason the exclusions prove anything. If v3 scores a session badly it
  // escalates to exactly this, rendered outside the badge, and it must still stop the submit.
  assert.equal(await read(`${FORM}${V2_WIDGET}`), true);
});

test('a v2 widget alongside the badge is a challenge', async () => {
  // Both on one page: the escalation shape. The badge must not launder the widget next to it.
  assert.equal(await read(`${FORM}${V3_BADGE}${V2_WIDGET}`), true);
});

test('an hCaptcha frame is a challenge', async () => {
  assert.equal(await read(`${FORM}
    <iframe src="https://newassets.hcaptcha.com/captcha/v1/9d2/static/hcaptcha.html#frame=challenge"
      width="400" height="580"></iframe>`), true);
});

test('a Turnstile frame with an empty response is a challenge', async () => {
  // Turnstile is the reason the challenge selector carries a hostname arm: its container class is
  // 'cf-turnstile', which contains no "captcha" for any substring match to find. The frame is what
  // names it, and the response input is what says it is unsolved.
  assert.equal(await read(`${FORM}
    <div class="cf-turnstile" style="width:300px;height:65px">
      <iframe src="https://challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2"
        width="300" height="65"></iframe>
    </div>
    <input type="hidden" name="cf-turnstile-response" value="">`), true);
});

test('a display:none widget is not a challenge', async () => {
  assert.equal(await read(`${FORM}
    <div class="g-recaptcha" data-sitekey="K" style="width:304px;height:78px;display:none"></div>`), false);
});

test('a widget hidden by an ANCESTOR is not a challenge', async () => {
  // The one a computed-style check alone would get wrong: display does not inherit, so the child's
  // own computed display is still 'block'. Its box is what is gone.
  assert.equal(await read(`${FORM}
    <div style="display:none">
      <div class="g-recaptcha" data-sitekey="K" style="width:304px;height:78px"></div>
    </div>`), false);
});

test('a zero-size widget is not a challenge', async () => {
  // A container mid-mount, and the reason either dimension being zero disqualifies rather than both:
  // a widget collapsed to zero height with overflow hidden is showing a person nothing.
  assert.equal(await read(`${FORM}
    <div class="g-recaptcha" data-sitekey="K" style="width:304px;height:0;overflow:hidden"></div>`), false);
});

test('a visibility:hidden widget is not a challenge', async () => {
  assert.equal(await read(`${FORM}
    <div class="g-recaptcha" data-sitekey="K" style="width:304px;height:78px;visibility:hidden"></div>`), false);
});

test('an opacity:0 widget is not a challenge', async () => {
  assert.equal(await read(`${FORM}
    <div class="g-recaptcha" data-sitekey="K" style="width:304px;height:78px;opacity:0"></div>`), false);
});

test('a SOLVED widget is not a challenge', async () => {
  /* The token is read off the value PROPERTY, which is the whole reason this predicate lives in a
   * page.evaluate. g-recaptcha-response is a <textarea>: it has no value ATTRIBUTE, so an attribute
   * read returns null on a solved widget and every cleared challenge would be reported as still
   * waiting. The value is set here the way the widget sets it, through the property. */
  await page.setContent(`<!doctype html><html><body>${FORM}${V2_WIDGET}
    <textarea id="g-recaptcha-response" name="g-recaptcha-response" style="display:none"></textarea>
    </body></html>`);
  await page.evaluate(() => {
    document.getElementById('g-recaptcha-response').value = '03AGdBq26SolvedTokenValue';
  });
  assert.equal(await page.evaluate(`(${PREDICATE})()`), false);
});

test('a rendered widget with an EMPTY response is a challenge', async () => {
  // The counterpart, and the one that makes the test above mean something: same markup, no token.
  assert.equal(await read(`${FORM}${V2_WIDGET}
    <textarea id="g-recaptcha-response" name="g-recaptcha-response" style="display:none"></textarea>`), true);
});

test('an invisible-marked widget outside the badge is not a challenge', async () => {
  // The shape the badge exclusion does not watch: a form that mounts its own invisible widget rather
  // than letting the API render the floating badge. Visible, outside the badge, asking for nothing.
  assert.equal(await read(`${FORM}
    <div class="g-recaptcha" data-sitekey="K" data-size="invisible" style="width:304px;height:78px"></div>`), false);
});

test('an ESCALATED invisible widget IS a challenge', async () => {
  /* The load-bearing exception, and the case that makes the rule above safe to have. When an
   * invisible widget escalates, it keeps saying data-size="invisible" - the marker describes how it
   * was configured, not what it is currently showing. What changes is that reCAPTCHA mounts the
   * image-grid popup in a SECOND iframe whose src carries 'bframe'. A person is looking at that
   * grid right now, so the marker must stop excluding anything. */
  assert.equal(await read(`${FORM}
    <div class="g-recaptcha" data-sitekey="K" data-size="invisible" style="width:304px;height:78px"></div>
    <iframe title="recaptcha challenge"
      src="https://www.google.com/recaptcha/api2/bframe?hl=en&amp;k=K" width="400" height="580"></iframe>`), true);
});

test('a plain application page reports nothing', async () => {
  // The floor. An ordinary form with no captcha markup of any kind must be silent, or none of the
  // discriminations above matter.
  assert.equal(await read(`<h1>Data Science Intern</h1>${FORM}`), false);
});
