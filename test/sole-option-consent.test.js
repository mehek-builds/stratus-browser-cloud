/* A LIST OF ONE HAS NOTHING TO CHOOSE BETWEEN, run against the shipped runner's own source.
 *
 * Employers write acknowledgement rows as STATEMENTS. Read off a live Optiver Greenhouse form on
 * 2026-08-19: "I consent to the above.", "Yes, I have read and agree to Optiver's privacy policies,
 * notices and disclaimers." A stored "Yes" matches neither, so both were refused and reported as
 * "required and is still empty" while the answer sat in the packet.
 *
 * The refusals are the load-bearing half, and the sharpest is TWO options: the moment a list offers
 * a second row, choosing becomes a claim about which statement is true of her.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { loadChooser } from './chooser-source.mjs';

const { chooseOptionIndex, soleOptionIndex } = loadChooser();

test('an affirmative answers a single statement row', () => {
  assert.equal(chooseOptionIndex(['I consent to the above.'], 'Yes'), 0);
  assert.equal(chooseOptionIndex(["Yes, I have read and agree to Optiver's privacy policies, notices and disclaimers."], 'Yes'), 0);
  assert.equal(chooseOptionIndex(['I acknowledge and agree to the terms described above.'], 'I agree'), 0);
});

/* THE REFUSAL THAT MATTERS MOST. Two rows means choosing is a claim about which statement is true
   of her, and the first-preference control on the same form is exactly that shape. */
test('two options refuse, however affirmative the answer', () => {
  const preference = [
    'I am NOT currently in process for another Optiver role',
    'I am currently in process for another Optiver role',
  ];
  assert.equal(soleOptionIndex(preference, 'Yes'), -1);
  assert.equal(chooseOptionIndex(preference, 'Yes'), -1);
});

test('a non-affirmative answer never selects the sole row', () => {
  assert.equal(soleOptionIndex(['I consent to the above.'], 'No'), -1);
  assert.equal(soleOptionIndex(['I consent to the above.'], 'Decline to self-identify'), -1);
  assert.equal(soleOptionIndex(['I consent to the above.'], ''), -1);
  assert.equal(soleOptionIndex(['I consent to the above.'], 'Chicago'), -1);
});

test('a placeholder row is not an option', () => {
  assert.equal(soleOptionIndex([''], 'Yes'), -1);
  assert.equal(soleOptionIndex(['   '], 'Yes'), -1);
});

test('an exact match still wins and does not need this tier', () => {
  assert.equal(chooseOptionIndex(['Yes'], 'Yes'), 0);
  assert.equal(chooseOptionIndex(['No', 'Yes'], 'Yes'), 1, 'two options, answered exactly');
});

/* A value that merely BEGINS with those letters is not an affirmative. The test is anchored and
   word-bounded, so neither of these can tick an acknowledgement on somebody's application. Both
   were checked rather than assumed: the first draft of this suite guessed "Agreeable" would pass
   and it does not, which is the safer answer and is now pinned so it stays that way. */
test('a word that merely begins like an affirmative does not count', () => {
  assert.equal(soleOptionIndex(['I consent to the above.'], 'Yesterday'), -1);
  assert.equal(soleOptionIndex(['I consent to the above.'], 'Agreeable terms only'), -1);
  assert.equal(soleOptionIndex(['I consent to the above.'], 'Yellow'), -1);
});

/* GENERAL BY SHAPE, NOT BY EMPLOYER. Nothing in this tier names Optiver or Greenhouse: it reads the
   number of rows and whether the stored answer is affirmative, so any board that writes an
   acknowledgement as a single statement is answered the same way. */
test('the same rule answers other boards written the same way', () => {
  assert.equal(chooseOptionIndex(['I have read and accept the candidate privacy notice.'], 'I consent'), 0);
  assert.equal(chooseOptionIndex(['I agree to the processing of my personal data.'], 'Accept'), 0);
  assert.equal(chooseOptionIndex(['Ich stimme zu.'], 'Yes'), 0, 'wording is not parsed, only counted');
});
