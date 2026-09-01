import { applyApiHeaders, authorize, privateErrorDiagnostic, requireMethod, sendError } from './_http.js';
import { executeManagedRun } from '../src/managed-browser.js';

export const config = { maxDuration: 300 };

export function managedRunProgressLogSummary(progress) {
  if (!progress || typeof progress !== 'object') return null;
  const stages = new Set([
    'launch', 'phase_started', 'submit_activation_started', 'submit_blocked',
    'submit_released', 'result_ready', 'result_written'
  ]);
  const submitKinds = new Set(['application', 'verification']);
  const outcomeKinds = new Set(['not_attempted', 'pressed', 'confirmed']);
  const outcomeStates = new Set(['not_attempted', 'unknown', 'rejected', 'confirmed']);
  const outcomeSources = new Set([
    'ats_state', 'ats_route', 'ats_state_unconfirmed', 'live_region', 'page_text',
    'unmatched_page_text', 'client_validation'
  ]);
  return {
    version: progress.version === 1 ? 1 : null,
    phase: Number.isInteger(progress.phase) && progress.phase >= 0 && progress.phase <= 1
      ? progress.phase
      : null,
    stage: stages.has(progress.stage) ? progress.stage : null,
    submitPressed: progress.submitPressed === true,
    applicationSubmitPressed: progress.applicationSubmitPressed === true,
    verificationSubmitPressed: progress.verificationSubmitPressed === true,
    submitKind: submitKinds.has(progress.submitKind) ? progress.submitKind : null,
    policyVersion: progress.policyVersion === 3 || progress.policyVersion === 4
      ? progress.policyVersion
      : null,
    ...(progress.employerOutcome && typeof progress.employerOutcome === 'object' ? {
      employerOutcome: {
        kind: outcomeKinds.has(progress.employerOutcome.kind) ? progress.employerOutcome.kind : null,
        state: outcomeStates.has(progress.employerOutcome.state) ? progress.employerOutcome.state : null,
        source: outcomeSources.has(progress.employerOutcome.source)
          ? progress.employerOutcome.source
          : null,
        formStillPresent: typeof progress.employerOutcome.formStillPresent === 'boolean'
          ? progress.employerOutcome.formStillPresent
          : null
      }
    } : {})
  };
}

/* One line per completed run, PII-free, so a host that refuses a result for a reason of its own
 * (litos-api hard-fails a prepare whose preview screenshot is missing) can be read against what
 * the run actually produced. Measured 2026-09-01: three prepares in a row were refused for the
 * missing preview two seconds after they were requested, and this service had logged nothing at
 * all, because only failures were logged and the run had not failed. Hostname only, never the
 * page text or any extracted value. */
export function managedRunCompletionLogSummary(input, run, durationMs) {
  const url = (() => {
    try { return new URL(String(run?.url ?? input?.url ?? '')).hostname; } catch { return null; }
  })();
  const outcomes = {};
  for (const entry of Array.isArray(run?.actionDiagnostics) ? run.actionDiagnostics : []) {
    const key = typeof entry?.outcome === 'string' ? entry.outcome : 'unknown';
    outcomes[key] = (outcomes[key] || 0) + 1;
  }
  return {
    event: 'managed_browser_run_completed',
    durationMs: Number.isFinite(durationMs) ? Math.round(durationMs) : null,
    host: url,
    actions: Array.isArray(input?.actions) ? input.actions.length : null,
    continuation: typeof input?.continuationToken === 'string',
    screenshotRequested: input?.screenshot !== false,
    screenshotWait: input?.screenshotWait === true,
    screenshot: typeof run?.screenshot === 'string' && run.screenshot.length > 0,
    textLength: typeof run?.text === 'string' ? run.text.length : 0,
    filledFields: Array.isArray(run?.filledFields) ? run.filledFields.length : 0,
    blockers: Array.isArray(run?.blockers) ? run.blockers.length : 0,
    skipped: Array.isArray(run?.skipped) ? run.skipped.length : 0,
    humanVerification: run?.humanVerification?.kind ?? null,
    submitPressed: run?.submitOutcome?.pressed === true,
    submitState: run?.submitOutcome?.state ?? null,
    requiredFieldConfirmation: run?.requiredFieldConfirmation?.status ?? null,
    terminalResult: Boolean(run?.terminalResult),
    actionOutcomes: outcomes
  };
}

export default async function handler(request, response) {
  applyApiHeaders(response);
  if (!requireMethod(request, response, ['POST'])) return;
  if (!await authorize(request, response)) return;
  const startedAt = Date.now();
  try {
    const projectBinding = process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_NAME || 'stratus-managed';
    const run = await executeManagedRun(request.body, { projectBinding });
    console.log(JSON.stringify(managedRunCompletionLogSummary(request.body, run, Date.now() - startedAt)));
    response.status(200).json({ run });
  } catch (error) {
    console.error(JSON.stringify({
      event: 'managed_browser_run_failed',
      code: error?.code || 'INTERNAL_ERROR',
      status: Number(error?.status) || 500,
      diagnostic: privateErrorDiagnostic(error),
      runProgress: managedRunProgressLogSummary(error?.runProgress)
    }));
    sendError(response, error);
  }
}
