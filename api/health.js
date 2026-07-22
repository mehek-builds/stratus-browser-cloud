import { applyApiHeaders, requireMethod } from './_http.js';

export default function handler(request, response) {
  applyApiHeaders(response);
  if (!requireMethod(request, response, ['GET'])) return;
  response.status(200).json({ ok: true, service: 'stratus-managed-control-plane', provider: 'stratus-sandbox', providerConfigured: true, authenticationMode: process.env.STRATUS_API_KEY?.trim() ? 'api-key-or-vercel-oidc' : 'vercel-oidc', runtime: process.version, commit: process.env.VERCEL_GIT_COMMIT_SHA || null });
}
