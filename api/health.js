import { applyApiHeaders, requireMethod } from './_http.js';
import { browserlessConfiguration } from '../src/managed-browser.js';

export default function handler(request, response) {
  applyApiHeaders(response);
  if (!requireMethod(request, response, ['GET'])) return;
  response.status(200).json({ ok: true, service: 'stratus-managed-control-plane', providerConfigured: browserlessConfiguration().configured, runtime: process.version, commit: process.env.VERCEL_GIT_COMMIT_SHA || null });
}
