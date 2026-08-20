import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://ats.rippling.com/easy-dynamics-corporation/jobs/0eb836b2-6719-48e0-89c9-6c589063a225/apply', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
const out = await page.evaluate(() => {
  const info = (el) => {
    // walk up to the field block and read its heading/label text
    let p = el; let label = '';
    for (let i = 0; i < 6 && p; i++) {
      p = p.parentElement;
      if (!p) break;
      const lab = p.querySelector(':scope > label, :scope > div > label, :scope [id$="-label"]');
      if (lab && lab.textContent.trim()) { label = lab.textContent.trim(); break; }
    }
    return label;
  };
  const req = [...document.querySelectorAll('[aria-required="true"], [required]')].map(el => ({
    id: el.id, tag: el.tagName, type: el.getAttribute('type'), role: el.getAttribute('role'),
    label: info(el) || el.getAttribute('aria-label'), value: (el.value ?? '').toString().slice(0,30)
  }));
  const radios = [...document.querySelectorAll('input[type="radio"], [role="radio"]')].map(el => ({
    id: el.id, name: el.getAttribute('name'), aria: el.getAttribute('aria-label'),
    labelText: (el.closest('label')?.textContent || '').trim().slice(0,80),
    required: el.getAttribute('aria-required') || el.hasAttribute('required')
  }));
  return { req, radios };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
