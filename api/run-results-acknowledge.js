import { acknowledgeManagedTerminalResult } from '../src/managed-browser.js';
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
    code: 'INVALID_RUN_RESULT_ACKNOWLEDGEMENT'
  });
}

export function submissionAttemptFromAcknowledgementBody(body) {
  const keys = body && typeof body === 'object' && !Array.isArray(body)
    ? Object.keys(body).sort().join(',')
    : '';
  if (keys !== 'submissionAttempt') {
    throw invalidRequest('The request body must contain only submissionAttempt');
  }
  return body.submissionAttempt;
}

export async function acknowledgeManagedRunResult(body, {
  projectBinding = 'stratus-managed',
  acknowledge = acknowledgeManagedTerminalResult
} = {}) {
  const submissionAttempt = submissionAttemptFromAcknowledgementBody(body);
  const acknowledgement = await acknowledge({ submissionAttempt }, { projectBinding });
  return {
    acknowledged: true,
    submissionAttempt: acknowledgement.submissionAttempt,
    acknowledgedAt: acknowledgement.acknowledgedAt
  };
}

export default async function handler(request, response) {
  applyApiHeaders(response);
  if (!requireMethod(request, response, ['POST'])) return;
  if (!await authorize(request, response)) return;
  try {
    const projectBinding = process.env.VERCEL_PROJECT_ID
      || process.env.VERCEL_PROJECT_NAME
      || 'stratus-managed';
    response.status(200).json(await acknowledgeManagedRunResult(request.body, { projectBinding }));
  } catch (error) {
    console.error(JSON.stringify({
      event: 'managed_run_result_acknowledgement_failed',
      code: error?.code || 'INTERNAL_ERROR',
      status: Number(error?.status) || 500,
      diagnostic: privateErrorDiagnostic(error)
    }));
    sendError(response, error);
  }
}
