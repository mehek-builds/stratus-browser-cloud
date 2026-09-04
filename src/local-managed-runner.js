import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';
import { assertPublicUrl } from './security.js';
import {
  normalizeManagedBrowserProgress,
  normalizeManagedContinuation,
  normalizeManagedRun,
  SANDBOX_RUNNER,
  SCREENSHOT_ARTIFACT_POLL_MS,
  screenshotWaitMsForResult,
} from './managed-browser.js';

const RUN_TIMEOUT_MS = 150_000;
const CONTINUATION_TIMEOUT_MS = 60_000;
/* The runner keeps its own clock from the caller's providerDeadlineAt: it stops acting ten seconds
 * before that instant, closes the browser, and publishes a result or an error that names what it
 * was doing. The host used to wait a flat 150s, which is SHORTER than the 280s window litos-api
 * grants a prepare fill, so a long action (measured 2026-09-01 on a Recruitee dial-code picker:
 * the fill sat in phase 0 for the full 150s) was killed by the host with only a progress stage to
 * show for it, and nothing anywhere said which control it was stuck on. The host now waits until
 * the runner's own deadline has passed plus a return margin, so the runner's account of the run
 * always arrives first. Bounded above so a malformed deadline cannot hold a slot for an hour. */
const HOST_WAIT_AFTER_DEADLINE_MS = 5_000;
const MAX_RUN_TIMEOUT_MS = 330_000;

export function runTimeoutMsFor(providerDeadlineAt, now = Date.now()) {
  const deadlineMs = typeof providerDeadlineAt === 'string' ? Date.parse(providerDeadlineAt) : NaN;
  if (!Number.isFinite(deadlineMs)) return RUN_TIMEOUT_MS;
  return Math.min(MAX_RUN_TIMEOUT_MS, Math.max(RUN_TIMEOUT_MS, deadlineMs - now + HOST_WAIT_AFTER_DEADLINE_MS));
}
const MAX_CONCURRENT_RUNS = Math.max(1, Number(process.env.MANAGED_CONCURRENCY || 2));
const sessions = new Map();
const active = new Set();

function managedError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

/* A child that ended by SIGNAL has exitCode null and signalCode set; only a normal exit sets
 * exitCode. Checking exitCode alone (as this file did everywhere) reads an OOM-killed or
 * SIGTERMed runner as still running and waits out the whole budget on a process that is gone. */
function childExited(child) {
  return child?.exitCode != null || child?.signalCode != null;
}

async function waitForFile(directory, names, timeoutMs, child) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const name of names) {
      try {
        await fs.access(path.join(directory, name));
        return name;
      } catch {}
    }
    if (childExited(child)) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  for (const name of names) {
    try {
      await fs.access(path.join(directory, name));
      return name;
    } catch {}
  }
  return null;
}

async function runnerError(directory, stderr, expectedSubmissionAttempt = null) {
  const runProgress = await readProgress(directory, expectedSubmissionAttempt);
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(directory, 'stratus-error.json'), 'utf8'));
    return Object.assign(
      managedError(parsed.message || 'Managed browser run failed', 502, 'SANDBOX_RUN_FAILED'),
      runProgress ? { runProgress } : {},
    );
  } catch {
    return Object.assign(
      managedError(stderr.trim().slice(0, 500) || 'Managed browser run failed', 502, 'SANDBOX_RUN_FAILED'),
      runProgress ? { runProgress } : {},
    );
  }
}

async function readProgress(directory, expectedSubmissionAttempt = null) {
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(directory, 'stratus-progress.json'), 'utf8'));
    return normalizeManagedBrowserProgress(parsed, expectedSubmissionAttempt);
  } catch {
    return null;
  }
}

/* THE PREVIEW IS WRITTEN AFTER THE RESULT, on this path exactly as on the sandbox path.
 *
 * The runner publishes stratus-result-N.json first (it is the employer authority and must never
 * wait on a picture), then captures the screenshot and publishes it by rename. startRun wakes on
 * the result file, so a single immediate read of the PNG raced the capture and lost on every run,
 * and cleanup then SIGTERMed the child mid-capture and deleted the directory. Measured live on
 * Railway 2026-09-01: five prepare fills in a row (Breezy three times, Recruitee twice) came back
 * in one to four seconds with a complete fill and no screenshot, and litos-api, which hard-fails a
 * prepare without its preview, refused every one. stratus #137 fixed the identical race on the
 * Vercel Sandbox host (waitForSandboxScreenshot) and this path was never on it.
 *
 * Same contract as the sandbox host, deliberately: the wait is taken only when the caller asked
 * for it (screenshotWait: true) and only for an unpressed result, so a stalled optional screenshot
 * can never delay a confirmed submission receipt; it retries only clean absence (ENOENT), and it
 * stops the moment the child has exited, because a runner that exited without publishing the PNG
 * has given up on it (the capture failure is swallowed in the runner by design). */
export async function waitForLocalScreenshot(session, phase, waitMs, pollMs = SCREENSHOT_ARTIFACT_POLL_MS) {
  const file = path.join(session.directory, `stratus-screenshot-${phase}.png`);
  const deadline = Date.now() + Math.max(0, waitMs);
  for (;;) {
    try {
      return await fs.readFile(file);
    } catch (error) {
      if (error?.code !== 'ENOENT') return null;
    }
    if (childExited(session.child)) {
      return fs.readFile(file).catch(() => null);
    }
    if (Date.now() >= deadline) return null;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

/* A PRESSED RUN'S PICTURE IS THE RECEIPT, AND THIS HOST WAS THROWING IT AWAY.
 *
 * The sandbox contract (screenshotWaitMsForResult) waits for the preview only on an UNPRESSED
 * result, so that a stalled optional picture can never delay a confirmed submission receipt. On
 * this host that rule had the opposite effect: the runner publishes the result first and captures
 * the screenshot seconds later, readResult read the PNG exactly once with no wait, and cleanup then
 * killed the runner mid-capture and deleted its directory. So every pressed run left with
 * screenshot null, and litos-api, which stores the run's screenshot as the picture of a pressed
 * result that could not be confirmed (previewUrl on the unverified record), showed the applicant
 * the pre-press preview instead of what the employer's page said after the press. Measured on the
 * Hudson River Trading send of 2026-09-04: submitPressed true, submitState unknown, screenshot
 * false, and the applicant told to "check the employer portal" with nothing to check against.
 *
 * A pressed result now waits for its picture, bounded: the runner's own capture timeout is 15s,
 * and a full-page capture of a long board takes single seconds, so 20s covers it with margin
 * while still ending on a runner that exits without publishing. The employer result itself was
 * read before this wait began and is never delayed or changed by it. Unpressed results keep the
 * sandbox contract exactly. */
export const PRESSED_SCREENSHOT_WAIT_MS = 20_000;

export function localScreenshotWaitMsForResult(screenshotWait, result) {
  if (result?.submitOutcome?.pressed === true) return PRESSED_SCREENSHOT_WAIT_MS;
  return screenshotWaitMsForResult(screenshotWait, result);
}

async function readResult(session, phase, screenshot, screenshotWait) {
  const result = JSON.parse(await fs.readFile(path.join(session.directory, `stratus-result-${phase}.json`), 'utf8'));
  if (screenshot) {
    const bytes = await waitForLocalScreenshot(session, phase, localScreenshotWaitMsForResult(screenshotWait, result));
    result.screenshot = bytes?.toString('base64') || null;
  }
  return result;
}

async function cleanup(session) {
  sessions.delete(session.token);
  active.delete(session.id);
  if (!childExited(session.child)) session.child.kill('SIGTERM');
  await fs.rm(session.directory, { recursive: true, force: true }).catch(() => {});
}

function continuationEligible(result, checkpoint) {
  if (typeof result?.continuationOffered === 'boolean') return result.continuationOffered;
  if (checkpoint || result?.humanVerification?.kind === 'security_code') return true;
  const text = `${result?.title || ''}\n${result?.url || ''}\n${result?.text || ''}`;
  return /(?:verification|security|confirmation)\s+code|enter\s+(?:the\s+)?code|check\s+your\s+email/i.test(text);
}

async function startRun(input) {
  if (active.size >= MAX_CONCURRENT_RUNS) {
    throw managedError('Managed browser capacity is busy. Try again shortly.', 429, 'MANAGED_CAPACITY');
  }
  const context = await normalizeManagedRun(input, { urlValidator: assertPublicUrl });
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'stratus-managed-'));
  const token = context.requestContinuation ? crypto.randomBytes(32).toString('base64url') : null;
  const expiresAt = context.requestContinuation
    ? new Date(Date.now() + context.continuationTtlSeconds * 1000).toISOString()
    : null;
  if (expiresAt) context.continuationExpiresAt = expiresAt;
  await Promise.all([
    fs.writeFile(path.join(directory, 'stratus-runner.cjs'), SANDBOX_RUNNER),
    fs.writeFile(path.join(directory, 'stratus-input.json'), JSON.stringify(context)),
    ...(token ? [fs.writeFile(path.join(directory, 'stratus-continuation.json'), JSON.stringify({ expiresAt }))] : []),
  ]);
  const child = spawn(process.execPath, ['stratus-runner.cjs'], {
    cwd: directory,
    env: {
      ...process.env,
      NODE_PATH: [path.join(process.cwd(), 'node_modules'), process.env.NODE_PATH].filter(Boolean).join(path.delimiter),
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  const session = {
    id: crypto.randomUUID(),
    token,
    directory,
    child,
    expiresAt,
    used: false,
    stderr: '',
    submissionAttempt: context.submissionAttempt ?? null,
  };
  active.add(session.id);
  child.stderr.on('data', (chunk) => {
    session.stderr = `${session.stderr}${chunk.toString()}`.slice(-4000);
  });

  const produced = await waitForFile(
    directory,
    ['stratus-result-0.json', 'stratus-error.json'],
    runTimeoutMsFor(context.providerDeadlineAt),
    child,
  );
  if (!produced) {
    const runProgress = await readProgress(directory, session.submissionAttempt);
    await cleanup(session);
    throw Object.assign(
      managedError('Managed browser run timed out before it produced a result', 504, 'RUN_TIMED_OUT'),
      runProgress ? { runProgress } : {},
    );
  }
  if (produced === 'stratus-error.json') {
    const error = await runnerError(directory, session.stderr, session.submissionAttempt);
    await cleanup(session);
    throw error;
  }
  const result = await readResult(session, 0, context.screenshot, context.screenshotWait);
  if (token && continuationEligible(result, context.continuationCheckpoint)) {
    session.expiresAt = result.continuationExpiresAt || expiresAt;
    sessions.set(token, session);
    result.continuationToken = token;
    result.continuationExpiresAt = session.expiresAt;
    return result;
  }
  await cleanup(session);
  return result;
}

async function continueRun(input) {
  const continuation = normalizeManagedContinuation(input);
  const session = sessions.get(continuation.continuationToken);
  if (!session || session.used || Date.now() > Date.parse(session.expiresAt)) {
    if (session) await cleanup(session);
    throw managedError('Continuation is expired, already used, or does not belong to this service', 409, 'CONTINUATION_REJECTED');
  }
  session.used = true;
  await fs.writeFile(path.join(session.directory, 'stratus-continuation-input.json'), JSON.stringify(continuation));
  const produced = await waitForFile(
    session.directory,
    ['stratus-result-1.json', 'stratus-error.json'],
    CONTINUATION_TIMEOUT_MS,
    session.child,
  );
  if (!produced) {
    const runProgress = await readProgress(session.directory, session.submissionAttempt);
    await cleanup(session);
    throw Object.assign(
      managedError('Managed browser continuation timed out', 410, 'CONTINUATION_EXPIRED'),
      runProgress ? { runProgress } : {},
    );
  }
  if (produced === 'stratus-error.json') {
    const error = await runnerError(session.directory, session.stderr, session.submissionAttempt);
    await cleanup(session);
    throw error;
  }
  const result = await readResult(session, 1, continuation.screenshot, continuation.screenshotWait);
  await cleanup(session);
  return result;
}

export async function executeLocalManagedRun(input) {
  return input?.continuationToken != null ? continueRun(input) : startRun(input);
}

const expirySweep = setInterval(() => {
  for (const session of sessions.values()) {
    if (Date.now() > Date.parse(session.expiresAt)) cleanup(session).catch(() => {});
  }
}, 15_000);
expirySweep.unref();
