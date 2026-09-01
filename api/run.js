import { applyApiHeaders, authorize, privateErrorDiagnostic, requireMethod, sendError } from './_http.js';
import { executeManagedRun } from '../src/managed-browser.js';
import { managedRunCompletionLogSummary, managedRunProgressLogSummary } from '../src/run-log-summary.js';

// Re-exported so the two summaries keep one home; the Railway server (src/server.js) logs the same lines.
export { managedRunCompletionLogSummary, managedRunProgressLogSummary };

export const config = { maxDuration: 300 };

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
