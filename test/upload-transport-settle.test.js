import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');

/* THE UPLOAD THAT REPORTED ITSELF ATTACHED AND WAS NOT THERE.
 *
 * Packet a34e5ce2 went to a Recruitee board twice, 2026-09-02 and 2026-09-03. Both runs came back
 * with resume and cover_letter in filled_fields, no failed field and no skipped reason, and the
 * 2026-09-03 post-fill screenshot shows both dropzones still rendering the empty
 * "Upload a file or drag and drop here" prompt with no file name anywhere on the block. The
 * 2026-09-02 attempt pressed submit on that form and came back no_confirmation_state.
 *
 * Two things in this runner made that possible and both are pinned here:
 *   - the upload action was one setInputFiles followed immediately by filledFields.push, with
 *     nothing in between that had looked at the page;
 *   - the window that admits the board's own upload POST was closed by the NEXT action in the list
 *     whether or not that action did anything, including an optional fill whose selector matched
 *     nothing - which is exactly what follows the uploads in the Recruitee fixed-field plan.
 *
 * These are source-contract pins in the same idiom as containment-readonly-fetch.test.js: the DOM
 * half of this runner cannot be exercised on a machine without a downloaded Chromium, and the
 * arming and reporting rules are exactly the kind of thing a later edit reverts by accident.
 */

test('the upload window is armed below the pre-check, so a skipped action cannot close it', () => {
  const armIndex = source.indexOf("uploadTransportWatch.armed = action.type === 'upload';");
  const skipIndex = source.indexOf("': nothing matched ' + action.selector");
  assert.ok(armIndex > 0, 'the upload window arming is present');
  assert.ok(skipIndex > 0, 'the optional pre-check skip is present');
  assert.ok(
    armIndex > skipIndex,
    'the arming must sit BELOW the optional pre-check: an action the run steps over performs no '
    + 'mutation and must not close a window the board is still uploading through',
  );
  // And still above the action bodies it governs, so the window is set before anything runs.
  const uploadBodyIndex = source.indexOf("if (action.type === 'upload') {\n        const exactBinding");
  assert.ok(uploadBodyIndex > armIndex, 'the arming precedes the upload action body');
  // A disarm drops the in-flight set with it: those requests belong to a window that is now shut.
  assert.match(source, /if \(!uploadTransportWatch\.armed\) uploadTransportWatch\.inFlight\.clear\(\);/);
});

test('the run waits for the page own upload transport before it advances', () => {
  // Counted only inside an armed window, and only for the write-shaped transport an upload can be.
  assert.match(source, /if \(!uploadTransportWatch\.armed \|\| uploadTransportWatch\.inFlight\.size >= 32\) return;/);
  assert.match(source, /if \(uploadShapedTransport\(request\)\) uploadTransportWatch\.inFlight\.add\(request\);/);
  assert.match(source, /if \(method !== 'POST' && method !== 'PUT'\) return false;\s*\n\s*const type = request\.resourceType\(\);\s*\n\s*return type === 'xhr' \|\| type === 'fetch';/);
  // Both bounds are small and both are real: a board that uploads lazily pays only the start grace.
  assert.match(source, /const UPLOAD_TRANSPORT_START_GRACE_MS = 400;/);
  assert.match(source, /const UPLOAD_TRANSPORT_SETTLE_MS = 5000;/);
  // The settle is awaited by the upload action itself, between setInputFiles and the bookkeeping.
  assert.match(source, /const uploadTransportSettled = await settleUploadTransport\(\);/);
  const setFilesIndex = source.indexOf('await uploadTarget.setInputFiles({');
  const settleIndex = source.indexOf('const uploadTransportSettled = await settleUploadTransport();');
  assert.ok(setFilesIndex > 0 && settleIndex > setFilesIndex, 'the settle follows setInputFiles');
});

test('filled_fields claims an attachment only when the form shows some sign of the document', () => {
  /* Deliberately generous, because the failure direction that costs a real application is refusing
   * a correct send. Any one of four readings keeps the claim, and the fourth - the file name itself
   * appearing on the block - is an EXACT test against the name this run uploaded rather than a
   * guess at a class name, so it needs no vocabulary and holds on any board that shows the
   * applicant what she attached. */
  assert.match(source, /const formShowsDocument = !uploadEvidence\s*\n\s*\|\| !uploadEvidence\.connected\s*\n\s*\|\| uploadEvidence\.files > 0\s*\n\s*\|\| uploadEvidence\.named\s*\n\s*\|\| uploadEvidence\.chip;/);
  assert.match(source, /if \(formShowsDocument\) filledFields\.push\(action\.label\);/);
  // And the negative is SAID, not silent: this is the line the backend needs to refuse the send.
  assert.match(source, /the file was set into ' \+ action\.selector/);
  assert.match(source, /the control is still an empty file input and'/);
  // The chip vocabulary is the readiness scan's own three selectors, not a widened guess. It
  // appears in this file only in places that already had it plus this one read.
  const chipUses = source.match(/\.file-upload__filename, \[class\*="file-upload__filename"\], \[aria-label="Remove file" i\]/g) || [];
  assert.equal(
    chipUses.length,
    4,
    'the three readiness/answer readers that already carried this vocabulary, plus the one upload '
    + 'evidence read added on 2026-09-03 - a fifth spelling needs a measured capture first',
  );
});

test('a transport killed on the way to the board stops being invisible', () => {
  /* blockedThirdPartyCount had been incremented and read by nothing since it was added, so a board
   * whose uploader posts to a store this file does not know about had its resume aborted with no
   * counter, no skipped line and no blocker anywhere in the result. That is the one silent way this
   * containment can kill an attachment, and it is now recorded against the upload that provoked it.
   * It changes no admission decision. */
  assert.match(source, /if \(uploadTransportWatch\.armed\) uploadTransportWatch\.blockedWhileArmed \+= 1;/);
  assert.match(source, /third-party request\(s\) were blocked while this upload was in flight/);
  assert.match(source, /the page still had upload transport in flight after ' \+ UPLOAD_TRANSPORT_SETTLE_MS/);
});
