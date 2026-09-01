/* THE TWO PII-FREE LOG LINES A MANAGED RUN LEAVES BEHIND, in one module because there are two
 * request paths that must both write them: the Vercel Sandbox handler (api/run.js) and the Railway
 * server (src/server.js), whose /api/run branch runs the SANDBOX_RUNNER as a local child through
 * src/local-managed-runner.js. Measured 2026-09-01: the completion line shipped in api/run.js
 * alone, litos-api on Railway never reaches that file, and the container logged nothing for a run
 * whose missing preview was failing every prepare. Hostname only, never page text or a value. */

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
    /* The action the run was on when it stopped: index, type and the action's own label (a
     * question's employer text, never an applicant value). Absent on a run that never entered
     * its action loop. */
    ...(progress.action && typeof progress.action === 'object'
      && Number.isInteger(progress.action.index)
      ? {
        action: {
          index: progress.action.index,
          type: typeof progress.action.type === 'string' ? progress.action.type.slice(0, 40) : null,
          label: typeof progress.action.label === 'string' ? progress.action.label.slice(0, 200) : null
        }
      }
      : {}),
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
