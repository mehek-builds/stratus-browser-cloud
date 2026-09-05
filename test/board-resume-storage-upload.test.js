import test from 'node:test';
import assert from 'node:assert/strict';
import { isBoardResumeStorageUploadHost } from '../src/managed-browser.js';

/* THE BOARD'S OWN RESUME STORE, AND NOTHING ELSE.
 *
 * Greenhouse's file input uploads eagerly to a Greenhouse-named S3 bucket on the change event.
 * Measured 2026-09-02 on the live Hudson River Trading fill: the containment aborted
 * POST https://grnhse-prod-jben-us-east-1.s3.amazonaws.com/..., the XHR never settled, React
 * unmounted the file input into a perpetual progress bar, and the form's readiness scan read
 * "Resume/CV is required and is still empty". The admission is host-shaped and deliberately
 * narrow: a grnhse-* bucket in virtual-hosted style on Amazon S3, with or without a region infix.
 * Everything else on amazonaws.com stays third-party-blocked, and even this host is admitted only
 * inside the armed upload window (pinned in containment-readonly-fetch.test.js).
 */

test('the measured Greenhouse bucket is admitted, in every S3 virtual-hosted spelling', () => {
  assert.equal(isBoardResumeStorageUploadHost('grnhse-prod-jben-us-east-1.s3.amazonaws.com'), true);
  assert.equal(isBoardResumeStorageUploadHost('grnhse-prod-jben-us-east-1.s3.us-east-1.amazonaws.com'), true);
  assert.equal(isBoardResumeStorageUploadHost('grnhse-prod-jben-us-east-1.s3-us-east-1.amazonaws.com'), true);
  // Case and a trailing dot are DNS noise, not a different host.
  assert.equal(isBoardResumeStorageUploadHost('GRNHSE-PROD-JBEN-US-EAST-1.S3.AMAZONAWS.COM'), true);
  assert.equal(isBoardResumeStorageUploadHost('grnhse-prod-jben-us-east-1.s3.amazonaws.com.'), true);
});

/* WORKABLE'S BUCKET, measured 2026-09-05 on TWG Global: the careers bundle asks
 * GET /api/v1/jobs/<shortcode>/form/upload/resume for a presigned POST whose url is
 * https://workable-application-form.s3.us-east-1.amazonaws.com, and posts the resume there on the
 * file input's change event. Refusing it does not kill the run - the bundle's error mapper renders
 * "Sorry, an unknown error occurred" for a request that fails without a status, replacing the whole
 * form - so two 410 s runs found no controls to fill. Same admission, same arming, one more name. */
test('the measured Workable bucket is admitted, in every S3 virtual-hosted spelling', () => {
  assert.equal(isBoardResumeStorageUploadHost('workable-application-form.s3.us-east-1.amazonaws.com'), true);
  assert.equal(isBoardResumeStorageUploadHost('workable-application-form.s3.amazonaws.com'), true);
  assert.equal(isBoardResumeStorageUploadHost('workable-application-form.s3-us-east-1.amazonaws.com'), true);
  assert.equal(isBoardResumeStorageUploadHost('WORKABLE-APPLICATION-FORM.S3.US-EAST-1.AMAZONAWS.COM.'), true);
  // The name is pinned whole: a different Workable bucket, or the name with a suffix, is not this one.
  assert.equal(isBoardResumeStorageUploadHost('workable-application-form-eu.s3.amazonaws.com'), false);
  assert.equal(isBoardResumeStorageUploadHost('workable-uploads.s3.amazonaws.com'), false);
  assert.equal(isBoardResumeStorageUploadHost('workable-application-form.s3.amazonaws.com.evil.example'), false);
  assert.equal(isBoardResumeStorageUploadHost('apply.workable.com'), false);
});

test('nothing that is not a named board bucket on real S3 is admitted', () => {
  // Bare S3, other buckets, and AWS generally.
  assert.equal(isBoardResumeStorageUploadHost('s3.amazonaws.com'), false);
  assert.equal(isBoardResumeStorageUploadHost('some-other-bucket.s3.amazonaws.com'), false);
  assert.equal(isBoardResumeStorageUploadHost('uploads.amazonaws.com'), false);
  // A bucket merely MENTIONING grnhse mid-name, or grnhse itself without the prefix position.
  assert.equal(isBoardResumeStorageUploadHost('evil-grnhse-prod.s3.amazonaws.com'), false);
  // A lookalike where S3 is not the real suffix: the admission must not be spoofable by an
  // attacker-controlled domain that embeds the whole bucket string.
  assert.equal(isBoardResumeStorageUploadHost('grnhse-prod.s3.amazonaws.com.evil.example'), false);
  assert.equal(isBoardResumeStorageUploadHost('grnhse-prod.s3.evil.example'), false);
  // Greenhouse's own web hosts are employer-bound already and are not this admission's business.
  assert.equal(isBoardResumeStorageUploadHost('boards.greenhouse.io'), false);
  assert.equal(isBoardResumeStorageUploadHost('grnhse.io'), false);
  // Garbage in, false out.
  assert.equal(isBoardResumeStorageUploadHost(''), false);
  assert.equal(isBoardResumeStorageUploadHost(null), false);
  assert.equal(isBoardResumeStorageUploadHost(undefined), false);
});
