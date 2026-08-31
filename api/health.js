import { applyApiHeaders, requireMethod } from './_http.js';
import { submissionReleasePolicy } from '../src/managed-browser.js';

export function managedHealthPayload(env = process.env) {
  const releasePolicy = submissionReleasePolicy(env);
  return {
    ok: true,
    service: 'stratus-managed-control-plane',
    provider: 'stratus-sandbox',
    providerConfigured: true,
    authenticationMode: env.STRATUS_API_KEY?.trim() ? 'api-key-or-vercel-oidc' : 'vercel-oidc',
    runtime: process.version,
    commit: env.GIT_SHA || env.VERCEL_GIT_COMMIT_SHA || null,
    submissionQuiesced: releasePolicy.quiesced,
    submissionCorrelationRequired: releasePolicy.correlationRequired
  };
}

export default function handler(request, response) {
  applyApiHeaders(response);
  if (!requireMethod(request, response, ['GET'])) return;
  response.status(200).json(managedHealthPayload());
}
