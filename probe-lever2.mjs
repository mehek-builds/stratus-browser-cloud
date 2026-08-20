import { chromium } from 'playwright-core';
const url = 'https://jobs.lever.co/mytos/bbb558c0-d769-4b5f-a3a7-025642c2626d/apply';
const browser = await chromium.launch();
const page = await browser.newPage({ userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' });
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
const html = await page.evaluate(() => {
  const sel = document.querySelector('select[name*="field1"]');
  const card = sel.closest('li, .application-question, div[class*="question"]') || sel.parentElement.parentElement;
  const trim = (node, depth) => {
    if (depth > 4) return '...';
    return node.tagName + (node.className ? '.' + String(node.className).split(' ').slice(0,3).join('.') : '')
      + (node.name ? '[name=' + node.name + ']' : '')
      + (node.children.length === 0 ? ' :: "' + (node.textContent || '').trim().slice(0, 60) + '"' : '')
      + '\n' + [...node.children].map((c) => '  '.repeat(depth + 1) + trim(c, depth + 1)).join('');
  };
  const uni = document.querySelector('select[id^="university-picker"]');
  const uniCard = uni.closest('li, .application-question') || uni.parentElement.parentElement;
  return { field1: trim(card, 0).slice(0, 2500), uniOuter: trim(uniCard, 0).slice(0, 2500) };
});
console.log(html.field1);
console.log('=== UNIVERSITY ===');
console.log(html.uniOuter);
await browser.close();
