import { ALLOWED_ACTIONS } from './managed-browser.js';

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
  /* WHAT THE CALLER ACTUALLY ASKED THIS RUN TO DO, counted by type, plus how many bytes of document
   * came with it. Both are read off the RAW request, so they say what was sent rather than what the
   * run made of it.
   *
   * This line already carried 'actions: N', which is a number that answers nothing. Measured
   * 2026-09-03 on packet a34e5ce2 (DSI Innovations, Recruitee): the employer's "CV or resume *"
   * dropzone came back empty, the result claimed 'resume' in filled_fields, and the application
   * record on the other side showed resume_attached false with a resume artifact selected. The one
   * question that separates "the board refused the file" from "the run was never given a file" is
   * whether an upload action was queued at all, and NOTHING in any record could answer it: not this
   * line, not the progress line, not the result. Hours went into inferring it.
   *
   * 'actionTypes' answers it in one field, forever, for every board. 'uploadBytes' answers the
   * follow-up, whether what came was a real document or a stub, and it is the sum of the DECODED
   * size of each upload's base64, so a plan that queued the action and attached three bytes reads
   * differently from one that attached a resume.
   *
   * PII-free by construction and deliberately so: the type is admitted only if it is one of the
   * eleven names in ALLOWED_ACTIONS and is otherwise counted as 'unknown', so a caller cannot push
   * page text or an applicant value into this line through the type field, and the byte count is a
   * number. No label, no selector, no value, no file name. */
  const actionTypes = {};
  let uploadBytes = 0;
  for (const action of Array.isArray(input?.actions) ? input.actions : []) {
    const type = typeof action?.type === 'string' && ALLOWED_ACTIONS.has(action.type)
      ? action.type
      : 'unknown';
    actionTypes[type] = (actionTypes[type] || 0) + 1;
    if (type === 'upload' && typeof action?.file?.base64 === 'string') {
      const encoded = action.file.base64;
      const padding = encoded.endsWith('==') ? 2 : (encoded.endsWith('=') ? 1 : 0);
      uploadBytes += Math.max(0, Math.floor(encoded.length * 3 / 4) - padding);
    }
  }
  return {
    event: 'managed_browser_run_completed',
    durationMs: Number.isFinite(durationMs) ? Math.round(durationMs) : null,
    host: url,
    actions: Array.isArray(input?.actions) ? input.actions.length : null,
    actionTypes,
    uploadBytes,
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
