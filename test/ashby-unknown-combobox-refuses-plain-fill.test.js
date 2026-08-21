/* AN UNKNOWN CHOICE STATE IS NOT A LICENCE TO TYPE INTO THE CONTROL.
 *
 * Measured live end to end (packet-audit -> acknowledge -> submit-request -> the real
 * application-submission-runner), on the SAME Ashby "Current Location" field
 * ashby-blur-reverts-choice-dom.test.js documents, but a different mechanism from the one that
 * file fixes. That file's fixture always offers a matching row ("Dubai, United Arab Emirates")
 * for the query "Dubai" and pins the case where fillCustomChoice clicks it and choiceLanded's
 * post-blur reread decides whether the click held. This file is upstream of that: instrumented
 * against the real Deepgram and Notion Ashby postings, 2026-08-21, fillCustomChoice itself
 * returned false - lastChoiceControlOpened true, lastClickedOptionText empty, lastChoiceRefusal
 * empty. The real geocoder never offered a row worth clicking for the bare city name "Dubai" at
 * all, so nothing was ever chosen and choiceLanded was never even reached.
 *
 * THE ACTION LOOP'S OWN FALLTHROUGH, not fillCustomChoice or choiceLanded, is what turned that
 * false into a false "location" success. The comment immediately above the code this file tests
 * already names the exact defect it exists to prevent - "Falling through to the plain fill below
 * would type the answer into the widget's SEARCH box and then read it straight back out of that
 * same box... the field was reported filled while the control still said 'Select...'" (Five
 * Rings, 2026-08-17) - but the guard that follows it only fired when readChoiceState returned
 * something other than 'unknown': `if (state.kind !== 'unknown') { ...refuse...continue; }`.
 * readChoiceState only ever recognises a React Select (verifyChoiceInContainer's own docs say so
 * in as many words), so Ashby's homegrown, class-less autocomplete always comes back 'unknown',
 * the guard never fired, and execution fell through past isBareOpener (false - this is a real,
 * typeable <input>, not a bare div opener) straight into the plain-fill path a few lines further
 * down: a native .fill() of the raw DOM value, verified by reading that same raw value straight
 * back. Measured end to end: filled_fields carried "location" on every run while the packet's own
 * required-field scan kept naming "Current Location" empty, from the SAME run, every time.
 *
 * THE FIX removes the state.kind !== 'unknown' condition entirely: every control that reached the
 * combobox/listbox gate above and failed to have its choice made is refused here, regardless of
 * whether readChoiceState could classify it. Nothing about the 'chosen' or 'empty' outcomes
 * changes - they already refused - so this can only ever convert a previously-silent false
 * success into an honest "left for you", never the reverse.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

test('the no-option-matched refusal no longer exempts an unknown choice state', () => {
  const start = SANDBOX_RUNNER.indexOf('// No option matched, and this is a widget whose answered state can be read.');
  const end = SANDBOX_RUNNER.indexOf('A bare opener that reached here had no option to click', start);
  assert.ok(start !== -1 && end > start, 'the no-option-matched block must precede the bare-opener block');
  const body = SANDBOX_RUNNER.slice(start, end);
  // The old, incomplete guard is gone: nothing about this block may still branch on 'unknown'.
  assert.doesNotMatch(body, /state\.kind\s*!==\s*'unknown'/);
  // The refusal itself - the skip message and the continue - must still be reachable
  // unconditionally, not deleted along with the guard.
  assert.match(body, /skipped\.push\(/);
  assert.match(body, /\n\s*continue;\s*\n\s*\}/, 'the block must end by refusing, not by falling through');
  // 'unknown' still has to reach a decision between the two honest sentences the rest of this
  // file already writes for a choice it could not make: unreadable (something was clicked and
  // could not be confirmed) versus unmatched (nothing was ever offered to click).
  assert.match(body, /lastChoiceUnreadable/);
  assert.match(body, /unreadableChoiceReason/);
  assert.match(body, /unmatchedReason\(/);
});

test('the fix cannot be satisfied by deleting the refusal outright', () => {
  const start = SANDBOX_RUNNER.indexOf('// No option matched, and this is a widget whose answered state can be read.');
  const end = SANDBOX_RUNNER.indexOf('A bare opener that reached here had no option to click', start);
  const body = SANDBOX_RUNNER.slice(start, end);
  // A block that refused nothing at all would also pass the assertions above by accident (no
  // 'unknown' branch because there is no branch left). This pins that the 'chosen' sentence -
  // proof the block still tells the applicant when a real answer was already sitting on the form
  // - is still there.
  assert.match(body, /left the answer already on the form/);
});
