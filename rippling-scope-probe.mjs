import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://ats.rippling.com/easy-dynamics-corporation/jobs/0eb836b2-6719-48e0-89c9-6c589063a225/apply', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
const out = await page.evaluate(() => {
  const apply = [...document.querySelectorAll('button')].find(b => /apply/i.test(b.textContent || ''));
  const form = document.querySelector('form');
  const formFields = form ? form.querySelectorAll('input, textarea, select, [role="combobox"]').length : 0;
  const insideForm = apply ? Boolean(apply.closest('form')) : null;
  const formHasApply = form ? form.contains(apply) : null;
  // sms radios
  const radios = [...document.querySelectorAll('input[name="sms_opt_in"]')].map(r => ({
    value: r.value, checked: r.checked, required: r.hasAttribute('required') || r.getAttribute('aria-required'),
    labelText: (r.closest('label')?.textContent || r.parentElement?.textContent || '').trim().slice(0, 90)
  }));
  return { applyText: apply?.textContent.trim(), insideForm, formHasApply, formFields, ariaDisabled: apply?.getAttribute('aria-disabled'), radios };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
