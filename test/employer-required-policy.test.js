/* THE FOUR HAND-WRITTEN COPIES, AND THE ONE WORD THAT WAS NEVER THE SAME.
 *
 * SUBMIT_READINESS_POLICY closed the drift between this repo's readiness gate and the backend's.
 * It said out loud that it did not cover the confirmAndSubmit pass, which carried its own copies of
 * some of the same patterns. There were four such copies, in three evaluate blocks and one
 * discovery helper, and the risk they carried was not cross-repo. It was that ONE RUN, over ONE
 * form, could answer "which fields did this employer mark required" two different ways: once in the
 * pass that decides which controls to commit, and once in the gate that decides whether to click.
 * Both then push onto the same `unresolved` list, and a non-empty `unresolved` withholds the send.
 *
 * WHAT THIS FILE HOLDS IN PLACE, in two halves that pull in opposite directions.
 *
 * The first half is convergence. Four fragments were the same bytes in both and are now one
 * declaration, so the assertions below are on the SOURCE FILE and count literals: exactly one
 * spelling of each in the whole file. An assertion on behaviour would pass just as happily with two
 * spellings that currently agree, which is the state this change exists to end.
 *
 * The second half is the divergence that survives on purpose. The confirm pass reads one alternative
 * the gate does not, `\brequires an answer\b`, and it is attested nowhere: no employer, no dated
 * measurement, no ATS family. Its only other appearances are the sentence the runner writes into
 * its own attempts record and the fixtures written to prove it. Unattested is not disproved, and
 * both repairs move a live form: adding it to the gate widens the thing that lost seven packets,
 * removing it from the pass loosens a check nobody has measured. So it stays, named, and this file
 * pins the difference at exactly one alternative so that a fifth copy cannot appear quietly.
 *
 * WHY THE OLD LITERALS ARE TYPED OUT BELOW rather than read from anywhere. They are what the four
 * copies said on 2026-08-13, before this change. A test that derived them from the policy would be
 * asking the new code whether it agrees with itself.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  EMPLOYER_REQUIRED_DELTA,
  EMPLOYER_REQUIRED_POLICY,
  SANDBOX_RUNNER,
  SUBMIT_READINESS_POLICY
} from '../src/managed-browser.js';

const SOURCE = readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');

/** What the confirmAndSubmit pass's error vocabulary said before this change, character for
 *  character. Both of its copies were identical to each other and differed from the readiness
 *  gate's by one alternative, spliced in at position two. */
const ERROR_TEXT_BEFORE = String.raw`\bis required\b|\brequires an answer\b|\brequired field\b|\bplease (?:select|enter|complete|choose|provide)\b|\bcannot be blank\b`;

/** And what requiredOutside's control selector said, the one copy that excluded hidden inputs. */
const SCOPE_SELECTOR_BEFORE = String.raw`input:not([type="hidden"])[required], textarea[required], select[required], [aria-required="true"]`;

function occurrences(haystack, needle) {
  let count = 0;
  let index = 0;
  while ((index = haystack.indexOf(needle, index)) !== -1) {
    count += 1;
    index += needle.length;
  }
  return count;
}

test('every fragment the two passes share is spelled exactly once in the file', () => {
  /* The whole point of the change, asserted the only way that is worth asserting: not "the copies
   * agree today" but "there are no copies". Each of these was written out by hand in two, three or
   * four places before, which is how the file came to hold two answers to one question. */
  for (const fragment of ['requiredAttributes', 'requiredClassMarkers', 'asteriskMark', 'asteriskLegend']) {
    assert.equal(
      occurrences(SOURCE, SUBMIT_READINESS_POLICY[fragment]),
      1,
      `${fragment} is written more than once in src/managed-browser.js`
    );
    assert.equal(
      EMPLOYER_REQUIRED_POLICY[fragment],
      SUBMIT_READINESS_POLICY[fragment],
      `${fragment} must be the readiness policy's own value, not a copy of it`
    );
  }
  // The readiness gate's error vocabulary is one declaration too, and the confirm pass builds on it
  // rather than restating it.
  assert.equal(occurrences(SOURCE, SUBMIT_READINESS_POLICY.errorText), 1);
});

test('the confirm pass reads the same required-field markers the gate reads', () => {
  /* Four sites in the emitted runner, and every one of them now the policy's bytes: the scope veto
   * in `choices`, the control enumeration in `candidates`, and the discovery helper's marksRequired.
   * Counted in the SHIPPED script, because that is what runs against an employer's form. */
  assert.equal(occurrences(SANDBOX_RUNNER, EMPLOYER_REQUIRED_POLICY.requiredClassMarkers), 4);
  assert.ok(SANDBOX_RUNNER.includes(`const REQUIRED_CONTROLS = '${EMPLOYER_REQUIRED_POLICY.scopeRequiredAttributes}'`));
  assert.ok(SANDBOX_RUNNER.includes(`const controls = new Set(root.querySelectorAll(\n          '${EMPLOYER_REQUIRED_POLICY.requiredAttributes}'`));
});

test('the scope veto keeps its hidden-input exclusion, and nothing else', () => {
  /* requiredOutside tests visibility on the WIDGET alone, so a hidden required input inside a
   * visible field wrapper would veto the container and disable every formless application on the
   * page. The gate's loop tests the element OR its widget and asks a different question. This is a
   * real difference, and it is derived by substitution so that it cannot become a no-op in silence.
   */
  assert.equal(EMPLOYER_REQUIRED_POLICY.scopeRequiredAttributes, SCOPE_SELECTOR_BEFORE);
  assert.equal(
    EMPLOYER_REQUIRED_POLICY.scopeRequiredAttributes.replace('input:not([type="hidden"])[required]', 'input[required]'),
    SUBMIT_READINESS_POLICY.requiredAttributes,
    'the scope selector must differ from the shared one by the hidden exclusion and nothing else'
  );
});

test('the confirm error vocabulary matches exactly what it matched before', () => {
  /* Appended rather than spliced back into position two, so the emitted bytes moved. Both copies
   * are read only by `.test()` in a boolean, with no capture and no exec, so an alternation is a
   * set. Proven as a set, and then proven again over the sentences that actually appear: the
   * measured ones from the gate's own history, the fixtures', and the near-misses that must keep
   * missing. */
  const before = new Set(ERROR_TEXT_BEFORE.split('|'));
  const after = new Set(EMPLOYER_REQUIRED_POLICY.errorText.split('|'));
  assert.deepEqual([...after].sort(), [...before].sort());

  const corpus = [
    'This field is required.',
    'Phone is required.',
    'Required field',
    'Please select an option',
    'Please provide further explanation below.',
    'If yes, please provide further explanation below.',
    'This field cannot be blank',
    'This requires an answer',
    'requires an answer',
    '* indicates a required field',
    'Answer required',
    'This question requires answers',
    'Work authorization',
    'First Name *',
    ''
  ];
  const old = new RegExp(ERROR_TEXT_BEFORE, 'i');
  const now = new RegExp(EMPLOYER_REQUIRED_POLICY.errorText, 'i');
  for (const text of corpus) {
    assert.equal(now.test(text), old.test(text), `classification changed for ${JSON.stringify(text)}`);
  }
});

test('the pass that finds the complaint and the pass that clears it read one vocabulary', () => {
  /* `candidates` decides a control is affected; the retry loop decides the complaint has cleared.
   * Two spellings there would let one field be both affected and confirmed, and the confirm would
   * be the one that reaches the click. */
  assert.equal(occurrences(SANDBOX_RUNNER, `/${EMPLOYER_REQUIRED_POLICY.errorText}/i.test(text)`), 2);
  assert.equal(occurrences(SANDBOX_RUNNER, ERROR_TEXT_BEFORE), 0, 'a hand-written copy is back in the runner');
});

test('the one alternative the readiness gate does not have stays out of the readiness gate', () => {
  /* The divergence is the finding, not the bug. Adding `requires an answer` to the gate widens the
   * thing that stopped four Scale AI and three DV Trading packets; this asserts nobody does it by
   * reflex while tidying. */
  assert.ok(!SUBMIT_READINESS_POLICY.errorText.includes(EMPLOYER_REQUIRED_POLICY.confirmOnlyErrorText));
  assert.equal(
    EMPLOYER_REQUIRED_POLICY.errorText,
    `${SUBMIT_READINESS_POLICY.errorText}|${EMPLOYER_REQUIRED_POLICY.confirmOnlyErrorText}`
  );
  assert.equal(occurrences(SANDBOX_RUNNER, EMPLOYER_REQUIRED_POLICY.confirmOnlyErrorText), 2);
  assert.equal(
    occurrences(SOURCE, `String.raw\`${EMPLOYER_REQUIRED_POLICY.confirmOnlyErrorText}\``),
    1,
    'the unattested alternative must be declared once and nowhere else'
  );
});

test('the delta hash covers this policy only, and refuses an unannounced edit', () => {
  /* Not a cross-repo pin, and the comment above the policy says so: the backend's direct-Playwright
   * path has a required-control commit of its own that was never meant to be byte-identical to this
   * one. This literal exists in no other repository. What it buys is that the two fragments genuinely
   * owned here cannot be edited without a red boot check. */
  assert.equal(
    crypto.createHash('sha256').update(EMPLOYER_REQUIRED_DELTA).digest('hex'),
    EMPLOYER_REQUIRED_POLICY.deltaHash
  );
  assert.equal(
    EMPLOYER_REQUIRED_DELTA,
    [EMPLOYER_REQUIRED_POLICY.scopeRequiredAttributes, EMPLOYER_REQUIRED_POLICY.confirmOnlyErrorText].join('\n')
  );
  for (const mutation of [
    [SCOPE_SELECTOR_BEFORE, EMPLOYER_REQUIRED_POLICY.confirmOnlyErrorText.replace('answer', 'response')].join('\n'),
    [SUBMIT_READINESS_POLICY.requiredAttributes, EMPLOYER_REQUIRED_POLICY.confirmOnlyErrorText].join('\n')
  ]) {
    assert.notEqual(
      crypto.createHash('sha256').update(mutation).digest('hex'),
      EMPLOYER_REQUIRED_POLICY.deltaHash
    );
  }
  // The four aliased fragments are covered by the readiness hash. Hashing them here as well would
  // make one edit fail two checks that mean the same thing.
  for (const fragment of ['requiredClassMarkers', 'asteriskMark', 'asteriskLegend']) {
    assert.ok(!EMPLOYER_REQUIRED_DELTA.includes(SUBMIT_READINESS_POLICY[fragment]));
  }
});

test('the cross-repo pin is untouched', () => {
  /* This change reads SUBMIT_READINESS_POLICY and writes nothing to it. The backend's
   * submitReadinessGrammar.test.ts holds this same literal, and a change here that moved it would
   * turn that repo red for a reason that has nothing to do with the readiness gate. */
  assert.equal(
    SUBMIT_READINESS_POLICY.grammarHash,
    '4a020bdf8fce9a00aa4b9edbe99d65fc216d62f02d3d8eaa04bf0b7e1ab8c631'
  );
  assert.notEqual(EMPLOYER_REQUIRED_POLICY.deltaHash, SUBMIT_READINESS_POLICY.grammarHash);
});
