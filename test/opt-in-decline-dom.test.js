/* AN UNANSWERED OPT-IN THAT HOLDS THE SEND BUTTON DISABLED IS DECLINED, ONCE, BY NAME.
 *
 * Measured on the live Easy Dynamics Rippling form (2026-08-20): with every required field filled
 * and the resume uploaded, the Apply button stays aria-disabled="true" until the label-less
 * 'sms_opt_in' radio pair gets an answer, and it enables the moment one is chosen. Discovery
 * cannot mint a question for a group with no label and no aria-required, so no action ever
 * reached it and the submit pass reported a missing button about a button on screen.
 *
 * These cases run the REAL decline pass (extracted from the shipped runner, never copied) against
 * that measured shape and against the shapes that must be left alone.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

function declineSource() {
  const start = SANDBOX_RUNNER.indexOf('const OPTIN_NAME =');
  const end = SANDBOX_RUNNER.indexOf('return declinedNames;', start);
  assert.ok(start > 0 && end > start, 'the decline pass must exist in the sandbox runner');
  return SANDBOX_RUNNER.slice(start, end) + 'return declinedNames;';
}

let browser;
let page;
test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

async function runDecline(markup) {
  await page.setContent('<!doctype html><html><body>' + markup + '</body></html>');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  return page.evaluate(new AsyncFunction(declineSource()));
}

/* Byte-for-byte the live Rippling shape: value-carrying radios, no label element, no
 * aria-required, the copy in a paragraph nearby. */
const rippling = '<p>Check Yes or No to indicate your agreement to receive text message updates.</p>'
  + '<input type="radio" name="sms_opt_in" value="true">'
  + '<input type="radio" name="sms_opt_in" value="false">'
  + '<button type="submit" aria-disabled="true">Apply</button>';

test('the measured Rippling sms_opt_in pair is declined by its value member', async () => {
  const declined = await runDecline(rippling);
  assert.deepEqual(declined, ['sms_opt_in']);
  const state = await page.evaluate(() => (
    [...document.querySelectorAll('input[name="sms_opt_in"]')].map((radio) => ({ value: radio.value, checked: radio.checked }))
  ));
  assert.deepEqual(state, [{ value: 'true', checked: false }, { value: 'false', checked: true }]);
});

test('an already-answered group is left exactly as she answered it', async () => {
  const declined = await runDecline(
    '<input type="radio" name="sms_opt_in" value="true" checked>'
    + '<input type="radio" name="sms_opt_in" value="false">',
  );
  assert.deepEqual(declined, []);
  const accepted = await page.evaluate(() => document.querySelector('input[value="true"]').checked);
  assert.equal(accepted, true);
});

test('a group whose name is not opt-in shaped is never touched', async () => {
  const declined = await runDecline(
    '<input type="radio" name="work_authorization" value="true">'
    + '<input type="radio" name="work_authorization" value="false">',
  );
  assert.deepEqual(declined, []);
});

test('wording finds the decline when values carry no polarity', async () => {
  const declined = await runDecline(
    '<label><input type="radio" name="marketing_opt_in" value="a">Yes, send me updates</label>'
    + '<label><input type="radio" name="marketing_opt_in" value="b">No - I do not consent to receiving text messages</label>',
  );
  assert.deepEqual(declined, ['marketing_opt_in']);
  const chosen = await page.evaluate(() => document.querySelector('input[value="b"]').checked);
  assert.equal(chosen, true);
});

test('a group with no identifiable decline member is left alone', async () => {
  const declined = await runDecline(
    '<label><input type="radio" name="email_opt_in" value="a">Weekly</label>'
    + '<label><input type="radio" name="email_opt_in" value="c">Monthly</label>',
  );
  assert.deepEqual(declined, []);
});

/* The gate around the pass, pinned in source: it runs only when NO candidate is viable and some
 * final-intent control is sitting there DISABLED, it declines (never accepts), and it re-reads
 * the candidates exactly once. */
test('the pass is gated on a disabled final control and runs once', () => {
  const start = SANDBOX_RUNNER.indexOf('const viableAmong =');
  const end = SANDBOX_RUNNER.indexOf('const submitLocator =', start);
  assert.ok(start > 0 && end > start);
  const body = SANDBOX_RUNNER.slice(start, end);
  assert.match(body, /viable\.length === 0 && Array\.isArray\(choices\)/);
  assert.match(body, /choice\.visible && choice\.finalIntent && choice\.disabled/);
  assert.equal((body.match(/readSubmitChoices\(\)/g) || []).length, 2, 'one read, one re-read, never a loop');
  assert.match(body, /filledFields\.push\('question:' \+ name/);
});
