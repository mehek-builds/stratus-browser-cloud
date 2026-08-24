import { applyApiHeaders, authorize, privateErrorDiagnostic, requireMethod, sendError } from './_http.js';
import { executeManagedRun } from '../src/managed-browser.js';

export const config = { maxDuration: 300 };

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
      runProgress: error?.runProgress || null
    }));
    sendError(response, error);
  }
}
