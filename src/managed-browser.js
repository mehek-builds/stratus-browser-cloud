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

// Exported so tests can pin the load-bearing branches of the runner. It ships to the sandbox as a
// string, so a regression here is invisible until a real portal run fails on a real application.
export const SANDBOX_RUNNER = String.raw`
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
    const skipped = [];
    for (const action of input.actions || []) {
     try {
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
        // Dispatch on the CONTROL, not on the question. Everything used to fall through to fill(),
        // which throws on a checkbox or radio ("Input of type checkbox cannot be filled") and, before
        // the try/catch above, took the entire run with it. Callers cannot predict the control type
        // either: on a real Greenhouse form "How did you hear about this job?" reads like free text
        // and is a checkbox group.
        const shape = await field.evaluate((element) => ({
          tag: element.tagName.toLowerCase(),
          type: (element.getAttribute('type') || '').toLowerCase()
        }));
        if (shape.tag === 'select') {
          await field.selectOption({ label: action.value }).catch(() => field.selectOption(action.value));
        } else if (shape.type === 'checkbox' || shape.type === 'radio') {
          // Scoped to THIS question's container, never the whole page. That scoping is what makes
          // matching an answer as short as "Yes" safe: an unscoped label match could tick a consent
          // or legal acknowledgement elsewhere on the form, which the applicant cannot undo.
          const wanted = String(action.value || '').trim();
          const choices = container.locator('input[type=checkbox], input[type=radio]');
          const total = await choices.count();
          let matched = false;
          for (let choice = 0; choice < total; choice += 1) {
            const option = choices.nth(choice);
            const optionText = await option.evaluate((element) => {
              const byFor = element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
              const wrapping = element.closest('label');
              return ((byFor && byFor.textContent) || (wrapping && wrapping.textContent) || element.getAttribute('aria-label') || element.value || '').trim();
            });
            if (optionText && optionText.toLowerCase() === wanted.toLowerCase()) {
              await option.check();
              matched = true;
              break;
            }
          }
          // No exact option match means the answer does not belong to this control. Leaving it
          // unticked is correct: it surfaces as a required-field blocker for the applicant, which is
          // far cheaper than guessing a checkbox on their behalf.
          if (!matched) continue;
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
     } catch (actionError) {
      // 'optional' previously meant only "skip if the element is missing", and it was checked via
      // 'locator', which is null for fillByLabelText. So a fillByLabelText could never be optional,
      // and any throw from ANY action aborted the whole run. A single unfillable checkbox on a
      // Greenhouse form therefore discarded the name, email, phone and resume already entered, and
      // returned the caller a raw Playwright stack trace instead of a filled form.
      // An optional action that fails is now recorded and stepped over; a required one still stops
      // the run, because the caller marked it as something the run cannot proceed without.
      if (!action.optional) throw actionError;
      skipped.push((action.label || action.type) + ': ' + String(actionError?.message || actionError).split('\n')[0].slice(0, 200));
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
        if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
          // A checkbox reports value "on" whether or not it is ticked, so the old check treated
          // every unticked required checkbox as already satisfied and never reported it.
          const group = element.name ? document.getElementsByName(element.name) : [element];
          return Array.from(group).some((member) => member.checked) ? 'checked' : '';
        }
        return 'value' in element ? String(element.value || '') : '';
      });
      if (state) continue;
      // Resolve a HUMAN label. The old line fell back to the name attribute and then to the
      // literal string 'required field', which produced the two blocker texts the dashboard was
      // actually showing applicants:
      //   "5a326a1d-1a9e-42b1-a918-ca74022064dc is required"  (Greenhouse names custom questions
      //                                                        with UUIDs, so the name attr is a token)
      //   "required field is required"                        (the literal fallback, doubled)
      // Neither tells the applicant which field to go and fix, which is the entire job of a blocker.
      const label = await field.evaluate((element) => {
        const clean = (value) => (value || '').replace(/\s+/g, ' ').trim().replace(/[\s*:]+$/, '');
        const byFor = element.id && document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
        const describedBy = element.getAttribute('aria-labelledby');
        const referenced = describedBy && document.getElementById(describedBy.split(/\s+/)[0]);
        const wrapping = element.closest('label');
        const legend = element.closest('fieldset') && element.closest('fieldset').querySelector('legend');
        for (const candidate of [
          byFor && byFor.textContent,
          referenced && referenced.textContent,
          wrapping && wrapping.textContent,
          element.getAttribute('aria-label'),
          element.getAttribute('description'),
          legend && legend.textContent,
          element.getAttribute('placeholder')
        ]) {
          const text = clean(candidate);
          // Reject machine identifiers rather than dressing one up as a label.
          if (!text) continue;
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(text)) continue;
          if (!/[a-z]/i.test(text)) continue;
          return text.slice(0, 120);
        }
        return '';
      }).catch(() => '');
      blockers.push(label ? '"' + label + '" is required and is still empty'
                          : 'A required field on the form has no label Litos can read, and is still empty');
    }
    const title = await page.title();
    const url = page.url();
    const text = await page.evaluate(() => (document.body?.innerText || '').slice(0, 50000));
    const links = await page.evaluate(() => Array.from(document.querySelectorAll('a[href]')).slice(0, 100).map((link) => ({ text: (link.innerText || link.textContent || '').trim().slice(0, 500), href: link.href })));
    if (input.screenshot) await page.screenshot({ path: 'stratus-screenshot.png', fullPage: Boolean(input.fullPage) });
    // 'skipped' is reported, never swallowed: an optional action that failed is something the
    // caller should be able to see and act on, and a silent skip is how a half-filled form starts
    // looking like a fully-filled one.
    fs.writeFileSync('stratus-result.json', JSON.stringify({ title, url, text, links, extracted, filledFields: [...new Set(filledFields)], blockers: [...new Set(blockers)], skipped: [...new Set(skipped)], elapsedMs: Date.now() - startedAt }));
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
