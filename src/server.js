import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { config, regions } from './config.js';
import { Store } from './store.js';
import { BrowserManager } from './browser-manager.js';
import { FunctionRuntime } from './function-runtime.js';
import { assertPublicUrl, htmlToText, textToMarkdown } from './security.js';
import { hmac, id, json, now, readJson, redact } from './utils.js';

const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg' };

export function createApp({ database = path.join(config.dataDir, 'stratus.db') } = {}) {
  const store = new Store(database);
  const subscribers = new Map();
  const publish = (sessionId, event) => {
    for (const ws of subscribers.get(sessionId) || []) {
      if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: 'event', event }));
    }
  };
  const browsers = new BrowserManager(store, publish);
  const functions = new FunctionRuntime(store, browsers);

  const server = http.createServer(async (req, res) => {
    const requestId = id('req');
    const started = Date.now();
    res.setHeader('x-request-id', requestId);
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type,x-stratus-api-key,x-bb-api-key,authorization');
    res.setHeader('access-control-allow-methods', 'GET,POST,PUT,DELETE,OPTIONS');
    if (req.method === 'OPTIONS') return res.writeHead(204).end();
    try {
      const url = new URL(req.url, config.publicBaseUrl);
      const route = url.pathname;

      if (route === '/health' || route === '/v1/health') {
        return json(res, 200, { status: 'ok', version: '0.1.0', timestamp: now(), browserExecutable: fs.existsSync(config.chromePath) });
      }
      if (route === '/ready') return json(res, 200, { ready: true, database: true, worker: fs.existsSync(config.chromePath) });
      if (route === '/metrics') {
        const usage = store.usage();
        const body = `stratus_sessions_running ${usage.concurrent}\nstratus_sessions_limit ${usage.concurrentLimit}\nstratus_browser_hours_used ${usage.browserHoursUsed}\nstratus_browser_hours_allowance ${usage.browserHoursAllowance}\n`;
        res.writeHead(200, { 'content-type': 'text/plain; version=0.0.4' });
        return res.end(body);
      }
      if (route.startsWith('/artifacts/')) return serveArtifact(route, res);
      if (!route.startsWith('/v1') && !route.startsWith('/openapi')) return serveStatic(route, res);

      const apiKey = req.headers['x-stratus-api-key'] || req.headers['x-bb-api-key'] || url.searchParams.get('apiKey') || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      if (!store.authenticate(apiKey)) return json(res, 401, { error: { code: 'UNAUTHORIZED', message: 'Provide a valid API key in X-Stratus-API-Key or X-BB-API-Key.' } });

      if (route === '/openapi.json') return json(res, 200, openApi(config.publicBaseUrl));
      if (route === '/v1/projects' && req.method === 'GET') {
        const project = store.project();
        return json(res, 200, [{ id: project.id, name: project.name, createdAt: project.created_at, defaultTimeout: project.default_timeout, concurrency: project.concurrency }]);
      }
      if (route === '/v1/usage' && req.method === 'GET') return json(res, 200, store.usage());

      if (route === '/v1/sessions' && req.method === 'GET') {
        return json(res, 200, store.listSessions(url.searchParams.get('status'), url.searchParams.get('q')));
      }
      if (route === '/v1/sessions' && req.method === 'POST') {
        const body = await readJson(req);
        if (body.region && !regions.includes(body.region)) throw Object.assign(new Error(`region must be one of ${regions.join(', ')}`), { status: 400 });
        const session = store.reserveSession(body);
        const launched = await browsers.launch(session, { simulated: Boolean(body.simulated && config.testMode) });
        await dispatchWebhooks(store, 'session.started', launched).catch(() => {});
        return json(res, 201, launched);
      }

      const sessionMatch = route.match(/^\/v1\/sessions\/([^/]+)$/);
      if (sessionMatch && req.method === 'GET') {
        const session = store.getSession(sessionMatch[1]);
        return session ? json(res, 200, session) : json(res, 404, { error: { code: 'NOT_FOUND', message: 'Session not found' } });
      }
      if (sessionMatch && req.method === 'POST') {
        const body = await readJson(req);
        if (body.status !== 'REQUEST_RELEASE') throw Object.assign(new Error('status must be REQUEST_RELEASE'), { status: 400 });
        const released = await browsers.release(sessionMatch[1]);
        await dispatchWebhooks(store, 'session.completed', released).catch(() => {});
        return json(res, 200, released);
      }

      const commandMatch = route.match(/^\/v1\/sessions\/([^/]+)\/commands$/);
      if (commandMatch && req.method === 'POST') return json(res, 200, await browsers.command(commandMatch[1], await readJson(req)));
      const agentMatch = route.match(/^\/v1\/sessions\/([^/]+)\/(observe|act|extract)$/);
      if (agentMatch && req.method === 'POST') return json(res, 200, await browsers.agent(agentMatch[1], agentMatch[2], await readJson(req)));
      const eventMatch = route.match(/^\/v1\/sessions\/([^/]+)\/(recording|logs|network)$/);
      if (eventMatch && req.method === 'GET') {
        const all = store.events(eventMatch[1]);
        const filtered = eventMatch[2] === 'network' ? all.filter((event) => event.type.startsWith('network.')) : all;
        return json(res, 200, filtered);
      }
      const liveMatch = route.match(/^\/v1\/sessions\/([^/]+)\/live-frame$/);
      if (liveMatch && req.method === 'GET') {
        const frame = await browsers.liveFrame(liveMatch[1]);
        if (!frame) return json(res, 409, { error: { code: 'NO_LIVE_FRAME', message: 'No real browser is active for this session.' } });
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
        return res.end(frame);
      }

      if (route === '/v1/contexts' && req.method === 'GET') return json(res, 200, store.listContexts());
      if (route === '/v1/contexts' && req.method === 'POST') return json(res, 201, store.createContext((await readJson(req)).name));
      const contextMatch = route.match(/^\/v1\/contexts\/([^/]+)$/);
      if (contextMatch && req.method === 'GET') {
        const context = store.getContext(contextMatch[1]);
        return context ? json(res, 200, { id: context.id, projectId: context.projectId, name: context.name, createdAt: context.createdAt, updatedAt: context.updatedAt }) : json(res, 404, { error: { code: 'NOT_FOUND', message: 'Context not found' } });
      }

      if (route === '/v1/search' && req.method === 'POST') {
        const body = await readJson(req);
        if (!body.query) throw Object.assign(new Error('query is required'), { status: 400 });
        const results = await searchWeb(body.query, Number(body.limit || 8));
        return json(res, 200, { query: body.query, results, provider: 'duckduckgo-html' });
      }
      if (route === '/v1/fetch' && req.method === 'POST') {
        const body = await readJson(req);
        const target = await assertPublicUrl(body.url, { allowLocalhost: config.testMode });
        const response = await fetch(target, { redirect: 'follow', signal: AbortSignal.timeout(Math.min(Number(body.timeout || 15_000), 30_000)), headers: { 'user-agent': 'StratusFetch/0.1' } });
        const raw = (await response.text()).slice(0, 5_000_000);
        const text = htmlToText(raw);
        return json(res, 200, { url: response.url, status: response.status, contentType: response.headers.get('content-type'), html: body.format === 'html' ? raw : undefined, text, markdown: textToMarkdown(text), cached: false });
      }

      if (route === '/v1/functions' && req.method === 'GET') return json(res, 200, functions.list());
      if (route === '/v1/functions' && req.method === 'POST') return json(res, 201, functions.create(await readJson(req)));
      const invokeMatch = route.match(/^\/v1\/functions\/([^/]+)\/invoke$/);
      if (invokeMatch && req.method === 'POST') return json(res, 200, await functions.invoke(invokeMatch[1], await readJson(req)));

      if (route === '/v1/chat/completions' && req.method === 'POST') {
        const body = await readJson(req);
        const last = [...(body.messages || [])].reverse().find((message) => message.role === 'user')?.content || '';
        return json(res, 200, {
          id: id('chatcmpl'), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: body.model || 'stratus-local',
          choices: [{ index: 0, message: { role: 'assistant', content: `Local gateway response: ${last}` }, finish_reason: 'stop' }],
          usage: { prompt_tokens: String(last).split(/\s+/).length, completion_tokens: String(last).split(/\s+/).length + 3, total_tokens: String(last).split(/\s+/).length * 2 + 3 },
          provider: 'local-deterministic'
        });
      }

      if (route === '/v1/webhooks' && req.method === 'GET') {
        return json(res, 200, store.db.prepare('SELECT id,url,events,enabled,created_at createdAt FROM webhooks').all().map((item) => ({ ...item, events: JSON.parse(item.events), enabled: Boolean(item.enabled) })));
      }
      if (route === '/v1/webhooks' && req.method === 'POST') {
        const body = await readJson(req);
        await assertPublicUrl(body.url, { allowLocalhost: config.testMode });
        const webhook = { id: id('wh'), projectId: store.project().id, url: body.url, events: body.events || ['session.completed'], secret: body.secret || crypto.randomBytes(20).toString('hex'), enabled: true, createdAt: now() };
        store.db.prepare('INSERT INTO webhooks (id,project_id,url,events,secret,enabled,created_at) VALUES (?,?,?,?,?,?,?)').run(webhook.id, webhook.projectId, webhook.url, JSON.stringify(webhook.events), webhook.secret, 1, webhook.createdAt);
        return json(res, 201, webhook);
      }
      if (route === '/v1/extensions' && req.method === 'POST') {
        const body = await readJson(req, 10_000_000);
        const bytes = Buffer.byteLength(body.contentBase64 || '', 'base64');
        if (!body.name || !body.contentBase64 || bytes > 5_000_000) throw Object.assign(new Error('name and contentBase64 are required, maximum decoded size is 5 MB'), { status: 400 });
        const extension = { id: id('ext'), projectId: store.project().id, name: body.name, bytes, createdAt: now() };
        store.db.prepare('INSERT INTO extensions (id,project_id,name,bytes,created_at) VALUES (?,?,?,?,?)').run(extension.id, extension.projectId, extension.name, extension.bytes, extension.createdAt);
        return json(res, 201, extension);
      }
      if (route === '/v1/audit-log' && req.method === 'GET') {
        return json(res, 200, store.db.prepare('SELECT timestamp,action,resource,metadata FROM audit_log ORDER BY id DESC LIMIT 200').all().map((item) => ({ ...item, metadata: JSON.parse(item.metadata) })));
      }

      return json(res, 404, { error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${route}` } });
    } catch (error) {
      const status = error.status || 500;
      console.error(JSON.stringify({ level: 'error', requestId, method: req.method, url: req.url, status, durationMs: Date.now() - started, error: redact(error.message) }));
      return json(res, status, { error: { code: error.code || (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'), message: status === 500 ? 'The request failed. Check server logs with the request ID.' : error.message, requestId, runId: error.runId } });
    }
  });

  const wss = new WebSocketServer({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, config.publicBaseUrl);
    const match = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/live$/);
    if (!match) return socket.destroy();
    const apiKey = url.searchParams.get('apiKey');
    if (!store.authenticate(apiKey)) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, match[1]));
  });
  wss.on('connection', (ws, sessionId) => {
    if (!subscribers.has(sessionId)) subscribers.set(sessionId, new Set());
    subscribers.get(sessionId).add(ws);
    ws.send(JSON.stringify({ type: 'connected', sessionId }));
    ws.on('close', () => subscribers.get(sessionId)?.delete(ws));
  });

  async function close() {
    await browsers.closeAll();
    await new Promise((resolve) => server.close(resolve));
    wss.close();
    store.db.close();
  }

  return { server, store, browsers, functions, close };
}

function serveStatic(route, res) {
  const normalized = route === '/' ? '/index.html' : route;
  const file = path.join(process.cwd(), 'public', normalized);
  const publicRoot = path.join(process.cwd(), 'public');
  if (!file.startsWith(publicRoot) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    const fallback = path.join(publicRoot, 'index.html');
    if (!fs.existsSync(fallback)) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Dashboard not built' } });
    res.writeHead(200, { 'content-type': mime['.html'] });
    return fs.createReadStream(fallback).pipe(res);
  }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream' });
  return fs.createReadStream(file).pipe(res);
}

function serveArtifact(route, res) {
  const name = path.basename(route);
  const file = path.join(config.dataDir, 'artifacts', name);
  if (!fs.existsSync(file)) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Artifact not found' } });
  res.writeHead(200, { 'content-type': mime[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
}

async function searchWeb(query, limit) {
  try {
    const response = await fetch(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`, { signal: AbortSignal.timeout(10_000), headers: { 'user-agent': 'Mozilla/5.0 StratusSearch/0.1' } });
    const html = await response.text();
    const results = [];
    const pattern = /class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?class="result__snippet"[^>]*>([\s\S]*?)<\/a>/gi;
    let match;
    while ((match = pattern.exec(html)) && results.length < limit) results.push({ url: match[1].replace(/&amp;/g, '&'), title: htmlToText(match[2]), snippet: htmlToText(match[3]) });
    return results;
  } catch {
    return [];
  }
}

async function dispatchWebhooks(store, event, data) {
  const hooks = store.db.prepare('SELECT * FROM webhooks WHERE enabled=1').all().filter((hook) => JSON.parse(hook.events).includes(event));
  const body = JSON.stringify({ id: id('evt'), type: event, createdAt: now(), data: redact(data) });
  await Promise.allSettled(hooks.map(async (hook) => {
    let lastError;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const response = await fetch(hook.url, { method: 'POST', headers: { 'content-type': 'application/json', 'x-stratus-signature': hmac(hook.secret, body), 'x-stratus-attempt': String(attempt) }, body, signal: AbortSignal.timeout(5_000) });
        if (response.ok) return;
        lastError = new Error(`Webhook returned ${response.status}`);
      } catch (error) { lastError = error; }
    }
    throw lastError;
  }));
}

function openApi(baseUrl) {
  return {
    openapi: '3.1.0', info: { title: 'Stratus API', version: '0.1.0', description: 'Browser-agent cloud control plane' },
    servers: [{ url: baseUrl }], components: { securitySchemes: { ApiKey: { type: 'apiKey', in: 'header', name: 'X-Stratus-API-Key' } } },
    security: [{ ApiKey: [] }], paths: {
      '/v1/sessions': { get: { summary: 'List sessions' }, post: { summary: 'Create a browser session' } },
      '/v1/sessions/{id}': { get: { summary: 'Get a session' }, post: { summary: 'Release a session' } },
      '/v1/sessions/{id}/commands': { post: { summary: 'Control a browser session' } },
      '/v1/sessions/{id}/observe': { post: { summary: 'Observe interactive page elements' } },
      '/v1/sessions/{id}/act': { post: { summary: 'Act from a natural-language instruction' } },
      '/v1/sessions/{id}/extract': { post: { summary: 'Extract page content' } },
      '/v1/contexts': { get: { summary: 'List contexts' }, post: { summary: 'Create a context' } },
      '/v1/search': { post: { summary: 'Search the web' } }, '/v1/fetch': { post: { summary: 'Fetch a page' } },
      '/v1/functions': { get: { summary: 'List functions' }, post: { summary: 'Create a function' } },
      '/v1/chat/completions': { post: { summary: 'OpenAI-compatible model gateway' } }, '/v1/usage': { get: { summary: 'Get project usage and limits' } }
    }
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = createApp();
  app.server.listen(config.port, () => console.log(`Stratus is running at ${config.publicBaseUrl}`));
  const shutdown = async () => { await app.close(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
