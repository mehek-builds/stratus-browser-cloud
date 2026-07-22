import { assertPublicUrl } from './security.js';

export const FREE_MANAGED_LIMITS = Object.freeze({
  concurrentBrowsers: 2,
  monthlyUnits: 1000,
  maxRunSeconds: 60,
  persistedDays: 1
});

const ALLOWED_ACTIONS = new Set(['click', 'fill', 'waitForSelector', 'press', 'select', 'extract']);
const MAX_ACTIONS = 20;
const MAX_VALUE_LENGTH = 10_000;

const FUNCTION_CODE = String.raw`
export default async function ({ page, context }) {
  const startedAt = Date.now();
  await page.setViewport(context.viewport || { width: 1440, height: 900 });
  await page.goto(context.url, { waitUntil: context.waitUntil || 'networkidle2', timeout: 45000 });
  const extracted = [];
  for (const action of context.actions || []) {
    if (action.type === 'click') await page.click(action.selector);
    if (action.type === 'fill') {
      await page.focus(action.selector);
      await page.evaluate((selector) => {
        const element = document.querySelector(selector);
        if (!element) throw new Error('Element not found: ' + selector);
        element.value = '';
      }, action.selector);
      await page.type(action.selector, action.value || '');
    }
    if (action.type === 'waitForSelector') await page.waitForSelector(action.selector, { timeout: action.timeout || 10000 });
    if (action.type === 'press') await page.keyboard.press(action.value);
    if (action.type === 'select') await page.select(action.selector, action.value);
    if (action.type === 'extract') {
      const value = await page.$eval(action.selector, (element, attribute) => {
        if (attribute) return element.getAttribute(attribute);
        return element.innerText || element.textContent || '';
      }, action.attribute || null);
      extracted.push({ selector: action.selector, value });
    }
  }
  const title = await page.title();
  const url = page.url();
  const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 50000));
  const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map((link) => ({
    text: (link.innerText || link.textContent || '').trim().slice(0, 500),
    href: link.href
  })));
  const screenshot = context.screenshot
    ? await page.screenshot({ type: 'png', fullPage: Boolean(context.fullPage), encoding: 'base64' })
    : null;
  return {
    data: { title, url, text, links, extracted, screenshot, elapsedMs: Date.now() - startedAt },
    type: 'application/json'
  };
}`;

function inputError(message, code = 'INVALID_REQUEST') {
  return Object.assign(new Error(message), { status: 400, code });
}

function validateSelector(selector) {
  if (typeof selector !== 'string' || !selector.trim() || selector.length > 500) {
    throw inputError('Each selector must be a non-empty string no longer than 500 characters', 'INVALID_SELECTOR');
  }
  return selector.trim();
}

export function normalizeManagedActions(actions = []) {
  if (!Array.isArray(actions)) throw inputError('actions must be an array');
  if (actions.length > MAX_ACTIONS) throw inputError(`A run may contain at most ${MAX_ACTIONS} actions`, 'TOO_MANY_ACTIONS');
  return actions.map((action, index) => {
    if (!action || typeof action !== 'object' || !ALLOWED_ACTIONS.has(action.type)) {
      throw inputError(`Action ${index + 1} has an unsupported type`, 'INVALID_ACTION');
    }
    const normalized = { type: action.type };
    if (action.type !== 'press') normalized.selector = validateSelector(action.selector);
    if (['fill', 'press', 'select'].includes(action.type)) {
      if (typeof action.value !== 'string' || action.value.length > MAX_VALUE_LENGTH) {
        throw inputError(`Action ${index + 1} requires a string value no longer than ${MAX_VALUE_LENGTH} characters`, 'INVALID_ACTION_VALUE');
      }
      normalized.value = action.value;
    }
    if (action.type === 'waitForSelector') normalized.timeout = Math.min(Math.max(Number(action.timeout) || 10_000, 100), 20_000);
    if (action.type === 'extract' && action.attribute != null) {
      if (typeof action.attribute !== 'string' || action.attribute.length > 100) {
        throw inputError('Extract attributes must be strings no longer than 100 characters', 'INVALID_ATTRIBUTE');
      }
      normalized.attribute = action.attribute;
    }
    return normalized;
  });
}

export async function normalizeManagedRun(input = {}, { urlValidator = assertPublicUrl } = {}) {
  if (!input || typeof input !== 'object') throw inputError('Request body must be a JSON object');
  const url = await urlValidator(input.url);
  const viewport = input.viewport || {};
  const width = Math.min(Math.max(Number(viewport.width) || 1440, 320), 1920);
  const height = Math.min(Math.max(Number(viewport.height) || 900, 240), 1080);
  return {
    url: url.toString(),
    actions: normalizeManagedActions(input.actions),
    screenshot: input.screenshot !== false,
    fullPage: Boolean(input.fullPage),
    waitUntil: ['load', 'domcontentloaded', 'networkidle0', 'networkidle2'].includes(input.waitUntil) ? input.waitUntil : 'networkidle2',
    viewport: { width, height }
  };
}

export function browserlessConfiguration(env = process.env) {
  const token = env.BROWSERLESS_TOKEN?.trim();
  const endpoint = (env.BROWSERLESS_ENDPOINT || 'https://production-sfo.browserless.io').replace(/\/$/, '');
  return { configured: Boolean(token), token, endpoint };
}

export async function executeManagedRun(input, { env = process.env, fetchImpl = fetch, urlValidator = assertPublicUrl } = {}) {
  const config = browserlessConfiguration(env);
  if (!config.configured) {
    throw Object.assign(new Error('Browserless is not configured. Add BROWSERLESS_TOKEN in Vercel project settings.'), {
      status: 503,
      code: 'PROVIDER_NOT_CONFIGURED'
    });
  }
  const context = await normalizeManagedRun(input, { urlValidator });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 55_000);
  let response;
  try {
    const endpoint = new URL('/function', config.endpoint);
    endpoint.searchParams.set('token', config.token);
    response = await fetchImpl(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: FUNCTION_CODE, context }),
      signal: controller.signal
    });
  } catch (error) {
    const timedOut = error?.name === 'AbortError';
    throw Object.assign(new Error(timedOut ? 'Managed browser run timed out' : `Managed browser provider request failed: ${error.message}`), {
      status: timedOut ? 504 : 502,
      code: timedOut ? 'PROVIDER_TIMEOUT' : 'PROVIDER_UNAVAILABLE'
    });
  } finally {
    clearTimeout(timer);
  }
  const raw = await response.text();
  let payload;
  try { payload = JSON.parse(raw); } catch { payload = null; }
  if (!response.ok) {
    throw Object.assign(new Error(payload?.message || payload?.error || raw.slice(0, 500) || 'Managed browser provider returned an error'), {
      status: response.status === 429 ? 429 : 502,
      code: response.status === 429 ? 'PROVIDER_CAPACITY' : 'PROVIDER_ERROR'
    });
  }
  return payload?.data ?? payload;
}
