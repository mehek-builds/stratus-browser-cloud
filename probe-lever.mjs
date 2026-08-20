import { chromium } from 'playwright-core';
const url = 'https://jobs.lever.co/mytos/bbb558c0-d769-4b5f-a3a7-025642c2626d/apply';
const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
const info = await page.evaluate(() => {
  const out = [];
  for (const sel of document.querySelectorAll('select')) {
    const s2 = sel.nextElementSibling;
    out.push({
      name: sel.name, id: sel.id, required: sel.required, ariaRequired: sel.getAttribute('aria-required'),
      options: sel.options.length, visible: !!(sel.offsetWidth || sel.offsetHeight),
      display: getComputedStyle(sel).display,
      sibling: s2 ? { cls: (s2.className || '').toString().slice(0, 80), tag: s2.tagName } : null,
      label: (() => { let el = sel; for (let i = 0; i < 6 && el; i++) { el = el.parentElement; const q = el && el.querySelector('label, .application-label'); if (q) return q.textContent.trim().slice(0, 80); } return null; })(),
    });
  }
  return out;
});
console.log(JSON.stringify(info, null, 1));
await browser.close();
