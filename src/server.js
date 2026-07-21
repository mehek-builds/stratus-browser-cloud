import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { WebSocketServer } from 'ws';
import { config, regions } from './config.js';
import { Store } from './store.js';
import { BrowserManager } from './browser-manager.js';
import { FunctionRuntime } from './function-runtime.js';
import { AgentRuntime } from './agent-runtime.js';
import { assertPublicUrl, htmlToText, textToMarkdown } from './security.js';
import { hmac, id, json, now, readJson, redact, sha256 } from './utils.js';

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
  const agents = new AgentRuntime(store, browsers);

  const server = http.createServer(async (req, res) => {
    const requestId = id('req');
    const started = Date.now();
    res.setHeader('x-request-id', requestId);
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type,x-stratus-api-key,x-bb-api-key,x-stratus-user,authorization');
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
      if (route === '/v1/team' && req.method === 'GET') {
        const organization = store.db.prepare('SELECT * FROM organizations LIMIT 1').get();
        const members = store.db.prepare(`SELECT u.id,u.email,u.name,m.role,m.project_ids projectIds,m.created_at createdAt
          FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.organization_id=? ORDER BY m.created_at`).all(organization.id)
          .map((member) => ({ ...member, projectIds: JSON.parse(member.projectIds) }));
        return json(res, 200, { id: organization.id, name: organization.name, members, permissions: rolePermissions });
      }
      if (route === '/v1/team/members' && req.method === 'POST') {
        requirePermission(store, req, 'members.manage');
        const body = await readJson(req);
        if (!body.email || !['ADMIN', 'CONTRIBUTOR', 'VIEWER'].includes(body.role)) throw Object.assign(new Error('email and a valid role are required'), { status: 400 });
        const userId = id('usr');
        const organization = store.db.prepare('SELECT id FROM organizations LIMIT 1').get();
        store.db.prepare('INSERT INTO users (id,email,name,created_at) VALUES (?,?,?,?)').run(userId, body.email, body.name || body.email.split('@')[0], now());
        store.db.prepare('INSERT INTO memberships (organization_id,user_id,role,project_ids,created_at) VALUES (?,?,?,?,?)')
          .run(organization.id, userId, body.role, JSON.stringify(body.projectIds || ['*']), now());
        return json(res, 201, { id: userId, email: body.email, role: body.role, projectIds: body.projectIds || ['*'] });
      }
      if (route === '/v1/api-keys' && req.method === 'GET') {
        return json(res, 200, store.db.prepare('SELECT id,name,prefix,created_at createdAt,last_used_at lastUsedAt,revoked_at revokedAt FROM api_keys ORDER BY created_at DESC').all());
      }
      if (route === '/v1/api-keys' && req.method === 'POST') {
        requirePermission(store, req, 'keys.regenerate');
        const body = await readJson(req);
        const secret = `sk_stratus_${crypto.randomBytes(24).toString('base64url')}`;
        const key = { id: id('key'), name: body.name || 'Project key', prefix: secret.slice(0, 14), createdAt: now() };
        store.db.prepare('INSERT INTO api_keys (id,project_id,name,key_hash,prefix,created_at) VALUES (?,?,?,?,?,?)')
          .run(key.id, store.project().id, key.name, sha256(secret), key.prefix, key.createdAt);
        return json(res, 201, { ...key, secret });
      }
      const keyMatch = route.match(/^\/v1\/api-keys\/([^/]+)$/);
      if (keyMatch && req.method === 'DELETE') {
        requirePermission(store, req, 'keys.regenerate');
        store.db.prepare('UPDATE api_keys SET revoked_at=? WHERE id=?').run(now(), keyMatch[1]);
        return json(res, 200, { id: keyMatch[1], revoked: true });
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
      const protectionMatch = route.match(/^\/v1\/sessions\/([^/]+)\/protection$/);
      if (protectionMatch && req.method === 'GET') return json(res, 200, browsers.protectionStatus(protectionMatch[1]));
      const debugMatch = route.match(/^\/v1\/sessions\/([^/]+)\/debug$/);
      if (debugMatch && req.method === 'GET') {
        const session = store.getSession(debugMatch[1]);
        if (!session) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'Session not found' } });
        const apiKeyValue = encodeURIComponent(String(apiKey));
        return json(res, 200, {
          debuggerUrl: `${config.publicBaseUrl}/#sessions`, debuggerFullscreenUrl: `${config.publicBaseUrl}/#playground`,
          wsUrl: `${config.publicBaseUrl.replace(/^http/, 'ws')}/v1/sessions/${session.id}/live?apiKey=${apiKeyValue}`,
          pages: [{ id: 'page-1', url: session.status === 'RUNNING' ? 'active' : 'closed' }]
        });
      }

      if (route === '/v1/contexts' && req.method === 'GET') return json(res, 200, store.listContexts());
      if (route === '/v1/contexts' && req.method === 'POST') return json(res, 201, store.createContext((await readJson(req)).name));
      const contextMatch = route.match(/^\/v1\/contexts\/([^/]+)$/);
      if (contextMatch && req.method === 'GET') {
        const context = store.getContext(contextMatch[1]);
        return context ? json(res, 200, { id: context.id, projectId: context.projectId, name: context.name, createdAt: context.createdAt, updatedAt: context.updatedAt }) : json(res, 404, { error: { code: 'NOT_FOUND', message: 'Context not found' } });
      }
      if (contextMatch && req.method === 'PUT') {
        const context = store.updateContext(contextMatch[1], await readJson(req));
        return context ? json(res, 200, context) : json(res, 404, { error: { code: 'NOT_FOUND', message: 'Context not found' } });
      }
      if (contextMatch && req.method === 'DELETE') return json(res, store.deleteContext(contextMatch[1]) ? 200 : 404, { deleted: true });

      if (route === '/v1/files' && req.method === 'GET') return json(res, 200, store.listArtifacts(url.searchParams.get('sessionId'), url.searchParams.get('kind')));
      if (route === '/v1/files' && req.method === 'POST') {
        const body = await readJson(req, 25_000_000);
        if (!body.name || !body.contentBase64) throw Object.assign(new Error('name and contentBase64 are required'), { status: 400 });
        const content = Buffer.from(body.contentBase64, 'base64');
        if (content.length > 15_000_000) throw Object.assign(new Error('Maximum decoded file size is 15 MB'), { status: 413 });
        return json(res, 201, store.createArtifact({ sessionId: body.sessionId, kind: body.kind || 'upload', name: body.name, contentType: body.contentType, content }));
      }
      const fileMatch = route.match(/^\/v1\/files\/([^/]+)$/);
      if (fileMatch && req.method === 'GET') {
        const artifact = store.getArtifact(fileMatch[1]);
        return artifact ? json(res, 200, artifact) : json(res, 404, { error: { code: 'NOT_FOUND', message: 'File not found' } });
      }
      if (fileMatch && req.method === 'DELETE') return json(res, store.deleteArtifact(fileMatch[1]) ? 200 : 404, { deleted: true });
      const contentMatch = route.match(/^\/v1\/files\/([^/]+)\/content$/);
      if (contentMatch && req.method === 'GET') {
        const artifact = store.getArtifact(contentMatch[1]);
        if (!artifact || !fs.existsSync(artifact.storagePath)) return json(res, 404, { error: { code: 'NOT_FOUND', message: 'File not found' } });
        res.writeHead(200, { 'content-type': artifact.contentType, 'content-length': artifact.bytes, 'content-disposition': `attachment; filename="${artifact.name}"` });
        return fs.createReadStream(artifact.storagePath).pipe(res);
      }

      if (route === '/v1/agents' && req.method === 'GET') return json(res, 200, agents.list());
      if (route === '/v1/agents' && req.method === 'POST') return json(res, 201, agents.create(await readJson(req)));
      const agentResourceMatch = route.match(/^\/v1\/agents\/([^/]+)$/);
      if (agentResourceMatch && req.method === 'GET') {
        const agent = agents.get(agentResourceMatch[1]);
        return agent ? json(res, 200, agent) : json(res, 404, { error: { code: 'NOT_FOUND', message: 'Agent not found' } });
      }
      if (agentResourceMatch && req.method === 'PUT') return json(res, 200, agents.update(agentResourceMatch[1], await readJson(req)));
      if (agentResourceMatch && req.method === 'DELETE') return json(res, agents.delete(agentResourceMatch[1]) ? 200 : 404, { deleted: true });
      const agentRunsMatch = route.match(/^\/v1\/agents\/([^/]+)\/runs$/);
      if (agentRunsMatch && req.method === 'GET') return json(res, 200, agents.runs(agentRunsMatch[1]));
      if (agentRunsMatch && req.method === 'POST') return json(res, 201, await agents.run(agentRunsMatch[1], await readJson(req)));
      const runMatch = route.match(/^\/v1\/agent-runs\/([^/]+)$/);
      if (runMatch && req.method === 'GET') {
        const run = agents.getRun(runMatch[1]);
        return run ? json(res, 200, run) : json(res, 404, { error: { code: 'NOT_FOUND', message: 'Agent run not found' } });
      }
      const runMessagesMatch = route.match(/^\/v1\/agent-runs\/([^/]+)\/messages$/);
      if (runMessagesMatch && req.method === 'GET') return json(res, 200, agents.messages(runMessagesMatch[1]));
      const stopRunMatch = route.match(/^\/v1\/agent-runs\/([^/]+)\/stop$/);
      if (stopRunMatch && req.method === 'POST') return json(res, 200, await agents.stop(stopRunMatch[1]));

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
      if (route === '/v1/extensions' && req.method === 'GET') return json(res, 200, store.db.prepare('SELECT id,project_id projectId,name,bytes,created_at createdAt FROM extensions ORDER BY created_at DESC').all());
      const extensionMatch = route.match(/^\/v1\/extensions\/([^/]+)$/);
      if (extensionMatch && req.method === 'GET') {
        const extension = store.db.prepare('SELECT id,project_id projectId,name,bytes,created_at createdAt FROM extensions WHERE id=?').get(extensionMatch[1]);
        return extension ? json(res, 200, extension) : json(res, 404, { error: { code: 'NOT_FOUND', message: 'Extension not found' } });
      }
      if (extensionMatch && req.method === 'DELETE') {
        const result = store.db.prepare('DELETE FROM extensions WHERE id=?').run(extensionMatch[1]);
        return json(res, Number(result.changes) ? 200 : 404, { deleted: Boolean(result.changes) });
      }
      if (route === '/v1/certificates' && req.method === 'GET') return json(res, 200, store.db.prepare('SELECT id,name,created_at createdAt FROM certificates ORDER BY created_at DESC').all());
      if (route === '/v1/certificates' && req.method === 'POST') {
        const body = await readJson(req);
        if (!body.name || !body.certificatePem || !body.keyPem) throw Object.assign(new Error('name, certificatePem, and keyPem are required'), { status: 400 });
        const certificate = { id: id('cert'), name: body.name, createdAt: now() };
        store.db.prepare('INSERT INTO certificates (id,project_id,name,certificate_pem,key_pem,created_at) VALUES (?,?,?,?,?,?)')
          .run(certificate.id, store.project().id, certificate.name, body.certificatePem, body.keyPem, certificate.createdAt);
        return json(res, 201, certificate);
      }
      const certificateMatch = route.match(/^\/v1\/certificates\/([^/]+)$/);
      if (certificateMatch && req.method === 'DELETE') {
        const result = store.db.prepare('DELETE FROM certificates WHERE id=?').run(certificateMatch[1]);
        return json(res, Number(result.changes) ? 200 : 404, { deleted: Boolean(result.changes) });
      }
      if (route === '/v1/project-settings' && req.method === 'GET') {
        const settings = store.db.prepare('SELECT * FROM project_settings WHERE project_id=?').get(store.project().id);
        return json(res, 200, mapSettings(settings));
      }
      if (route === '/v1/project-settings' && req.method === 'PUT') {
        requirePermission(store, req, 'project.settings');
        const body = await readJson(req);
        const current = store.db.prepare('SELECT * FROM project_settings WHERE project_id=?').get(store.project().id);
        store.db.prepare(`UPDATE project_settings SET retention_days=?,zero_data_retention=?,record_sessions=?,record_logs=?,updated_at=? WHERE project_id=?`)
          .run(Number(body.retentionDays ?? current.retention_days), body.zeroDataRetention ?? Boolean(current.zero_data_retention) ? 1 : 0,
            body.recordSessions ?? Boolean(current.record_sessions) ? 1 : 0, body.recordLogs ?? Boolean(current.record_logs) ? 1 : 0, now(), store.project().id);
        return json(res, 200, mapSettings(store.db.prepare('SELECT * FROM project_settings WHERE project_id=?').get(store.project().id)));
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

  return { server, store, browsers, functions, agents, close };
}

const rolePermissions = {
  ADMIN: ['members.manage', 'sessions.view', 'sessions.stop', 'usage.view', 'scripts.run', 'project.settings', 'keys.view', 'keys.regenerate'],
  CONTRIBUTOR: ['sessions.view', 'sessions.stop', 'usage.view', 'scripts.run', 'project.settings', 'keys.view'],
  VIEWER: ['sessions.view']
};

function requirePermission(store, req, permission) {
  const userId = req.headers['x-stratus-user'] || 'usr_owner';
  const membership = store.db.prepare('SELECT role FROM memberships WHERE user_id=?').get(userId);
  if (!membership || !rolePermissions[membership.role]?.includes(permission)) {
    throw Object.assign(new Error(`Role does not allow ${permission}`), { status: 403, code: 'FORBIDDEN' });
  }
}

function mapSettings(row) {
  return {
    projectId: row.project_id, retentionDays: row.retention_days,
    zeroDataRetention: Boolean(row.zero_data_retention), recordSessions: Boolean(row.record_sessions),
    recordLogs: Boolean(row.record_logs), updatedAt: row.updated_at
  };
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
      '/v1/sessions/{id}/protection': { get: { summary: 'Inspect detected protection challenges' } },
      '/v1/sessions/{id}/debug': { get: { summary: 'Get live debugger URLs' } },
      '/v1/contexts': { get: { summary: 'List contexts' }, post: { summary: 'Create a context' } },
      '/v1/agents': { get: { summary: 'List reusable agents' }, post: { summary: 'Create a reusable agent' } },
      '/v1/agents/{id}/runs': { get: { summary: 'List agent runs' }, post: { summary: 'Run an agent' } },
      '/v1/files': { get: { summary: 'List files' }, post: { summary: 'Upload a file' } },
      '/v1/team': { get: { summary: 'Get organization members and role permissions' } },
      '/v1/api-keys': { get: { summary: 'List project API keys' }, post: { summary: 'Create a project API key' } },
      '/v1/project-settings': { get: { summary: 'Get retention and recording settings' }, put: { summary: 'Update retention and recording settings' } },
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
