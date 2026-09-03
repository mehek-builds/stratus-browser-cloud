import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isAshbyPublicBoardRead,
  isGraphqlReadDocument,
  ashbyPublicBoardOperationName,
  ASHBY_PUBLIC_BOARD_READ_OPERATIONS
} from '../src/managed-browser.js';

/* Ashby's public board performs every read as a same-host POST to one GraphQL endpoint, so the
 * mutation containment aborted the very request that carries the form definition and every Ashby
 * run sat at discovered=0. These tests pin the allowance to exactly that shape and prove a write
 * cannot ride in under a read's name. Bodies are the ones a live Ashby posting actually sent on
 * 2026-09-01. */

const ashbyRead = (over = {}) => ({
  applicationSite: 'ashbyhq.com',
  method: 'POST',
  resourceType: 'fetch',
  url: 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobPosting',
  postData: JSON.stringify({
    operationName: 'ApiJobPosting',
    variables: { organizationHostedJobsPageName: 'openai', jobPostingId: 'de06790a' },
    query: 'query ApiJobPosting($organizationHostedJobsPageName: String!) {\n  jobPosting {\n id\n }\n}'
  }),
  ...over
});

test('the reads a live Ashby application page issues are allowed', () => {
  assert.equal(isAshbyPublicBoardRead(ashbyRead()), true);
  for (const operationName of ASHBY_PUBLIC_BOARD_READ_OPERATIONS) {
    const body = JSON.stringify({ operationName, query: 'query ' + operationName + ' { x }' });
    assert.equal(isAshbyPublicBoardRead(ashbyRead({ postData: body })), true, operationName);
  }
  // An anonymous read document opens with `query(` or `query {`, still a read.
  assert.equal(isAshbyPublicBoardRead(ashbyRead({
    postData: JSON.stringify({ operationName: 'ApiJobPosting', query: 'query { jobPosting { id } }' })
  })), true);
});

test('the read proof survives how a client serializes a document', () => {
  /* Review finding: an earlier "starts with query" test was brittle in the FATAL direction. Each
   * shape below is a legal read on an allow-listed operation that a client can adopt without its
   * API changing, and blocking any of them would take Ashby from fixed back to 100% down. */
  assert.equal(isGraphqlReadDocument('query ApiJobPosting($a: String!) { x }'), true);
  assert.equal(isGraphqlReadDocument('query { x }'), true);
  assert.equal(isGraphqlReadDocument('fragment F on JobPosting { id }\nquery ApiJobPosting { ...F }'), true);
  assert.equal(isGraphqlReadDocument('# @generated\nquery ApiJobPosting { x }'), true);
  // A field or argument that merely contains the word is not an operation definition.
  assert.equal(isGraphqlReadDocument('query A { mutationCount subscriptionState }'), true);
});

test('the read proof still refuses anything it cannot prove is a read', () => {
  assert.equal(isGraphqlReadDocument('mutation M($i: I!) { submitApplication(input: $i) { id } }'), false);
  assert.equal(isGraphqlReadDocument('subscription S { x }'), false);
  // A mutation smuggled in behind a legitimate query is still a mutation.
  assert.equal(isGraphqlReadDocument('query A { x }\nmutation B { submitApplication { id } }'), false);
  // Shorthand anonymous and Automatic Persisted Query bodies carry no proof, so they stay blocked.
  assert.equal(isGraphqlReadDocument('{ x }'), false);
  assert.equal(isGraphqlReadDocument(undefined), false);
  assert.equal(isGraphqlReadDocument(''), false);
});

test('a mutation cannot ride in under an allow-listed read operation name', () => {
  // The ?op= label says ApiJobPosting; only the body is believed.
  assert.equal(isAshbyPublicBoardRead(ashbyRead({
    postData: JSON.stringify({
      operationName: 'ApiJobPosting',
      query: 'mutation ApiJobPosting($input: ApplicationInput!) { submitApplication(input: $input) { id } }'
    })
  })), false);
  assert.equal(isAshbyPublicBoardRead(ashbyRead({
    postData: JSON.stringify({ operationName: 'ApiJobPosting', query: 'subscription S { x }' })
  })), false);
});

test('an operation outside the list fails closed', () => {
  assert.equal(isAshbyPublicBoardRead(ashbyRead({
    postData: JSON.stringify({ operationName: 'ApiApplicationSubmit', query: 'query X { x }' })
  })), false);
  // A batched array body is not a single provable read.
  assert.equal(isAshbyPublicBoardRead(ashbyRead({
    postData: JSON.stringify([{ operationName: 'ApiJobPosting', query: 'query X { x }' }])
  })), false);
  // An unparseable or absent body is not evidence of anything.
  assert.equal(isAshbyPublicBoardRead(ashbyRead({ postData: 'not-json' })), false);
  assert.equal(isAshbyPublicBoardRead(ashbyRead({ postData: null })), false);
});

test('the allowance is scoped to Ashby runs, the Ashby host, that path and https', () => {
  // A run on some other board may not reach ashbyhq.com even with a perfect read body.
  assert.equal(isAshbyPublicBoardRead(ashbyRead({ applicationSite: 'greenhouse.io' })), false);
  // An Ashby run may not reach a look-alike host.
  assert.equal(isAshbyPublicBoardRead(ashbyRead({
    url: 'https://jobs.ashbyhq.com.evil.example/api/non-user-graphql?op=ApiJobPosting'
  })), false);
  assert.equal(isAshbyPublicBoardRead(ashbyRead({
    url: 'https://jobs.ashbyhq.com/api/submit-application'
  })), false);
  assert.equal(isAshbyPublicBoardRead(ashbyRead({
    url: 'http://jobs.ashbyhq.com/api/non-user-graphql'
  })), false);
  assert.equal(isAshbyPublicBoardRead(ashbyRead({ url: 'not a url' })), false);
});

test('the allowance never widens the method or the resource set', () => {
  assert.equal(isAshbyPublicBoardRead(ashbyRead({ method: 'PUT' })), false);
  assert.equal(isAshbyPublicBoardRead(ashbyRead({ resourceType: 'document' })), false);
  assert.equal(isAshbyPublicBoardRead(ashbyRead({ resourceType: 'websocket' })), false);
  assert.equal(isAshbyPublicBoardRead(ashbyRead({ resourceType: 'worker' })), false);
  assert.equal(isAshbyPublicBoardRead({}), false);
});

test('the containment consults the allowance in both modes, and nowhere else', () => {
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  // The form has to render before discovery can enumerate anything, so initial_navigation counts.
  assert.match(source, /return readOnlyMethod \|\| ashbyPublicBoardRead\(request\)\s*\n\s*\? route\.fallback\(\)/);
  // And the locked-mode data-fetch branch, which is where a fill-time autocomplete lands. The
  // field-value write allowance joined this same branch on 2026-09-03, and only this one: see
  // ashby-form-value-write.test.js, which holds that predicate to its own single call site.
  assert.match(source, /if \(!readOnlyDataFetch && !ashbyPublicBoardRead\(request\) && !ashbyFormValueWrite\(request\)\) \{/);
  // The violation assert is untouched: an employer-bound block that is not this read is still fatal.
  assert.match(source, /A non-submit action attempted employer transport without exact final authority/);
  // "and nowhere else" has to be measured, or a third call site could widen this silently.
  assert.equal(source.split('ashbyPublicBoardRead(request)').length - 1, 2);
});

test('a blocked Ashby operation names itself in the violation sentence', () => {
  // The next gap is an Ashby read operation this allowlist does not carry. Naming it keeps that
  // 502 diagnosable instead of reading as a fresh regression.
  const on = (postData) => ashbyPublicBoardOperationName({
    url: 'https://jobs.ashbyhq.com/api/non-user-graphql',
    postData
  });
  assert.equal(on(JSON.stringify({ operationName: 'ApiApplicationUpload', query: 'query X { x }' })),
    'ApiApplicationUpload');
  // It is diagnostics, never authorization: naming an operation does not allow it.
  assert.equal(isAshbyPublicBoardRead({
    applicationSite: 'ashbyhq.com',
    method: 'POST',
    resourceType: 'fetch',
    url: 'https://jobs.ashbyhq.com/api/non-user-graphql',
    postData: JSON.stringify({ operationName: 'ApiApplicationUpload', query: 'query X { x }' })
  }), false);
  // Nothing is read off a non-Ashby host, so no other board's body reaches the logs.
  assert.equal(on(JSON.stringify({ operationName: 'X' })), 'X');
  assert.equal(ashbyPublicBoardOperationName({
    url: 'https://api.greenhouse.io/api/non-user-graphql',
    postData: JSON.stringify({ operationName: 'Secret' })
  }), null);
  assert.equal(on('not-json'), null);
});
