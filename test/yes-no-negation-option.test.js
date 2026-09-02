/* A YES OR NO AGAINST TWO STATEMENTS, run against the shipped runner's own chooser.
 *
 * Measured on the live alertalarm.breezy.hr EEOC section, 2026-09-01: the stored answer "No"
 * against "I identify as one or more of the classifications of protected veteran listed above" /
 * "I am not a protected veteran" / "I don't wish to answer" matched nothing, and the run reported
 * no option matched while the answer sat in the packet. This suite pins the tier that closes that
 * and, as with every widening in this chooser, the cases where it must REFUSE are the load-bearing
 * half: a wrong tick here is a false declaration under her name.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadChooser } from './chooser-source.mjs';

const { chooseOptionIndex, yesNoNegationIndex } = loadChooser();

const VETERAN = [
  'I IDENTIFY AS ONE OR MORE OF THE CLASSIFICATIONS OF PROTECTED VETERAN LISTED ABOVE',
  'I AM NOT A PROTECTED VETERAN',
  "I DON'T WISH TO ANSWER",
];
const DISABILITY = [
  'Yes, I have a disability, or have had one in the past',
  "No, I don't have a disability",
  "I don't wish to answer",
];

test('"no" takes the one negated statement and "yes" the other, with the refusal set aside', () => {
  assert.equal(chooseOptionIndex(VETERAN, 'No'), 1);
  assert.equal(chooseOptionIndex(VETERAN, 'Yes'), 0);
  assert.equal(chooseOptionIndex(DISABILITY, 'No'), 1);
  assert.equal(chooseOptionIndex(DISABILITY, 'Yes'), 0);
  // Every negation spelling the tier accepts, at the start of the row.
  const OPT_OUT = 'Prefer not to say';
  assert.equal(yesNoNegationIndex(['I require sponsorship', 'I do not require sponsorship', OPT_OUT], 'no'), 1);
  assert.equal(yesNoNegationIndex(['I require sponsorship', "I don't require sponsorship", OPT_OUT], 'no'), 1);
  assert.equal(yesNoNegationIndex([OPT_OUT, 'I am currently in process', 'I am NOT currently in process'], 'yes'), 1);
});

/* THE CASE soleOptionIndex PINS, AND THIS TIER MUST NOT UNPIN IT. Optiver's acknowledgement pair
   is two statements with one negation and no opt-out, and the "Yes" stored against it is a
   consent-class affirmative rather than an answer to "are you in process". Without an opt-out row
   the list is not a self-identification question and the pair stays hers to choose. */
test('a two-statement pair with no opt-out row still refuses, however the answer reads', () => {
  const optiver = [
    'I am NOT currently in process for another Optiver role',
    'I am currently in process for another Optiver role',
  ];
  assert.equal(yesNoNegationIndex(optiver, 'yes'), -1);
  assert.equal(yesNoNegationIndex(optiver, 'no'), -1);
  assert.equal(chooseOptionIndex(optiver, 'Yes'), -1);
  assert.equal(chooseOptionIndex(optiver, 'No'), -1);
  assert.equal(yesNoNegationIndex(['I am authorized to work', 'I am not authorized to work'], 'yes'), -1);
});

test('a stored refusal still lands on the refusal row, not on a statement', () => {
  assert.equal(chooseOptionIndex(VETERAN, 'I decline to self-identify'), 2);
  assert.equal(chooseOptionIndex(DISABILITY, 'Prefer not to say'), 2);
});

test('only a bare yes or no reaches the tier', () => {
  assert.equal(yesNoNegationIndex(VETERAN, 'Not a veteran'), -1);
  assert.equal(yesNoNegationIndex(VETERAN, 'No, I am not'), -1);
  assert.equal(yesNoNegationIndex(VETERAN, 'true'), -1);
  assert.equal(yesNoNegationIndex(VETERAN, ''), -1);
  assert.equal(chooseOptionIndex(VETERAN, 'Not a veteran'), -1);
});

test('two negated rows refuse rather than guess', () => {
  const twoNegations = ['I am not a protected veteran', 'No, I am a protected veteran', "I don't wish to answer"];
  assert.equal(yesNoNegationIndex(twoNegations, 'no'), -1);
  assert.equal(chooseOptionIndex(twoNegations, 'No'), -1);
  assert.equal(chooseOptionIndex(twoNegations, 'Yes'), -1);
});

test('three statements, one statement, or no negation at all refuse', () => {
  const OPT_OUT = 'Prefer not to say';
  assert.equal(yesNoNegationIndex(['I am a citizen', 'I am not a citizen', 'I am a permanent resident', OPT_OUT], 'no'), -1);
  assert.equal(yesNoNegationIndex(['I am not a citizen', OPT_OUT], 'no'), -1);
  assert.equal(yesNoNegationIndex(['Male', 'Female', OPT_OUT], 'no'), -1);
  assert.equal(chooseOptionIndex(['Male', 'Female', "I don't wish to answer"], 'No'), -1);
});

test('a negation that does not open the row is not a negated row', () => {
  // "Yes, I have not yet graduated" contains "not" and is the affirmative row.
  assert.equal(yesNoNegationIndex(['Yes, I have not yet graduated', 'I graduated', 'Prefer not to say'], 'no'), -1);
  // "Non-binary" and "None" are not "No".
  assert.equal(yesNoNegationIndex(['Non-binary', 'Woman', 'Prefer not to say'], 'no'), -1);
  assert.equal(yesNoNegationIndex(['None', 'Some', 'Prefer not to say'], 'no'), -1);
});

test('a row it cannot read refuses the whole list', () => {
  assert.equal(yesNoNegationIndex(['', 'I am not a protected veteran', "I don't wish to answer"], 'yes'), -1);
  assert.equal(yesNoNegationIndex(['I am a veteran', 'I am not a veteran', "I don't wish to answer", ''], 'no'), -1);
});

test('the exact tiers still win: a list that literally offers "No" is answered by it', () => {
  assert.equal(chooseOptionIndex(['Yes', 'No', 'I am not sure'], 'No'), 1);
  assert.equal(chooseOptionIndex(['I am not sure', 'No'], 'No'), 1);
});
