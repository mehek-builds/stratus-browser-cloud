import { retrieveManagedTerminalResult } from '../src/managed-browser.js';
import {
  applyApiHeaders,
  authorize,
  privateErrorDiagnostic,
  requireMethod,
  sendError
} from './_http.js';

export const config = { maxDuration: 60 };

function invalidRequest(message) {
  return Object.assign(new Error(message), {
    status: 400,
    code: 'INVALID_RUN_RESULT_REQUEST'
  });
}

export function submissionAttemptFromRunResultQuery(query) {
  const keys = query && typeof query === 'object' && !Array.isArray(query)
    ? Object.keys(query).sort().join(',')
    : '';
  if (keys !== 'claimId,executionId,runId'
    || Object.values(query).some((value) => typeof value !== 'string')) {
    throw invalidRequest('runId, claimId, and executionId are required as single query values');
  }
  return {
    runId: query.runId,
    claimId: query.claimId,
    executionId: query.executionId
  };
}

export async function lookupManagedRunResult(query, {
  projectBinding = 'stratus-managed',
  retrieve = retrieveManagedTerminalResult
} = {}) {
  const submissionAttempt = submissionAttemptFromRunResultQuery(query);
  return retrieve({ submissionAttempt }, { projectBinding });
}

export default async function handler(request, response) {
  applyApiHeaders(response);
  if (!requireMethod(request, response, ['GET'])) return;
  if (!await authorize(request, response)) return;
  try {
    const projectBinding = process.env.VERCEL_PROJECT_ID
      || process.env.VERCEL_PROJECT_NAME
      || 'stratus-managed';
    const result = await lookupManagedRunResult(request.query, { projectBinding });
    response.status(result.state === 'pending' ? 202 : 200).json(result);
  } catch (error) {
    console.error(JSON.stringify({
      event: 'managed_run_result_lookup_failed',
      code: error?.code || 'INTERNAL_ERROR',
      status: Number(error?.status) || 500,
      diagnostic: privateErrorDiagnostic(error)
    }));
    sendError(response, error);
  }
}
