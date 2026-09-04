/* THE RESULT THAT WENT TO A CLOSED SOCKET.
 *
 * Measured on Railway 2026-09-04, Hudson River Trading attempt 2b521d32: litos-api opened the
 * attempt at 15:53:08Z, authorized the employer boundary at 15:53:10Z and called POST /api/run.
 * The runner pressed Submit and finished at 15:55:50Z (durationMs 157418, submitPressed true,
 * requiredFieldConfirmation confirmed). litos-api had stopped waiting by 15:55:47Z: its recovery
 * sweep was already asking GET /api/run-results for the attempt, and this server answered that
 * path with the dashboard's index.html at 200, because nothing here had ever served it. The
 * runner's answer was written to a connection nobody was reading, the row sat at "submitting"
 * until the sweep folded it to "unverified" at 16:13:24Z, and the only record that the press
 * happened is one console line. Every managed send whose caller hangs up before the runner
 * finishes ends the same way: the employer has the application and Litos has no result.
 *
 * The sandbox host retains results in a Vercel Sandbox per attempt (managed-browser.js,
 * retrieveManagedTerminalResult). This host has no sandbox. It retains them here: in memory and
 * as one JSON file per attempt under the data directory, keyed by the durable submission attempt
 * tuple (runId, claimId, executionId), with the same states and shapes litos-api already reads
 * (student-outreach-backend src/lib/browserbase.ts getManagedBrowserTerminalResult):
 *
 *   pending        202  the run is executing; expiresAt is when the host stops waiting for it
 *   completed      200  run echoed, resultId, completedAt, expiresAt
 *   failed         200  error {code, message}, runProgress when the runner published one
 *   indeterminate  200  the host lost the runner before a result (timeout); the outcome is unknown
 *   (absent)       404  no attempt with that tuple was ever started here
 *   (acknowledged) 410  litos-api folded the result and acknowledged it; it is gone
 *
 * The retained run drops its screenshot bytes: the evidence PNG is published separately and a
 * recovery reads the outcome, not the picture. The data directory is the service's Railway volume
 * (/data, attached since #121), so files survive a restart or an auto-deploy. A reservation that
 * is reloaded after a restart is rewritten as indeterminate on load: the process that owned that
 * run is gone, its browser with it, and 202 would make litos-api wait on a run nobody is running.
 * A reservation whose deadline passed while the process lived is swept at that deadline for the
 * same reason; by then this host has already retained indeterminate itself. */
import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs } from 'node:fs';

export const LOCAL_TERMINAL_RESULT_RETENTION_MS = 6 * 60 * 60 * 1000;
const ATTEMPT_KEYS = ['runId', 'claimId', 'executionId'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function terminalError(message, status, code) {
  return Object.assign(new Error(message), { status, code });
}

export function normalizeLocalSubmissionAttempt(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const keys = Object.keys(value).sort().join(',');
  if (keys !== ATTEMPT_KEYS.slice().sort().join(',')) return null;
  const attempt = {};
  for (const key of ATTEMPT_KEYS) {
    const raw = value[key];
    if (typeof raw !== 'string' || !UUID.test(raw)) return null;
    attempt[key] = raw.toLowerCase();
  }
  return attempt;
}

function attemptKey(attempt) {
  return `${attempt.runId}_${attempt.claimId}_${attempt.executionId}`;
}

/* Unique per retention, not per tuple: a continuation's answer supersedes the first phase's within
 * the same millisecond in tests and within the same second in production, and an acknowledgement
 * must name exactly the answer it folded. */
function resultIdFor(attempt, completedAt, state) {
  return crypto.createHash('sha256')
    .update(`${attemptKey(attempt)}|${completedAt}|${state}|${crypto.randomBytes(8).toString('hex')}`)
    .digest('hex');
}

function withoutScreenshot(run) {
  if (!run || typeof run !== 'object') return run;
  const { screenshot, ...rest } = run;
  return { ...rest, screenshot: null, screenshotRetained: false };
}

export class LocalTerminalResultStore {
  constructor({ directory, now = Date.now, retentionMs = LOCAL_TERMINAL_RESULT_RETENTION_MS } = {}) {
    this.directory = directory || null;
    this.now = now;
    this.retentionMs = retentionMs;
    this.records = new Map();
    this.loaded = this.directory ? this.load() : Promise.resolve();
  }

  async load() {
    try {
      await fs.mkdir(this.directory, { recursive: true });
      const names = await fs.readdir(this.directory);
      for (const name of names) {
        if (!name.endsWith('.json')) continue;
        try {
          const record = JSON.parse(await fs.readFile(path.join(this.directory, name), 'utf8'));
          const attempt = normalizeLocalSubmissionAttempt(record?.submissionAttempt);
          if (!attempt || typeof record.state !== 'string') continue;
          if (record.state === 'pending') {
            // The process that reserved this is gone, and so is its runner: the outcome is unknown.
            const orphaned = this.terminalRecord(attempt, 'indeterminate', {
              error: { code: 'RUN_LOST_ON_RESTART', message: 'The host restarted while this managed run was executing; its outcome is unknown' },
            });
            this.records.set(attemptKey(attempt), orphaned);
            await this.persist(orphaned);
            continue;
          }
          this.records.set(attemptKey(attempt), record);
        } catch { /* a corrupt file is unreadable and is left for the operator; nothing is served from it */ }
      }
    } catch { /* no directory: memory only */ }
  }

  async persist(record) {
    if (!this.directory) return;
    const file = path.join(this.directory, `${attemptKey(record.submissionAttempt)}.json`);
    const temporary = `${file}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      await fs.mkdir(this.directory, { recursive: true });
      await fs.writeFile(temporary, JSON.stringify(record));
      await fs.rename(temporary, file);
    } catch { await fs.rm(temporary, { force: true }).catch(() => {}); }
  }

  async remove(attempt) {
    this.records.delete(attemptKey(attempt));
    if (!this.directory) return;
    await fs.rm(path.join(this.directory, `${attemptKey(attempt)}.json`), { force: true }).catch(() => {});
  }

  /** Called before the runner is spawned, so a lookup during the run answers 202, not 404. */
  async reservePending(submissionAttempt, expiresAtMs) {
    const attempt = normalizeLocalSubmissionAttempt(submissionAttempt);
    if (!attempt) return null;
    await this.loaded;
    const existing = this.records.get(attemptKey(attempt));
    if (existing && existing.state === 'pending') {
      throw terminalError('This submission attempt is already executing here', 409, 'SUBMISSION_EXECUTION_IN_PROGRESS');
    }
    if (existing) {
      throw terminalError('This submission attempt already has a retained terminal result', 409, 'SUBMISSION_EXECUTION_CONFLICT');
    }
    const record = {
      state: 'pending',
      submissionAttempt: attempt,
      reservedAt: new Date(this.now()).toISOString(),
      expiresAt: new Date(expiresAtMs).toISOString(),
    };
    this.records.set(attemptKey(attempt), record);
    await this.persist(record);
    return record;
  }

  terminalRecord(attempt, state, outcome) {
    const completedAt = new Date(this.now()).toISOString();
    const base = {
      submissionAttempt: attempt,
      resultId: resultIdFor(attempt, completedAt, state),
      completedAt,
      expiresAt: new Date(this.now() + this.retentionMs).toISOString(),
    };
    if (state === 'completed') {
      return { ...base, state: 'completed', run: withoutScreenshot(outcome.run) };
    }
    if (state === 'failed' || state === 'indeterminate') {
      const error = outcome.error || {};
      return {
        ...base,
        state,
        error: {
          code: typeof error.code === 'string' ? error.code : 'SANDBOX_RUN_FAILED',
          message: typeof error.message === 'string' ? error.message.slice(0, 2000) : 'Managed browser run failed',
        },
        ...(outcome.runProgress ? { runProgress: outcome.runProgress } : {}),
      };
    }
    throw terminalError(`Unknown terminal state ${String(state)}`, 500, 'TERMINAL_RESULT_STORE_UNAVAILABLE');
  }

  /** Called when the runner produced a result, an error, or nothing before the host gave up.
   *  Only a pending reservation, or a completed phase that offered a continuation (the second
   *  phase's answer supersedes the first), may be written; a settled record is never rewritten. */
  async retain(submissionAttempt, outcome) {
    const attempt = normalizeLocalSubmissionAttempt(submissionAttempt);
    if (!attempt) return null;
    await this.loaded;
    const existing = this.records.get(attemptKey(attempt));
    if (existing && existing.state !== 'pending'
      && !(existing.state === 'completed' && existing.run?.continuationOffered === true && outcome.continuation === true)) {
      throw terminalError('This submission attempt already has a retained terminal result', 409, 'SUBMISSION_EXECUTION_CONFLICT');
    }
    const record = this.terminalRecord(attempt, outcome.state, outcome);
    this.records.set(attemptKey(attempt), record);
    await this.persist(record);
    return record;
  }

  /** The GET /api/run-results answer: {status, body}. */
  async lookup(submissionAttempt) {
    const attempt = normalizeLocalSubmissionAttempt(submissionAttempt);
    if (!attempt) throw terminalError('runId, claimId, and executionId are required as single query values', 400, 'INVALID_RUN_RESULT_REQUEST');
    await this.loaded;
    await this.sweep();
    const record = this.records.get(attemptKey(attempt));
    if (!record) {
      return { status: 404, body: { error: { code: 'TERMINAL_RESULT_NOT_FOUND', message: 'No managed run was started here for this submission attempt' } } };
    }
    if (record.state === 'acknowledged') {
      return { status: 410, body: { error: { code: 'TERMINAL_RESULT_ACKNOWLEDGED', message: 'This terminal result was acknowledged and released' }, submissionAttempt: attempt, resultId: record.resultId, acknowledgedAt: record.acknowledgedAt } };
    }
    if (record.state === 'pending') {
      return { status: 202, body: { state: 'pending', submissionAttempt: attempt, expiresAt: record.expiresAt } };
    }
    const { reservedAt, acknowledgedAt, ...body } = record;
    return { status: 200, body };
  }

  /** The POST /api/run-results/acknowledge answer. Acknowledged records answer 410 afterwards. */
  async acknowledge(submissionAttempt, resultId) {
    const attempt = normalizeLocalSubmissionAttempt(submissionAttempt);
    if (!attempt || typeof resultId !== 'string' || !/^[a-f0-9]{64}$/.test(resultId)) {
      throw terminalError('The request body must contain only submissionAttempt and a lowercase 64-character resultId', 400, 'INVALID_RUN_RESULT_ACKNOWLEDGEMENT');
    }
    await this.loaded;
    const record = this.records.get(attemptKey(attempt));
    if (!record) throw terminalError('No managed run was started here for this submission attempt', 404, 'TERMINAL_RESULT_NOT_FOUND');
    if (record.state === 'pending') throw terminalError('The managed run has not produced its terminal result yet', 409, 'TERMINAL_RESULT_PENDING');
    if (record.resultId !== resultId) throw terminalError('The acknowledged result ID does not match the retained terminal result', 409, 'TERMINAL_RESULT_ID_MISMATCH');
    const acknowledgedAt = new Date(this.now()).toISOString();
    if (record.state === 'acknowledged') {
      return { acknowledged: true, submissionAttempt: attempt, resultId, acknowledgedAt: record.acknowledgedAt, cleanupState: 'completed' };
    }
    const tombstone = {
      state: 'acknowledged',
      submissionAttempt: attempt,
      resultId,
      acknowledgedAt,
      expiresAt: new Date(this.now() + this.retentionMs).toISOString(),
    };
    this.records.set(attemptKey(attempt), tombstone);
    await this.persist(tombstone);
    return { acknowledged: true, submissionAttempt: attempt, resultId, acknowledgedAt, cleanupState: 'completed' };
  }

  async sweep() {
    const nowMs = this.now();
    for (const [key, record] of this.records) {
      const expiresMs = Date.parse(record.expiresAt);
      if (Number.isFinite(expiresMs) && nowMs > expiresMs) {
        this.records.delete(key);
        await this.remove(record.submissionAttempt);
      }
    }
  }

  /** A host that only prepares never looks anything up; the timer keeps the files bounded. */
  startSweeping(intervalMs = 60_000) {
    if (this.sweeper) return this.sweeper;
    this.sweeper = setInterval(() => { this.sweep().catch(() => {}); }, intervalMs);
    this.sweeper.unref();
    return this.sweeper;
  }
}
