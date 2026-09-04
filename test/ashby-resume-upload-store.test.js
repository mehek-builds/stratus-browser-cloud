import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  graphqlLexicalSkeleton,
  graphqlSoleMutationRootField,
  graphqlValueContainsForbiddenKey,
  ASHBY_FORBIDDEN_VARIABLE_KEYS,
  ASHBY_FILE_BIND_WRITE_ROOT_FIELDS,
  ASHBY_FILE_BIND_WRITE_OPERATIONS,
  isAshbyFileBindWrite,
  ASHBY_FILE_UPLOAD_HANDLE_OPERATION,
  isAshbyFileUploadHandleRequest,
  ashbyOneShotUploadTargetFromUrl,
  ashbyOneShotUploadTargetMatches,
  findAshbyFileUploadHandleUrl,
  ASHBY_FORM_VALUE_WRITE_OPERATIONS,
  ASHBY_PUBLIC_BOARD_READ_OPERATIONS,
  isGraphqlSoleNamedMutation
} from '../src/managed-browser.js';

/* MEASURED 2026-09-04 on production (Exa "Software Engineer, Intern", jobs.ashbyhq.com, packet
 * 73768339-7fef-4493-aa75-1d47c61ae51f): the FILL run completed to ready_for_final_approval with
 * resume in filled_fields, but the preview screenshot shows Ashby's own toast "...Resume.pdf failed
 * to upload" and the dashboard's Review screen read "Resume NOT CONFIRMED". Ashby stores a file in
 * three calls - ApiCreateFileUploadHandle, an eager POST of the bytes to the presigned target that
 * call returns, then ApiSetFormValueToFile/ApiAddManyFilesToFormValue to bind it - and only the
 * first and third were ever employer-bound candidates for this containment. The second, the actual
 * bytes, had no admission at all and fell to ordinary (non-fatal, #169) third-party blocking, which
 * is why the run finished instead of dying and Ashby simply showed the toast. These tests pin the
 * fix: a one-shot admission for exactly the presigned target Ashby's own response names, and the
 * bind mutations admitted the same way ApiSetFormValue already is. The documents below are plausible
 * serializations following PR #143's fixture (test/fixtures/ashby-frontend-non-user-documents.json)
 * for the operation names and root fields, not captured traffic - this project never opens an
 * employer portal - so every assertion here is about the RULE, and the rule fails closed on
 * anything it cannot prove. */

const bindWrite = (operationName, over = {}) => {
  const spec = ASHBY_FILE_BIND_WRITE_ROOT_FIELDS[operationName];
  const rootField = spec.alias ? `${spec.alias}: ${spec.field}` : spec.field;
  return {
    applicationSite: 'ashbyhq.com',
    method: 'POST',
    resourceType: 'fetch',
    url: 'https://jobs.ashbyhq.com/api/non-user-graphql?op=' + operationName,
    postData: JSON.stringify({
      operationName,
      variables: { path: 'field_resume', fileHandle: { handle: 'h_123', fields: {} } },
      query: `mutation ${operationName}($input: ${operationName}Input!) {\n  ${rootField}(input: $input) {\n    id\n  }\n}`
    }),
    ...over
  };
};

const handleRequest = (over = {}) => ({
  applicationSite: 'ashbyhq.com',
  method: 'POST',
  resourceType: 'fetch',
  url: 'https://jobs.ashbyhq.com/api/non-user-graphql?op=' + ASHBY_FILE_UPLOAD_HANDLE_OPERATION,
  postData: JSON.stringify({
    operationName: ASHBY_FILE_UPLOAD_HANDLE_OPERATION,
    variables: { filename: 'resume.pdf', contentType: 'application/pdf', contentLength: 1024 },
    query: `mutation ${ASHBY_FILE_UPLOAD_HANDLE_OPERATION}($i: I!) {\n  createFileUploadHandle(input: $i) {\n    fileUploadHandle {\n      handle\n      url\n      fields\n    }\n  }\n}`
  }),
  ...over
});

test('graphqlLexicalSkeleton blanks strings and comments to the same length', () => {
  const skeleton = graphqlLexicalSkeleton('mutation M { x(s: "a{b}c") # a comment with { and }\n  y }');
  assert.equal(skeleton.length, 'mutation M { x(s: "a{b}c") # a comment with { and }\n  y }'.length);
  // The quoted braces and the commented ones must not be visible to a brace count.
  assert.equal((skeleton.match(/\{/g) || []).length, 1);
  assert.equal((skeleton.match(/\}/g) || []).length, 1);
  // A block string survives, including one holding an escaped triple-quote.
  assert.notEqual(graphqlLexicalSkeleton('mutation M { x(s: """a\nb {c}""") }'), null);
  assert.notEqual(graphqlLexicalSkeleton('mutation M { x(s: """esc \\""" more""") }'), null);
  // An unterminated string proves nothing, so the whole document is refused rather than partially
  // scanned - the same fail-closed premise isGraphqlReadDocument already holds elsewhere.
  assert.equal(graphqlLexicalSkeleton('mutation M { x(s: "unterminated) }'), null);
  assert.equal(graphqlLexicalSkeleton('mutation M { x(s: """unterminated) }'), null);
  assert.equal(graphqlLexicalSkeleton(42), null);
});

test('graphqlSoleMutationRootField reads the one field a server would actually run', () => {
  assert.deepEqual(
    graphqlSoleMutationRootField(
      'mutation ApiSetFormValueToFile($input: SetFormValueToFileInput!) {\n  setFormValueToFile(input: $input) {\n    id\n  }\n}',
      'ApiSetFormValueToFile'
    ),
    { alias: null, name: 'setFormValueToFile' }
  );
  assert.deepEqual(
    graphqlSoleMutationRootField(
      'mutation ApiAddManyFilesToFormValue($i: I!) { formRender: addManyFilesToFormValue(input: $i) { id } }',
      'ApiAddManyFilesToFormValue'
    ),
    { alias: 'formRender', name: 'addManyFilesToFormValue' }
  );
  // A field with neither arguments nor a nested selection set still reads cleanly.
  assert.deepEqual(graphqlSoleMutationRootField('mutation M { x }', 'M'), { alias: null, name: 'x' });
});

test('THE SIBLING-ROOT-FIELD SAFETY PROPERTY (PR #143 round-2 finding 1): a second root field beside the real one is refused, even though isGraphqlSoleNamedMutation alone would accept it', () => {
  const smuggled = 'mutation ApiSetFormValueToFile($i: I!) { setFormValueToFile(input: $i) { id } submitSingleApplicationFormAction(input: $j) { id } }';
  // isGraphqlSoleNamedMutation's proof - exactly one operation definition, that operation a mutation
  // named what the body claims - is satisfied by this document. It has to be: that is exactly the
  // gap graphqlSoleMutationRootField exists to close on top of it.
  assert.equal(isGraphqlSoleNamedMutation(smuggled, 'ApiSetFormValueToFile'), true);
  assert.equal(graphqlSoleMutationRootField(smuggled, 'ApiSetFormValueToFile'), null);
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', { postData: JSON.stringify({
    operationName: 'ApiSetFormValueToFile',
    query: smuggled
  }) })), false);
  // A fragment spread or an inline fragment as the sole content is refused the same way: neither is
  // the named field, and isGraphqlSoleNamedMutation's document-level proof does not see inside it.
  assert.equal(graphqlSoleMutationRootField('fragment F on V { id }\nmutation M { ...F }', 'M'), null);
  assert.equal(graphqlSoleMutationRootField('mutation M { ... on V { id } }', 'M'), null);
  // A directive on the root field is refused too, rather than silently ignored.
  assert.equal(graphqlSoleMutationRootField('mutation M { x @include(if: true) }', 'M'), null);
  // graphqlSoleMutationRootField itself is unopinionated - it reports whatever alias and name it
  // finds, aliased or not - so an unaliased or wrong-aliased addManyFilesToFormValue still reads
  // back cleanly here. Enforcing Ashby's own exact printed shape is isAshbyFileBindWrite's job, one
  // level up (spec.alias/spec.field), and that is what the two isAshbyFileBindWrite calls below pin.
  assert.deepEqual(
    graphqlSoleMutationRootField('mutation ApiAddManyFilesToFormValue($i: I!) { addManyFilesToFormValue(input: $i) { id } }', 'ApiAddManyFilesToFormValue'),
    { alias: null, name: 'addManyFilesToFormValue' }
  );
  assert.equal(
    graphqlSoleMutationRootField('mutation ApiAddManyFilesToFormValue($i: I!) { other: addManyFilesToFormValue(input: $i) { id } }', 'ApiAddManyFilesToFormValue')?.alias,
    'other'
  );
  // addManyFilesToFormValue MUST be printed under the formRender alias to be ADMITTED - never bare,
  // never under a different alias - which is where the alias actually gets enforced.
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiAddManyFilesToFormValue', { postData: JSON.stringify({
    operationName: 'ApiAddManyFilesToFormValue',
    query: 'mutation ApiAddManyFilesToFormValue($i: I!) { addManyFilesToFormValue(input: $i) { id } }'
  }) })), false, 'unaliased addManyFilesToFormValue must be refused');
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiAddManyFilesToFormValue', { postData: JSON.stringify({
    operationName: 'ApiAddManyFilesToFormValue',
    query: 'mutation ApiAddManyFilesToFormValue($i: I!) { other: addManyFilesToFormValue(input: $i) { id } }'
  }) })), false, 'wrong-aliased addManyFilesToFormValue must be refused');
  // And setFormValueToFile MUST be printed bare - an alias on it is refused too, since Ashby's own
  // bundle never prints one there.
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', { postData: JSON.stringify({
    operationName: 'ApiSetFormValueToFile',
    query: 'mutation ApiSetFormValueToFile($i: I!) { aliased: setFormValueToFile(input: $i) { id } }'
  }) })), false, 'aliased setFormValueToFile must be refused');
});

test('the file-bind write a live Ashby upload issues is allowed, for both operations', () => {
  for (const operationName of ASHBY_FILE_BIND_WRITE_OPERATIONS) {
    assert.equal(isAshbyFileBindWrite(bindWrite(operationName)), true, operationName);
  }
});

test('THE SAFETY PROPERTY: a submit cannot ride in on the file-bind allowance', () => {
  // 1. The real submit operation, whatever it is called, is not on the list.
  for (const operationName of [
    'ApiSubmitSingleApplicationFormAction', 'ApiSubmitApplication', 'SubmitApplication', 'ApiCreateFileUploadHandle'
  ]) {
    assert.equal(ASHBY_FILE_BIND_WRITE_OPERATIONS.includes(operationName), false, operationName);
    assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', {
      postData: JSON.stringify({ operationName, query: 'mutation ' + operationName + ' { submitSingleApplicationFormAction { id } }' })
    })), false, operationName);
  }
  // 2. The pinned name over a submit document is refused: the document must define the operation
  // the body claims AND that operation's sole root field must be the exact one this admits.
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', {
    postData: JSON.stringify({
      operationName: 'ApiSetFormValueToFile',
      query: 'mutation ApiSubmitSingleApplicationFormAction($i: I!) { submitSingleApplicationFormAction(input: $i) { id } }'
    })
  })), false);
  // 3. A submit riding alongside the pinned operation as a second definition in the document.
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', {
    postData: JSON.stringify({
      operationName: 'ApiSetFormValueToFile',
      query: 'mutation ApiSetFormValueToFile($i: I!) { setFormValueToFile(input: $i) { id } }\nmutation ApiSubmit { submitSingleApplicationFormAction { id } }'
    })
  })), false);
  // 4. An anonymous document, and an Automatic Persisted Query body with no document at all.
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', {
    postData: JSON.stringify({ operationName: 'ApiSetFormValueToFile', query: 'mutation { setFormValueToFile(input: $i) { id } }' })
  })), false);
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', {
    postData: JSON.stringify({ operationName: 'ApiSetFormValueToFile', extensions: { persistedQuery: { sha256Hash: 'deadbeef' } } })
  })), false);
  // 5. A batched array body is not a single provable write.
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', {
    postData: JSON.stringify([
      { operationName: 'ApiSetFormValueToFile', query: 'mutation ApiSetFormValueToFile { setFormValueToFile { id } }' },
      { operationName: 'ApiSubmit', query: 'mutation ApiSubmit { submitSingleApplicationFormAction { id } }' }
    ])
  })), false);
  // 6. Unparseable or absent bodies are not evidence of anything.
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', { postData: 'not-json' })), false);
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', { postData: null })), false);
  assert.equal(isAshbyFileBindWrite({}), false);
});

test('the file-bind allowance refuses actionIdentifier and recaptchaToken at any depth in variables, and any extensions key', () => {
  const withVariables = (variables) => isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', {
    postData: JSON.stringify({
      operationName: 'ApiSetFormValueToFile',
      variables,
      query: 'mutation ApiSetFormValueToFile($input: I!) { setFormValueToFile(input: $input) { id } }'
    })
  }));
  assert.equal(withVariables({ actionIdentifier: 'x' }), false);
  assert.equal(withVariables({ recaptchaToken: 'x' }), false);
  // Nested under input, exactly the shape #143's round-2 review measured the original two-key check
  // missed.
  assert.equal(withVariables({ input: { actionIdentifier: 'x' } }), false);
  assert.equal(withVariables({ input: { nested: { deeply: { recaptchaToken: 'x' } } } }), false);
  assert.equal(withVariables({ list: [{ actionIdentifier: 'x' }] }), false);
  // A non-object variables value is refused outright rather than skipped.
  assert.equal(withVariables('actionIdentifier'), false);
  assert.equal(withVariables(['actionIdentifier']), false);
  // An explicit `variables: null` is present (JSON.stringify keeps it, unlike undefined) and is not
  // a plain object either, so it is refused the same way.
  assert.equal(withVariables(null), false);
  // A legitimate-shaped variables object with neither key present is admitted.
  assert.equal(withVariables({ path: 'field_resume', fileHandle: { handle: 'h' } }), true);
  assert.equal(graphqlValueContainsForbiddenKey({ a: { b: { actionIdentifier: 1 } } }, ASHBY_FORBIDDEN_VARIABLE_KEYS), true);
  assert.equal(graphqlValueContainsForbiddenKey({ a: 'actionIdentifier' }, ASHBY_FORBIDDEN_VARIABLE_KEYS), false);
  assert.equal(graphqlValueContainsForbiddenKey('actionIdentifier', ASHBY_FORBIDDEN_VARIABLE_KEYS), false);
});

test('the file-bind allowance never widens the host, path, scheme, method or resource set', () => {
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', { applicationSite: 'greenhouse.io' })), false);
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', { applicationSite: null })), false);
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', {
    url: 'https://jobs.ashbyhq.com.evil.example/api/non-user-graphql'
  })), false);
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', {
    url: 'http://jobs.ashbyhq.com/api/non-user-graphql'
  })), false);
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', {
    url: 'https://jobs.ashbyhq.com/api/submit-application'
  })), false);
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', { method: 'PUT' })), false);
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', { method: 'GET' })), false);
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', { resourceType: 'document' })), false);
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', { resourceType: 'websocket' })), false);
});

test('the file-bind list, the field-value list, the read list and the upload-handle operation stay four separate things', () => {
  for (const operationName of ASHBY_FILE_BIND_WRITE_OPERATIONS) {
    assert.equal(ASHBY_FORM_VALUE_WRITE_OPERATIONS.includes(operationName), false, operationName);
    assert.equal(ASHBY_PUBLIC_BOARD_READ_OPERATIONS.includes(operationName), false, operationName);
  }
  assert.equal(ASHBY_FILE_BIND_WRITE_OPERATIONS.includes(ASHBY_FILE_UPLOAD_HANDLE_OPERATION), false);
  assert.equal(ASHBY_FORM_VALUE_WRITE_OPERATIONS.includes(ASHBY_FILE_UPLOAD_HANDLE_OPERATION), false);
  // ApiCreateFileUploadHandle is deliberately NOT admitted by isAshbyFileBindWrite - it stays gated
  // by the armed upload window's pre-existing employer-bound admission alone (see the mechanism
  // comment above isAshbyFileBindWrite), never by this predicate.
  assert.equal(isAshbyFileBindWrite(bindWrite('ApiSetFormValueToFile', {
    postData: JSON.stringify({
      operationName: ASHBY_FILE_UPLOAD_HANDLE_OPERATION,
      query: `mutation ${ASHBY_FILE_UPLOAD_HANDLE_OPERATION}($i: I!) { createFileUploadHandle(input: $i) { fileUploadHandle { url } } }`
    })
  })), false);
});

test('isAshbyFileUploadHandleRequest detects call 1 and only call 1, without deciding admission', () => {
  assert.equal(isAshbyFileUploadHandleRequest(handleRequest()), true);
  assert.equal(isAshbyFileUploadHandleRequest(handleRequest({ applicationSite: 'greenhouse.io' })), false);
  assert.equal(isAshbyFileUploadHandleRequest(handleRequest({ method: 'GET' })), false);
  assert.equal(isAshbyFileUploadHandleRequest(handleRequest({ resourceType: 'document' })), false);
  assert.equal(isAshbyFileUploadHandleRequest(handleRequest({
    url: 'http://jobs.ashbyhq.com/api/non-user-graphql'
  })), false);
  assert.equal(isAshbyFileUploadHandleRequest(handleRequest({
    postData: JSON.stringify({ operationName: 'ApiSetFormValueToFile', query: 'mutation ApiSetFormValueToFile { x }' })
  })), false);
  assert.equal(isAshbyFileUploadHandleRequest(handleRequest({ postData: 'not-json' })), false);
});

test('ashbyOneShotUploadTargetFromUrl requires https, refuses userinfo and a non-default explicit port', () => {
  assert.deepEqual(
    ashbyOneShotUploadTargetFromUrl('https://ashby-uploads-prod.s3.amazonaws.com/orgs/abc/handle?X-Amz-Signature=zzz&X-Amz-Expires=900'),
    { origin: 'https://ashby-uploads-prod.s3.amazonaws.com', pathname: '/orgs/abc/handle' }
  );
  assert.equal(ashbyOneShotUploadTargetFromUrl('http://ashby-uploads.example/abc'), null);
  assert.equal(ashbyOneShotUploadTargetFromUrl('https://user:pass@ashby-uploads.example/abc'), null);
  assert.equal(ashbyOneShotUploadTargetFromUrl('https://user@ashby-uploads.example/abc'), null);
  assert.equal(ashbyOneShotUploadTargetFromUrl('https://ashby-uploads.example:8443/abc'), null);
  // The default https port is indistinguishable from no port at all once parsed - same precedent
  // #143's host check already established for :443 on jobs.ashbyhq.com itself.
  assert.deepEqual(ashbyOneShotUploadTargetFromUrl('https://ashby-uploads.example:443/abc'), {
    origin: 'https://ashby-uploads.example', pathname: '/abc'
  });
  assert.equal(ashbyOneShotUploadTargetFromUrl('not a url'), null);
  assert.equal(ashbyOneShotUploadTargetFromUrl(''), null);
  assert.equal(ashbyOneShotUploadTargetFromUrl(null), null);
  assert.equal(ashbyOneShotUploadTargetFromUrl(undefined), null);
});

test('MUTATION-CHECK: ashbyOneShotUploadTargetMatches compares origin+pathname EXACTLY, never a prefix or a host pattern', () => {
  /* This is the test that has to fail if the one-shot admission is ever loosened from an exact
   * target into a pattern. A presigned upload host is otherwise indistinguishable from any other
   * third-party host this containment blocks, so "close enough" here is a hole an attacker-adjacent
   * page could walk a second request through. */
  const target = { origin: 'https://ashby-uploads-prod.s3.amazonaws.com', pathname: '/orgs/abc/handle-1' };
  assert.equal(ashbyOneShotUploadTargetMatches(target, 'https://ashby-uploads-prod.s3.amazonaws.com/orgs/abc/handle-1'), true);
  // The query string carries the presigned signature and must be ignored, not compared.
  assert.equal(ashbyOneShotUploadTargetMatches(target, 'https://ashby-uploads-prod.s3.amazonaws.com/orgs/abc/handle-1?X-Amz-Signature=different'), true);
  // A different path on the identical host - the exact shape a second, unrelated upload on the same
  // bucket would take - is refused. If the compare were loosened to a host-only or prefix match,
  // this line goes red.
  assert.equal(ashbyOneShotUploadTargetMatches(target, 'https://ashby-uploads-prod.s3.amazonaws.com/orgs/abc/handle-2'), false);
  assert.equal(ashbyOneShotUploadTargetMatches(target, 'https://ashby-uploads-prod.s3.amazonaws.com/orgs/abc/handle-1/extra'), false);
  assert.equal(ashbyOneShotUploadTargetMatches(target, 'https://ashby-uploads-prod.s3.amazonaws.com/orgs/'), false);
  // A different, look-alike host is refused - never a substring or suffix match.
  assert.equal(ashbyOneShotUploadTargetMatches(target, 'https://evil.example/orgs/abc/handle-1'), false);
  assert.equal(ashbyOneShotUploadTargetMatches(target, 'https://ashby-uploads-prod.s3.amazonaws.com.evil.example/orgs/abc/handle-1'), false);
  // No target recorded yet (the common case: no handle response has been captured this window).
  assert.equal(ashbyOneShotUploadTargetMatches(null, 'https://ashby-uploads-prod.s3.amazonaws.com/orgs/abc/handle-1'), false);
  assert.equal(ashbyOneShotUploadTargetMatches(undefined, 'https://ashby-uploads-prod.s3.amazonaws.com/orgs/abc/handle-1'), false);
  assert.equal(ashbyOneShotUploadTargetMatches(target, 'not a url'), false);
});

test('findAshbyFileUploadHandleUrl is a bounded, shape-tolerant search for fileUploadHandle.url', () => {
  assert.equal(findAshbyFileUploadHandleUrl({
    data: { createFileUploadHandle: { fileUploadHandle: { handle: 'h', url: 'https://target/x', fields: {} } } }
  }), 'https://target/x');
  // Whatever the enclosing root field happens to be named or aliased, the search still finds it -
  // this function does not decide admission, only whether a response gets read (see its comment).
  assert.equal(findAshbyFileUploadHandleUrl({
    data: { apiCreateFileUploadHandle: { fileUploadHandle: { url: 'https://target/y' } } }
  }), 'https://target/y');
  assert.equal(findAshbyFileUploadHandleUrl({ data: { errors: [{ message: 'nope' }] } }), null);
  assert.equal(findAshbyFileUploadHandleUrl({ fileUploadHandle: { url: 123 } }), null);
  assert.equal(findAshbyFileUploadHandleUrl({ fileUploadHandle: { url: '' } }), null);
  assert.equal(findAshbyFileUploadHandleUrl(null), null);
  assert.equal(findAshbyFileUploadHandleUrl('not an object'), null);
  // Bounded depth: a pathological or maliciously deep response cannot stall the search, and finds
  // nothing rather than throwing.
  let deep = { url: 'https://x/deep' };
  for (let i = 0; i < 20; i += 1) deep = { fileUploadHandle: deep };
  assert.equal(findAshbyFileUploadHandleUrl(deep), null);
});

/* THE CONTAINMENT WIRING. No browser launches in this environment (Playwright cannot start its
 * bundled chromium here - see managed-browser.test.js's own baseline note), so - consistent with
 * how containment-readonly-fetch.test.js and ashby-form-value-write.test.js already pin the rest of
 * this same handler - these assert against the shipped SOURCE rather than executing it. Each pin
 * names, in its own comment, the property it is standing in for. */

test('the file-handle response is captured ahead of the pre-existing employer-bound admission, not instead of it', () => {
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  const captureAt = source.indexOf('if (uploadWindowCandidate && ashbyFileUploadHandleRequest(request)) {');
  const pinnedAdmissionAt = source.indexOf(
    "if (containment.uploadActionArmed\n          && (method === 'POST' || method === 'PUT')\n          && (request.resourceType() === 'xhr' || request.resourceType() === 'fetch')\n          && (employerBoundTransport(request) || boardResumeStorageUpload(request))) {\n          return route.fallback();\n        }"
  );
  assert.ok(captureAt >= 0, 'the capture branch is present');
  // THE PRE-EXISTING #129 ADMISSION IS BYTE-FOR-BYTE UNCHANGED: same four-way condition, same
  // immediate route.fallback() body, exactly as containment-readonly-fetch.test.js already pins it.
  // This fix does not touch what call 1 (or any other employer-bound upload-window POST) is
  // admitted for; it only reads the response of the one request this ALSO catches first.
  assert.ok(pinnedAdmissionAt >= 0, 'the pre-existing employer-bound upload-window admission is unchanged');
  assert.ok(captureAt < pinnedAdmissionAt, 'the capture branch runs before the plain fallback, so call 1 is read and not merely passed through');
  assert.match(source, /const captureAshbyOneShotUploadTarget = async \(route\) => \{/);
  assert.match(source, /response = await route\.fetch\(\);/);
  assert.match(source, /const responseBody = await response\.json\(\);/);
  assert.match(source, /const handleUrl = findAshbyFileUploadHandleUrl\(responseBody\);/);
  assert.match(source, /if \(target\) containment\.ashbyOneShotUpload = target;/);
  // The captured response is forwarded to the page UNMODIFIED - no json/body override - so a parse
  // failure or an unexpected shape changes nothing about what Ashby's own client receives.
  assert.match(source, /return route\.fulfill\(\{ response \}\);/);
});

test('MUTATION-CHECK: the one-shot upload target is consumed the instant it is admitted, and admission is scoped to the armed window', () => {
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  assert.match(source,
    /if \(uploadWindowCandidate\s*\n\s*&& containment\.ashbyOneShotUpload\s*\n\s*&& ashbyOneShotUploadTargetMatches\(containment\.ashbyOneShotUpload, request\.url\(\)\)\) \{\s*\n\s*containment\.ashbyOneShotUpload = null;\s*\n\s*return route\.fallback\(\);/
  );
  // Consumption happens exactly once in the whole file. If a future edit removed the null-out (the
  // one-shot property itself), this count assertion is the thing that catches it: a SECOND POST to
  // the identical recorded target would then also match and also be admitted.
  const consumptions = source.match(/containment\.ashbyOneShotUpload = null/g) || [];
  assert.equal(consumptions.length, 1, 'the one-shot target is consumed from exactly one place: the match branch itself');
  // uploadWindowCandidate is computed once, from exactly containment.uploadActionArmed plus the same
  // POST/PUT xhr/fetch shape the pre-existing admission already requires - not a new, wider gate.
  assert.match(source,
    /const uploadWindowCandidate = containment\.uploadActionArmed\s*\n\s*&& \(method === 'POST' \|\| method === 'PUT'\)\s*\n\s*&& \(request\.resourceType\(\) === 'xhr' \|\| request\.resourceType\(\) === 'fetch'\);/
  );
});

test('the file-bind write is admitted in the same locked-fill gate as ApiSetFormValue, without altering that gate', () => {
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  // The pre-existing ApiSetFormValue gate, byte-for-byte unchanged - same pin
  // containment-readonly-fetch.test.js already holds it to.
  assert.match(source, /if \(!readOnlyDataFetch && !ashbyPublicBoardRead\(request\) && !ashbyFormValueWrite\(request\)\) \{\s*\n\s*return block\(route, request\.resourceType\(\) \+ ' transport'\);/);
  assert.equal(source.split('ashbyFormValueWrite(request)').length - 1, 1,
    'the field-value write allowance is still called from exactly one place');
  // The new admission sits ahead of it, in the same transportTypes branch, gated on nothing but the
  // document proof itself - not on containment.uploadActionArmed, because Ashby issues this call
  // after its own async upload settles, which can outlast the window a following fill disarms.
  assert.match(source, /if \(ashbyFileBindWrite\(request\)\) \{\s*\n\s*containment\.ashbyFileBindWriteAdmitted = true;\s*\n\s*return route\.fallback\(\);\s*\n\s*\}/);
  assert.equal(source.split('ashbyFileBindWrite(request)').length - 1, 1,
    'the file-bind write allowance is called from exactly one place');
});

test('the armed window resets both new pieces of state at every arm and every disarm', () => {
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  assert.match(source,
    /if \(action\.type === 'upload'\) \{\s*\n\s*managedMutationTransportContainment\.uploadActionArmed = true;[\s\S]*?\n\s*managedMutationTransportContainment\.ashbyOneShotUpload = null;\s*\n\s*managedMutationTransportContainment\.ashbyFileBindWriteAdmitted = false;/
  );
  assert.match(source,
    /\} else if \(!\['waitForSelector', 'extract', 'requireCapability', 'discover'\]\.includes\(action\.type\)\) \{\s*\n\s*managedMutationTransportContainment\.uploadActionArmed = false;\s*\n\s*managedMutationTransportContainment\.ashbyOneShotUpload = null;\s*\n\s*managedMutationTransportContainment\.ashbyFileBindWriteAdmitted = false;/
  );
  // Both reset sites, plus the containment object's own initial state, account for every assignment
  // to ashbyOneShotUpload other than the handler's own one-shot consumption already pinned above.
  const initialState = source.match(/ashbyOneShotUpload: null,/g) || [];
  assert.equal(initialState.length, 1, 'the containment object declares the initial state exactly once');
});

test('the Ashby upload settle wait is bounded, Ashby-only, and does not touch filled_fields or re-verify anything', () => {
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  // A no-op by default - every other board keeps today's behaviour: the upload action returns the
  // instant setInputFiles does.
  assert.match(source, /let waitForAshbyUploadSettle = async \(\) => \{\};/);
  // Only assigned a real implementation when the application page is on Ashby.
  assert.match(source, /if \(applicationTransportSite === ASHBY_PUBLIC_BOARD_SITE\) \{/);
  assert.match(source, /const ASHBY_UPLOAD_SETTLE_TIMEOUT_MS = 5000;/);
  assert.match(source, /const ASHBY_UPLOAD_SETTLE_POLL_MS = 150;/);
  // Exits early on either signal, and always bounded by the deadline either way.
  assert.match(source, /if \(containment\.ashbyFileBindWriteAdmitted\) return;/);
  assert.match(source, /const failureToastShown = await page\.evaluate\(\(\) => \{\s*\n\s*const toast = document\.querySelector\('\.ashby-application-form'\);\s*\n\s*return Boolean\(toast && \/failed to upload\/i\.test\(toast\.textContent \|\| ''\)\);/);
  assert.match(source, /if \(failureToastShown\) return;/);
  assert.match(source, /if \(Date\.now\(\) >= deadline\) return;/);
  // Called exactly once, from the 'upload' action's own handling, after setInputFiles and the
  // existing filled_fields bookkeeping - never before, never from any other action type.
  const calls = source.match(/await waitForAshbyUploadSettle\(\);/g) || [];
  assert.equal(calls.length, 1, 'the settle wait is invoked from exactly one place');
  assert.match(source, /if \(action\.label\) filledFields\.push\(action\.label\);\s*\n\s*\/\/ Ashby's own upload settles asynchronously[\s\S]{0,200}await waitForAshbyUploadSettle\(\);\s*\n\s*\}\s*\n\s*if \(action\.type === 'waitForSelector'\)/);
});

test('the sandbox runner carries every new definition rather than a bare module reference', () => {
  /* b816a61's lesson, 2026-09-01, restated by the existing Ashby write-allowance test: the runner is
   * one String.raw template evaluated in the sandbox, so a bare module identifier is a
   * ReferenceError on every managed run - source that parses, passes node --check, and matches every
   * source-contract regex. Each definition the fix needs must be interpolated INTO the template. */
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  for (const injected of [
    'const graphqlLexicalSkeleton = ${graphqlLexicalSkeleton.toString()};',
    'const graphqlSoleMutationRootField = ${graphqlSoleMutationRootField.toString()};',
    'const graphqlValueContainsForbiddenKey = ${graphqlValueContainsForbiddenKey.toString()};',
    'const ASHBY_FORBIDDEN_VARIABLE_KEYS = ${JSON.stringify(ASHBY_FORBIDDEN_VARIABLE_KEYS)};',
    'const ASHBY_FILE_BIND_WRITE_ROOT_FIELDS = ${JSON.stringify(ASHBY_FILE_BIND_WRITE_ROOT_FIELDS)};',
    'const isAshbyFileBindWrite = ${isAshbyFileBindWrite.toString()};',
    'const ASHBY_FILE_UPLOAD_HANDLE_OPERATION = ${JSON.stringify(ASHBY_FILE_UPLOAD_HANDLE_OPERATION)};',
    'const isAshbyFileUploadHandleRequest = ${isAshbyFileUploadHandleRequest.toString()};',
    'const ashbyOneShotUploadTargetFromUrl = ${ashbyOneShotUploadTargetFromUrl.toString()};',
    'const ashbyOneShotUploadTargetMatches = ${ashbyOneShotUploadTargetMatches.toString()};',
    'const findAshbyFileUploadHandleUrl = ${findAshbyFileUploadHandleUrl.toString()};'
  ]) {
    assert.ok(source.includes(injected), injected);
  }
});

test('every module export this fix adds is defined inside the composed runner (belt-and-suspenders alongside sandbox-runner-compiles.test.js)', async () => {
  const { SANDBOX_RUNNER } = await import('../src/managed-browser.js');
  const code = SANDBOX_RUNNER
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
  for (const name of [
    'graphqlLexicalSkeleton', 'graphqlSoleMutationRootField', 'graphqlValueContainsForbiddenKey',
    'ASHBY_FORBIDDEN_VARIABLE_KEYS', 'ASHBY_FILE_BIND_WRITE_ROOT_FIELDS', 'isAshbyFileBindWrite',
    'ASHBY_FILE_UPLOAD_HANDLE_OPERATION', 'isAshbyFileUploadHandleRequest',
    'ashbyOneShotUploadTargetFromUrl', 'ashbyOneShotUploadTargetMatches', 'findAshbyFileUploadHandleUrl'
  ]) {
    assert.ok(new RegExp('\\bconst ' + name + ' = ').test(code), name + ' has an in-string definition');
  }
});
