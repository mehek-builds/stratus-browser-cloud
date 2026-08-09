/* THE DATE ARITHMETIC, RUN INSTEAD OF READ.
 *
 * The rest of this suite pins the runner by asserting that strings appear inside it, which cannot
 * catch a parser that reads "05/01/2028" as the fifth of January, or a convention that widens a
 * bare year into a month nobody stated. Those are the two ways this code can put a false fact on a
 * real application, so they are executed here rather than pattern-matched.
 *
 * The functions are EXTRACTED from the shipped runner string, never copied. A copy would let this
 * file keep passing while the code that ships drifted away from it, which is the failure the two
 * existing DOM test files were written to end.
 *
 * THE RULE UNDER TEST, stated once so a future reader can disagree with it deliberately:
 *
 *   A month-precision graduation date going into a control that insists on a day is written as the
 *   FIRST of that month. The year and the month are exactly what is on file; the first is the
 *   canonical widening of a month-precision date and is what ISO 8601, every date library and the
 *   picker itself produce from the same input; and no reader can take a different month out of it.
 *
 *   A bare YEAR going into the same control is REFUSED. Widening a year to a day means choosing a
 *   month - twelve choices, eleven of them false - and the month the picker chooses for itself is
 *   January, which on the live Deepgram form puts 01/01/2028 in a field about a person who
 *   graduates in May. That is not a missing day, it is the wrong answer to the question an
 *   internship screens on.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { chromium } from 'playwright-core';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* Slices one `const NAME = ...;` declaration out of the runner by balancing brackets, so the test
 * runs the shipped source of that declaration and nothing else. */
function declarationOf(name) {
  const start = SANDBOX_RUNNER.indexOf('const ' + name + ' =');
  assert.notEqual(start, -1, name + ' must still be in the runner');
  let depth = 0;
  for (let i = start; i < SANDBOX_RUNNER.length; i += 1) {
    const ch = SANDBOX_RUNNER[i];
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ';' && depth === 0) return SANDBOX_RUNNER.slice(start, i + 1);
  }
  throw new Error('could not find the end of ' + name);
}

const HELPERS = [
  'clean',
  'MONTH_WORDS',
  'calendarPointOf',
  'sameCalendarPoint',
  'dateWriteForms',
].map(declarationOf).join('\n');

const { calendarPointOf, sameCalendarPoint, dateWriteForms } = new Function(
  HELPERS + '\nreturn { calendarPointOf, sameCalendarPoint, dateWriteForms };',
)();

test('a graduation answer is read at the precision it was written at', () => {
  assert.deepEqual(calendarPointOf('2028'), { year: 2028, month: 0, day: 0, precision: 'year' });
  assert.deepEqual(calendarPointOf('May 2028'), { year: 2028, month: 5, day: 0, precision: 'month' });
  assert.deepEqual(calendarPointOf('2028-05'), { year: 2028, month: 5, day: 0, precision: 'month' });
  assert.deepEqual(calendarPointOf('05/2028'), { year: 2028, month: 5, day: 0, precision: 'month' });
  assert.deepEqual(calendarPointOf('2028-05-01'), { year: 2028, month: 5, day: 1, precision: 'day' });
  assert.deepEqual(calendarPointOf('May 1, 2028'), { year: 2028, month: 5, day: 1, precision: 'day' });
  assert.deepEqual(calendarPointOf('May 15th, 2028'), { year: 2028, month: 5, day: 15, precision: 'day' });
  assert.deepEqual(calendarPointOf('Sept 2028'), { year: 2028, month: 9, day: 0, precision: 'month' });
  assert.equal(calendarPointOf('sometime soon'), null);
  assert.equal(calendarPointOf(''), null);
});

test('a term names a year and refuses to name a month', () => {
  // Spring ends in April at some schools, May at others and June at others again. Reading a month
  // out of it would be a guess wearing the clothes of a parse, and it would then be widened to a
  // day and put on an application.
  for (const term of ['Spring 2028', 'Fall 2028', 'Summer 2028', 'Winter 2028']) {
    assert.deepEqual(calendarPointOf(term), { year: 2028, month: 0, day: 0, precision: 'year' }, term);
  }
});

test('the widening convention is the first of the stated month, and only that', () => {
  assert.deepEqual(dateWriteForms(calendarPointOf('May 2028'), 'day'), ['2028-05-01', 'May 1, 2028']);
  assert.deepEqual(dateWriteForms(calendarPointOf('2028-05-15'), 'day'), ['2028-05-15', 'May 15, 2028']);
  // A month-precision control is never handed a day it did not ask for.
  assert.deepEqual(dateWriteForms(calendarPointOf('May 2028'), 'month'), ['2028-05', 'May 2028']);
});

test('the slash forms are never written, because they ask the board to guess', () => {
  // 05/01/2028 is the first of May to one board and the fifth of January to another, and a board
  // that guesses wrong writes a date in the wrong month that reads back as a clean success. ISO and
  // the spelled-out month cannot be read two ways.
  for (const precision of ['day', 'month']) {
    for (const form of dateWriteForms(calendarPointOf('May 2028'), precision)) {
      assert.doesNotMatch(form, /\d+\/\d+\/\d+/, form);
    }
  }
});

test('a read-back is compared as a date, and its display order is not relied on', () => {
  const asked = { year: 2028, month: 5, day: 1, precision: 'day' };
  // The two normalisations the corpus has met, from the same write.
  assert.equal(sameCalendarPoint(calendarPointOf('05/01/2028'), asked), true);
  assert.equal(sameCalendarPoint(calendarPointOf('01/05/2028'), asked), true);
  assert.equal(sameCalendarPoint(calendarPointOf('2028-05-01'), asked), true);
  assert.equal(sameCalendarPoint(calendarPointOf('May 1, 2028'), asked), true);
  // A different day, a different month and a different year are all refused.
  assert.equal(sameCalendarPoint(calendarPointOf('05/02/2028'), asked), false);
  assert.equal(sameCalendarPoint(calendarPointOf('06/01/2028'), asked), false);
  assert.equal(sameCalendarPoint(calendarPointOf('05/01/2029'), asked), false);
  // And a control that kept only the year has not kept the answer.
  assert.equal(sameCalendarPoint(calendarPointOf('2028'), asked), false);
});

test('a control that invented a month has not kept a bare year', () => {
  // The measured live behaviour: type 2028, press Tab, the picker writes 01/01/2028. If a bare year
  // ever reaches a picker, this is what stops the invention being reported as a success.
  const yearOnly = { year: 2028, month: 0, day: 0, precision: 'year' };
  assert.equal(sameCalendarPoint(calendarPointOf('01/01/2028'), yearOnly), false);
  assert.equal(sameCalendarPoint(calendarPointOf('2028'), yearOnly), true);
});

/* THE CONTROL, IDENTIFIED FROM A REAL DOM.
 *
 * dateControlPrecisionOf decides whether a write is going into a widget that will reinterpret it or
 * into a text box that will keep it verbatim, and it decides that from closest() and from the
 * placeholder. jsdom would answer these too, but the whole point is that it is run against the
 * markup the live board serves, so the react-datepicker case below is the Deepgram field copied out
 * of the page as it was measured on 2026-08-09.
 */
const ASHBY_DATEPICKER = '<div class="_fieldEntry_1e3gg_28 ashby-application-form-field-entry"'
  + ' data-field-path="407cc864-6d10-4427-bc5e-71598c5e593f">'
  + '<label class="_heading_f7cvd_52" for="407cc864-6d10-4427-bc5e-71598c5e593f">Expected Graduation Year</label>'
  + '<div class="react-datepicker-wrapper"><div class="react-datepicker__input-container">'
  + '<input type="text" placeholder="Pick date..." class="_input_gc9ve_28" required value=""></div></div></div>';

let browser;
let page;
test.before(async () => {
  browser = await chromium.launch();
  page = await browser.newPage();
});
test.after(async () => { await browser?.close(); });

const PRECISION = declarationOf('dateControlPrecisionOf')
  .replace('const dateControlPrecisionOf = async (field) => await field.evaluate(', 'const dateControlPrecisionOf = (')
  .replace(/\)\.catch\(\(\) => ''\);$/, ');');

async function precisionOf(html, selector) {
  await page.setContent('<!doctype html><html><body>' + html + '</body></html>');
  return page.evaluate(
    (args) => new Function('return ' + args.source)()(document.querySelector(args.selector)),
    { source: PRECISION.slice(PRECISION.indexOf('=') + 1).trim().replace(/;$/, ''), selector },
  );
}

test('the live Ashby graduation control reads as a day-precision picker', async () => {
  assert.equal(await precisionOf(ASHBY_DATEPICKER, '.react-datepicker__input-container input'), 'day');
});

test('the native date types are read at their own precision', async () => {
  assert.equal(await precisionOf('<input id="a" type="date">', '#a'), 'day');
  assert.equal(await precisionOf('<input id="a" type="month">', '#a'), 'month');
});

test('a text box that merely mentions a date is left alone', async () => {
  // A free-text field must keep taking what it is given verbatim. Only a widget SAYING it is a
  // picker - "Pick date...", or the wrapper class, or the native type - changes how it is written
  // to, because only a widget will reinterpret what it is handed.
  assert.equal(await precisionOf('<input id="a" placeholder="Start date (optional)">', '#a'), '');
  assert.equal(await precisionOf('<input id="a" placeholder="Date of the most recent role">', '#a'), '');
  assert.equal(await precisionOf('<input id="a" placeholder="Pick date...">', '#a'), 'day');
  assert.equal(await precisionOf('<input id="a" placeholder="Select a date">', '#a'), 'day');
});
