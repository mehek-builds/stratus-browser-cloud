import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* The runner ships to the sandbox as ONE String.raw template written to stratus-runner.cjs, so a
 * bare module identifier inside it parses, passes node -c on the module, matches every
 * source-contract regex, and still throws ReferenceError on the first real run. That exact shape
 * reached production on 2026-09-01 ("transportRegistrableSuffix is not defined" on every managed
 * run). Module definitions enter the string by interpolation only. */

test('the composed sandbox runner compiles as a script', () => {
  assert.doesNotThrow(() => new vm.Script(SANDBOX_RUNNER, { filename: 'stratus-runner.cjs' }));
});

test('the shared transport definitions are injected before their first use', () => {
  const injected = SANDBOX_RUNNER.indexOf('const transportRegistrableSuffix = (host) =>');
  const assigned = SANDBOX_RUNNER.indexOf('const registrableSuffix = transportRegistrableSuffix;');
  assert.ok(injected >= 0, 'transportRegistrableSuffix source is interpolated into the runner');
  assert.ok(assigned > injected, 'the alias reads the injected definition, not a module name');
  const ashby = SANDBOX_RUNNER.indexOf('const isAshbyPublicBoardRead = (');
  const ashbyUse = SANDBOX_RUNNER.indexOf('isAshbyPublicBoardRead({');
  assert.ok(ashby >= 0 && ashbyUse > ashby, 'isAshbyPublicBoardRead source precedes its call');
  const opName = SANDBOX_RUNNER.indexOf('const ashbyPublicBoardOperationName = (');
  const opUse = SANDBOX_RUNNER.indexOf('ashbyPublicBoardOperationName({');
  assert.ok(opName >= 0 && opUse > opName, 'ashbyPublicBoardOperationName source precedes its call');
  // And its regex dependency rides along as a literal, not a module name.
  assert.match(SANDBOX_RUNNER, /const GRAPHQL_OPERATION_DEFINITION = "/);
});
