/* THE REQUIRED-CONFIRM SCAN READS A BARE OPENER'S COMMITTED CHOICE.
 *
 * Measured on the live Easy Dynamics Rippling form (2026-08-20): the two required
 * '<div role="combobox" aria-label="Select">' work-authorization selects were filled with their
 * resolved answers, readSubmitReadiness's bare-opener arm read them as answered, and the atomic
 * required-field confirmation still called them "required field is empty": its chosenValue had
 * no arm for a div opener whose only publication is its rendered text, so the run found the send
 * button and withheld the press over two committed answers.
 *
 * These cases run the REAL chosenValue (extracted from the shipped runner, never copied) against
 * that measured shape and against the empty states that must stay empty.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

function chosenValueSource() {
  const start = SANDBOX_RUNNER.indexOf('const ownedNativeControls = (element) => {',
    SANDBOX_RUNNER.indexOf('const ownedNativeControls = (element) => {') + 1);
  assert.notEqual(start, -1, 'the confirm-scan chosenValue must exist');
  const end = SANDBOX_RUNNER.indexOf('const errorText = (widget)', start);
  assert.ok(end > start);
  return SANDBOX_RUNNER.slice(start, end);
}

let browser;
let page;
test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

async function chosen(markup, selector) {
  await page.setContent('<!doctype html><html><body>' + markup + '</body></html>');
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction('args', `
    const { selector, source } = args;
    const clean = (value) => String(value || '').replace(/\\s+/g, ' ').trim();
    const CHOICE_OPENER = '[role="combobox"], [aria-haspopup="listbox"]';
    const reactChoiceBinding = () => null;
    const reactChoiceAnswered = () => false;
    const chosenAshbyYesNoOf = () => null;
    const semanticChoiceGroup = () => null;
    const enabledNativeChoiceAnswered = () => false;
    const selectHasEnabledSelection = () => false;
    const root = document.body;
    let chosenValue;
    eval(source.replace('const chosenValue =', 'chosenValue ='));
    const element = document.querySelector(selector);
    return Boolean(chosenValue(element, element.parentElement || element));
  `);
  return page.evaluate(run, { selector, source: chosenValueSource() });
}

/* Byte-for-byte the measured Rippling shape: a div opener whose only publication is its
 * rendered text. */
const opener = (text, aria) => (
  '<div class="css-18c1nrl"><div id="field-59" role="combobox" aria-label="' + aria
  + '" aria-required="true" tabindex="0"><p>' + text + '</p></div></div>'
);

test('a committed answer rendered in the opener reads as chosen', async () => {
  assert.equal(await chosen(opener('Yes', 'Select'), '#field-59'), true);
});

test('the aria-label restatement is the measured empty state and stays empty', async () => {
  assert.equal(await chosen(opener('Select', 'Select'), '#field-59'), false);
});

test('placeholder-shaped text stays empty', async () => {
  assert.equal(await chosen(opener('Select...', 'Select...'), '#field-59'), false);
  assert.equal(await chosen(opener('Please select an option', 'Country'), '#field-59'), false);
  assert.equal(await chosen(opener('Auswählen', 'Allgemeine Anrede'), '#field-59'), false);
  assert.equal(await chosen(opener('Frau', 'Allgemeine Anrede'), '#field-59'), true);
});

test('an opener with an inner search input keeps the pre-existing treatment', async () => {
  const markup = '<div id="wrap"><div id="field-77" role="combobox">'
    + '<input type="text" value=""><p>Asian</p></div></div>';
  assert.equal(await chosen(markup, '#field-77'), false);
});
