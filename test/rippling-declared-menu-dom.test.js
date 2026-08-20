/* THE MENU NAMED BY CONVENTION, READ OFF A REAL DOM.
 *
 * Rippling's bare div combobox ('<div role="combobox" id="field-90">', ats.rippling.com, Easy
 * Dynamics, 2026-08-20) portals its popup to '<div role="listbox" id="field-90-list">' with no
 * aria-controls or aria-owns anywhere. readDeclaredMenu used to come back empty for it, menuRoot
 * had nowhere it was allowed to look, and the correct answer sat unclicked in the open portal.
 * These cases run the REAL readDeclaredMenu (extracted from the shipped runner, never copied)
 * against that shape and against the shapes that must keep refusing.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

function constSource(name, indent) {
  const pad = ' '.repeat(indent);
  const start = SANDBOX_RUNNER.indexOf(`\n${pad}const ${name} = `);
  assert.notEqual(start, -1, `${name} must exist in the sandbox runner`);
  const rest = SANDBOX_RUNNER.slice(start + 1);
  const next = rest.search(new RegExp(`\\n${pad}(?:const|let|var|for|if|return|await|//|/\\*)`));
  return rest.slice(0, next === -1 ? rest.length : next);
}

const READ_DECLARED_MENU = constSource('readDeclaredMenu', 6);

let browser;
let page;
test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { if (browser) await browser.close(); });

/* `page.locator(...)` inside readDeclaredMenu only ever receives the selector; handing back the
 * raw selector string lets the assertions read WHICH menu was declared without faking anything
 * else. `control.evaluate` stays the real Playwright evaluate against the real DOM. */
async function declaredMenuFor(markup, controlSelector) {
  await page.setContent(`<!doctype html><html><body>${markup}</body></html>`);
  const control = page.locator(controlSelector);
  const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;
  const run = new AsyncFunction('page', 'control', `
    let declaredMenu = null;
    ${READ_DECLARED_MENU}
    await readDeclaredMenu(control);
    return declaredMenu;
  `);
  return run({ locator: (selector) => selector }, control);
}

test('an aria-controls reference still wins, byte for byte', async () => {
  const declared = await declaredMenuFor(
    '<div role="combobox" id="field-90" aria-controls="the-real-menu"></div>'
    + '<div role="listbox" id="field-90-list"></div>'
    + '<div role="listbox" id="the-real-menu"></div>',
    '#field-90',
  );
  assert.equal(declared, '[id="the-real-menu"]');
});

test('the {id}-list convention names the menu when nothing is referenced', async () => {
  const declared = await declaredMenuFor(
    '<div role="combobox" id="field-90" aria-haspopup="listbox">Select</div>'
    + '<div role="listbox" id="field-90-list"><div role="option">Yes</div><div role="option">No</div></div>',
    '#field-90',
  );
  assert.equal(declared, '[id="field-90-list"]');
});

test('a conventional listbox with no visible rows declares nothing', async () => {
  /* Another question's collapsed or permanently rendered-but-hidden list under a colliding name
   * must not become this control's menu; and a menu that has not rendered yet simply fails this
   * read and is retried by waitForMenu's poll. */
  const declared = await declaredMenuFor(
    '<div role="combobox" id="field-90">Select</div>'
    + '<div role="listbox" id="field-90-list" style="display:none"><div role="option">Yes</div></div>',
    '#field-90',
  );
  assert.equal(declared, null);
});

test('a conventional id that is not a listbox declares nothing', async () => {
  const declared = await declaredMenuFor(
    '<div role="combobox" id="field-90">Select</div>'
    + '<div id="field-90-list">just a div wearing the name</div>',
    '#field-90',
  );
  assert.equal(declared, null);
});

test('no id, no reference, no menu: the control is handed back exactly as before', async () => {
  const declared = await declaredMenuFor(
    '<div role="combobox">Select</div><div role="listbox" id="orphan-list"></div>',
    '[role="combobox"]',
  );
  assert.equal(declared, null);
});
