import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import * as managedBrowser from '../src/managed-browser.js';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* The runner ships to the sandbox as ONE String.raw template written to stratus-runner.cjs, so a
 * bare module identifier inside it parses, passes node -c on the module, matches every
 * source-contract regex, and still throws ReferenceError on the first real run. That exact shape
 * reached production on 2026-09-01 ("transportRegistrableSuffix is not defined" on every managed
 * run). Module definitions enter the string by interpolation only. */

/* STRING-LITERAL-AWARE comment stripper for the "every module export..." guard below.
 *
 * The naive version this replaced (`.replace(/\/\*[\s\S]*?\*\//g, ' ')`) scanned for the two
 * characters '/*' ANYWHERE in the text, with no notion of "inside a string literal". The glob
 * `browserContext.routeWebSocket('**\/*', ...)` (two call sites: the managed containment install
 * and the v4 one) spells its own string argument '**\/*', which CONTAINS '/*' as ordinary string
 * content, so either call site can open a fake block comment under that scan. Measured: the FIRST
 * site's fake open happens to be closed almost immediately by the next REAL comment's own '*\/' a
 * few lines later, but the SECOND site's fake open finds no nearby '*\/' to close it against and
 * does not resolve until an unrelated real comment over 40KB further into the file. Every const
 * definition and every reference in that 40KB span vanished from the scan, exactly the blind spot
 * #128 and #131 (named in the guard below) already proved is fatal: a bare reference inside it
 * would parse, pass this guard, and throw ReferenceError on the runner's first real run.
 *
 * This walks the text one token at a time instead of pattern-matching blindly: single- and
 * double-quoted string literals (with backslash escapes honoured) are copied through verbatim
 * without their contents ever being interpreted as comment syntax, exactly like a real tokenizer
 * would, and only '//'/'/-*' seen OUTSIDE a string are treated as comment starts. (The runner has
 * no backtick template literals - confirmed by scanning SANDBOX_RUNNER - so backtick handling is
 * not needed here.) String contents still pass through into the returned text unstripped, same as
 * before: a name mentioned only inside a string can still over-report as "referenced", which the
 * guard's own comment already accepts as the safe direction. */
function stripRunnerComments(source) {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i];
    const next = i + 1 < n ? source[i + 1] : '';
    if (ch === '/' && next === '/') {
      let j = i + 2;
      while (j < n && source[j] !== '\n') j += 1;
      out += ' ';
      i = j;
      continue;
    }
    if (ch === '/' && next === '*') {
      let j = i + 2;
      while (j < n && !(source[j] === '*' && source[j + 1] === '/')) j += 1;
      out += ' ';
      i = Math.min(j + 2, n);
      continue;
    }
    if (ch === "'" || ch === '"') {
      const quote = ch;
      let j = i + 1;
      out += ch;
      while (j < n) {
        const c = source[j];
        out += c;
        if (c === '\\' && j + 1 < n) {
          out += source[j + 1];
          j += 2;
          continue;
        }
        j += 1;
        if (c === quote || c === '\n') break;
      }
      i = j;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

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

test('every module export the runner references is defined inside the runner first', () => {
  /* The general guard for this class. #128 shipped a bare module reference and threw
   * ReferenceError on every run; #131 shipped another one INSIDE employerBoundTransport's try,
   * where the catch converted it to fail-closed and every third-party beacon silently became
   * run-fatal again. Any exported name the runner mentions must have an in-string const
   * definition before its first mention. */
  /* Comment prose may name an export without using it, so the scan looks at CODE mentions only:
   * the runner with line comments and block comments stripped, in a way that cannot itself be
   * fooled by a string literal that merely looks like a comment delimiter (see
   * stripRunnerComments above - #167/#168's own '**\/*' glob is exactly that shape). String
   * literals stay in, which can only over-report, never under-report. */
  const code = stripRunnerComments(SANDBOX_RUNNER);
  const names = Object.keys(managedBrowser).filter((name) => name !== 'SANDBOX_RUNNER');
  const missing = [];
  for (const name of names) {
    if (!new RegExp('\\b' + name + '\\b').test(code)) continue;
    if (code.indexOf('const ' + name + ' = ') < 0) missing.push(name);
  }
  assert.deepEqual(missing, [], 'runner references these module exports without an in-string definition');
});

test('the export scan is not blinded by a string literal shaped like a comment opener', () => {
  /* Reproduces the actual #167/#168 shape rather than a synthetic stand-in, and locates it by
   * measurement rather than assumption. There are two live `routeWebSocket('**\/*', ...)` glob
   * sites (the managed containment install, then the v4 one); EACH one's own string argument
   * contains '/*' as ordinary content, so each is capable of opening a fake block comment under
   * the naive '/\*[\s\S]*?\*\/' scan. They do not fail the same way: the FIRST one's fake open
   * happens to be closed almost immediately by the next REAL comment's own '*\/' a few lines later
   * (self-healing by accident), but the SECOND one's fake open is not closed by anything nearby -
   * measured against the naive scan, the next literal '*\/' it finds is over 40KB further into the
   * file. That second span, not the gap between the two glob sites, is where a bare reference
   * would have vanished from the guard entirely. This test finds that real boundary the same way
   * the naive stripper would have (search for '/*', then the next '*\/'), so it tracks wherever
   * the actual blind spot falls rather than assuming today's file offsets. */
  const secondGlob = SANDBOX_RUNNER.indexOf(
    "routeWebSocket('**/*'",
    SANDBOX_RUNNER.indexOf("routeWebSocket('**/*'") + 1
  );
  assert.ok(secondGlob >= 0, 'both routeWebSocket glob sites must still be present');
  const fakeOpen = SANDBOX_RUNNER.indexOf('/*', secondGlob);
  const fakeClose = SANDBOX_RUNNER.indexOf('*/', fakeOpen + 2);
  assert.ok(fakeOpen >= 0 && fakeClose > fakeOpen,
    'the glob string must still contain the /* -shaped content this defect turns on');
  assert.ok(fakeClose - fakeOpen > 4000,
    'this test assumes the historically large (40KB+) blind spot after the second glob site; ' +
    'if the surrounding source changed shape, re-locate the current blind spot before trusting it');
  const plantedName = '__stratusPlantedUndefinedExportProbe';
  const midpoint = fakeOpen + Math.floor((fakeClose - fakeOpen) / 2);
  const mutated = SANDBOX_RUNNER.slice(0, midpoint)
    + ('\n  ' + plantedName + '();\n')
    + SANDBOX_RUNNER.slice(midpoint);

  const code = stripRunnerComments(mutated);
  assert.match(
    code,
    new RegExp('\\b' + plantedName + '\\b'),
    'a reference planted inside the historically-blind span must survive stripping: it is real ' +
    'code, not a comment, and the guard can only catch what it can still see'
  );
  assert.ok(
    code.indexOf('const ' + plantedName + ' = ') < 0,
    'the planted name deliberately has no definition anywhere in the mutated text'
  );
  // This is the exact check 'every module export the runner references is defined inside the
  // runner first' performs. Restated here directly so this test fails on its own if the scan
  // ever regresses back to being fooled by the glob, independent of that other test's export list.
  assert.ok(
    new RegExp('\\b' + plantedName + '\\b').test(code) && code.indexOf('const ' + plantedName + ' = ') < 0,
    'the guard must be able to see and flag a reference planted inside the second routeWebSocket site\'s blind spot'
  );
});
