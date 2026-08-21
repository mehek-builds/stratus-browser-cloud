import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';

let browser;
let page;

test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});

test.after(async () => { await browser?.close(); });

test('a pronoun question block excludes the earlier phonetic-name textbox', async () => {
  await page.setContent(`
    <div id="shared-applicant-details">
      <label for="phonetic">Write out how your name is pronounced phonetically</label>
      <input id="phonetic" type="text" />
      <fieldset id="pronouns">
        <legend>We care about addressing everyone correctly. Add your personal pronouns below to share with the hiring team.</legend>
        <label><input type="checkbox" value="She/her/hers" />She/her/hers</label>
        <label><input type="checkbox" value="They/them/theirs" />They/them/theirs</label>
      </fieldset>
    </div>
  `);

  const anchor = page.getByText(
    'We care about addressing everyone correctly. Add your personal pronouns below to share with the hiring team.',
    { exact: true },
  );
  const shared = page.locator('#shared-applicant-details');
  assert.equal(await shared.locator('textarea, input:not([type=file]):not([type=hidden]), select').first().getAttribute('id'), 'phonetic');

  const questionBlock = anchor.locator(
    'xpath=ancestor-or-self::*[(self::fieldset or @data-field-path or @role="radiogroup" or @role="group"'
    + ' or contains(@class,"_fieldEntry_")) and .//input[@type="radio" or @type="checkbox"]][1]',
  ).first();
  assert.equal(await questionBlock.getAttribute('id'), 'pronouns');
  assert.equal(
    await questionBlock.locator('textarea, input:not([type=file]):not([type=hidden]), select').first().getAttribute('value'),
    'She/her/hers',
  );
});
