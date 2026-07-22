import { assertPublicUrl } from './security.js';
import { Sandbox } from '@vercel/sandbox';

export const FREE_MANAGED_LIMITS = Object.freeze({
  concurrentBrowsers: 10,
  monthlyCpuHours: 5,
  maxRunSeconds: 60,
  persistedDays: 30
});

const ALLOWED_ACTIONS = new Set(['click', 'fill', 'fillByLabelText', 'upload', 'waitForSelector', 'press', 'select', 'extract']);
const MAX_ACTIONS = 120;
const MAX_VALUE_LENGTH = 10_000;
const MAX_FILE_BASE64_LENGTH = 6_000_000;

const SANDBOX_NAME = 'stratus-browser-runtime';
const SANDBOX_DEPENDENCIES = [
  'nss', 'dbus-libs', 'atk', 'at-spi2-atk', 'cups-libs', 'libxcb', 'libxkbcommon',
  'at-spi2-core', 'libX11', 'libXcomposite', 'libXdamage', 'libXext', 'libXfixes',
  'libXrandr', 'mesa-libgbm', 'cairo', 'pango', 'alsa-lib'
];

const SANDBOX_RUNNER = String.raw`
const fs = require('node:fs');
const { chromium } = require('playwright');

(async () => {
  const input = JSON.parse(fs.readFileSync('stratus-input.json', 'utf8'));
  const startedAt = Date.now();
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  try {
    const browserContext = await browser.newContext({ viewport: input.viewport || { width: 1440, height: 900 } });
    const page = await browserContext.newPage();
    const waitUntil = input.waitUntil === 'networkidle2' || input.waitUntil === 'networkidle0' ? 'networkidle' : input.waitUntil;
    await page.goto(input.url, { waitUntil, timeout: 45000 });
    const extracted = [];
    const filledFields = [];
    for (const action of input.actions || []) {
      const locator = action.selector ? page.locator(action.selector).first() : null;
      if (locator && action.optional && await locator.count() === 0) continue;
      if (action.type === 'click') {
        await locator.click();
        await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => {});
      }
      if (action.type === 'fill') {
        await locator.fill(action.value || '');
        if (action.label) filledFields.push(action.label);
      }
      if (action.type === 'fillByLabelText') {
        const label = page.getByText(action.text, { exact: false }).first();
        if (await label.count() === 0) continue;
        const container = label.locator('xpath=ancestor::*[self::div or self::fieldset][1]');
        const field = container.locator('textarea, input:not([type=file]):not([type=hidden]), select').first();
        if (await field.count() === 0) continue;
        if (await field.evaluate((element) => element.tagName.toLowerCase()) === 'select') {
          await field.selectOption({ label: action.value }).catch(() => field.selectOption(action.value));
        } else {
          await field.fill(action.value || '');
        }
        if (action.label) filledFields.push(action.label);
      }
      if (action.type === 'upload') {
        await locator.setInputFiles({
          name: action.file.name,
          mimeType: action.file.mimeType,
          buffer: Buffer.from(action.file.base64, 'base64')
        });
        if (action.label) filledFields.push(action.label);
      }
      if (action.type === 'waitForSelector') await page.waitForSelector(action.selector, { timeout: action.timeout || 10000 });
      if (action.type === 'press') await page.keyboard.press(action.value);
      if (action.type === 'select') {
        await locator.selectOption(action.value);
        if (action.label) filledFields.push(action.label);
      }
      if (action.type === 'extract') {
        const value = await locator.evaluate((element, attribute) => attribute ? element.getAttribute(attribute) : (element.innerText || element.textContent || ''), action.attribute || null);
        extracted.push({ selector: action.selector, value });
      }
    }
    const blockers = [];
    if (await page.locator('iframe[src*="captcha" i], [class*="captcha" i], [id*="captcha" i]').count() > 0) {
      blockers.push('CAPTCHA requires your attention');
    }
    const required = page.locator('input[required], textarea[required], select[required]');
    for (let index = 0; index < await required.count(); index += 1) {
      const field = required.nth(index);
      if (!await field.isVisible().catch(() => false)) continue;
      const state = await field.evaluate((element) => {
        if (element instanceof HTMLInputElement && element.type === 'file') return element.files?.length ? 'filled' : '';
        return 'value' in element ? String(element.value || '') : '';
      });
      if (state) continue;
      const name = await field.getAttribute('aria-label') || await field.getAttribute('name') || 'required field';
      blockers.push(String(name).slice(0, 120) + ' is required');
    }
    const title = await page.title();
    const url = page.url();
    const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 50000));
    const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map((link) => ({ text: (link.innerText || link.textContent || '').trim().slice(0, 500), href: link.href })));
    if (input.screenshot) await page.screenshot({ path: 'stratus-screenshot.png', fullPage: Boolean(input.fullPage) });
    fs.writeFileSync('stratus-result.json', JSON.stringify({ title, url, text, links, extracted, filledFields: [...new Set(filledFields)], blockers: [...new Set(blockers)], elapsedMs: Date.now() - startedAt }));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error?.stack || error?.message || String(error));
  process.exit(1);
});
`;

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
    if (!['press', 'fillByLabelText'].includes(action.type)) normalized.selector = validateSelector(action.selector);
    if (action.optional != null) normalized.optional = Boolean(action.optional);
    if (action.label != null) {
      if (typeof action.label !== 'string' || action.label.length > 200) throw inputError('Action labels must be strings no longer than 200 characters', 'INVALID_ACTION_LABEL');
      normalized.label = action.label;
    }
    if (['fill', 'press', 'select'].includes(action.type)) {
      if (typeof action.value !== 'string' || action.value.length > MAX_VALUE_LENGTH) {
        throw inputError(`Action ${index + 1} requires a string value no longer than ${MAX_VALUE_LENGTH} characters`, 'INVALID_ACTION_VALUE');
      }
      normalized.value = action.value;
    }
    if (action.type === 'fillByLabelText') {
      if (typeof action.text !== 'string' || !action.text.trim() || action.text.length > 500) throw inputError('Question text must be a non-empty string no longer than 500 characters', 'INVALID_ACTION_TEXT');
      if (typeof action.value !== 'string' || action.value.length > MAX_VALUE_LENGTH) throw inputError('Question answers must be strings no longer than 10000 characters', 'INVALID_ACTION_VALUE');
      normalized.text = action.text.trim();
      normalized.value = action.value;
    }
    if (action.type === 'upload') {
      const file = action.file;
      if (!file || typeof file !== 'object') throw inputError('Upload actions require a file', 'INVALID_UPLOAD');
      if (typeof file.name !== 'string' || !file.name.trim() || file.name.length > 255) throw inputError('Upload file names must be non-empty strings no longer than 255 characters', 'INVALID_UPLOAD');
      if (typeof file.mimeType !== 'string' || !file.mimeType.trim() || file.mimeType.length > 200) throw inputError('Upload MIME types must be non-empty strings no longer than 200 characters', 'INVALID_UPLOAD');
      if (
        typeof file.base64 !== 'string' || !file.base64 || file.base64.length > MAX_FILE_BASE64_LENGTH ||
        file.base64.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(file.base64)
      ) throw inputError('Upload file data must be valid non-empty base64 no longer than 6000000 characters', 'INVALID_UPLOAD');
      normalized.file = { name: file.name.trim(), mimeType: file.mimeType.trim(), base64: file.base64 };
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

async function ensureSandboxTemplate() {
  const template = await Sandbox.getOrCreate({
    name: SANDBOX_NAME,
    runtime: 'node24',
    timeout: 45 * 60 * 1000,
    resources: { vcpus: 2 },
    persistent: true,
    snapshotExpiration: 0,
    keepLastSnapshots: { count: 1, expiration: 0 },
    onCreate: async (sandbox) => {
      const dependencies = await sandbox.runCommand({ cmd: 'dnf', args: ['install', '-y', ...SANDBOX_DEPENDENCIES], sudo: true });
      if (dependencies.exitCode !== 0) throw new Error(`Sandbox browser dependency installation failed: ${await dependencies.stderr()}`);
      const npmInit = await sandbox.runCommand('npm', ['init', '-y']);
      if (npmInit.exitCode !== 0) throw new Error(`Sandbox npm initialization failed: ${await npmInit.stderr()}`);
      const playwright = await sandbox.runCommand('npm', ['install', 'playwright@1.54.1']);
      if (playwright.exitCode !== 0) throw new Error(`Sandbox Playwright installation failed: ${await playwright.stderr()}`);
      const chromium = await sandbox.runCommand('npx', ['playwright', 'install', 'chromium']);
      if (chromium.exitCode !== 0) throw new Error(`Sandbox Chromium installation failed: ${await chromium.stderr()}`);
    }
  });
  if (!template.currentSnapshotId) await template.snapshot({ expiration: 0 });
  return template;
}

export async function executeSandboxRun(input, { urlValidator = assertPublicUrl, sandboxApi = Sandbox } = {}) {
  const context = await normalizeManagedRun(input, { urlValidator });
  let sandbox;
  try {
    const template = sandboxApi === Sandbox
      ? await ensureSandboxTemplate()
      : await sandboxApi.get({ name: SANDBOX_NAME, resume: false });
    sandbox = await sandboxApi.fork({
      sourceSandbox: template.name,
      timeout: 90_000,
      resources: { vcpus: 2 },
      persistent: false,
      networkPolicy: 'allow-all'
    });
    await sandbox.writeFiles([
      { path: 'stratus-runner.cjs', content: Buffer.from(SANDBOX_RUNNER) },
      { path: 'stratus-input.json', content: Buffer.from(JSON.stringify(context)) }
    ]);
    const command = await sandbox.runCommand('node', ['stratus-runner.cjs']);
    if (command.exitCode !== 0) {
      throw Object.assign(new Error((await command.stderr()).trim() || 'Sandbox browser run failed'), { status: 502, code: 'SANDBOX_RUN_FAILED' });
    }
    const resultBuffer = await sandbox.readFileToBuffer({ path: 'stratus-result.json' });
    if (!resultBuffer) throw Object.assign(new Error('Sandbox browser did not produce a result'), { status: 502, code: 'SANDBOX_RESULT_MISSING' });
    const result = JSON.parse(resultBuffer.toString('utf8'));
    if (context.screenshot) {
      const screenshot = await sandbox.readFileToBuffer({ path: 'stratus-screenshot.png' });
      result.screenshot = screenshot?.toString('base64') || null;
    }
    return result;
  } catch (error) {
    if (error?.code) throw error;
    throw Object.assign(new Error(`Vercel Sandbox browser request failed: ${error.message}`), { status: 502, code: 'SANDBOX_UNAVAILABLE' });
  } finally {
    if (sandbox) await sandbox.stop().catch(() => {});
  }
}

export async function executeManagedRun(input, { urlValidator = assertPublicUrl, sandboxExecutor = executeSandboxRun } = {}) {
  return sandboxExecutor(input, { urlValidator });
}
