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

export default async function handler(request, response) {
  applyApiHeaders(response);
  if (!requireMethod(request, response, ['POST'])) return;
  if (!await authorize(request, response)) return;
  try {
    const projectBinding = process.env.VERCEL_PROJECT_ID || process.env.VERCEL_PROJECT_NAME || 'stratus-managed';
    response.status(200).json({ run: await executeManagedRun(request.body, { projectBinding }) });
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
