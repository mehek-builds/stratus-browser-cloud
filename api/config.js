import { applyApiHeaders, requireMethod } from './_http.js';
import { FREE_MANAGED_LIMITS } from '../src/managed-browser.js';

export default function handler(request, response) {
  applyApiHeaders(response);
  if (!requireMethod(request, response, ['GET'])) return;
  const authenticationConfigured = Boolean(process.env.STRATUS_API_KEY?.trim());
  response.status(200).json({
    name: 'Stratus', mode: 'managed-free', provider: 'stratus-sandbox', configured: true,
    authenticationRequired: ['production', 'preview'].includes(process.env.VERCEL_ENV) || authenticationConfigured, limits: FREE_MANAGED_LIMITS,
    authenticationMode: authenticationConfigured ? 'api-key-or-vercel-oidc' : 'vercel-oidc',
    capabilities: ['navigate', 'click', 'fill', 'fillByLabelText', 'upload', 'press', 'select', 'extract', 'discover', 'confirmAndSubmit', 'screenshot'],
    localMode: { command: 'npm start', concurrentBrowsers: 100, monthlyBrowserHours: 500 },
    runtime: { isolation: 'firecracker-microvm', engine: 'chromium', orchestration: 'stratus' }
  });
}
