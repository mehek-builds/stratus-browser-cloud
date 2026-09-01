/* ASHBY KEEPS THE VALUES ON THE SERVER. Read from its public board bundle 2026-09-01: the submit
 * carries identifiers and a captcha token, never a field value; every value is persisted as it is
 * typed by ApiSetFormValue keyed on the same formRenderIdentifier. Aborting those writes non-fatally
 * would file a blank application under her name, so they are admitted during the fill, and only
 * they. These pin the exact shape admitted and the exact shapes refused. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  ASHBY_PUBLIC_BOARD_DRAFT_OPERATIONS,
  isAshbyPublicBoardDraftWrite,
  isGraphqlSingleMutationNamed,
} from '../src/managed-browser.js';

const SITE = 'ashbyhq.com';
const URL_ = 'https://jobs.ashbyhq.com/api/non-user-graphql';
const setFormValue = 'mutation ApiSetFormValue($organizationHostedJobsPageName: String!, $formRenderIdentifier: String!, $path: String!, $value: JSONString!, $formDefinitionIdentifier: String!) { setFormValue(organizationHostedJobsPageName: $organizationHostedJobsPageName, formRenderIdentifier: $formRenderIdentifier, path: $path, value: $value, formDefinitionIdentifier: $formDefinitionIdentifier) { ok } }';
const submit = 'mutation ApiSubmitSingleApplicationFormAction($organizationHostedJobsPageName: String!, $jobPostingId: String!, $formRenderIdentifier: String!, $formDefinitionIdentifier: String!, $actionIdentifier: String!, $recaptchaToken: String) { submitApplicationFormAction: submitSingleApplicationFormAction(organizationHostedJobsPageName: $organizationHostedJobsPageName) { ok } }';
const request = (over = {}) => ({
  applicationSite: SITE,
  method: 'POST',
  resourceType: 'fetch',
  url: URL_,
  postData: JSON.stringify({ operationName: 'ApiSetFormValue', query: setFormValue, variables: { organizationHostedJobsPageName: 'cartesia', formRenderIdentifier: 'abc', path: 'fields.0', value: '"Mehek"', formDefinitionIdentifier: 'def' } }),
  ...over,
});

test('the four draft operations are admitted, as a single named mutation on the one path', () => {
  assert.deepEqual([...ASHBY_PUBLIC_BOARD_DRAFT_OPERATIONS], ['ApiSetFormValue', 'ApiSetFormValueToFile', 'ApiAddManyFilesToFormValue', 'ApiRemoveFileFromFormValue']);
  assert.equal(Object.isFrozen(ASHBY_PUBLIC_BOARD_DRAFT_OPERATIONS), true);
  assert.equal(isAshbyPublicBoardDraftWrite(request()), true);
  assert.equal(isAshbyPublicBoardDraftWrite(request({ resourceType: 'xhr' })), true);
  const toFile = setFormValue.replace(/ApiSetFormValue/, 'ApiSetFormValueToFile');
  assert.equal(isAshbyPublicBoardDraftWrite(request({ postData: JSON.stringify({ operationName: 'ApiSetFormValueToFile', query: toFile, variables: { fileHandle: 'h' } }) })), true);
});

test('THE SUBMIT IS NEVER A DRAFT WRITE, nor anything shaped like one', () => {
  // The submit operation itself.
  assert.equal(isAshbyPublicBoardDraftWrite(request({ postData: JSON.stringify({ operationName: 'ApiSubmitSingleApplicationFormAction', query: submit, variables: { actionIdentifier: 'x' } }) })), false);
  // A draft name on a document that defines the submit, or two operations, or a query.
  assert.equal(isAshbyPublicBoardDraftWrite(request({ postData: JSON.stringify({ operationName: 'ApiSetFormValue', query: submit, variables: {} }) })), false);
  assert.equal(isAshbyPublicBoardDraftWrite(request({ postData: JSON.stringify({ operationName: 'ApiSetFormValue', query: setFormValue + '\n' + submit, variables: {} }) })), false);
  assert.equal(isAshbyPublicBoardDraftWrite(request({ postData: JSON.stringify({ operationName: 'ApiSetFormValue', query: setFormValue.replace('mutation', 'query'), variables: {} }) })), false);
  // The submit's own variables riding a draft name.
  assert.equal(isAshbyPublicBoardDraftWrite(request({ postData: JSON.stringify({ operationName: 'ApiSetFormValue', query: setFormValue, variables: { actionIdentifier: 'submit' } }) })), false);
  assert.equal(isAshbyPublicBoardDraftWrite(request({ postData: JSON.stringify({ operationName: 'ApiSetFormValue', query: setFormValue, variables: { recaptchaToken: 't' } }) })), false);
  // Wrong site, host, path, method, type, scheme, body.
  assert.equal(isAshbyPublicBoardDraftWrite(request({ applicationSite: 'greenhouse.io' })), false);
  assert.equal(isAshbyPublicBoardDraftWrite(request({ url: 'https://jobs.ashbyhq.com.evil.example/api/non-user-graphql' })), false);
  assert.equal(isAshbyPublicBoardDraftWrite(request({ url: 'https://jobs.ashbyhq.com/api/user-graphql' })), false);
  assert.equal(isAshbyPublicBoardDraftWrite(request({ url: 'http://jobs.ashbyhq.com/api/non-user-graphql' })), false);
  assert.equal(isAshbyPublicBoardDraftWrite(request({ method: 'PUT' })), false);
  assert.equal(isAshbyPublicBoardDraftWrite(request({ resourceType: 'websocket' })), false);
  assert.equal(isAshbyPublicBoardDraftWrite(request({ postData: 'not json' })), false);
  assert.equal(isAshbyPublicBoardDraftWrite(request({ postData: '[]' })), false);
  assert.equal(isAshbyPublicBoardDraftWrite({}), false);
});

test('a single named mutation is exactly that', () => {
  assert.equal(isGraphqlSingleMutationNamed(setFormValue, 'ApiSetFormValue'), true);
  assert.equal(isGraphqlSingleMutationNamed(setFormValue, 'ApiSetFormValueToFile'), false);
  assert.equal(isGraphqlSingleMutationNamed('mutation { setFormValue { ok } }', 'ApiSetFormValue'), false);
  assert.equal(isGraphqlSingleMutationNamed('query ApiSetFormValue { x }', 'ApiSetFormValue'), false);
  assert.equal(isGraphqlSingleMutationNamed('', 'ApiSetFormValue'), false);
});

test('the admission is consulted only in locked mode, after activation and initial navigation, and never blocks the block', () => {
  const source = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');
  assert.equal(source.split('ashbyPublicBoardDraftWrite(request)').length - 1, 1);
  assert.match(source, /if \(containment\.mode === 'locked' && ashbyPublicBoardDraftWrite\(request\)\) \{\s*\n\s*return route\.fallback\(\);/);
  // The activation and initial_navigation returns come first in the handler.
  const handler = source.slice(source.indexOf('containment.handler = async (route) => {'));
  assert.ok(handler.indexOf("containment.mode === 'activation'") < handler.indexOf('ashbyPublicBoardDraftWrite(request)'));
  assert.ok(handler.indexOf("containment.mode === 'initial_navigation'") < handler.indexOf('ashbyPublicBoardDraftWrite(request)'));
  // The read allowance still governs initial navigation alone; the draft one does not reach it.
  const initial = handler.slice(handler.indexOf("containment.mode === 'initial_navigation'"), handler.indexOf('allowedNavigationUrl'));
  assert.doesNotMatch(initial, /DraftWrite/);
});
