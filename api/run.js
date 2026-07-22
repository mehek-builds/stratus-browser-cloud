import { applyApiHeaders, authorize, requireMethod, sendError } from './_http.js';
import { executeManagedRun } from '../src/managed-browser.js';

export const config = { maxDuration: 300 };

export default async function handler(request, response) {
  applyApiHeaders(response);
  if (!requireMethod(request, response, ['POST'])) return;
  if (!await authorize(request, response)) return;
  try {
    response.status(200).json({ run: await executeManagedRun(request.body) });
  } catch (error) {
    sendError(response, error);
  }
}
