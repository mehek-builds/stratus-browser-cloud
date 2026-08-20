/* CHOOSING A BAND FOR A GRADED VALUE, run against the shipped runner's own source.
 *
 * `no option matched "3.89", left for you to choose` was the stored blocker on two packets while
 * the answer sat in the profile the whole time: the employer offered bands and the packet held a
 * value. This suite pins the widening that closes that, and - far more importantly - it pins the
 * cases where the widening must REFUSE.
 *
 * THE ASYMMETRY IS THE WHOLE POINT, and it is the same one option-click-dom states: a choice the
 * runner cannot make costs a person a minute. A choice it makes WRONGLY is a false statement on a
 * real job application under her name, which verifyFilled will then agree with, because the row
 * really was selected. So the no-click cases below are the load-bearing half.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadChooser } from './chooser-source.mjs';

const { chooseOptionIndex, gradedBandIndex, parseBand, gradedValueWithScale } = loadChooser();

const GPA_BANDS = ['3.50 - 4.00', '3.00 - 3.49', '2.50 - 2.99', '2.00 - 2.49'];

test('a GPA lands in the one band that contains it', () => {
  assert.equal(chooseOptionIndex(GPA_BANDS, '3.89/4.0'), 0);
  assert.equal(chooseOptionIndex(GPA_BANDS, '3.10/4.0'), 1);
  assert.equal(chooseOptionIndex(GPA_BANDS, '2.00/4.0'), 3);
  // The boundary belongs to the band that names it.
  assert.equal(chooseOptionIndex(GPA_BANDS, '3.50/4.0'), 0);
});

/* THE DEFECT THIS TIER WOULD HAVE INTRODUCED IF IT ONLY CHECKED CONTAINMENT. 3.89 is inside
   "0 - 25" on a percentage list, so a containment-only matcher states a first-quartile GPA to an
   employer. The list's ceiling is 100 and the answer's denominator is 4, so it declines. */
test('a percentage list is refused, however well the number fits a band', () => {
  const percent = ['0 - 25', '26 - 50', '51 - 75', '76 - 100'];
  assert.equal(chooseOptionIndex(percent, '3.89/4.0'), -1);
  assert.equal(gradedBandIndex(percent, '3.89/4.0'), -1);
});

/* WITHOUT A DENOMINATOR THERE IS NOTHING TO CHECK THE LIST AGAINST, so a bare number never fires
   this tier - it is exactly the input that cannot distinguish the two lists above. */
test('a bare number never reaches the band tier', () => {
  assert.equal(gradedBandIndex(GPA_BANDS, '3.89'), -1);
  assert.equal(chooseOptionIndex(GPA_BANDS, '3.89'), -1);
});

/* A list offering BOTH the value and bands must answer with the value. The exact tiers cannot do
   this on their own: they are handed "3.89/4.0" and answerOptions does not strip the denominator,
   so the literal row reaches gradedBandIndex unmatched and the guard there is what protects it. */
test('a row that IS the value beats a band that merely contains it', () => {
  assert.equal(gradedBandIndex(['3.50 - 4.00', '3.89', '3.00 - 3.49'], '3.89/4.0'), -1,
    'the band tier stands down so the value row is not overruled');
  assert.equal(gradedBandIndex(['3.50 - 4.00', '3.90', '3.00 - 3.49'], '3.89/4.0'), 0,
    'a DIFFERENT value on the list is not this answer, so the band still applies');
});

test('overlapping or repeated bands refuse rather than pick the first', () => {
  assert.equal(gradedBandIndex(['3.00 - 4.00', '3.50 - 4.00'], '3.89/4.0'), -1);
  assert.equal(gradedBandIndex(['3.50 - 4.00', '3.50 - 4.00'], '3.89/4.0'), -1);
});

test('a value outside every band refuses', () => {
  assert.equal(gradedBandIndex(GPA_BANDS, '1.20/4.0'), -1);
});

test('a single band is not a list of bands', () => {
  assert.equal(gradedBandIndex(['3.50 - 4.00'], '3.89/4.0'), -1);
});

/* Sponsorship and work authorisation are the family this file's neighbours exist to protect. They
   never parse as a graded value, so they cannot reach this tier at all - the numeric gate is the
   bound, not a rule someone has to remember. */
test('a declaration list cannot reach the band tier', () => {
  const visa = ['I am authorized to work', 'I am authorized to work only with a student visa'];
  assert.equal(gradedBandIndex(visa, 'I am authorized to work'), -1);
  assert.equal(gradedValueWithScale('I am authorized to work'), null);
  assert.equal(gradedValueWithScale('Yes'), null);
});

test('open-topped and open-bottomed bands are read on the answer scale', () => {
  assert.equal(chooseOptionIndex(['Below 3.0', '3.0 - 3.49', '3.5+'], '3.89/4.0'), 2);
  assert.equal(chooseOptionIndex(['Below 3.0', '3.0 - 3.49', '3.5+'], '2.10/4.0'), 0);
  // "Below 3.0" is exclusive, so exactly 3.0 is not it.
  assert.equal(chooseOptionIndex(['Below 3.0', '3.0 - 3.49', '3.5+'], '3.00/4.0'), 1);
});

test('a list mixing bands with prose is left alone rather than half-read', () => {
  // One band is not a list of bands: with nothing to compare it against, a single "3.50 - 4.00"
  // beside prose could just as easily be a lone row on a scale this answer does not share.
  assert.equal(gradedBandIndex(['3.50 - 4.00', 'Prefer not to say'], '3.89/4.0'), -1);
  assert.equal(gradedBandIndex(['Ask me', 'Prefer not to say'], '3.89/4.0'), -1);
  // Real bands with prose alongside them are still a list of bands.
  assert.equal(gradedBandIndex(['3.50 - 4.00', '3.00 - 3.49', 'Prefer not to say'], '3.89/4.0'), 0);
});

test('the parser reads the separators employers actually use', () => {
  assert.deepEqual(parseBand('3.5 - 4.0'), { lo: 3.5, hi: 4 });
  assert.deepEqual(parseBand('3.5 – 4.0'), { lo: 3.5, hi: 4 });
  assert.deepEqual(parseBand('3.5 to 4.0'), { lo: 3.5, hi: 4 });
  assert.equal(parseBand('Bachelor of Science'), null);
  assert.equal(parseBand(''), null);
});

test('a denominator the value exceeds is not a graded value', () => {
  assert.equal(gradedValueWithScale('5.0/4.0'), null);
  assert.deepEqual(gradedValueWithScale('3.89 out of 4.0'), { value: 3.89, scale: 4 });
});
