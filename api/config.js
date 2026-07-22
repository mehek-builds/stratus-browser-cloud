import { applyApiHeaders, requireMethod } from './_http.js';
import { browserlessConfiguration, FREE_MANAGED_LIMITS } from '../src/managed-browser.js';

export default function handler(request, response) {
  applyApiHeaders(response);
  if (!requireMethod(request, response, ['GET'])) return;
  const provider = browserlessConfiguration();
  response.status(200).json({
    name: 'Stratus', mode: 'managed-free', provider: 'browserless', configured: provider.configured,
    authenticationRequired: Boolean(process.env.STRATUS_API_KEY?.trim()), limits: FREE_MANAGED_LIMITS,
    capabilities: ['navigate', 'click', 'fill', 'press', 'select', 'extract', 'screenshot'],
    localMode: { command: 'npm start', concurrentBrowsers: 100, monthlyBrowserHours: 500 },
    setupUrl: 'https://cloud.browserless.io/signup'
  });
}
