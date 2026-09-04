import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SANDBOX_RUNNER } from '../src/managed-browser.js';

/* A FILL RUN THAT NEVER GETS PAST "OPENING THE COMPANY FORM" STAYED `filling` WITH NO TERMINAL
 * RESULT FOR MANY MINUTES.
 *
 * MEASURED PRODUCTION 2026-09-04, Celerant Technologies via Paylocity, packet
 * 4b66641d-d12c-4b56-b9c1-850fd1e20a1d: fill run d471dcf1 approved 22:21:47Z, `status: "filling"`,
 * `progress_stage: "Opening the company form"`, no submission_error, no submission_stop, and still
 * byte-for-byte identical at 22:30:53Z - 9 minutes with zero heartbeat. litos-api's dashboard read
 * "STARTING - Opening the company form / Still working" the entire window.
 *
 * This one navigation already carried a hard deadline before today - 45 seconds, and whatever
 * waitUntil litos-api asks for, which is 'domcontentloaded' on every managed call
 * (browserbase.ts runManagedBrowser). What was missing was what happened AFTER page.goto threw:
 * nothing arm-specific, so the rejection fell through to the file's generic top-level handler
 * exactly like any other crash, with no distinguishing code, no final URL and no screenshot -
 * indistinguishable from a browser that genuinely crashed for an unrelated reason.
 *
 * These tests execute the shipped logic extracted from SANDBOX_RUNNER (same convention as
 * test/out-of-band-transport-origin.test.js), so they measure the actual behaviour rather than
 * pinning its wording. No real browser or network call is ever made: `page` is a plain mock. */

const sliceBetween = (startMarker, endMarker, label) => {
  const start = SANDBOX_RUNNER.indexOf(startMarker);
  assert.notEqual(start, -1, 'the runner must still contain ' + label + ' (start)');
  const end = SANDBOX_RUNNER.indexOf(endMarker, start);
  assert.notEqual(end, -1, 'the runner must still contain ' + label + ' (end)');
  return SANDBOX_RUNNER.slice(start, end);
};

/* From the waitUntil normalization through the closing brace of the new try/catch, ending right
 * before the pre-existing containment-state update that has always followed the navigation call.
 * Slicing to that pre-existing, unrelated line (rather than hand-typing the new block's own closing
 * brace) means this extraction tracks the real boundary even if the new block's internals change
 * shape later. */
const NAVIGATION_BLOCK = sliceBetween(
  'const waitUntil = input.waitUntil === ',
  'if (managedMutationTransportContainment) {',
  'the page-open navigation deadline block',
);

test('the extracted block still contains the exact deadline, and nothing widened it', () => {
  assert.match(NAVIGATION_BLOCK, /timeout: navigationTimeoutMs/);
  assert.match(NAVIGATION_BLOCK, /const navigationTimeoutMs = 45000;/);
  assert.match(NAVIGATION_BLOCK, /FORM_NEVER_OPENED/);
});

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor;

/**
 * Runs the extracted navigation block with a mock `page` and returns whatever it returns (a fake
 * navigation response on success) or lets it throw (a page.goto failure). `fs`/`crypto` are passed
 * explicitly - a `new Function`/`AsyncFunction` body does not close over the constructing scope's
 * local bindings the way an ordinary function does, only over true globals, and `fs`/`crypto` are
 * module-scoped requires in the real file, not globals.
 *
 * Runs inside a fresh temp cwd so the relative screenshot-file writes the block performs on a
 * failure never touch this checkout or collide across tests.
 */
async function runNavigationBlock({
  input,
  gotoImpl,
  urlAfterFailure = null,
  screenshotImpl = async () => Buffer.from('fake-png-bytes'),
}) {
  const factory = new AsyncFunction(
    'input', 'page', 'assertProviderActionWindow', 'fs', 'crypto',
    NAVIGATION_BLOCK + '\nreturn navigationResponse;',
  );
  const page = {
    goto: gotoImpl,
    url: () => {
      if (urlAfterFailure instanceof Error) throw urlAfterFailure;
      return urlAfterFailure;
    },
    screenshot: screenshotImpl,
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-nav-deadline-'));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    return await factory(input, page, () => {}, fs, crypto);
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const PAYLOCITY_URL = 'https://recruiting.paylocity.com/Recruiting/Jobs/Details/1234567';

test('a page that opens normally is untouched: same response, no screenshot written', async () => {
  const fakeResponse = { ok: true };
  let gotoArgs = null;
  const result = await runNavigationBlock({
    input: { url: PAYLOCITY_URL, waitUntil: 'domcontentloaded' },
    gotoImpl: async (url, options) => {
      gotoArgs = [url, options];
      return fakeResponse;
    },
  });
  assert.equal(result, fakeResponse);
  assert.deepEqual(gotoArgs, [PAYLOCITY_URL, { waitUntil: 'domcontentloaded', timeout: 45000 }]);
});

test('the navigation deadline and waitUntil litos-api asked for are unchanged', async () => {
  // The fix is additive: a page.goto that already worked must keep working identically. This is
  // the regression guard against quietly widening the 45s budget while adding the failure arm.
  let gotoArgs = null;
  await runNavigationBlock({
    input: { url: PAYLOCITY_URL, waitUntil: 'load' },
    gotoImpl: async (url, options) => {
      gotoArgs = [url, options];
      return {};
    },
  });
  assert.deepEqual(gotoArgs, [PAYLOCITY_URL, { waitUntil: 'load', timeout: 45000 }]);
});

test('networkidle2 and networkidle0 still normalize to networkidle before dispatch', async () => {
  for (const requested of ['networkidle2', 'networkidle0']) {
    let gotoArgs = null;
    await runNavigationBlock({
      input: { url: PAYLOCITY_URL, waitUntil: requested },
      gotoImpl: async (url, options) => {
        gotoArgs = [url, options];
        return {};
      },
    });
    assert.equal(gotoArgs[1].waitUntil, 'networkidle', requested + ' must still normalize');
  }
});

test('a page that never opens ends the run with a typed reason instead of a bare crash', async () => {
  await assert.rejects(
    () => runNavigationBlock({
      input: { url: PAYLOCITY_URL, waitUntil: 'domcontentloaded' },
      gotoImpl: async () => { throw new Error('page.goto: Timeout 45000ms exceeded.'); },
      urlAfterFailure: PAYLOCITY_URL,
    }),
    (error) => {
      assert.equal(error.code, 'FORM_NEVER_OPENED');
      assert.match(error.message, /Litos could not open the company form/);
      assert.match(error.message, /waitUntil=domcontentloaded/);
      assert.match(error.message, /timeoutMs=45000/);
      assert.match(error.message, new RegExp(PAYLOCITY_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.match(error.message, /Timeout 45000ms exceeded/);
      return true;
    },
  );
});

test('the reported url is the page\'s own last-known url, not just an echo of the request', async () => {
  // Proves the message reflects what the browser actually reached (a redirect target, a
  // provider-owned interstitial) rather than trusting the requested url blindly - the evidence
  // the task asks for is the FINAL url, and a run that redirected before hanging must say so.
  const redirectedTo = 'https://recruiting.paylocity.com/Recruiting/Login?returnUrl=%2FJobs%2F1234567';
  await assert.rejects(
    () => runNavigationBlock({
      input: { url: PAYLOCITY_URL, waitUntil: 'domcontentloaded' },
      gotoImpl: async () => { throw new Error('net::ERR_CONNECTION_CLOSED'); },
      urlAfterFailure: redirectedTo,
    }),
    (error) => {
      assert.match(error.message, new RegExp(redirectedTo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      assert.ok(!error.message.includes(PAYLOCITY_URL),
        'the redirected-to url, not the originally requested one, must be reported');
      return true;
    },
  );
});

test('an unreadable page.url() still reports the typed reason with the requested url as a fallback', async () => {
  await assert.rejects(
    () => runNavigationBlock({
      input: { url: PAYLOCITY_URL, waitUntil: 'domcontentloaded' },
      gotoImpl: async () => { throw new Error('Target page, context or browser has been closed'); },
      urlAfterFailure: new Error('page.url(): Target closed'),
    }),
    (error) => {
      assert.equal(error.code, 'FORM_NEVER_OPENED');
      assert.match(error.message, new RegExp(PAYLOCITY_URL.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
      return true;
    },
  );
});

test('a best-effort screenshot is captured under the exact filename the success path already reads', async () => {
  const pngBytes = Buffer.from('deadbeef', 'hex');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-nav-deadline-shot-'));
  const originalCwd = process.cwd();
  process.chdir(dir);
  try {
    const factory = new AsyncFunction(
      'input', 'page', 'assertProviderActionWindow', 'fs', 'crypto',
      NAVIGATION_BLOCK + '\nreturn navigationResponse;',
    );
    const page = {
      goto: async () => { throw new Error('page.goto: Timeout 45000ms exceeded.'); },
      url: () => PAYLOCITY_URL,
      screenshot: async () => pngBytes,
    };
    await assert.rejects(() => factory({ url: PAYLOCITY_URL, waitUntil: 'domcontentloaded' }, page, () => {}, fs, crypto));
    // Same convention as the success-path screenshot writer: written under a .tmp- name and
    // renamed into place, so a poll landing mid-write never reads a truncated file, and the
    // FINAL name is exactly what the host's existing, unmodified reading code already looks for.
    assert.ok(fs.existsSync('stratus-screenshot-0.png'), 'the failure screenshot must be written');
    assert.deepEqual(fs.readFileSync('stratus-screenshot-0.png'), pngBytes);
    const leftoverTemp = fs.readdirSync('.').filter((name) => name.includes('.tmp-'));
    assert.deepEqual(leftoverTemp, [], 'the temp file must be renamed away, not left behind');
  } finally {
    process.chdir(originalCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a screenshot capture failure never hides the typed reason - the picture is a bonus, not a gate', async () => {
  await assert.rejects(
    () => runNavigationBlock({
      input: { url: PAYLOCITY_URL, waitUntil: 'domcontentloaded' },
      gotoImpl: async () => { throw new Error('page.goto: Timeout 45000ms exceeded.'); },
      urlAfterFailure: PAYLOCITY_URL,
      screenshotImpl: async () => { throw new Error('Target page, context or browser has been closed'); },
    }),
    (error) => {
      assert.equal(error.code, 'FORM_NEVER_OPENED');
      assert.match(error.message, /Litos could not open the company form/);
      return true;
    },
  );
});

test('the embedded failure detail is bounded, not an unbounded stack dump', async () => {
  const hugeDetail = 'x'.repeat(5000);
  await assert.rejects(
    () => runNavigationBlock({
      input: { url: PAYLOCITY_URL, waitUntil: 'domcontentloaded' },
      gotoImpl: async () => { throw new Error(hugeDetail); },
      urlAfterFailure: PAYLOCITY_URL,
    }),
    (error) => {
      // Prose plus at most 300 characters of the underlying error, never the full 5000.
      assert.ok(error.message.length < 600, 'the message must stay well short of an unbounded dump');
      return true;
    },
  );
});

/* ---- The typed reason has to SURVIVE, not just be created: persistTerminalFailure ---- */

/* THE SECOND PLACE A TYPED REASON CAN BE LOST. 'correlated' at the host dispatch site is
 * Boolean(context.submissionAttempt), which is true for the discovery pass and the prepare-path
 * fill exactly as it is for a real durable submit - both carry a submissionAttempt, an ephemeral
 * scan pair for the two, a ledger-backed one for a submit. So a navigation failure on either of
 * those two prepare-path calls persists its durable envelope through persistTerminalFailure, and
 * the host's resultFromManagedTerminalState reads the thrown error's `code` from THAT envelope
 * (state.envelope.error.code), never from stratus-error.json. Before this fix, persistTerminalFailure
 * was called with only the run's input - never the error that actually occurred - so it always
 * wrote the same two hardcoded strings regardless of what happened, and a page that never opened
 * looked, on this path, identical to every other crash. */
const TERMINAL_FAILURE_BLOCK = sliceBetween(
  'function publishDurableJsonOnce(path, value) {',
  'let terminalFailureInput = null;',
  'publishDurableJsonOnce + terminalExpiresAt + persistTerminalFailure',
);

function buildPersistTerminalFailure() {
  // eslint-disable-next-line no-new-func
  const factory = new Function('fs', 'crypto', TERMINAL_FAILURE_BLOCK + '\nreturn persistTerminalFailure;');
  return factory(fs, crypto);
}

const VALID_HASH_A = crypto.randomBytes(32).toString('hex');
const VALID_HASH_B = crypto.randomBytes(32).toString('hex');

function baseDurableInput(over = {}) {
  return {
    submissionAttempt: { runId: 'r1', claimId: 'c1', executionId: 'e1' },
    terminalResultProjectHash: VALID_HASH_A,
    terminalResultRequestDigest: VALID_HASH_B,
    ...over,
  };
}

function withTempCwd(fn) {
  return async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'stratus-terminal-failure-'));
    const originalCwd = process.cwd();
    process.chdir(dir);
    try {
      await fn(dir);
    } finally {
      process.chdir(originalCwd);
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };
}

function readPersistedEnvelope() {
  return JSON.parse(fs.readFileSync('stratus-terminal-result.json', 'utf8'));
}

test('a typed navigation failure is persisted verbatim into the durable envelope', withTempCwd(() => {
  const persistTerminalFailure = buildPersistTerminalFailure();
  persistTerminalFailure(baseDurableInput(), Object.assign(
    new Error('Litos could not open the company form within its navigation budget; last known url X'),
    { code: 'FORM_NEVER_OPENED' },
  ));
  const envelope = readPersistedEnvelope();
  assert.equal(envelope.state, 'failed');
  assert.equal(envelope.error.code, 'FORM_NEVER_OPENED');
  assert.equal(envelope.error.message, 'Litos could not open the company form within its navigation budget; last known url X');
}));

test('a crash with no typed code keeps the exact old fallback, byte for byte', withTempCwd(() => {
  // THE REGRESSION GUARD. Every crash that never sets `.code` (which today is most of them) must
  // persist identically to before this change, or every existing caller reading SANDBOX_RUN_FAILED
  // silently starts seeing something else.
  const persistTerminalFailure = buildPersistTerminalFailure();
  persistTerminalFailure(baseDurableInput(), new Error('some unrelated Playwright crash'));
  const envelope = readPersistedEnvelope();
  assert.equal(envelope.error.code, 'SANDBOX_RUN_FAILED');
  assert.equal(envelope.error.message, 'Managed browser run failed');
}));

test('an absent error object still falls back exactly as it always did', withTempCwd(() => {
  const persistTerminalFailure = buildPersistTerminalFailure();
  persistTerminalFailure(baseDurableInput());
  const envelope = readPersistedEnvelope();
  assert.equal(envelope.error.code, 'SANDBOX_RUN_FAILED');
  assert.equal(envelope.error.message, 'Managed browser run failed');
}));

test('only the first line of a multi-line error message is persisted, bounded to 500 chars', withTempCwd(() => {
  const persistTerminalFailure = buildPersistTerminalFailure();
  const longSecondLine = 'y'.repeat(2000);
  persistTerminalFailure(baseDurableInput(), Object.assign(
    new Error('Litos could not open the company form\n    at Page.goto (playwright.js:1)\n' + longSecondLine),
    { code: 'FORM_NEVER_OPENED' },
  ));
  const envelope = readPersistedEnvelope();
  assert.equal(envelope.error.message, 'Litos could not open the company form');
  assert.ok(!envelope.error.message.includes('playwright.js'));
}));

test('a non-string code falls back to SANDBOX_RUN_FAILED rather than persisting garbage', withTempCwd(() => {
  const persistTerminalFailure = buildPersistTerminalFailure();
  for (const badCode of [42, {}, '', null]) {
    persistTerminalFailure(
      baseDurableInput({ submissionAttempt: { runId: 'r' + String(badCode), claimId: 'c', executionId: 'e' } }),
      Object.assign(new Error('crash'), { code: badCode }),
    );
    const envelope = readPersistedEnvelope();
    assert.equal(envelope.error.code, 'SANDBOX_RUN_FAILED', 'code ' + JSON.stringify(badCode) + ' must not pass through');
    fs.unlinkSync('stratus-terminal-result.json');
  }
}));

test('a run with no durable submission authority is never persisted here at all', withTempCwd(() => {
  // Unrelated to this fix and pinned so it stays that way: an ephemeral or malformed input must
  // take the same early return it always did, or a scan that was never meant to be durable
  // starts writing a durable terminal record.
  const persistTerminalFailure = buildPersistTerminalFailure();
  persistTerminalFailure({}, Object.assign(new Error('crash'), { code: 'FORM_NEVER_OPENED' }));
  assert.ok(!fs.existsSync('stratus-terminal-result.json'));
}));

/* ---- The third place: the host's OWN plain-error path, throwSandboxRunnerError ---- */

/* This is the host-side twin of the durable path above, taken when the produced file is the plain
 * stratus-error.json rather than the durable terminal envelope (a non-correlated run, or a race
 * where the durable file did not win). Before this fix it hardcoded `code: 'SANDBOX_RUN_FAILED'`
 * unconditionally, discarding whatever `code` stratus-error.json actually carried - so even after
 * teaching the sandbox to write FORM_NEVER_OPENED into that file, this reader would still have
 * thrown it away. Extracted from the file's own source (this function lives outside SANDBOX_RUNNER,
 * as ordinary host code, so no compile-safety constraint applies to it or to this test). */
const fullSource = fs.readFileSync(new URL('../src/managed-browser.js', import.meta.url), 'utf8');

const sliceFullSourceBetween = (startMarker, endMarker, label) => {
  const start = fullSource.indexOf(startMarker);
  assert.notEqual(start, -1, 'the file must still contain ' + label + ' (start)');
  const end = fullSource.indexOf(endMarker, start);
  assert.notEqual(end, -1, 'the file must still contain ' + label + ' (end)');
  return fullSource.slice(start, end);
};

const THROW_SANDBOX_RUNNER_ERROR_BLOCK = sliceFullSourceBetween(
  'async function throwSandboxRunnerError(sandbox, expectedSubmissionAttempt = null) {',
  'export const CLAIM_CONTINUATION_SCRIPT',
  'throwSandboxRunnerError',
);

function buildThrowSandboxRunnerError({ runProgress = null } = {}) {
  const factory = new AsyncFunction(
    'sandbox', 'expectedSubmissionAttempt', 'AbortSignal', 'OPTIONAL_ARTIFACT_TIMEOUT_MS',
    'readSandboxRunnerProgress',
    'return (' + THROW_SANDBOX_RUNNER_ERROR_BLOCK + ')(sandbox, expectedSubmissionAttempt);',
  );
  return (sandbox, expectedSubmissionAttempt = null) => factory(
    sandbox,
    expectedSubmissionAttempt,
    globalThis.AbortSignal,
    10_000,
    async () => runProgress,
  );
}

function bufferSandbox(contents) {
  return { readFileToBuffer: async () => Buffer.from(contents, 'utf8') };
}

test('a typed code in stratus-error.json is no longer discarded as SANDBOX_RUN_FAILED', async () => {
  const throwIt = buildThrowSandboxRunnerError();
  await assert.rejects(
    () => throwIt(bufferSandbox(JSON.stringify({
      message: 'Litos could not open the company form within its navigation budget',
      code: 'FORM_NEVER_OPENED',
    }))),
    (error) => {
      assert.equal(error.code, 'FORM_NEVER_OPENED');
      assert.equal(error.status, 502);
      assert.equal(error.message, 'Litos could not open the company form within its navigation budget');
      return true;
    },
  );
});

test('an error file with no code keeps the exact old default, unconditionally', async () => {
  const throwIt = buildThrowSandboxRunnerError();
  await assert.rejects(
    () => throwIt(bufferSandbox(JSON.stringify({ message: 'some unrelated crash' }))),
    (error) => {
      assert.equal(error.code, 'SANDBOX_RUN_FAILED');
      assert.equal(error.message, 'some unrelated crash');
      return true;
    },
  );
});

test('an unreadable error file falls all the way back to the original generic sentence', async () => {
  const throwIt = buildThrowSandboxRunnerError();
  await assert.rejects(
    () => throwIt({ readFileToBuffer: async () => { throw new Error('ENOENT'); } }),
    (error) => {
      assert.equal(error.code, 'SANDBOX_RUN_FAILED');
      assert.equal(error.message, 'Sandbox browser run failed');
      return true;
    },
  );
});

test('a non-string code in the file is refused the same way an absent one is', async () => {
  const throwIt = buildThrowSandboxRunnerError();
  await assert.rejects(
    () => throwIt(bufferSandbox(JSON.stringify({ message: 'crash', code: 12345 }))),
    (error) => {
      assert.equal(error.code, 'SANDBOX_RUN_FAILED');
      return true;
    },
  );
});

test('run progress still rides along beside a typed code, unchanged', async () => {
  const progress = { version: 1, phase: 0, stage: 'launch', submitPressed: false };
  const throwIt = buildThrowSandboxRunnerError({ runProgress: progress });
  await assert.rejects(
    () => throwIt(bufferSandbox(JSON.stringify({ message: 'never opened', code: 'FORM_NEVER_OPENED' }))),
    (error) => {
      assert.equal(error.code, 'FORM_NEVER_OPENED');
      assert.deepEqual(error.runProgress, progress);
      return true;
    },
  );
});
