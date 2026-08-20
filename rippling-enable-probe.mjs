import { chromium } from 'playwright-core';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('https://ats.rippling.com/easy-dynamics-corporation/jobs/0eb836b2-6719-48e0-89c9-6c589063a225/apply', { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(6000);
const applyState = async () => page.evaluate(() => {
  const b = [...document.querySelectorAll('button')].find(x => /apply/i.test(x.textContent||''));
  return b?.getAttribute('aria-disabled');
});
const fill = async (sel, val) => { await page.fill(sel, val).catch(e => console.log('fill fail', sel, e.message.slice(0,60))); };
await fill('#field-8', 'Mehek');
await fill('#field-12', 'Mandal');
await fill('#field-16', 'test@example.com');
await fill('#field-31', '2135746270');
// location autocomplete: type then pick first suggestion
await page.click('#field-42').catch(()=>{});
await page.fill('#field-42', 'Dubai').catch(()=>{});
await page.waitForTimeout(1500);
await page.keyboard.press('ArrowDown').catch(()=>{});
await page.keyboard.press('Enter').catch(()=>{});
// resume upload
const fileInput = page.locator('input[type="file"]').first();
await fileInput.setInputFiles('/tmp/dummy-resume.pdf').catch(e => console.log('file fail', e.message.slice(0,60)));
await page.waitForTimeout(4000);
// the two required selects
for (const id of ['field-59', 'field-65']) {
  await page.click(`#${id}`).catch(()=>{});
  await page.waitForTimeout(800);
  const row = page.locator(`#${id}-list [role="option"]`).first();
  await row.click().catch(e => console.log('row fail', id, e.message.slice(0,60)));
  await page.waitForTimeout(400);
}
console.log('after required fills, apply aria-disabled =', await applyState());
// now the sms radio (No)
await page.evaluate(() => {
  const no = [...document.querySelectorAll('input[name="sms_opt_in"]')].find(r => r.value === 'false');
  if (no) { no.click(); }
});
await page.waitForTimeout(800);
console.log('after sms No, apply aria-disabled =', await applyState());
await browser.close();
