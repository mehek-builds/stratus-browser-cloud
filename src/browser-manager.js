import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';
import { config } from './config.js';
import { now } from './utils.js';
import { assertAuthorizedNavigation, detectProtectionChallenge, normalizeProtectionPolicy } from './protection-policy.js';

export class BrowserManager {
  constructor(store, publish = () => {}) {
    this.store = store;
    this.publish = publish;
    this.sessions = new Map();
  }

  async launch(session, { simulated = false } = {}) {
    if (simulated) {
      const running = this.store.updateSession(session.id, {
        status: 'RUNNING', startedAt: now(), signingKey: crypto.randomBytes(18).toString('hex'),
        connectUrl: `${config.publicBaseUrl}/v1/sessions/${session.id}/cdp`,
        seleniumRemoteUrl: `${config.publicBaseUrl}/selenium/${session.id}`
      });
      this.sessions.set(session.id, { simulated: true });
      this.emit(session.id, 'session.started', { simulated: true });
      return running;
    }

    let browser;
    let browserServer;
    try {
      const context = session.contextId ? this.store.getContext(session.contextId) : null;
      const settings = session.browserSettings || {};
      const protectionPolicy = normalizeProtectionPolicy(settings.protectionPolicy);
      browserServer = await chromium.launchServer({
        executablePath: config.chromePath,
        headless: true,
        args: ['--disable-dev-shm-usage', '--no-first-run', '--no-default-browser-check']
      });
      browser = await chromium.connect(browserServer.wsEndpoint());
      const browserContext = await browser.newContext({
        viewport: settings.viewport || { width: 1440, height: 900 },
        locale: settings.locale || 'en-US',
        timezoneId: settings.timezoneId || 'UTC',
        userAgent: settings.userAgent,
        extraHTTPHeaders: settings.headers,
        storageState: context?.statePath && fs.existsSync(context.statePath) ? context.statePath : undefined,
        acceptDownloads: true,
        recordVideo: settings.recordVideo ? { dir: path.join(config.dataDir, 'artifacts') } : undefined
      });
      const page = await browserContext.newPage();
      this.wirePage(session.id, page);
      const signingKey = crypto.randomBytes(18).toString('hex');
      const running = this.store.updateSession(session.id, {
        status: 'RUNNING', startedAt: now(), signingKey,
        connectUrl: browserServer.wsEndpoint(),
        seleniumRemoteUrl: `${config.publicBaseUrl}/selenium/${session.id}`
      });
      const timer = setTimeout(() => this.release(session.id, 'TIMED_OUT'), Math.max(1, new Date(session.expiresAt).getTime() - Date.now()));
      this.sessions.set(session.id, {
        browser, browserServer, context: browserContext, page, timer, signingKey,
        protectionPolicy, lastNavigationAt: 0, protectionStatus: { state: 'clear', challenge: null }
      });
      this.emit(session.id, 'session.started', { region: session.region, viewport: settings.viewport || { width: 1440, height: 900 } });
      this.emit(session.id, 'protection.policy', protectionPolicy);
      return running;
    } catch (error) {
      if (browserServer) await boundedClose(() => browserServer.close());
      else if (browser) await boundedClose(() => browser.close());
      this.store.updateSession(session.id, { status: 'ERROR', endedAt: now(), error: error.message });
      this.emit(session.id, 'session.error', { message: error.message });
      throw error;
    }
  }

  wirePage(sessionId, page) {
    page.on('console', (message) => this.emit(sessionId, 'console', { level: message.type(), text: message.text() }));
    page.on('pageerror', (error) => this.emit(sessionId, 'page.error', { message: error.message }));
    page.on('request', (request) => this.emit(sessionId, 'network.request', { method: request.method(), url: request.url() }));
    page.on('response', (response) => this.emit(sessionId, 'network.response', { status: response.status(), url: response.url() }));
    page.on('download', async (download) => {
      const artifactPath = path.join(config.dataDir, 'artifacts', `${sessionId}-${download.suggestedFilename()}`);
      await download.saveAs(artifactPath).catch(() => {});
      if (fs.existsSync(artifactPath)) {
        const artifact = this.store.createArtifact({ sessionId, kind: 'download', name: download.suggestedFilename(), content: fs.readFileSync(artifactPath) });
        this.emit(sessionId, 'download', { id: artifact.id, name: artifact.name, url: artifact.downloadUrl });
      }
    });
  }

  emit(sessionId, type, data) {
    const event = this.store.addEvent(sessionId, type, data);
    this.publish(sessionId, event);
    return event;
  }

  async command(sessionId, command) {
    const runtime = this.sessions.get(sessionId);
    if (!runtime || runtime.simulated) throw Object.assign(new Error('Real browser runtime is not active'), { status: 409 });
    const { page } = runtime;
    if (runtime.protectionStatus.state === 'paused' && !['protection', 'resume'].includes(command.action)) {
      throw Object.assign(new Error('Session is paused for human review'), { status: 409, code: 'HUMAN_REVIEW_REQUIRED' });
    }
    const started = Date.now();
    let result;
    switch (command.action) {
      case 'navigate': {
        assertAuthorizedNavigation(command.url, runtime.protectionPolicy);
        await this.paceNavigation(runtime);
        const response = await page.goto(command.url, { waitUntil: 'domcontentloaded', timeout: command.timeout || 30_000 });
        runtime.lastNavigationAt = Date.now();
        const challenge = await this.inspectProtection(sessionId, runtime, response?.status());
        if (challenge.detected && runtime.protectionPolicy.challengeBehavior === 'pause') {
          throw Object.assign(new Error('A site protection challenge requires human review'), {
            status: 409, code: 'HUMAN_REVIEW_REQUIRED', challenge
          });
        }
        result = { url: page.url(), title: await page.title(), protection: runtime.protectionStatus };
        break;
      }
      case 'click':
        await page.locator(command.selector).click();
        result = { clicked: command.selector };
        break;
      case 'fill':
        await page.locator(command.selector).fill(String(command.value ?? ''));
        result = { filled: command.selector };
        break;
      case 'evaluate':
        result = await page.evaluate(command.expression);
        break;
      case 'content':
        result = { html: await page.content(), text: await page.locator('body').innerText() };
        break;
      case 'screenshot': {
        const filename = `${sessionId}-${Date.now()}.png`;
        const content = await page.screenshot({ fullPage: Boolean(command.fullPage) });
        const artifact = this.store.createArtifact({ sessionId, kind: 'screenshot', name: filename, contentType: 'image/png', content });
        result = { id: artifact.id, filename, url: artifact.downloadUrl };
        break;
      }
      case 'pdf': {
        const filename = `${sessionId}-${Date.now()}.pdf`;
        const content = await page.pdf({ format: command.format || 'A4', printBackground: true });
        const artifact = this.store.createArtifact({ sessionId, kind: 'pdf', name: filename, contentType: 'application/pdf', content });
        result = { id: artifact.id, filename, url: artifact.downloadUrl };
        break;
      }
      case 'protection':
        result = runtime.protectionStatus;
        break;
      case 'resume': {
        const challenge = await this.inspectProtection(sessionId, runtime);
        if (challenge.detected) {
          throw Object.assign(new Error('Protection challenge is still present'), { status: 409, code: 'HUMAN_REVIEW_REQUIRED' });
        }
        result = runtime.protectionStatus;
        this.emit(sessionId, 'protection.resumed', { resumedAt: now() });
        break;
      }
      default:
        throw Object.assign(new Error(`Unknown browser action: ${command.action}`), { status: 400 });
    }
    this.emit(sessionId, 'command.completed', { action: command.action, durationMs: Date.now() - started, result });
    return result;
  }

  async paceNavigation(runtime) {
    const remaining = runtime.protectionPolicy.minNavigationIntervalMs - (Date.now() - runtime.lastNavigationAt);
    if (runtime.lastNavigationAt && remaining > 0) await new Promise((resolve) => setTimeout(resolve, remaining));
  }

  async inspectProtection(sessionId, runtime, status) {
    if (!runtime.protectionPolicy.enabled) return { detected: false };
    const page = runtime.page;
    const challenge = detectProtectionChallenge({
      title: await page.title().catch(() => ''),
      text: await page.locator('body').innerText({ timeout: 2000 }).catch(() => ''),
      status,
      url: page.url()
    });
    if (!challenge.detected) {
      runtime.protectionStatus = { state: 'clear', challenge: null, checkedAt: now() };
      return challenge;
    }
    let evidenceUrl;
    if (runtime.protectionPolicy.captureEvidence) {
      const filename = `${sessionId}-challenge-${Date.now()}.png`;
      await page.screenshot({ path: path.join(config.dataDir, 'artifacts', filename), fullPage: true }).catch(() => {});
      evidenceUrl = `/artifacts/${filename}`;
    }
    const detail = {
      ...challenge,
      evidenceUrl,
      detectedAt: now(),
      action: runtime.protectionPolicy.challengeBehavior === 'pause' ? 'human_review' : 'reported'
    };
    runtime.protectionStatus = {
      state: runtime.protectionPolicy.challengeBehavior === 'pause' ? 'paused' : 'challenge_detected',
      challenge: detail
    };
    this.emit(sessionId, 'protection.challenge_detected', detail);
    return detail;
  }

  protectionStatus(sessionId) {
    const runtime = this.sessions.get(sessionId);
    if (!runtime || runtime.simulated) throw Object.assign(new Error('Real browser runtime is not active'), { status: 409 });
    return runtime.protectionStatus;
  }

  async agent(sessionId, operation, input = {}) {
    const runtime = this.sessions.get(sessionId);
    if (!runtime || runtime.simulated) throw Object.assign(new Error('Real browser runtime is not active'), { status: 409 });
    if (runtime.protectionStatus.state === 'paused') {
      throw Object.assign(new Error('Session is paused for human review'), { status: 409, code: 'HUMAN_REVIEW_REQUIRED' });
    }
    const { page } = runtime;
    const started = Date.now();
    let result;
    if (operation === 'observe') {
      result = await page.locator('a,button,input,textarea,select,[role="button"]').evaluateAll((elements) => elements.slice(0, 100).map((element, index) => ({
        index,
        tag: element.tagName.toLowerCase(),
        text: (element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').trim().slice(0, 180),
        type: element.getAttribute('type'),
        href: element.getAttribute('href'),
        disabled: Boolean(element.disabled),
        visible: Boolean(element.getBoundingClientRect().width && element.getBoundingClientRect().height)
      })).filter((item) => item.visible));
    } else if (operation === 'act') {
      const instruction = String(input.instruction || '').trim();
      if (!instruction) throw Object.assign(new Error('instruction is required'), { status: 400 });
      const clickMatch = instruction.match(/^(?:click|press|choose|select)\s+(?:the\s+)?["']?(.+?)["']?$/i);
      const fillMatch = instruction.match(/^(?:fill|type|enter)\s+["']?(.+?)["']?\s+(?:into|in)\s+["']?(.+?)["']?$/i);
      if (clickMatch) {
        const target = clickMatch[1].replace(/\s+(?:button|link)$/i, '');
        const locator = page.getByRole('button', { name: target, exact: false }).or(page.getByRole('link', { name: target, exact: false })).or(page.getByText(target, { exact: false }));
        await locator.first().click({ timeout: Number(input.timeout || 10_000) });
        result = { action: 'click', target };
      } else if (fillMatch) {
        const [, value, target] = fillMatch;
        const locator = page.getByLabel(target, { exact: false }).or(page.getByPlaceholder(target, { exact: false }));
        await locator.first().fill(value, { timeout: Number(input.timeout || 10_000) });
        result = { action: 'fill', target, value };
      } else {
        throw Object.assign(new Error('Instruction is not actionable. Start with click, press, fill, type, or enter.'), { status: 422, code: 'UNSUPPORTED_INSTRUCTION' });
      }
    } else if (operation === 'extract') {
      const selector = input.selector || 'body';
      const locator = page.locator(selector).first();
      result = {
        url: page.url(),
        title: await page.title(),
        text: (await locator.innerText()).trim(),
        attributes: input.attributes ? Object.fromEntries(await Promise.all(input.attributes.map(async (name) => [name, await locator.getAttribute(name)]))) : undefined
      };
    } else {
      throw Object.assign(new Error(`Unknown agent operation: ${operation}`), { status: 400 });
    }
    this.emit(sessionId, `agent.${operation}`, { durationMs: Date.now() - started, input, result });
    return result;
  }

  async liveFrame(sessionId) {
    const runtime = this.sessions.get(sessionId);
    if (!runtime || runtime.simulated) return null;
    try {
      return await runtime.page.screenshot({ type: 'jpeg', quality: 68 });
    } catch (error) {
      if (/closed|target page|browser has been/i.test(error.message)) return null;
      throw error;
    }
  }

  async release(sessionId, status = 'COMPLETED') {
    const runtime = this.sessions.get(sessionId);
    const session = this.store.getSession(sessionId);
    if (!session) throw Object.assign(new Error('Session not found'), { status: 404 });
    if (!['PENDING', 'RUNNING'].includes(session.status)) return session;
    if (runtime?.timer) clearTimeout(runtime.timer);
    if (runtime?.context && session.contextId) {
      const context = this.store.getContext(session.contextId);
      if (context) await runtime.context.storageState({ path: context.statePath }).catch(() => {});
    }
    if (runtime?.browserServer) await boundedClose(() => runtime.browserServer.close());
    else if (runtime?.browser) await boundedClose(() => runtime.browser.close());
    this.sessions.delete(sessionId);
    const updated = this.store.updateSession(sessionId, { status, endedAt: now() });
    this.emit(sessionId, 'session.ended', { status });
    return updated;
  }

  async closeAll() {
    await Promise.all([...this.sessions.keys()].map((sessionId) => this.release(sessionId).catch(() => {})));
  }
}

async function boundedClose(close) {
  await Promise.race([
    Promise.resolve().then(close).catch(() => {}),
    new Promise((resolve) => setTimeout(resolve, 3000))
  ]);
}
