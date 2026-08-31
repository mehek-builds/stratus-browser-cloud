import { applyApiHeaders, requireMethod } from './_http.js';
import { submissionReleasePolicy } from '../src/managed-browser.js';

const COMMIT_SHA_PATTERN = /^[a-f0-9]{40}$/i;

function revisionIdentity(env) {
  const declaredRaw = env.GIT_SHA?.trim() || null;
  const providerRaw = env.VERCEL_GIT_COMMIT_SHA?.trim() || null;
  const declaredCommitValid = declaredRaw == null || COMMIT_SHA_PATTERN.test(declaredRaw);
  const providerCommitValid = providerRaw == null || COMMIT_SHA_PATTERN.test(providerRaw);
  const declaredCommit = declaredCommitValid && declaredRaw ? declaredRaw.toLowerCase() : null;
  const providerCommit = providerCommitValid && providerRaw ? providerRaw.toLowerCase() : null;
  const sourcesMatch = !declaredCommit || !providerCommit || declaredCommit === providerCommit;
  const revisionStatus = !declaredCommitValid || !providerCommitValid
    ? 'invalid'
    : !declaredCommit && !providerCommit
      ? 'missing'
      : !sourcesMatch
        ? 'mismatch'
        : 'verified';
  return {
    commit: revisionStatus === 'verified' ? declaredCommit || providerCommit : null,
    declaredCommit,
    providerCommit,
    declaredCommitValid,
    providerCommitValid,
    revisionStatus
  };
}

export function managedHealthPayload(env = process.env) {
  const releasePolicy = submissionReleasePolicy(env);
  const revision = revisionIdentity(env);
  return {
    ok: revision.revisionStatus === 'verified',
    service: 'stratus-managed-control-plane',
    provider: 'stratus-sandbox',
    providerConfigured: true,
    authenticationMode: env.STRATUS_API_KEY?.trim() ? 'api-key-or-vercel-oidc' : 'vercel-oidc',
    runtime: process.version,
    ...revision,
    submissionQuiesced: releasePolicy.quiesced,
    submissionCorrelationRequired: releasePolicy.correlationRequired
  };
}

export default function handler(request, response) {
  applyApiHeaders(response);
  if (!requireMethod(request, response, ['GET'])) return;
  const payload = managedHealthPayload();
  response.status(payload.ok ? 200 : 503).json(payload);
}
