import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  isAshbyFormValueWrite,
  isAshbyPublicBoardRead,
  isGraphqlSoleNamedMutation,
  ASHBY_FORM_VALUE_WRITE_OPERATIONS,
  ASHBY_PUBLIC_BOARD_READ_OPERATIONS
} from '../src/managed-browser.js';

/* Ashby holds each form value on its own server as the field is typed, one ApiSetFormValue POST to
 * the same GraphQL endpoint its reads use, so the mutation containment aborted the first value of
 * every Ashby fill and the run died at the next action - measured twice on 2026-09-03 on the Exa
 * packet, before a preview screenshot existed. These tests pin the allowance to that one operation
 * and, mostly, prove the thing that matters in the other direction: that a SUBMIT cannot reach the
 * employer through it. The operation name and the endpoint are the ones the 2026-09-03 violation
 * sentence named. The document below is a plausible serialization, not a captured one - this
 * project never opens an employer portal - so every assertion here is about the RULE, and the rule
 * fails closed on anything it cannot prove. */

const ashbyWrite = (over = {}) => ({
  applicationSite: 'ashbyhq.com',
  method: 'POST',
  resourceType: 'fetch',
  url: 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSetFormValue',
  postData: JSON.stringify({
    operationName: 'ApiSetFormValue',
    variables: { fieldId: 'f_name', value: 'Mehek' },
    query: 'mutation ApiSetFormValue($input: SetFormValueInput!) {\n  setFormValue(input: $input) {\n    id\n  }\n}'
  }),
  ...over
});

test('the field-value write a live Ashby fill issues is allowed', () => {
  assert.equal(isAshbyFormValueWrite(ashbyWrite()), true);
  for (const operationName of ASHBY_FORM_VALUE_WRITE_OPERATIONS) {
    const body = JSON.stringify({
      operationName,
      query: 'mutation ' + operationName + '($i: I!) { x }'
    });
    assert.equal(isAshbyFormValueWrite(ashbyWrite({ postData: body })), true, operationName);
  }
});

test('the write proof survives how a client serializes a document', () => {
  /* The same brittleness lesson the read proof learned: each shape below is the same single named
   * mutation a client can emit without its API changing, and refusing one of them would leave
   * Ashby exactly as broken as it was on 2026-09-03. */
  assert.equal(isGraphqlSoleNamedMutation('mutation M($i: I!) { x }', 'M'), true);
  assert.equal(isGraphqlSoleNamedMutation('mutation M { x }', 'M'), true);
  assert.equal(isGraphqlSoleNamedMutation('mutation M{ x }', 'M'), true);
  assert.equal(isGraphqlSoleNamedMutation('fragment F on V { id }\nmutation M { ...F }', 'M'), true);
  assert.equal(isGraphqlSoleNamedMutation('# @generated\nmutation M { x }', 'M'), true);
  // A field or argument that merely contains the word is not an operation definition.
  assert.equal(isGraphqlSoleNamedMutation('mutation M { queryCount subscriptionState }', 'M'), true);
});

test('THE SAFETY PROPERTY: a submit cannot ride in on the field-value allowance', () => {
  /* This is the test that has to fail if this allowance ever opens the hole it was written to keep
   * shut. Ashby's real submit operation is not known to this repo and is deliberately not named in
   * the allowlist, so the property is proved the only way it can be: NOTHING but the pinned
   * operation is admitted, and the pinned name cannot be attached to a document that does
   * something else. */

  // 1. A submit-shaped operation name is not on the list, whatever it is called.
  for (const operationName of [
    'ApiSubmitApplication', 'ApiApplicationSubmit', 'SubmitApplication',
    'ApiCreateApplication', 'ApiSetFormValues', 'ApisetFormValue', 'apiSetFormValue'
  ]) {
    assert.equal(isAshbyFormValueWrite(ashbyWrite({
      postData: JSON.stringify({
        operationName,
        query: 'mutation ' + operationName + '($i: I!) { submitApplication(input: $i) { id } }'
      })
    })), false, operationName);
  }

  // 2. The pinned name over a submit document: refused, because the document must define the
  // operation the body claims. A server honouring operationName would error; a server that ignores
  // it and runs the document's sole operation would SUBMIT. Neither gets the chance.
  assert.equal(isAshbyFormValueWrite(ashbyWrite({
    postData: JSON.stringify({
      operationName: 'ApiSetFormValue',
      query: 'mutation ApiSubmitApplication($i: I!) { submitApplication(input: $i) { id } }'
    })
  })), false);

  // 3. A submit riding ALONGSIDE the pinned operation in one document: refused, because exactly one
  // operation definition is allowed. This is the shape that would let a server pick the wrong one.
  assert.equal(isAshbyFormValueWrite(ashbyWrite({
    postData: JSON.stringify({
      operationName: 'ApiSetFormValue',
      query: 'mutation ApiSetFormValue($i: I!) { x }\nmutation ApiSubmitApplication { submitApplication { id } }'
    })
  })), false);
  assert.equal(isGraphqlSoleNamedMutation(
    'mutation ApiSubmitApplication { submitApplication { id } }\nmutation ApiSetFormValue { x }',
    'ApiSetFormValue'
  ), false);

  // 4. An anonymous document carries no name to hold to anything, and an Automatic Persisted Query
  // body carries no document at all. Absence of evidence reads as absence of permission.
  assert.equal(isAshbyFormValueWrite(ashbyWrite({
    postData: JSON.stringify({ operationName: 'ApiSetFormValue', query: 'mutation { x }' })
  })), false);
  assert.equal(isAshbyFormValueWrite(ashbyWrite({
    postData: JSON.stringify({ operationName: 'ApiSetFormValue', query: '{ x }' })
  })), false);
  assert.equal(isAshbyFormValueWrite(ashbyWrite({
    postData: JSON.stringify({
      operationName: 'ApiSetFormValue',
      extensions: { persistedQuery: { sha256Hash: 'deadbeef' } }
    })
  })), false);

  // 5. A batched array body is not a single provable write, so a submit cannot travel as element 2.
  assert.equal(isAshbyFormValueWrite(ashbyWrite({
    postData: JSON.stringify([
      { operationName: 'ApiSetFormValue', query: 'mutation ApiSetFormValue { x }' },
      { operationName: 'ApiSubmitApplication', query: 'mutation ApiSubmitApplication { x }' }
    ])
  })), false);

  // 6. An unparseable or absent body is not evidence of anything.
  assert.equal(isAshbyFormValueWrite(ashbyWrite({ postData: 'not-json' })), false);
  assert.equal(isAshbyFormValueWrite(ashbyWrite({ postData: null })), false);
  assert.equal(isAshbyFormValueWrite({}), false);
});

test('the write allowance is scoped to Ashby runs, the Ashby host, that path and https', () => {
  // A run on some other board may not reach ashbyhq.com even with a perfect write body.
  assert.equal(isAshbyFormValueWrite(ashbyWrite({ applicationSite: 'greenhouse.io' })), false);
  assert.equal(isAshbyFormValueWrite(ashbyWrite({ applicationSite: null })), false);
  // An Ashby run may not reach a look-alike host.
  assert.equal(isAshbyFormValueWrite(ashbyWrite({
    url: 'https://jobs.ashbyhq.com.evil.example/api/non-user-graphql?op=ApiSetFormValue'
  })), false);
  // Nor any other path on the right host: the submit endpoint, whatever it is, is not this one.
  assert.equal(isAshbyFormValueWrite(ashbyWrite({
    url: 'https://jobs.ashbyhq.com/api/submit-application'
  })), false);
  assert.equal(isAshbyFormValueWrite(ashbyWrite({
    url: 'https://jobs.ashbyhq.com/api/non-user-graphql/submit'
  })), false);
  assert.equal(isAshbyFormValueWrite(ashbyWrite({
    url: 'http://jobs.ashbyhq.com/api/non-user-graphql'
  })), false);
  assert.equal(isAshbyFormValueWrite(ashbyWrite({ url: 'not a url' })), false);
});

test('the write allowance never widens the method or the resource set', () => {
  assert.equal(isAshbyFormValueWrite(ashbyWrite({ method: 'PUT' })), false);
  assert.equal(isAshbyFormValueWrite(ashbyWrite({ method: 'GET' })), false);
  assert.equal(isAshbyFormValueWrite(ashbyWrite({ resourceType: 'document' })), false);
  assert.equal(isAshbyFormValueWrite(ashbyWrite({ resourceType: 'websocket' })), false);
  assert.equal(isAshbyFormValueWrite(ashbyWrite({ resourceType: 'worker' })), false);
  assert.equal(isAshbyFormValueWrite(ashbyWrite({ resourceType: 'ping' })), false);
});

test('the read list and the write list stay separate, and neither answers for the other', () => {
  /* The 2026-09-03 fix could have been "add ApiSetFormValue to the read list". That would have
   * handed the write the read's SECOND gate - initial navigation, before any reviewed action exists
   * - and it would not have worked either, because a read must prove it defines no mutation. Two
   * lists, two predicates, two gates. */
  assert.equal(ASHBY_PUBLIC_BOARD_READ_OPERATIONS.includes('ApiSetFormValue'), false);
  for (const operationName of ASHBY_FORM_VALUE_WRITE_OPERATIONS) {
    assert.equal(ASHBY_PUBLIC_BOARD_READ_OPERATIONS.includes(operationName), false, operationName);
    // The read predicate does not admit a write operation, on any document.
    assert.equal(isAshbyPublicBoardRead(ashbyWrite()), false);
    assert.equal(isAshbyPublicBoardRead(ashbyWrite({
      postData: JSON.stringify({ operationName, query: 'query ' + operationName + ' { x }' })
    })), false, operationName);
  }
  for (const operationName of ASHBY_PUBLIC_BOARD_READ_OPERATIONS) {
    // And the write predicate does not admit a read operation, on any document.
    assert.equal(isAshbyFormValueWrite(ashbyWrite({
      postData: JSON.stringify({ operationName, query: 'mutation ' + operationName + ' { x }' })
    })), false, operationName);
  }
  // A read document under the write operation's name is still not a write.
  assert.equal(isAshbyFormValueWrite(ashbyWrite({
    postData: JSON.stringify({ operationName: 'ApiSetFormValue', query: 'query ApiSetFormValue { x }' })
  })), false);
  assert.equal(isAshbyFormValueWrite(ashbyWrite({
    postData: JSON.stringify({ operationName: 'ApiSetFormValue', query: 'subscription ApiSetFormValue { x }' })
  })), false);
});

test('the containment consults the write allowance in the fill phase, and nowhere else', () => {
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  // Exactly one call site: the locked-mode data-fetch branch, where a typed value lands.
  assert.match(source, /if \(!readOnlyDataFetch && !ashbyPublicBoardRead\(request\) && !ashbyFormValueWrite\(request\)\) \{/);
  assert.equal(source.split('ashbyFormValueWrite(request)').length - 1, 1,
    'the field-value write allowance is called from the locked-mode branch and nowhere else');
  // NOT on the initial-navigation branch, which still admits reads only. A page that writes a form
  // value before the run has a reviewed action to write is moving on its own, and stays fatal.
  assert.match(source, /return readOnlyMethod \|\| ashbyPublicBoardRead\(request\)\s*\n\s*\? route\.fallback\(\)/);
  // The violation assert is untouched: an employer-bound block that is neither of these is fatal.
  assert.match(source, /A non-submit action attempted employer transport without exact final authority/);
  // And the final gate still demands literal allowSubmit plus exact final authority, unchanged.
  assert.match(source, /A final employer action requires literal allowSubmit and exact final authority/);
  assert.match(source, /runInput\?\.allowSubmit === true\s*\n\s*&& runInput\?\.exactFinalActionAuthority === true/);
});

test('the sandbox runner carries the write allowance rather than a bare module reference', () => {
  /* b816a61's lesson, 2026-09-01: the containment is one String.raw template evaluated inside the
   * sandbox, so a module identifier referenced but not interpolated is a ReferenceError on every
   * managed run - source that parses, passes node --check, and matches every source-contract regex.
   * Each definition the write allowance needs must be interpolated INTO the template. */
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  for (const injected of [
    'const GRAPHQL_NAMED_OPERATION_DEFINITION = ${JSON.stringify(GRAPHQL_NAMED_OPERATION_DEFINITION)};',
    'const isGraphqlSoleNamedMutation = ${isGraphqlSoleNamedMutation.toString()};',
    'const ASHBY_FORM_VALUE_WRITE_OPERATIONS = ${JSON.stringify(ASHBY_FORM_VALUE_WRITE_OPERATIONS)};',
    'const isAshbyFormValueWrite = ${isAshbyFormValueWrite.toString()};'
  ]) {
    assert.ok(source.includes(injected), injected);
  }
  // Every free identifier the injected predicate closes over is injected alongside it.
  for (const dependency of [
    'const ASHBY_PUBLIC_BOARD_SITE = ${JSON.stringify(ASHBY_PUBLIC_BOARD_SITE)};',
    'const ASHBY_PUBLIC_BOARD_GRAPHQL_PATH = ${JSON.stringify(ASHBY_PUBLIC_BOARD_GRAPHQL_PATH)};',
    'const transportRegistrableSuffix = ${transportRegistrableSuffix.toString()};',
    'const GRAPHQL_OPERATION_DEFINITION = ${JSON.stringify(GRAPHQL_OPERATION_DEFINITION)};'
  ]) {
    assert.ok(source.includes(dependency), dependency);
  }
});

test('an allow-listed write that fails its document proof says so in the violation sentence', () => {
  /* The document shape is the one input here this repo has never measured, because it never opens
   * an employer portal. If Ashby's real ApiSetFormValue body does not satisfy the proof, the run
   * still dies exactly as it does today - and the 502 must not read identically to the regression
   * this allowance closes, or the next operator re-derives all of it from scratch. */
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  assert.match(source, /const allowListedWriteRefused = Boolean\(operationName\)\s*\n\s*&& ASHBY_FORM_VALUE_WRITE_OPERATIONS\.includes\(operationName\);/);
  assert.match(source, /allowListedWriteRefused \? ' \(allow-listed field-value write failed its proof\)' : ''/);
});
