import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://ats.rippling.com/easy-dynamics-corporation/jobs/0eb836b2-6719-48e0-89c9-6c589063a225/apply', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
const race = page.locator('#field-77');
await race.click();
await page.waitForTimeout(1200);
const menu = await page.evaluate(() => {
  const list = document.getElementById('field-77-list') || document.querySelector('[role="listbox"]');
  return {
    listId: list ? list.id : null,
    rows: list ? [...list.querySelectorAll('[role="option"], li, div')].map(n => n.textContent.trim()).filter(Boolean).slice(0, 25) : []
  };
});
console.log('MENU', JSON.stringify(menu, null, 1));
// click the Asian row
const row = page.locator('#field-77-list [role="option"]', { hasText: 'Asian' }).first();
await row.click().catch(e => console.log('row click failed', e.message));
await page.waitForTimeout(1200);
const after = await page.evaluate(() => {
  const input = document.getElementById('field-77');
  // walk up 4 ancestors and dump
  let node = input, dumps = [];
  for (let i = 0; i < 4 && node; i++) { node = node.parentElement; }
  return {
    inputValue: input.value,
    inputAria: input.getAttribute('aria-label'),
    placeholder: input.placeholder,
    wrapper4: node ? node.outerHTML.slice(0, 2500) : null
  };
});
console.log('AFTER', JSON.stringify(after, null, 1));
await browser.close();
