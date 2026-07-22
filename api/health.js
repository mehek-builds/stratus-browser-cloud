import { applyApiHeaders, requireMethod } from './_http.js';

export default function handler(request, response) {
  applyApiHeaders(response);
  if (!requireMethod(request, response, ['GET'])) return;
  const providerConfigured = process.env.VERCEL_ENV !== 'production' || Boolean(process.env.STRATUS_API_KEY?.trim());
  response.status(providerConfigured ? 200 : 503).json({ ok: providerConfigured, service: 'stratus-managed-control-plane', provider: 'stratus-sandbox', providerConfigured, runtime: process.version, commit: process.env.VERCEL_GIT_COMMIT_SHA || null });
}
