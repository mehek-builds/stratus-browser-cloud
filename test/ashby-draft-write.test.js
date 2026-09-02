/* ASHBY KEEPS THE VALUES ON THE SERVER. Read from its public board bundle 2026-09-01: the submit
 * carries identifiers and a captcha token, never a field value; every value is persisted as it is
 * typed by ApiSetFormValue keyed on the same formRenderIdentifier. Aborting those writes non-fatally
 * would file a blank application under her name, so they are admitted during the fill, and only
 * they. These pin the exact DOCUMENTS admitted (the ones Ashby prints, read from the bundle into
 * test/fixtures/ashby-frontend-non-user-documents.json) and the exact shapes refused, on the module
 * export and on the copy that ships inside the sandbox runner. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import {
  ASHBY_PUBLIC_BOARD_DRAFT_OPERATIONS,
  ASHBY_PUBLIC_BOARD_DRAFT_ROOT_FIELDS,
  ASHBY_PUBLIC_BOARD_HOST,
  SANDBOX_RUNNER,
  graphqlLexicalSkeleton,
  graphqlSingleMutationRootSelection,
  isAshbyPublicBoardDraftWrite,
  isGraphqlSingleMutationNamed,
} from '../src/managed-browser.js';

const SITE = 'ashbyhq.com';
const URL_ = 'https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiSetFormValue';
const FIXTURE = JSON.parse(fs.readFileSync(
  new URL('./fixtures/ashby-frontend-non-user-documents.json', import.meta.url), 'utf8',
));
const printed = (name) => FIXTURE.documents[name].printed;
const stripped = (name) => FIXTURE.documents[name].stripped;
const SET_FORM_VALUE = printed('ApiSetFormValue');
const SUBMIT = printed('ApiSubmitSingleApplicationFormAction');
const VARIABLES = {
  organizationHostedJobsPageName: 'cartesia',
  formRenderIdentifier: 'abc',
  path: 'fields.0',
  value: 'Mehek',
  formDefinitionIdentifier: 'def',
};
const body = (over = {}) => JSON.stringify({
  operationName: 'ApiSetFormValue', query: SET_FORM_VALUE, variables: VARIABLES, ...over,
});
const request = (over = {}) => ({
  applicationSite: SITE,
  applicationHostname: ASHBY_PUBLIC_BOARD_HOST,
  method: 'POST',
  resourceType: 'fetch',
  url: URL_,
  postData: body(),
  ...over,
});
/* Every verdict asserted on the module export is recorded, so the last test can replay the same
 * table through the copy extracted from the shipped runner. */
const RECORDED = [];
const verdict = (label, input, expected) => {
  RECORDED.push({ label, input, expected });
  assert.equal(isAshbyPublicBoardDraftWrite(input), expected, label);
};
const rotated = (document) => {
  const parts = document.split('\n\n');
  return [...parts.slice(1), parts[0]].join('\n\n');
};

test('the four draft operations are admitted exactly as Ashby prints them', () => {
  assert.deepEqual([...ASHBY_PUBLIC_BOARD_DRAFT_OPERATIONS], ['ApiSetFormValue', 'ApiSetFormValueToFile', 'ApiAddManyFilesToFormValue', 'ApiRemoveFileFromFormValue']);
  assert.equal(Object.isFrozen(ASHBY_PUBLIC_BOARD_DRAFT_OPERATIONS), true);
  assert.equal(Object.isFrozen(ASHBY_PUBLIC_BOARD_DRAFT_ROOT_FIELDS), true);
  assert.deepEqual(ASHBY_PUBLIC_BOARD_DRAFT_ROOT_FIELDS, {
    ApiSetFormValue: { alias: null, field: 'setFormValue' },
    ApiSetFormValueToFile: { alias: null, field: 'setFormValueToFile' },
    ApiAddManyFilesToFormValue: { alias: 'formRender', field: 'addManyFilesToFormValue' },
    ApiRemoveFileFromFormValue: { alias: 'formRender', field: 'removeFileFromFormValue' },
  });
  for (const operationName of ASHBY_PUBLIC_BOARD_DRAFT_OPERATIONS) {
    /* The bundle's document: operation first, then JSONBoxParts, FileParts, FormFieldEntryParts
     * and FormRenderParts, printed by graphql-js print() as Apollo's HttpLink sends it. */
    assert.deepEqual(FIXTURE.documents[operationName].definitions.slice(1), ['FragmentDefinition:JSONBoxParts', 'FragmentDefinition:FileParts', 'FragmentDefinition:FormFieldEntryParts', 'FragmentDefinition:FormRenderParts']);
    assert.match(printed(operationName), /^mutation \w+\(\$organizationHostedJobsPageName: String!, \$formRenderIdentifier: String!, \$path: String!, /);
    verdict(operationName + ' as printed', request({ postData: body({ operationName, query: printed(operationName) }) }), true);
    verdict(operationName + ' as xhr', request({ resourceType: 'xhr', postData: body({ operationName, query: printed(operationName) }) }), true);
    /* Serializations a client can adopt without its API changing; refusing any would be fatal. */
    verdict(operationName + ' with ignored characters stripped', request({ postData: body({ operationName, query: stripped(operationName) }) }), true);
    verdict(operationName + ' fragments first', request({ postData: body({ operationName, query: rotated(printed(operationName)) }) }), true);
    verdict(operationName + ' behind a leading comment', request({ postData: body({ operationName, query: '# @generated\n' + printed(operationName) }) }), true);
    verdict(operationName + ' without a variables key', request({ postData: JSON.stringify({ operationName, query: printed(operationName) }) }), true);
  }
  assert.equal(SET_FORM_VALUE.includes('$value: JSON,'), true, 'the real value variable is JSON, not JSONString');
  verdict('a string argument that quotes grammar is only a string', request({ postData: body({ query: 'mutation ApiSetFormValue { setFormValue(path: "} mutation Evil { submitSingleApplicationFormAction { ok } }") { ok } }' }) }), true);
});

test('THE SUBMIT IS NEVER A DRAFT WRITE: the document is pinned, not the name', () => {
  verdict('the submit under its own name', request({ postData: body({ operationName: 'ApiSubmitSingleApplicationFormAction', query: SUBMIT, variables: { actionIdentifier: 'x' } }) }), false);
  verdict('the submit document under a draft operationName', request({ postData: body({ query: SUBMIT }) }), false);
  verdict('the upload-handle mutation is not a draft write', request({ postData: body({ operationName: 'ApiCreateFileUploadHandle', query: printed('ApiCreateFileUploadHandle') }) }), false);
  // A1: a mutation NAMED ApiSetFormValue whose selection set is the submit.
  verdict('A1 draft name over the submit selection', request({ postData: body({ query: SUBMIT.replace('mutation ApiSubmitSingleApplicationFormAction(', 'mutation ApiSetFormValue(') }) }), false);
  verdict('A1 draft name over an inline-argument submit', request({ postData: body({ query: 'mutation ApiSetFormValue { submitSingleApplicationFormAction(organizationHostedJobsPageName: "cartesia", jobPostingId: "j", formRenderIdentifier: "r", formDefinitionIdentifier: "d", actionIdentifier: "submit", recaptchaToken: "tok") { ok } }', variables: {} }) }), false);
  // A2: the submit aliased so the response key reads setFormValue.
  verdict('A2 the submit behind a setFormValue alias', request({ postData: body({ query: 'mutation ApiSetFormValue($organizationHostedJobsPageName: String!, $formRenderIdentifier: String!) {\n  setFormValue: submitSingleApplicationFormAction(organizationHostedJobsPageName: $organizationHostedJobsPageName, formRenderIdentifier: $formRenderIdentifier, actionIdentifier: "submit", recaptchaToken: "tok") {\n    ok\n  }\n}' }) }), false);
  // A5: the real draft field and the submit as sibling root fields, executed serially.
  verdict('A5 the submit as a sibling root field', request({ postData: body({ query: SET_FORM_VALUE.replace('  setFormValue(', '  submitSingleApplicationFormAction(actionIdentifier: "submit", recaptchaToken: "t") { ok }\n  setFormValue(') }) }), false);
  verdict('A5 the submit as a trailing sibling root field', request({ postData: body({ query: SET_FORM_VALUE.replace('    ...FormRenderParts\n  }\n}', '    ...FormRenderParts\n  }\n  submitSingleApplicationFormAction(actionIdentifier: "submit") { ok }\n}') }) }), false);
  // A4: the submit's variables renamed and passed inline.
  verdict('A4 renamed variables feeding an inline submit', request({ postData: body({ query: 'mutation ApiSetFormValue($a: String!, $r: String!) { submitSingleApplicationFormAction(actionIdentifier: $a, recaptchaToken: $r) { ok } }', variables: { a: 'submit', r: 't' } }) }), false);
  // Fragments and directives at the root, which can change what executes.
  verdict('a fragment spread at the root', request({ postData: body({ query: SET_FORM_VALUE.replace('  setFormValue(', '  ...FormRenderParts\n  setFormValue(') }) }), false);
  verdict('an inline fragment at the root', request({ postData: body({ query: SET_FORM_VALUE.replace('  setFormValue(', '  ... on Mutation { submitSingleApplicationFormAction { ok } }\n  setFormValue(') }) }), false);
  verdict('a directive on the operation after its variables', request({ postData: body({ query: SET_FORM_VALUE.replace(') {\n  setFormValue(', ') @skip(if: false) {\n  setFormValue(') }) }), false);
  verdict('a directive on an operation without variables', request({ postData: body({ query: 'mutation ApiSetFormValue @skip(if: false) { setFormValue { ok } }' }) }), false);
  verdict('a directive on the root field', request({ postData: body({ query: SET_FORM_VALUE.replace('  ) {\n    ...FormRenderParts', '  ) @include(if: true) {\n    ...FormRenderParts') }) }), false);
  // The alias is part of the pin in both directions.
  verdict('setFormValue under an alias Ashby does not print', request({ postData: body({ query: SET_FORM_VALUE.replace('  setFormValue(', '  formRender: setFormValue(') }) }), false);
  verdict('addManyFilesToFormValue without the alias Ashby prints', request({ postData: body({ operationName: 'ApiAddManyFilesToFormValue', query: printed('ApiAddManyFilesToFormValue').replace('formRender: addManyFilesToFormValue(', 'addManyFilesToFormValue(') }) }), false);
  verdict('addManyFilesToFormValue under a different alias', request({ postData: body({ operationName: 'ApiAddManyFilesToFormValue', query: printed('ApiAddManyFilesToFormValue').replace('formRender: addManyFilesToFormValue(', 'data: addManyFilesToFormValue(') }) }), false);
  verdict('the wrong draft field for the operation name', request({ postData: body({ operationName: 'ApiSetFormValueToFile', query: SET_FORM_VALUE.replace('mutation ApiSetFormValue(', 'mutation ApiSetFormValueToFile(') }) }), false);
  // Shapes with no document to pin.
  verdict('an empty selection set', request({ postData: body({ query: 'mutation ApiSetFormValue { }' }) }), false);
  verdict('a comment hiding the real root field', request({ postData: body({ query: 'mutation ApiSetFormValue {\n  # setFormValue\n  submitSingleApplicationFormAction(actionIdentifier: "s") { ok }\n}' }) }), false);
  verdict('an anonymous mutation', request({ postData: body({ query: 'mutation { setFormValue { ok } }' }) }), false);
  verdict('a query under a draft name', request({ postData: body({ query: SET_FORM_VALUE.replace('mutation', 'query') }) }), false);
  verdict('an unterminated string', request({ postData: body({ query: 'mutation ApiSetFormValue { setFormValue(path: "x) { ok } }' }) }), false);
  verdict('a bracket that never closes', request({ postData: body({ query: 'mutation ApiSetFormValue { setFormValue(path: "x") { ok }' }) }), false);
  verdict('no query at all', request({ postData: JSON.stringify({ operationName: 'ApiSetFormValue', variables: {} }) }), false);
});

test('a second operation is counted whatever separates it, including a comma', () => {
  // B1: a GraphQL insignificant comma between two operations.
  assert.equal(isGraphqlSingleMutationNamed(SET_FORM_VALUE + ',' + SUBMIT, 'ApiSetFormValue'), false);
  verdict('B1 a comma-joined second operation', request({ postData: body({ query: SET_FORM_VALUE + ',' + SUBMIT }) }), false);
  verdict('a newline-joined second operation', request({ postData: body({ query: SET_FORM_VALUE + '\n' + SUBMIT }) }), false);
  verdict('a brace-joined second operation', request({ postData: body({ query: SET_FORM_VALUE + SUBMIT }) }), false);
  verdict('a comment-joined second operation', request({ postData: body({ query: SET_FORM_VALUE + ' # x\n' + SUBMIT }) }), false);
  assert.equal(isGraphqlSingleMutationNamed(SET_FORM_VALUE, 'ApiSetFormValue'), true);
  assert.equal(isGraphqlSingleMutationNamed(SET_FORM_VALUE, 'ApiSetFormValueToFile'), false);
  assert.equal(isGraphqlSingleMutationNamed('mutation { setFormValue { ok } }', 'ApiSetFormValue'), false);
  assert.equal(isGraphqlSingleMutationNamed('query ApiSetFormValue { x }', 'ApiSetFormValue'), false);
  assert.equal(isGraphqlSingleMutationNamed('', 'ApiSetFormValue'), false);
  assert.equal(isGraphqlSingleMutationNamed(SET_FORM_VALUE, ''), false);
});

test('variables fail closed', () => {
  verdict('the real variables', request(), true);
  verdict('a value that merely contains a submit variable name', request({ postData: body({ variables: { ...VARIABLES, path: 'fields.actionIdentifier' } }) }), true);
  verdict('actionIdentifier at the top', request({ postData: body({ variables: { ...VARIABLES, actionIdentifier: 'submit' } }) }), false);
  verdict('recaptchaToken at the top', request({ postData: body({ variables: { ...VARIABLES, recaptchaToken: 't' } }) }), false);
  // A3: nested.
  verdict('A3 actionIdentifier nested in an input object', request({ postData: body({ variables: { input: { actionIdentifier: 'submit', recaptchaToken: 't' } } }) }), false);
  verdict('recaptchaToken nested inside an array', request({ postData: body({ variables: { files: [{ recaptchaToken: 't' }] } }) }), false);
  verdict('actionIdentifier three levels down', request({ postData: body({ variables: { a: { b: { c: { actionIdentifier: 's' } } } } }) }), false);
  // E1 and E2: not a plain object.
  verdict('E1 variables as an array', request({ postData: body({ variables: [{ actionIdentifier: 's' }] }) }), false);
  verdict('E2 variables as a JSON string', request({ postData: body({ variables: JSON.stringify(VARIABLES) }) }), false);
  verdict('variables null', request({ postData: body({ variables: null }) }), false);
  verdict('variables a number', request({ postData: body({ variables: 1 }) }), false);
});

test('a body carrying extensions is refused', () => {
  // C2: an Automatic Persisted Query envelope that also carries the draft document.
  verdict('C2 a persisted-query envelope with the draft document', request({ postData: body({ extensions: { persistedQuery: { version: 1, sha256Hash: 'abc' } } }) }), false);
  verdict('an empty extensions object', request({ postData: body({ extensions: {} }) }), false);
  // C1: the hash alone.
  verdict('C1 a hash-only body', request({ postData: JSON.stringify({ operationName: 'ApiSetFormValue', variables: {}, extensions: { persistedQuery: { version: 1, sha256Hash: 'abc' } } }) }), false);
});

test('the host is pinned to the board, not to a suffix', () => {
  verdict('the public board host', request({ url: 'https://jobs.ashbyhq.com/api/non-user-graphql' }), true);
  verdict('the public board host in capitals', request({ url: 'https://JOBS.ashbyhq.com/api/non-user-graphql' }), true);
  verdict('the default https port is the same origin', request({ url: 'https://jobs.ashbyhq.com:443/api/non-user-graphql' }), true);
  verdict('F1 another ashbyhq.com label', request({ url: 'https://evil.ashbyhq.com/api/non-user-graphql' }), false);
  verdict('F2 app.ashbyhq.com', request({ url: 'https://app.ashbyhq.com/api/non-user-graphql' }), false);
  verdict('F3 the apex', request({ url: 'https://ashbyhq.com/api/non-user-graphql' }), false);
  verdict('F4 a trailing-dot FQDN', request({ url: 'https://jobs.ashbyhq.com./api/non-user-graphql' }), false);
  verdict('F5 userinfo', request({ url: 'https://me@jobs.ashbyhq.com/api/non-user-graphql' }), false);
  verdict('F5 a password', request({ url: 'https://me:pw@jobs.ashbyhq.com/api/non-user-graphql' }), false);
  verdict('F10 an explicit port', request({ url: 'https://jobs.ashbyhq.com:8443/api/non-user-graphql' }), false);
  verdict('F11 a suffix spoof', request({ url: 'https://jobs.ashbyhq.com.evil.example/api/non-user-graphql' }), false);
  // The application page's own host is the other admitted host, and only on ashbyhq.com.
  verdict('the page\'s own ashbyhq.com host', request({ applicationHostname: 'acme.ashbyhq.com', url: 'https://acme.ashbyhq.com/api/non-user-graphql' }), true);
  verdict('the public board host from a page on another ashbyhq.com host', request({ applicationHostname: 'acme.ashbyhq.com' }), true);
  verdict('a third ashbyhq.com host from a page on another', request({ applicationHostname: 'acme.ashbyhq.com', url: 'https://evil.ashbyhq.com/api/non-user-graphql' }), false);
  verdict('the page host when it is off ashbyhq.com', request({ applicationHostname: 'evil.example', url: 'https://evil.example/api/non-user-graphql' }), false);
  verdict('no page hostname, the public board host', request({ applicationHostname: null }), true);
  verdict('no page hostname, another ashbyhq.com host', request({ applicationHostname: null, url: 'https://app.ashbyhq.com/api/non-user-graphql' }), false);
  verdict('an empty page hostname does not match an empty host', request({ applicationHostname: '', url: 'https://app.ashbyhq.com/api/non-user-graphql' }), false);
  // Wrong site, path, method, type, scheme, body.
  verdict('another application site', request({ applicationSite: 'greenhouse.io' }), false);
  verdict('the user graphql path', request({ url: 'https://jobs.ashbyhq.com/api/user-graphql' }), false);
  verdict('plain http', request({ url: 'http://jobs.ashbyhq.com/api/non-user-graphql' }), false);
  verdict('PUT', request({ method: 'PUT' }), false);
  verdict('a websocket', request({ resourceType: 'websocket' }), false);
  verdict('not json', request({ postData: 'not json' }), false);
  verdict('a batched array body', request({ postData: '[' + body() + ']' }), false);
  verdict('an empty input', {}, false);
});

test('the lexical skeleton and the root selection read the document Ashby sends', () => {
  const skeleton = graphqlLexicalSkeleton('mutation M { f(a: "x } y", b: """block "" \\""" end""") { g } } # tail');
  assert.equal(skeleton.length, 'mutation M { f(a: "x } y", b: """block "" \\""" end""") { g } } # tail'.length);
  assert.equal(skeleton, 'mutation M { f(a: "     ", b: """                 """) { g } }       ');
  assert.equal(graphqlLexicalSkeleton('mutation M { f(a: "x'), null);
  assert.equal(graphqlLexicalSkeleton('mutation M { f(a: "x\n") }'), null);
  assert.equal(graphqlLexicalSkeleton('mutation M { f(a: """x') , null);
  assert.equal(graphqlLexicalSkeleton(''), null);
  assert.equal(graphqlLexicalSkeleton(undefined), null);
  assert.deepEqual(graphqlSingleMutationRootSelection(SET_FORM_VALUE, 'ApiSetFormValue'), { alias: null, field: 'setFormValue' });
  assert.deepEqual(graphqlSingleMutationRootSelection(printed('ApiAddManyFilesToFormValue'), 'ApiAddManyFilesToFormValue'), { alias: 'formRender', field: 'addManyFilesToFormValue' });
  assert.deepEqual(graphqlSingleMutationRootSelection(printed('ApiRemoveFileFromFormValue'), 'ApiRemoveFileFromFormValue'), { alias: 'formRender', field: 'removeFileFromFormValue' });
  assert.deepEqual(graphqlSingleMutationRootSelection(SUBMIT, 'ApiSubmitSingleApplicationFormAction'), { alias: 'submitApplicationFormAction', field: 'submitSingleApplicationFormAction' });
  assert.deepEqual(graphqlSingleMutationRootSelection('mutation M{a:b{c}}', 'M'), { alias: 'a', field: 'b' });
  assert.deepEqual(graphqlSingleMutationRootSelection('mutation M{b}', 'M'), { alias: null, field: 'b' });
  assert.equal(graphqlSingleMutationRootSelection('mutation M{a b}', 'M'), null);
  assert.equal(graphqlSingleMutationRootSelection('mutation M{a:b:c}', 'M'), null);
  assert.equal(graphqlSingleMutationRootSelection('mutation M{...F}', 'M'), null);
  assert.equal(graphqlSingleMutationRootSelection('mutation M{b @d}', 'M'), null);
  assert.equal(graphqlSingleMutationRootSelection('mutation M($a: Int = 1) @d {b}', 'M'), null);
  assert.deepEqual(graphqlSingleMutationRootSelection('mutation M($a: Int = 1) {b}', 'M'), { alias: null, field: 'b' });
  assert.deepEqual(graphqlSingleMutationRootSelection('mutation M($a: String = "){ evil }") {b}', 'M'), { alias: null, field: 'b' });
  assert.equal(graphqlSingleMutationRootSelection(SET_FORM_VALUE, 'Other'), null);
});

/* THE COPY THAT SHIPS. The runner is one String.raw template; the module export is never what runs
 * in the sandbox. Extract the predicate chain from the runner text and replay every verdict above
 * through it, so a dropped interpolation (the 2026-09-01 ReferenceError class) or a drifted copy
 * turns a named test red instead of surfacing on the first live ApiSetFormValue. */
function runnerDeclarationOf(name) {
  const start = SANDBOX_RUNNER.indexOf('const ' + name + ' = ');
  assert.notEqual(start, -1, name + ' must be interpolated into the runner');
  let depth = 0;
  let quote = null;
  for (let i = start; i < SANDBOX_RUNNER.length; i += 1) {
    const ch = SANDBOX_RUNNER[i];
    if (quote) {
      if (ch === '\\') i += 1;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '\'' || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(' || ch === '[' || ch === '{') depth += 1;
    else if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
    else if (ch === ';' && depth === 0) return SANDBOX_RUNNER.slice(start, i + 1);
  }
  throw new Error('could not find the end of ' + name);
}
const RUNNER_CHAIN = [
  'GRAPHQL_OPERATION_DEFINITION_NAMED',
  'ASHBY_PUBLIC_BOARD_SITE',
  'ASHBY_PUBLIC_BOARD_GRAPHQL_PATH',
  'ASHBY_PUBLIC_BOARD_HOST',
  'ASHBY_PUBLIC_BOARD_DRAFT_ROOT_FIELDS',
  'ASHBY_PUBLIC_BOARD_DRAFT_OPERATIONS',
  'transportRegistrableSuffix',
  'graphqlLexicalSkeleton',
  'isGraphqlSingleMutationNamed',
  'graphqlSingleMutationRootSelection',
  'isAshbyPublicBoardDraftWrite',
];

test('the copy inside the sandbox runner returns the same verdict on every case', () => {
  assert.ok(RECORDED.length > 80, 'the table above was recorded');
  const runner = vm.runInNewContext(
    RUNNER_CHAIN.map(runnerDeclarationOf).join('\n')
      + '\n({ isAshbyPublicBoardDraftWrite, graphqlSingleMutationRootSelection, isGraphqlSingleMutationNamed });',
    { URL },
  );
  for (const { label, input, expected } of RECORDED) {
    assert.equal(runner.isAshbyPublicBoardDraftWrite(input), expected, 'runner copy: ' + label);
  }
  /* Spread across the realm boundary: the vm returns objects whose prototype is the other realm's,
   * which deepStrictEqual refuses on identity alone. */
  assert.deepEqual({ ...runner.graphqlSingleMutationRootSelection(SET_FORM_VALUE, 'ApiSetFormValue') }, { alias: null, field: 'setFormValue' });
  assert.equal(runner.isGraphqlSingleMutationNamed(SET_FORM_VALUE + ',' + SUBMIT, 'ApiSetFormValue'), false);
  // Each definition precedes the one that reads it, and all precede the handler's call.
  const at = (text) => {
    const index = SANDBOX_RUNNER.indexOf(text);
    assert.notEqual(index, -1, text);
    return index;
  };
  /* Every name the extracted chain needs is interpolated exactly once, so runnerDeclarationOf
   * above cannot have picked up a second, drifted copy. */
  for (const name of RUNNER_CHAIN) {
    assert.equal(SANDBOX_RUNNER.split('const ' + name + ' = ').length - 1, 1, name);
  }
  assert.ok(at('const graphqlLexicalSkeleton = ') < at('const isGraphqlSingleMutationNamed = '));
  assert.ok(at('const isGraphqlSingleMutationNamed = ') < at('const graphqlSingleMutationRootSelection = '));
  assert.ok(at('const graphqlSingleMutationRootSelection = ') < at('const isAshbyPublicBoardDraftWrite = '));
  assert.ok(at('const isAshbyPublicBoardDraftWrite = ') < at('ashbyPublicBoardDraftWrite(request)'));
  assert.match(SANDBOX_RUNNER, /const GRAPHQL_OPERATION_DEFINITION_NAMED = "/);
  assert.match(SANDBOX_RUNNER, /const ASHBY_PUBLIC_BOARD_DRAFT_ROOT_FIELDS = \{"ApiSetFormValue":\{"alias":null,"field":"setFormValue"\}/);
});

test('the admission is consulted only in locked mode while armed, after activation and initial navigation, and never blocks the block', () => {
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  assert.equal(source.split('ashbyPublicBoardDraftWrite(request)').length - 1, 1);
  assert.match(source, /if \(containment\.mode === 'locked' && containment\.draftWritesArmed\s*\n\s*&& ashbyPublicBoardDraftWrite\(request\)\) \{\s*\n\s*return route\.fallback\(\);/);
  /* Three handlers are assigned `containment.handler = async (route) => {` in this file. The one
   * that carries the allowance is found by the allowance's own comment and sliced back to its
   * opening, so an earlier handler can never satisfy these assertions on the wrong code. */
  const anchor = source.indexOf("/* ASHBY'S DRAFT WRITES CARRY THE VALUES");
  assert.notEqual(anchor, -1);
  const opening = source.lastIndexOf('containment.handler = async (route) => {', anchor);
  const closing = source.indexOf('managedMutationTransportContainment = containment;', anchor);
  assert.ok(opening !== -1 && closing !== -1 && opening < anchor && anchor < closing);
  const handler = source.slice(opening, closing);
  assert.equal(handler.split('containment.handler = async (route) => {').length - 1, 1);
  const use = handler.indexOf('ashbyPublicBoardDraftWrite(request)');
  assert.ok(handler.indexOf("containment.mode === 'activation'") < use);
  assert.ok(handler.indexOf("containment.mode === 'initial_navigation'") < use);
  assert.ok(handler.indexOf('containment.uploadActionArmed') < use);
  assert.ok(use < handler.indexOf('transportTypes.has(request.resourceType())'));
  // The read allowance still governs initial navigation alone; the draft one does not reach it.
  const initial = handler.slice(handler.indexOf("containment.mode === 'initial_navigation'"), handler.indexOf('allowedNavigationUrl'));
  assert.doesNotMatch(initial, /DraftWrite/);
  // The v4 containment carries no draft allowance: it admits no Ashby read either, so no Ashby
  // form renders under it and no draft write can arise there.
  const v4Opening = source.indexOf('containment.handler = async (route) => {', closing);
  const v4Closing = source.indexOf('v4PreSubmitTransportContainment = containment;', v4Opening);
  assert.ok(v4Opening !== -1 && v4Closing > v4Opening);
  assert.doesNotMatch(source.slice(v4Opening, v4Closing), /DraftWrite|ashbyPublicBoardRead/);
});

test('draftWritesArmed opens on the first non-final mutation action and closes with the final authority', () => {
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  assert.match(source, /uploadActionArmed: false,\s*\n\s*draftWritesArmed: false,\s*\n\s*handler: null/);
  /* The arming needs all three clauses. Without the mode clause an action after the final press
   * could rearm the flag, which is finding 6 of the round-1 review. */
  assert.match(source, /if \(managedMutationTransportContainment\.mode === 'locked'\s*\n\s*&& !hasExactFinalActionAuthority\(currentInput, action\)\s*\n\s*&& !\['waitForSelector', 'extract', 'requireCapability', 'discover'\]\.includes\(action\.type\)\) \{\s*\n\s*managedMutationTransportContainment\.draftWritesArmed = true;/);
  assert.match(source, /managedMutationTransportContainment\.allowedNavigationUrl = null;\s*\n\s*managedMutationTransportContainment\.draftWritesArmed = false;\s*\n\s*managedMutationTransportContainment\.mode = 'activation';/);
  assert.match(source, /managedMutationTransportContainment\.mode = 'locked';\s*\n\s*managedMutationTransportContainment\.draftWritesArmed = false;\s*\n\s*managedMutationTransportContainment\.allowedNavigationUrl = null;/);
  assert.equal(source.split('.draftWritesArmed = true;').length - 1, 1);
  assert.equal(source.split('.draftWritesArmed = false;').length - 1, 2);
  // The arming sits inside the per-action loop, after the upload window's own arming.
  const arm = source.indexOf('.draftWritesArmed = true;');
  const uploadArm = source.indexOf('.uploadActionArmed = true;');
  const loop = source.lastIndexOf('for (const action of currentInput.actions || []) {', arm);
  assert.ok(loop !== -1 && loop < uploadArm && uploadArm < arm);
});
