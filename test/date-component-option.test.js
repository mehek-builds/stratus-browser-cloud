/* SPLITTING A DATE ANSWER FOR A CONTROL THAT WANTS ONE PART, against the shipped runner's source.
 *
 * "no option matched May 2028, left for you to choose" is the single most common stored blocker on
 * this account - seven of them - against Graduation Year lists offering 2026/2027/2028 and month
 * lists offering January..December. The answer holds both parts; the control wants one.
 *
 * The refusal cases are the load-bearing half, and the season cases are the sharpest of them:
 * mapping May onto "Spring 2028" is a claim about the employer's calendar, and the hemispheres
 * disagree about it.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

function constSource(name, indent, required = true) {
  const pad = ' '.repeat(indent);
  const start = SANDBOX_RUNNER.indexOf(`\n${pad}const ${name} = `);
  if (start === -1) {
    if (required) assert.fail(`${name} must exist in the sandbox runner`);
    return '';
  }
  const rest = SANDBOX_RUNNER.slice(start + 1);
  const next = rest.search(new RegExp(`\\n${pad}(?:const|let|var|for|if|return|await|fs\\.)`));
  return rest.slice(0, next === -1 ? rest.length : next);
}

const SRC = ['clean', 'normalized', 'DECLINE_TO_STATE', 'answerOptions', 'declineMatches',
  'gradedValueWithScale', 'parseBand', 'gradedBandIndex',
  'MONTH_NAMES', 'monthIndexOf', 'datePartsOf', 'dateComponentIndex', 'chooseOptionIndex']
  .map((name) => constSource(name, 4))
  .join('\n');
const { chooseOptionIndex, dateComponentIndex, datePartsOf } =
  Function(`${SRC}\nreturn { chooseOptionIndex, dateComponentIndex, datePartsOf };`)();

const YEARS = ['2026', '2027', '2028', '2029'];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

test('a graduation date answers a year list with its year', () => {
  assert.equal(chooseOptionIndex(YEARS, 'May 2028'), 2);
  assert.equal(chooseOptionIndex(YEARS, 'December 2026'), 0);
});

test('and answers a month list with its month', () => {
  assert.equal(chooseOptionIndex(MONTHS, 'May 2028'), 4);
  assert.equal(chooseOptionIndex(MONTHS, 'Sept 2027'), 8, 'an abbreviation is the same month');
});

test('a row carrying the whole date is still preferred over a part', () => {
  assert.equal(chooseOptionIndex(['2028', 'May 2028'], 'May 2028'), 1,
    'the exact tier owns this before the split tier is reached');
});

/* THE REFUSAL THAT MATTERS MOST. May is not Spring: the mapping is the employer's, and the
   hemispheres disagree about it. */
test('a season or quarter list is refused', () => {
  assert.equal(dateComponentIndex(['Spring 2028', 'Summer 2028', 'Fall 2028'], 'May 2028'), -1);
  assert.equal(dateComponentIndex(['Q1 2028', 'Q2 2028'], 'May 2028'), -1);
  assert.equal(dateComponentIndex(['Fall Semester 2028', 'Spring Semester 2028'], 'May 2028'), -1);
});

test('an answer that is already seasonal is left to the exact tiers', () => {
  assert.equal(dateComponentIndex(YEARS, 'Spring 2028'), -1);
});

test('a year the list does not offer refuses', () => {
  assert.equal(dateComponentIndex(YEARS, 'May 2031'), -1);
});

test('an answer with only one part is not split', () => {
  assert.equal(dateComponentIndex(YEARS, '2028'), -1, 'a bare year is already exact-matchable');
  assert.equal(dateComponentIndex(MONTHS, 'May'), -1);
});

test('two rows matching the same part refuse rather than pick', () => {
  assert.equal(dateComponentIndex(['2028', '2028 '], 'May 2028'), -1);
});

test('a non-date list cannot reach this tier', () => {
  const visa = ['I am authorized to work', 'I am authorized to work only with a student visa'];
  assert.equal(dateComponentIndex(visa, 'I am authorized to work'), -1);
  assert.equal(datePartsOf('I am authorized to work'), null);
  assert.equal(datePartsOf('Yes'), null);
});

test('the parser reads the parts and flags the seasonal vocabulary', () => {
  assert.deepEqual(datePartsOf('May 2028'), { year: 2028, month: 4, seasonal: false, hasBoth: true });
  assert.deepEqual(datePartsOf('2028'), { year: 2028, month: -1, seasonal: false, hasBoth: false });
  assert.equal(datePartsOf('Summer 2028').seasonal, true);
  assert.equal(datePartsOf(''), null);
});
