import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://ats.rippling.com/easy-dynamics-corporation/jobs/0eb836b2-6719-48e0-89c9-6c589063a225/apply', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
const out = await page.evaluate(() => {
  const forms = document.querySelectorAll('form').length;
  const nodes = [...document.querySelectorAll('button, [role="button"], input[type="submit"]')]
    .filter(n => /apply|submit/i.test((n.textContent || '') + (n.getAttribute('aria-label') || '') + (n.value || '')));
  return {
    forms,
    candidates: nodes.map(n => ({
      tag: n.tagName, type: n.getAttribute('type'), role: n.getAttribute('role'),
      text: (n.textContent || '').trim().slice(0, 40),
      html: n.outerHTML.slice(0, 300),
      ancestors: (() => { let p = n.parentElement, out = []; for (let i=0;i<5&&p;i++){out.push(p.tagName + '.' + (p.className||'').toString().slice(0,40) + (p.id?('#'+p.id):'')); p=p.parentElement;} return out; })()
    }))
  };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
