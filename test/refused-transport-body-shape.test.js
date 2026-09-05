import test from 'node:test';
import assert from 'node:assert/strict';
import { refusedTransportBodyShape, SANDBOX_RUNNER } from '../src/managed-browser.js';

/* Measured 2026-09-04 23:31Z on Covenant House's Intern, Finance (application c24e48a2, run
 * 4a27b41b): the fill died on the one Teamtailor write #180 admits, and the violation sentence
 * could not say why the body proof refused it. These pin that the sentence now carries the body's
 * shape - and, mostly, that it carries no content. */

test('a refused JSON body is described by keys, types and lengths, never by values', () => {
  const shape = refusedTransportBodyShape(JSON.stringify({
    cookie_policy: { visitor_uuid: '', referrer: 'https://www.google.com/', categories: '' }
  }));
  assert.equal(shape, 'body=json{cookie_policy:{visitor_uuid:str0,referrer:str23,categories:str0}}');
  assert.ok(!shape.includes('google'), 'no value may reach the sentence');
  const candidate = refusedTransportBodyShape(JSON.stringify({
    candidate: { email: 'someone@example.com', first_name: 'Mehek', answers: [1, 2], consent: true, age: 21, nothing: null }
  }));
  assert.equal(candidate,
    'body=json{candidate:{email:str19,first_name:str5,answers:array2,consent:boolean,age:number,nothing:null}}');
  assert.ok(!candidate.includes('example.com') && !candidate.includes('Mehek'));
});

test('the sentence says when there was no body to prove, and when it was not JSON', () => {
  assert.equal(refusedTransportBodyShape(null), 'body=absent');
  assert.equal(refusedTransportBodyShape(undefined), 'body=absent');
  assert.equal(refusedTransportBodyShape(''), 'body=empty');
  assert.equal(refusedTransportBodyShape('a=1&b=2'), 'body=text7');
  assert.equal(refusedTransportBodyShape(Buffer.from('x')), 'body=object');
  assert.equal(refusedTransportBodyShape('[1,2,3]'), 'body=jsonarray3');
  assert.equal(refusedTransportBodyShape('"just a string"'), 'body=jsonstr13');
});

test('nesting stops at two levels, key lists are capped, and the sentence is bounded', () => {
  const deep = refusedTransportBodyShape(JSON.stringify({ a: { b: { c: { d: 1 } } } }));
  assert.equal(deep, 'body=json{a:{b:object}}');
  const wide = {};
  for (let i = 0; i < 20; i += 1) wide['k' + i] = i;
  const shape = refusedTransportBodyShape(JSON.stringify(wide));
  assert.ok(shape.endsWith(',+8}'), shape);
  const longKey = refusedTransportBodyShape(JSON.stringify({ ['x'.repeat(100)]: 'v' }));
  assert.equal(longKey, 'body=json{' + 'x'.repeat(40) + ':str1}');
  assert.ok(refusedTransportBodyShape(JSON.stringify({ ['y'.repeat(2000)]: 1 })).length <= 400);
});

test('the runner names the refused body shape beside a write-shaped employer-bound block, and only there', () => {
  const definition = SANDBOX_RUNNER.indexOf('const refusedTransportBodyShape = (');
  const use = SANDBOX_RUNNER.indexOf('refusedTransportBodyShape(request.postData())');
  assert.ok(definition >= 0, 'the helper is interpolated into the runner');
  assert.ok(use > definition, 'the helper is defined before the block that calls it');
  assert.match(SANDBOX_RUNNER, /const bodyShape = method === 'POST' \|\| method === 'PUT' \|\| method === 'PATCH'\s*\n\s*\? ' ' \+ refusedTransportBodyShape\(request\.postData\(\)\)\s*\n\s*: '';/);
  assert.match(SANDBOX_RUNNER, /containment\.blockedReason = reason \+ ': ' \+ method \+ target\s*\n\s*\+ \(operationName \? ' op=' \+ operationName : ''\)\s*\n\s*\+ \(allowListedWriteRefused \? ' \(allow-listed field-value write failed its proof\)' : ''\)\s*\n\s*\+ bodyShape;/);
  // The interpolated definition is an arrow function, so its name appears only on the const; the
  // one parenthesised mention is the call in block(). Diagnostics, never authorization.
  assert.equal((SANDBOX_RUNNER.match(/refusedTransportBodyShape\(/g) || []).length, 1,
    'exactly one call site, in block()');
  assert.equal((SANDBOX_RUNNER.match(/const refusedTransportBodyShape = \(/g) || []).length, 1);
});
