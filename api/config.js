import { applyApiHeaders, requireMethod } from './_http.js';
import { browserlessConfiguration, BROWSERLESS_FREE_LIMITS, FREE_MANAGED_LIMITS, managedProvider } from '../src/managed-browser.js';

export default function handler(request, response) {
  applyApiHeaders(response);
  if (!requireMethod(request, response, ['GET'])) return;
  const provider = browserlessConfiguration();
  const selectedProvider = managedProvider();
  response.status(200).json({
    name: 'Stratus', mode: 'managed-free', provider: selectedProvider, configured: true,
    authenticationRequired: Boolean(process.env.STRATUS_API_KEY?.trim()), limits: provider.configured ? BROWSERLESS_FREE_LIMITS : FREE_MANAGED_LIMITS,
    capabilities: ['navigate', 'click', 'fill', 'press', 'select', 'extract', 'screenshot'],
    localMode: { command: 'npm start', concurrentBrowsers: 100, monthlyBrowserHours: 500 },
    setupUrl: provider.configured ? null : 'https://vercel.com/docs/sandbox'
  });
}
