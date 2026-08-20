/* THE PHONE FIELD THAT DOES NOT SAY type="tel", RUN AGAINST THE MARKUP THE EMPLOYER SERVES.
 *
 * PR #65 taught verifyFilled that a tel field verifies on digits, so the control's own formatting
 * is not a lost answer - and gated the arm on type="tel". Two days later the same defect walked in
 * one board over: the live Rippling apply form (ats.rippling.com, Easy Dynamics, measured
 * 2026-08-20) renders its phone control as
 *
 *   <input id="field-31" type="text" inputmode="tel" data-input="phone_number"
 *     placeholder="Phone number" ...>
 *
 * type="text", so the digit arm was unreachable, the field auto-formatted with dashes, and the run
 * told the applicant:
 *
 *   phone: value did not persist after fill (wrote "2135746270", field holds "213-574-6270")
 *
 * with both sides holding the same ten digits. This file runs the shipped verifyFilled - extracted,
 * not copied - against that exact element shape and that exact wrote/holds pair.
 *
 * WHY A BROWSER AND NOT A STUB. verifyFilled's first move is `element instanceof HTMLInputElement`,
 * which no stub can answer honestly, and the whole point of the read-back is what a real input
 * reports through .value and getAttribute.
 *
 * The option matchers are stubbed to `false` deliberately: they can only ever ADD accepts, so a
 * verification that passes here passes on the digit comparison alone, and a stricter harness cannot
 * hide a regression behind an option match.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* Extracted from the shipped runner string rather than copied, the same way
 * question-label-dom.test.js does it. A copy would let this file keep passing while the verifier
 * drifted, which is the drift class this repo keeps measuring. */
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

function extractLine(prefix) {
  const start = SANDBOX_RUNNER.indexOf(prefix);
  assert.notEqual(start, -1, `${prefix} must still be in the runner`);
  const end = SANDBOX_RUNNER.indexOf('\n', start);
  return SANDBOX_RUNNER.slice(start, end);
}

const VERIFY_SOURCE = [
  extractLine('const clean = (value) => String(value == null'),
  extractLine('const normalized = (value) => clean(value)'),
  // Stubbed closed on purpose; see the header comment.
  'const optionMatches = () => false;',
  'const optionMatchesExactly = () => false;',
  'const declineMatches = () => false;',
  extractBraced('const verifyFilled = async (field, expected) => {'),
].join('\n');

let browser;
let page;

test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

/* Puts `html` on a real page and asks the shipped verifyFilled whether the first matching control
 * holds `expected`. The field shim forwards evaluate() to the live element, which is the only
 * locator behavior verifyFilled uses. */
async function verifies(html, selector, expected) {
  await page.setContent(`<!doctype html><html><body>${html}</body></html>`);
  return page.evaluate(async ([source, sel, want]) => {
    // eslint-disable-next-line no-new-func
    const verifyFilled = new Function(`${source}\nreturn verifyFilled;`)();
    const element = document.querySelector(sel);
    const field = { evaluate: (fn) => Promise.resolve(fn(element)) };
    return verifyFilled(field, want);
  }, [VERIFY_SOURCE, selector, expected]);
}

// The live Rippling element shape, attribute for attribute, holding the live run's read-back.
const RIPPLING_PHONE = `
  <input id="field-31" data-input="phone_number" data-testid="input-phone_number" type="text"
    inputmode="tel" autocomplete="off" placeholder="Phone number" value="213-574-6270" />`;

test('a text input the employer marks as a phone verifies on digits, like a tel input', async () => {
  // The exact pair from the 2026-08-20 packet: wrote "2135746270", field holds "213-574-6270".
  assert.equal(await verifies(RIPPLING_PHONE, '#field-31', '2135746270'), true);
});

test('the inferred-phone arm still fails closed on a genuinely different number', async () => {
  // Same field, one digit off: digit comparison is a comparison, not an amnesty.
  assert.equal(await verifies(RIPPLING_PHONE, '#field-31', '2135746271'), false);
});

test('each phone signal the live element carries is sufficient on its own', async () => {
  // inputmode="tel" alone, with nothing else phone-shaped on the control.
  assert.equal(await verifies(`
    <input id="f" type="text" inputmode="tel" value="(213) 574-6270" />`, '#f', '2135746270'), true);
  // The phone word in the placeholder alone, which is all some boards say.
  assert.equal(await verifies(`
    <input id="f" type="text" placeholder="Phone number" value="213.574.6270" />`, '#f', '2135746270'), true);
  // autocomplete="tel-national", the standards-track spelling.
  assert.equal(await verifies(`
    <input id="f" type="text" autocomplete="tel-national" value="213 574 6270" />`, '#f', '2135746270'), true);
});

test('a short numeric answer near the word phone is never judged by digits alone', async () => {
  /* The bound the inferred arm carries and type="tel" does not: both sides must hold at least
   * seven digits. "10" against "10+" is the measured collision class ("10" chose "10+" once
   * already, in the option tiers); an extension box beside a phone number is the live shape.
   * These still verify or refuse exactly as they did before this arm existed. */
  assert.equal(await verifies(`
    <input id="f" type="text" placeholder="Phone extension" value="101" />`, '#f', '10'), false);
  // Digits EQUAL but short, with the field reformatting: without the seven-digit bound the
  // inferred arm would accept this pair on digits alone. It must stay a strict-comparison refusal.
  assert.equal(await verifies(`
    <input id="f" type="text" placeholder="Phone extension" value="1-0" />`, '#f', '10'), false);
});

test('a plain text field is judged exactly as before', async () => {
  // No phone evidence anywhere: the digit arm must not reach an ordinary numeric answer.
  assert.equal(await verifies(`
    <input id="f" type="text" placeholder="Desired salary" value="90,000" />`, '#f', '90000'), false);
});

test('the declared tel field from PR #65 keeps its behavior to the byte', async () => {
  assert.equal(await verifies(`
    <input id="f" type="tel" value="(213) 574-6270" />`, '#f', '2135746270'), true);
  assert.equal(await verifies(`
    <input id="f" type="tel" value="(213) 574-6271" />`, '#f', '2135746270'), false);
});
