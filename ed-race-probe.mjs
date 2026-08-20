import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://ats.rippling.com/easy-dynamics-corporation/jobs/0eb836b2-6719-48e0-89c9-6c589063a225/apply', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
const info = await page.evaluate(() => {
  const out = [];
  for (const el of document.querySelectorAll('[role="combobox"]')) {
    const id = el.id || '';
    const label = (id && document.querySelector(`[id="${id}-label"]`)?.textContent) || el.getAttribute('aria-label') || '';
    out.push({
      tag: el.tagName, id, label: label.trim().slice(0,60),
      ariaMultiselectable: el.getAttribute('aria-multiselectable'),
      ariaControls: el.getAttribute('aria-controls'),
      html: el.outerHTML.slice(0, 400),
      parentHtml: el.parentElement ? el.parentElement.outerHTML.slice(0, 500) : ''
    });
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
