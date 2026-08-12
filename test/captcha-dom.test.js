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
 * drifts, which is the exact failure the ordinary suite's assert.match-on-a-string already had.
 * Both halves come from there, the selector table as well as the decision, so a selector added to
 * the runner reaches these cases and a selector added only here proves nothing. */
function extractBraced(prefix) {
  const start = SANDBOX_RUNNER.indexOf(prefix);
  assert.notEqual(start, -1, `${prefix} must still be in the runner`);
  const open = SANDBOX_RUNNER.indexOf('{', start);
  let depth = 0;
  for (let i = open; i < SANDBOX_RUNNER.length; i += 1) {
    const ch = SANDBOX_RUNNER[i];
    if (ch === '{') depth += 1;
    else if (ch === '}') {
      depth -= 1;
      if (depth === 0) return SANDBOX_RUNNER.slice(start, i + 1);
    }
  }
  throw new Error(`could not find the end of ${prefix}`);
}

const SELECTORS = new Function(`${extractBraced('const CAPTCHA_SELECTORS = ')}; return CAPTCHA_SELECTORS;`)();
const SNAPSHOT_SOURCE = extractBraced('const captchaSnapshot = ').replace(/^const captchaSnapshot = /, '');

/* The REQUEST is extracted too, and for the same reason the decision is: captchaSnapshot now answers
 * two questions and picks between them off this object. A hand-written `{ mode: 'unresolvedCaptcha' }`
 * here would keep every case below green while the runner passed something the function does not
 * recognise, which is the one mistake that would silence the blocker predicate entirely. */
const UNRESOLVED_REQUEST = new Function(
  'CAPTCHA_SELECTORS',
  `return ${extractBraced('.evaluateAll(captchaSnapshot, ')
    .replace(/^\.evaluateAll\(captchaSnapshot, /, '')};`,
)(SELECTORS);
assert.equal(UNRESOLVED_REQUEST.selectors, SELECTORS, 'the runner must hand the snapshot its selector table');

/* THE LOCATOR IS PART OF WHAT IS UNDER TEST, so the test uses one too. Playwright's CSS engine
 * pierces open shadow roots and document.querySelectorAll does not, and a widget mounted in a shadow
 * root is one of the cases below. Driving these through querySelectorAll would quietly test a
 * different collector than the one that ships and would report that case as passing. */
const COMBINED_SELECTOR = [SELECTORS.challenge, SELECTORS.response, SELECTORS.bframe].join(', ');
const SNAPSHOT = new Function('nodes', 'request', `return (${SNAPSHOT_SOURCE})(nodes, request);`);

/* A token the length of a real one. Every provider mints an encoded blob far longer than the floor
 * the runner applies, so a fixture that wants to say "solved" has to look solved. */
const REAL_TOKEN = `03AGdBq2${'QwErTyUiOpAsDfGhJkLzXcVbNm0123456789-_'.repeat(4)}`;

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

async function evaluateSnapshot() {
  return page.locator(COMBINED_SELECTOR).evaluateAll(SNAPSHOT, UNRESOLVED_REQUEST);
}

/* The second mode, driven the way the extract handler drives it: an arbitrary caller selector, no
 * .first(), one entry per VISIBLE match. `sel` is the caller's, never CAPTCHA_SELECTORS, because
 * that is what the backend sends. */
async function visibleValues(selector, attribute) {
  return page.locator(selector).evaluateAll(SNAPSHOT, { mode: 'visibleValues', attribute });
}

async function readVisible(html, selector, attribute) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  return visibleValues(selector, attribute);
}

async function read(html) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  return evaluateSnapshot();
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
  /* The token is read off the value PROPERTY, which is the whole reason this runs in the page.
   * g-recaptcha-response is a <textarea>: it has no value ATTRIBUTE, so an attribute read returns
   * null on a solved widget and every cleared challenge would be reported as still waiting. The
   * value is set here the way the widget sets it, through the property. */
  await page.setContent(`<!doctype html><html><body>${FORM}${V2_WIDGET}
    <textarea id="g-recaptcha-response" name="g-recaptcha-response" style="display:none"></textarea>
    </body></html>`);
  await page.evaluate((token) => {
    document.getElementById('g-recaptcha-response').value = token;
  }, REAL_TOKEN);
  assert.equal(await evaluateSnapshot(), false);
});

test('a STALE leftover value is not a solved widget', async () => {
  /* REGRESSION C. The first version accepted any non-empty value as proof of a solved widget, so a
   * short leftover string in the response field silenced a widget that is still asking. The floor
   * sits far below a real token and above every placeholder, which is the whole claim it makes.
   * What it deliberately does NOT claim is that a correctly-shaped token can be checked for expiry:
   * nothing in the DOM distinguishes a fresh blob from one the provider expired server side, at this
   * layer or in the backend. The visible-popup rule below is the only honest answer to that. */
  for (const leftover of ['expired', 'null', 'undefined', '   ']) {
    assert.equal(await read(`${FORM}${V2_WIDGET}
      <textarea name="g-recaptcha-response" style="display:none">${leftover}</textarea>`), true,
    `a response field holding ${JSON.stringify(leftover)} must not read as solved`);
  }
});

test('an OPEN popup outranks any token, however real it looks', async () => {
  /* The provider is putting an image grid in front of a person right now, so whatever is sitting in
   * the response field belongs to an earlier round. This is the one staleness signal a DOM read can
   * produce without guessing, and it is why the token check runs after the popup check. */
  await page.setContent(`<!doctype html><html><body>${FORM}${V2_WIDGET}
    <textarea id="g-recaptcha-response" name="g-recaptcha-response" style="display:none"></textarea>
    <iframe title="recaptcha challenge" src="https://www.google.com/recaptcha/api2/bframe?k=K"
      width="400" height="580"></iframe>
    </body></html>`);
  await page.evaluate((token) => {
    document.getElementById('g-recaptcha-response').value = token;
  }, REAL_TOKEN);
  assert.equal(await evaluateSnapshot(), true);
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

test('a bframe that is MOUNTED but hidden does not switch the invisible rule off', async () => {
  /* REGRESSION D. The first version tested the bframe for PRESENCE. reCAPTCHA mounts that iframe
   * collapsed and leaves it mounted after the popup closes, so presence is true on pages where
   * nobody is being asked anything, and the invisible exclusion switched itself off over a form with
   * no challenge on it. The escalation exception has to key on the popup being on screen. */
  assert.equal(await read(`${FORM}
    <div class="g-recaptcha" data-sitekey="K" data-size="invisible" style="width:304px;height:78px"></div>
    <iframe title="recaptcha challenge" src="https://www.google.com/recaptcha/api2/bframe?k=K"
      width="400" height="580" style="display:none"></iframe>`), false);
});

test('a widget inside an OPEN shadow root is still a challenge', async () => {
  /* REGRESSION A, and a straight capability loss against the selector this replaced. Playwright's
   * CSS engine pierces open shadow roots; document.querySelectorAll stops at the boundary. Embedded
   * application widgets are mounted this way, and the first version could not see into any of them.
   * The shadow root is attached through the DOM API rather than declaratively so the test cannot
   * accidentally pass on a light-DOM copy of the markup. */
  await page.setContent(`<!doctype html><html><body>${FORM}<div id="widget-host"></div></body></html>`);
  await page.evaluate((markup) => {
    document.getElementById('widget-host').attachShadow({ mode: 'open' }).innerHTML = markup;
  }, V2_WIDGET);
  assert.equal(await evaluateSnapshot(), true);
});

test('noise nodes cannot use up the budget before a real widget is reached', async () => {
  /* REGRESSION B. The first version capped the scan at 20 nodes and applied the cap BEFORE the
   * visibility and badge filters, so a page whose CSS framework uses "captcha" in utility class
   * names hid a real widget behind its own noise. The cap existed to bound per-node round trips, and
   * there are no per-node round trips left: the whole matched list is handed to one page-side pass.
   * Forty hidden noise nodes here, double the old cap, with the widget last. */
  const noise = Array.from(
    { length: 40 },
    (_, i) => `<div class="captcha-tooltip-${i}" style="display:none">tooltip</div>`,
  ).join('');
  assert.equal(await read(`${FORM}${noise}${V2_WIDGET}`), true);
});

test('a plain application page reports nothing', async () => {
  // The floor. An ordinary form with no captcha markup of any kind must be silent, or none of the
  // discriminations above matter.
  assert.equal(await read(`<h1>Data Science Intern</h1>${FORM}`), false);
});

/* ---------------------------------------------------------------------------------------------
 * MODE 2: THE LAYOUT READ THE BACKEND GETS.
 *
 * WHAT THIS SECTION IS PAYING FOR. The backend's MANAGED path reads captcha evidence through the
 * extract contract, which until now returned attribute values and nothing else. It therefore had to
 * infer "is this on screen" from the attributes alone, and the rule it settled on - an absent
 * data-size means rendered, because reCAPTCHA's default is normal - is not a rule hCaptcha obeys.
 * Measured on 2026-08-12 across three live Lever postings: div#h-captcha[data-sitekey] with no
 * data-size, a 1380x0 container, two visibility:hidden iframes and an empty h-captcha-response.
 * Nothing was shown to anyone. This runner's predicate said false. The backend's direct-Playwright
 * predicate said false. The managed predicate said true and blocked all three permanently.
 *
 * THE ASYMMETRY IS THE SAME ONE AS ABOVE, pointed at a different reader. A value reported for a node
 * with no box is how a finished application gets handed back to a person to redo by hand. A value
 * withheld from a node that IS on screen is how a submit click goes through under a live challenge.
 * So both directions are pinned here, and the visible cases are pinned with markup that a
 * data-size-based rule gets WRONG, which is the whole point of paying for a layout read.
 * ------------------------------------------------------------------------------------------- */

/* Transcribed from jobs.lever.co/palantir/*, read on 2026-08-12. Lever renders hCaptcha
 * programmatically in invisible mode and never writes data-size, so every attribute-only rule sees
 * a bare [data-sitekey] and has nothing left to reason with. The container is the shape that was
 * measured: full width, zero height. */
const LEVER_INVISIBLE_HCAPTCHA = `
  <div id="h-captcha" class="h-captcha" data-sitekey="e33f87f8-88ec-4e1a-9a13-df9bbb1d8120"
    style="width:1380px;height:0">
    <iframe src="https://newassets.hcaptcha.com/captcha/v1/9d2/static/hcaptcha.html#frame=checkbox"
      style="visibility:hidden" width="1" height="1"></iframe>
    <iframe src="https://newassets.hcaptcha.com/captcha/v1/9d2/static/hcaptcha.html#frame=challenge"
      style="visibility:hidden" width="1" height="1"></iframe>
  </div>
  <input type="hidden" id="hcaptchaResponseInput" name="h-captcha-response" value="" style="display:none">`;

/* The SAME markup with the container laid out, which is what a genuinely visible hCaptcha looks
 * like: still no data-size, because hCaptcha does not write one. This is the case an
 * ':not(.h-captcha:not([data-size]))' selector patch would get wrong, and it is why the fix is a
 * layout read rather than another provider name in a selector. */
const VISIBLE_HCAPTCHA_NO_SIZE = `
  <div id="h-captcha" class="h-captcha" data-sitekey="e33f87f8-88ec-4e1a-9a13-df9bbb1d8120"
    style="width:303px;height:78px">
    <iframe src="https://newassets.hcaptcha.com/captcha/v1/9d2/static/hcaptcha.html#frame=checkbox"
      width="303" height="78"></iframe>
  </div>
  <input type="hidden" id="hcaptchaResponseInput" name="h-captcha-response" value="" style="display:none">`;

const SITEKEY_SELECTOR = '[data-sitekey]:not(.grecaptcha-badge):not(.grecaptcha-badge *)';

test('mode 2 withholds the sitekey of a widget container with no box', async () => {
  // THE THREE-POSTING CASE. The attribute is right there on the node; the node occupies nothing.
  assert.deepEqual(await readVisible(`${FORM}${LEVER_INVISIBLE_HCAPTCHA}`, SITEKEY_SELECTOR, 'data-sitekey'), []);
});

test('mode 2 reports a laid-out hCaptcha that declares no size at all', async () => {
  /* The adversary that can win, and the reason this file rather than a selector patch. Identical
     attributes to the case above - class h-captcha, data-sitekey, no data-size - and the opposite
     answer, decided by 78 pixels of height. Any rule reading only the attributes returns the same
     verdict for both, so whichever verdict it picks, one of these two pages is wrong. */
  assert.deepEqual(
    await readVisible(`${FORM}${VISIBLE_HCAPTCHA_NO_SIZE}`, SITEKEY_SELECTOR, 'data-sitekey'),
    ['e33f87f8-88ec-4e1a-9a13-df9bbb1d8120'],
  );
});

test('mode 2 reports a visible v2 checkbox widget', async () => {
  assert.deepEqual(await readVisible(`${FORM}${V2_WIDGET}`, SITEKEY_SELECTOR, 'data-sitekey'), ['6Ld_v2_key']);
});

test('mode 2 reports ONE ENTRY PER VISIBLE NODE, in DOM order', async () => {
  /* The cardinality the backend cannot otherwise establish. Its per-widget rules subtract one list
     of site keys from another, and reCAPTCHA keys are issued per domain, so the ordinary employer
     page carries two widgets on ONE key. A read that returned locator.first() collapsed both to a
     single entry and the subtraction cancelled a real widget against its own hidden twin. */
  const html = `${FORM}
    <div class="g-recaptcha" data-sitekey="K" style="width:304px;height:78px"></div>
    <div class="g-recaptcha" data-sitekey="K" style="width:304px;height:78px;display:none"></div>
    <div class="g-recaptcha" data-sitekey="K2" style="width:304px;height:78px"></div>`;
  assert.deepEqual(await readVisible(html, SITEKEY_SELECTOR, 'data-sitekey'), ['K', 'K2']);
});

test('mode 2 excludes the badge through the CALLER selector, not through a captcha table', async () => {
  /* Mode 2 is generic: it applies the visibility rule to whatever the caller located. The badge
     exclusion therefore has to be in the caller's selector, and this pins that the exclusion the
     backend actually sends does the job against the badge markup Google actually ships. Without it,
     the badge's own anchor iframe is a visible node with a src, and the only thing keeping 24 live
     Greenhouse and Ashby postings off the blocked list is a substring of a Google query string. */
  const anchors = await readVisible(
    `${FORM}${V3_BADGE}`,
    'iframe[src*="/recaptcha/"][src*="anchor"]:not(.grecaptcha-badge *)',
    'src',
  );
  assert.deepEqual(anchors, []);
});

test('the badge exclusion holds when the anchor src carries NO size parameter', async () => {
  /* THE LATENT FRAGILITY, made to fire. size=invisible is a Google query-string convention, not a
     contract with anyone, and the backend's rendered-anchor rule reads it with a regex. Strip it and
     the regex says "rendered" about the badge on every one of those 24 postings in one step. The
     structural exclusion is what has to hold here, so this fixture removes the parameter the regex
     keys on and asserts the badge is still excluded on the strength of where it sits. */
  const stripped = V3_BADGE.replace('&amp;size=invisible', '');
  assert.ok(!stripped.includes('size=invisible'), 'the fixture must really have lost the parameter');
  assert.deepEqual(
    await readVisible(`${FORM}${stripped}`, 'iframe[src*="/recaptcha/"][src*="anchor"]:not(.grecaptcha-badge *)', 'src'),
    [],
  );
  // And the contrast: the same selector still reports an anchor that is NOT in the badge.
  const outside = await readVisible(
    `${FORM}${V2_WIDGET}`,
    'iframe[src*="/recaptcha/"][src*="anchor"]:not(.grecaptcha-badge *)',
    'src',
  );
  assert.equal(outside.length, 1);
  assert.match(outside[0], /\/recaptcha\/api2\/anchor/);
});

test('a MOUNTED but hidden bframe yields no value, and an open one does', async () => {
  /* The same discrimination REGRESSION D pinned for mode 1, now reachable by the backend. reCAPTCHA
     leaves the popup iframe mounted after it closes, so presence is true on pages nobody is being
     asked anything on - including the live JazzHR posting in the 2026-08-12 sweep, whose bframe is
     mounted and hidden while a real, visible checkbox sits on the form above it. */
  const bframe = 'iframe[src*="/recaptcha/"][src*="bframe"]';
  assert.deepEqual(await readVisible(`${FORM}
    <iframe src="https://www.google.com/recaptcha/api2/bframe?k=K" width="400" height="580"
      style="display:none"></iframe>`, bframe, 'src'), []);
  const open = await readVisible(`${FORM}
    <iframe src="https://www.google.com/recaptcha/api2/bframe?k=K" width="400" height="580"></iframe>`,
  bframe, 'src');
  assert.equal(open.length, 1);
});

test('both modes share ONE definition of visible, mechanism by mechanism', async () => {
  /* THE POINT OF PUTTING MODE 2 INSIDE captchaSnapshot. Two copies of an isVisible helper would pass
     the cases above on the day they were written and drift apart afterwards with nothing to notice,
     which is precisely how the managed path ended up disagreeing with this runner in the first
     place. Every hiding mechanism the predicate knows about is driven through BOTH entry points on
     the same page, and the two are required to agree. A copy that loses an arm fails here. */
  const cases = [
    ['laid out', 'width:304px;height:78px', true],
    ['display:none', 'width:304px;height:78px;display:none', false],
    ['zero height', 'width:304px;height:0;overflow:hidden', false],
    ['visibility:hidden', 'width:304px;height:78px;visibility:hidden', false],
    ['opacity:0', 'width:304px;height:78px;opacity:0', false],
  ];
  for (const [name, style, expected] of cases) {
    await page.setContent(`<!doctype html><html><body>${FORM}
      <div class="g-recaptcha" data-sitekey="K" style="${style}"></div>
      </body></html>`);
    assert.equal(await evaluateSnapshot(), expected, `mode 1 disagrees on ${name}`);
    assert.equal((await visibleValues(SITEKEY_SELECTOR, 'data-sitekey')).length > 0, expected,
      `mode 2 disagrees on ${name}`);
  }
  // And through an ANCESTOR, which is the case a computed-style-only copy gets wrong: display does
  // not inherit, so the child's own computed display is still 'block' and only its box is gone.
  await page.setContent(`<!doctype html><html><body>${FORM}
    <div style="display:none"><div class="g-recaptcha" data-sitekey="K" style="width:304px;height:78px"></div></div>
    </body></html>`);
  assert.equal(await evaluateSnapshot(), false, 'mode 1 disagrees on an ancestor-hidden widget');
  assert.deepEqual(await visibleValues(SITEKEY_SELECTOR, 'data-sitekey'), [],
    'mode 2 disagrees on an ancestor-hidden widget');
});

/* ---------------------------------------------------------------------------------------------
 * A BORDER BOX IS NOT WHAT A PERSON SEES.
 *
 * The first version of mode 2 asked isVisible of the MATCHED NODE ONLY, and that was wrong in the
 * one direction this file exists to prevent, on the exact geometry the sweep measured.
 *
 * The caller's selectors match widget CONTAINERS and reCAPTCHA frames. Nothing in them can match an
 * hCaptcha or a Turnstile frame, so on those providers the container is the caller's only channel.
 * `height:0` under the default `overflow:visible` leaves that container's border box at 1380x0 while
 * its 303x78 checkbox is in flow, painted, and waiting to be clicked. The node-only rule reported
 * nothing, the caller discarded a correct blocker, and the run walked into a challenge it cannot
 * clear. That direction costs an application outright; the false alarm this file was written about
 * only strands one.
 *
 * THE FIXTURE THAT MISSED IT is worth naming, because it is this project's signature failure. The
 * visible-hCaptcha case used to hand-write its container as `303x78`. Nothing in the 30-posting
 * sweep measured a visible hCaptcha; the one thing measured about that container is that its height
 * is 0 while it holds non-zero children, so the height is IMPOSED rather than derived from content.
 * Assuming it goes away in the visible state was the entire safety margin, and it was an assumption,
 * not a measurement. The cases below use the geometry that was measured.
 * ------------------------------------------------------------------------------------------- */

const ZERO_HEIGHT_CONTAINER_STYLE = 'width:1380px;height:0';

test('a zero-height container that PAINTS a child is reported', async () => {
  const html = `${FORM}
    <div id="h-captcha" class="h-captcha" data-sitekey="e33f87f8-88ec-4e1a-9a13-df9bbb1d8120"
      style="${ZERO_HEIGHT_CONTAINER_STYLE}">
      <iframe src="/captcha/v1/9d2/static/hcaptcha.html#frame=checkbox" width="303" height="78"></iframe>
    </div>`;
  assert.deepEqual(await readVisible(html, SITEKEY_SELECTOR, 'data-sitekey'),
    ['e33f87f8-88ec-4e1a-9a13-df9bbb1d8120']);
});

test('the SAME container painting nothing is still withheld', async () => {
  /* The pair that makes the rule above mean something rather than "report everything". Identical
     container, identical attributes, identical 1380x0 box: the only difference is what the children
     are doing, which is the whole question. This is the live Lever shape, and the PR that added mode
     2 exists to keep it silent. */
  assert.deepEqual(await readVisible(`${FORM}${LEVER_INVISIBLE_HCAPTCHA}`, SITEKEY_SELECTOR, 'data-sitekey'), []);
});

test('a Turnstile container is reachable through the same rule', async () => {
  // Turnstile is the second provider with no frame-level selector of its own, so the container is
  // the only channel and a node-only rule is blind here for the same reason.
  const html = `${FORM}
    <div class="cf-turnstile" data-sitekey="0x4AAAAAAADnPIDROrmt1Wwj" style="${ZERO_HEIGHT_CONTAINER_STYLE}">
      <iframe src="/challenges.cloudflare.com/cdn-cgi/challenge-platform/h/b/turnstile/if/ov2"
        width="300" height="65"></iframe>
    </div>`;
  assert.deepEqual(await readVisible(html, SITEKEY_SELECTOR, 'data-sitekey'), ['0x4AAAAAAADnPIDROrmt1Wwj']);
});

test('an ESCALATED challenge overlay inside a zero-height container is reported', async () => {
  // The post-click state. hCaptcha mounts the image grid as a fixed-position overlay inside the same
  // container, so the container geometry never changes and a person is looking at a grid right now.
  const html = `${FORM}
    <div id="h-captcha" class="h-captcha" data-sitekey="K" style="${ZERO_HEIGHT_CONTAINER_STYLE}">
      <iframe src="/captcha/v1/9d2/static/hcaptcha.html#frame=checkbox" style="visibility:hidden" width="1" height="1"></iframe>
      <iframe src="/captcha/v1/9d2/static/hcaptcha.html#frame=challenge" width="400" height="580"
        style="position:fixed;top:0;left:0"></iframe>
    </div>`;
  assert.deepEqual(await readVisible(html, SITEKEY_SELECTOR, 'data-sitekey'), ['K']);
});

test('the subtree rule does not reach across an iframe boundary', async () => {
  /* REGRESSION D, which the subtree widening could have undone and does not. reCAPTCHA leaves the
     popup iframe mounted and collapsed after it closes, and an iframe's document is not in this
     document's querySelectorAll, so a collapsed bframe has no visible descendants to find here
     whatever is inside it. Pinned because "or any descendant" is exactly the kind of widening that
     quietly re-opens a closed hole. */
  const bframe = 'iframe[src*="/recaptcha/"][src*="bframe"]';
  assert.deepEqual(await readVisible(`${FORM}
    <iframe src="/recaptcha/api2/bframe?k=K" width="400" height="580" style="display:none"></iframe>`,
  bframe, 'src'), []);
});

test('a hidden container whose children are all hidden stays withheld, mechanism by mechanism', async () => {
  /* The floor under the widening. Each mechanism is applied to the CHILD while the container is the
     measured 1380x0, so the only thing that can report a value is a child the browser is painting.
     A subtree rule that forgot any one of these arms would report a page showing nobody anything. */
  for (const style of ['display:none', 'visibility:hidden', 'opacity:0']) {
    const html = `${FORM}
      <div class="h-captcha" data-sitekey="K" style="${ZERO_HEIGHT_CONTAINER_STYLE}">
        <iframe src="/captcha/v1/9d2/static/hcaptcha.html#frame=checkbox" width="303" height="78"
          style="${style}"></iframe>
      </div>`;
    assert.deepEqual(await readVisible(html, SITEKEY_SELECTOR, 'data-sitekey'), [],
      `a child hidden by ${style} must not report its container`);
  }
});

test('a child collapsed by SIZE ALONE still has an iframe border box, and is reported', async () => {
  /* A RESIDUAL, pinned rather than hidden, and it was found by writing this list before writing the
     rule. An <iframe> carries a 2px inset border by default, so `width:0;height:0` still lays out a
     4x4 border box and every isVisible in this runner has always called that painted. The rule keys
     on whether the browser paints a box, not on whether the box is big enough to use.
     WHY IT IS LEFT ALONE. An area floor is exactly the kind of number nothing in the sweep measured,
     and picking one would be guessing at the boundary between a collapsed widget and a small one.
     The measured Lever page does not depend on it either way: its frames carry visibility:hidden, so
     the arms above are what keep it silent, and a provider that switched to size-only collapsing
     would fail toward the blocker rather than toward a submit under a live challenge. */
  const html = `${FORM}
    <div class="h-captcha" data-sitekey="K" style="${ZERO_HEIGHT_CONTAINER_STYLE}">
      <iframe src="/captcha/v1/9d2/static/hcaptcha.html#frame=checkbox" width="303" height="78"
        style="width:0;height:0"></iframe>
    </div>`;
  assert.deepEqual(await readVisible(html, SITEKEY_SELECTOR, 'data-sitekey'), ['K']);
  // And the same node with its border removed has no box at all, which is what makes the reading
  // above a statement about the border box rather than about the size attributes.
  const borderless = html.replace('style="width:0;height:0"', 'style="width:0;height:0;border:0"');
  assert.deepEqual(await readVisible(borderless, SITEKEY_SELECTOR, 'data-sitekey'), []);
});
