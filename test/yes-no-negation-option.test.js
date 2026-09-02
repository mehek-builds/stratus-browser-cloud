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

/* The tier is tied to the QUESTION, so every case here names one. The row polarity and the
 * question polarity are two different facts, and the pair of them is what decides the answer. */
const VETERAN_QUESTION = 'Voluntary Self-Identification of Veteran Status';
const DISABILITY_QUESTION = 'Voluntary Self-Identification of Disability';
const SPONSORSHIP_QUESTION = 'Will you now or in the future require sponsorship for an employment visa?';
const AUTHORISATION_QUESTION = 'Are you legally authorized to work in the United States?';
const IN_PROCESS_QUESTION = 'Are you currently in process for another Optiver role?';

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
  assert.equal(chooseOptionIndex(VETERAN, 'No', VETERAN_QUESTION), 1);
  assert.equal(chooseOptionIndex(VETERAN, 'Yes', VETERAN_QUESTION), 0);
  assert.equal(chooseOptionIndex(DISABILITY, 'No', DISABILITY_QUESTION), 1);
  assert.equal(chooseOptionIndex(DISABILITY, 'Yes', DISABILITY_QUESTION), 0);
  // Every negation spelling the tier accepts, at the start of the row.
  const OPT_OUT = 'Prefer not to say';
  assert.equal(yesNoNegationIndex(['I require sponsorship', 'I do not require sponsorship', OPT_OUT], 'no', SPONSORSHIP_QUESTION), 1);
  assert.equal(yesNoNegationIndex(['I require sponsorship', "I don't require sponsorship", OPT_OUT], 'no', SPONSORSHIP_QUESTION), 1);
  assert.equal(yesNoNegationIndex([OPT_OUT, 'I am currently in process', 'I am NOT currently in process'], 'yes', IN_PROCESS_QUESTION), 1);
});

/* THE ROW'S POLARITY IS NOT THE QUESTION'S POLARITY, and this is the whole of the round-two
 * correction. Each pair below is a perfectly formed yes/no pair - two statements, one negation,
 * an opt-out - sitting under a question about something else, and in each the stored answer maps
 * onto the row that states the OPPOSITE of what she said. Under the question the rows do answer,
 * the same rows map. */
test('a pair that answers a different question than the one asked is refused', () => {
  const OPT_OUT = "I don't wish to answer";
  const SPONSORSHIP_ROWS = [
    'I require sponsorship to work in the United States',
    'I do not require sponsorship to work in the United States',
    OPT_OUT,
  ];
  // "No" to "are you authorized" means NOT authorised; the negated row says no sponsorship is
  // needed, which is the opposite declaration. The two share "work in the united states" and
  // nothing else, and neither "authorized" nor "sponsorship" crosses over.
  assert.equal(yesNoNegationIndex(SPONSORSHIP_ROWS, 'no', AUTHORISATION_QUESTION), -1);
  assert.equal(yesNoNegationIndex(SPONSORSHIP_ROWS, 'yes', AUTHORISATION_QUESTION), -1);
  assert.equal(chooseOptionIndex(SPONSORSHIP_ROWS, 'No', AUTHORISATION_QUESTION), -1);
  assert.equal(yesNoNegationIndex(SPONSORSHIP_ROWS, 'no', SPONSORSHIP_QUESTION), 1);

  const AUTHORISATION_ROWS = [
    'I am authorized to work in the United States',
    'I am not authorized to work in the United States',
    OPT_OUT,
  ];
  // And the same swap the other way round: "No" to "do you require sponsorship" means she needs
  // none, and the negated row here would declare her unauthorised to work at all.
  assert.equal(yesNoNegationIndex(AUTHORISATION_ROWS, 'no', SPONSORSHIP_QUESTION), -1);
  assert.equal(yesNoNegationIndex(AUTHORISATION_ROWS, 'yes', SPONSORSHIP_QUESTION), -1);
  assert.equal(yesNoNegationIndex(AUTHORISATION_ROWS, 'no', AUTHORISATION_QUESTION), 1);

  // The veteran rows under the disability heading, and the disability rows under the veteran one:
  // both are two-statement pairs with one negation, and neither states the other's predicate.
  assert.equal(yesNoNegationIndex(VETERAN, 'no', DISABILITY_QUESTION), -1);
  assert.equal(yesNoNegationIndex(DISABILITY, 'no', VETERAN_QUESTION), -1);
});

test('no question label means no tier, however well formed the pair is', () => {
  assert.equal(yesNoNegationIndex(VETERAN, 'no'), -1);
  assert.equal(yesNoNegationIndex(VETERAN, 'no', ''), -1);
  // A question made entirely of words the noise list strikes names no predicate at all.
  assert.equal(yesNoNegationIndex(VETERAN, 'no', 'Please answer the following question'), -1);
  assert.equal(chooseOptionIndex(VETERAN, 'No'), -1);
});

/* A LIST THAT SPELLS ITS POLARITY OUT ON ONE ROW AND NOT THE OTHER. The employer has shown, on
 * the row it wrote "No," on, that it says so when it means it; reading the other row's polarity
 * by inference on the same list is a guess the list itself contradicts. */
test('a literal "No," row against a bare affirmative statement refuses', () => {
  const MIXED = [
    'I identify as a person with a disability',
    "No, I don't have a disability",
    "I don't wish to answer",
  ];
  assert.equal(yesNoNegationIndex(MIXED, 'no', DISABILITY_QUESTION), -1);
  assert.equal(yesNoNegationIndex(MIXED, 'yes', DISABILITY_QUESTION), -1);
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
  assert.equal(yesNoNegationIndex(optiver, 'yes', IN_PROCESS_QUESTION), -1);
  assert.equal(yesNoNegationIndex(optiver, 'no', IN_PROCESS_QUESTION), -1);
  assert.equal(chooseOptionIndex(optiver, 'Yes', IN_PROCESS_QUESTION), -1);
  assert.equal(chooseOptionIndex(optiver, 'No', IN_PROCESS_QUESTION), -1);
  assert.equal(yesNoNegationIndex(['I am authorized to work', 'I am not authorized to work'], 'yes', AUTHORISATION_QUESTION), -1);
});

test('a stored refusal still lands on the refusal row, not on a statement', () => {
  assert.equal(chooseOptionIndex(VETERAN, 'I decline to self-identify', VETERAN_QUESTION), 2);
  assert.equal(chooseOptionIndex(DISABILITY, 'Prefer not to say', DISABILITY_QUESTION), 2);
});

test('only a bare yes or no reaches the tier', () => {
  assert.equal(yesNoNegationIndex(VETERAN, 'Not a veteran', VETERAN_QUESTION), -1);
  assert.equal(yesNoNegationIndex(VETERAN, 'No, I am not', VETERAN_QUESTION), -1);
  assert.equal(yesNoNegationIndex(VETERAN, 'true', VETERAN_QUESTION), -1);
  assert.equal(yesNoNegationIndex(VETERAN, '', VETERAN_QUESTION), -1);
  assert.equal(chooseOptionIndex(VETERAN, 'Not a veteran', VETERAN_QUESTION), -1);
});

test('two negated rows refuse rather than guess', () => {
  const twoNegations = ['I am not a protected veteran', 'No, I am a protected veteran', "I don't wish to answer"];
  assert.equal(yesNoNegationIndex(twoNegations, 'no', VETERAN_QUESTION), -1);
  assert.equal(chooseOptionIndex(twoNegations, 'No', VETERAN_QUESTION), -1);
  assert.equal(chooseOptionIndex(twoNegations, 'Yes', VETERAN_QUESTION), -1);
});

test('three statements, one statement, or no negation at all refuse', () => {
  const OPT_OUT = 'Prefer not to say';
  const CITIZEN_QUESTION = 'Are you a citizen of the United States?';
  assert.equal(yesNoNegationIndex(['I am a citizen', 'I am not a citizen', 'I am a permanent resident', OPT_OUT], 'no', CITIZEN_QUESTION), -1);
  assert.equal(yesNoNegationIndex(['I am not a citizen', OPT_OUT], 'no', CITIZEN_QUESTION), -1);
  assert.equal(yesNoNegationIndex(['Male', 'Female', OPT_OUT], 'no', 'Gender'), -1);
  assert.equal(chooseOptionIndex(['Male', 'Female', "I don't wish to answer"], 'No', 'Gender'), -1);
  // Two real rows and no more, with the pair intact under the question it answers.
  assert.equal(yesNoNegationIndex(['I am a citizen', 'I am not a citizen', OPT_OUT], 'no', CITIZEN_QUESTION), 1);
});

test('a negation that does not open the row is not a negated row', () => {
  // "Yes, I have not yet graduated" contains "not" and is the affirmative row.
  assert.equal(yesNoNegationIndex(['Yes, I have not yet graduated', 'I graduated', 'Prefer not to say'], 'no', 'Have you graduated?'), -1);
  // "Non-binary" and "None" are not "No".
  assert.equal(yesNoNegationIndex(['Non-binary', 'Woman', 'Prefer not to say'], 'no', 'Gender identity'), -1);
  assert.equal(yesNoNegationIndex(['None', 'Some', 'Prefer not to say'], 'no', 'Management experience'), -1);
});

test('a row it cannot read refuses the whole list', () => {
  assert.equal(yesNoNegationIndex(['', 'I am not a protected veteran', "I don't wish to answer"], 'yes', VETERAN_QUESTION), -1);
  assert.equal(yesNoNegationIndex(['I am a veteran', 'I am not a veteran', "I don't wish to answer", ''], 'no', VETERAN_QUESTION), -1);
});

test('the exact tiers still win: a list that literally offers "No" is answered by it', () => {
  assert.equal(chooseOptionIndex(['Yes', 'No', 'I am not sure'], 'No', VETERAN_QUESTION), 1);
  assert.equal(chooseOptionIndex(['I am not sure', 'No'], 'No', VETERAN_QUESTION), 1);
  /* And the tier says so itself rather than relying on that ordering: handed a list carrying a
   * literal or normalised-exact row for the answer, it refuses outright. */
  assert.equal(yesNoNegationIndex(['No', 'I am not a protected veteran', "I don't wish to answer"], 'no', VETERAN_QUESTION), -1);
  assert.equal(yesNoNegationIndex(['I am a protected veteran', 'I am not a protected veteran', 'No.', "I don't wish to answer"], 'no', VETERAN_QUESTION), -1);
});
