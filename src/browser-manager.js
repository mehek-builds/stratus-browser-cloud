import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { chromium } from 'playwright-core';
import { config } from './config.js';
import { now } from './utils.js';

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
      this.sessions.set(session.id, { browser, browserServer, context: browserContext, page, timer, signingKey });
      this.emit(session.id, 'session.started', { region: session.region, viewport: settings.viewport || { width: 1440, height: 900 } });
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
      this.emit(sessionId, 'download', { name: download.suggestedFilename(), path: artifactPath });
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
    const started = Date.now();
    let result;
    switch (command.action) {
      case 'navigate':
        await page.goto(command.url, { waitUntil: 'domcontentloaded', timeout: command.timeout || 30_000 });
        result = { url: page.url(), title: await page.title() };
        break;
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
        const artifactPath = path.join(config.dataDir, 'artifacts', filename);
        await page.screenshot({ path: artifactPath, fullPage: Boolean(command.fullPage) });
        result = { filename, url: `/artifacts/${filename}` };
        break;
      }
      default:
        throw Object.assign(new Error(`Unknown browser action: ${command.action}`), { status: 400 });
    }
    this.emit(sessionId, 'command.completed', { action: command.action, durationMs: Date.now() - started, result });
    return result;
  }

  async liveFrame(sessionId) {
    const runtime = this.sessions.get(sessionId);
    if (!runtime || runtime.simulated) return null;
    return runtime.page.screenshot({ type: 'jpeg', quality: 68 });
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
