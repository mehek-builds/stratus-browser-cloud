import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.js';
import { id, now, sha256 } from './utils.js';

fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'artifacts'), { recursive: true });
fs.mkdirSync(path.join(config.dataDir, 'contexts'), { recursive: true });

export class Store {
  constructor(filename = path.join(config.dataDir, 'stratus.db')) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      CREATE TABLE IF NOT EXISTS projects (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, api_key_hash TEXT NOT NULL,
        created_at TEXT NOT NULL, default_timeout INTEGER NOT NULL,
        concurrency INTEGER NOT NULL, browser_hour_allowance REAL NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, started_at TEXT,
        ended_at TEXT, expires_at TEXT NOT NULL, keep_alive INTEGER NOT NULL,
        region TEXT NOT NULL, context_id TEXT, metadata TEXT NOT NULL,
        settings TEXT NOT NULL, connect_url TEXT, selenium_url TEXT,
        signing_key TEXT, proxy_bytes INTEGER NOT NULL DEFAULT 0,
        avg_cpu REAL NOT NULL DEFAULT 0, memory_usage INTEGER NOT NULL DEFAULT 0,
        error TEXT
      );
      CREATE TABLE IF NOT EXISTS contexts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
        created_at TEXT NOT NULL, updated_at TEXT NOT NULL, state_path TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL,
        timestamp INTEGER NOT NULL, type TEXT NOT NULL, data TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS functions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
        code TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
        timeout_ms INTEGER NOT NULL, schedule TEXT, enabled INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS function_runs (
        id TEXT PRIMARY KEY, function_id TEXT NOT NULL, status TEXT NOT NULL,
        created_at TEXT NOT NULL, ended_at TEXT, input TEXT NOT NULL,
        output TEXT, error TEXT, logs TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, url TEXT NOT NULL,
        events TEXT NOT NULL, secret TEXT NOT NULL, enabled INTEGER NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS extensions (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
        bytes INTEGER NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL,
        timestamp TEXT NOT NULL, action TEXT NOT NULL, resource TEXT NOT NULL,
        metadata TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS organizations (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS memberships (
        organization_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL,
        project_ids TEXT NOT NULL, created_at TEXT NOT NULL,
        PRIMARY KEY (organization_id,user_id)
      );
      CREATE TABLE IF NOT EXISTS api_keys (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
        key_hash TEXT UNIQUE NOT NULL, prefix TEXT NOT NULL, created_at TEXT NOT NULL,
        last_used_at TEXT, revoked_at TEXT
      );
      CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
        instructions TEXT NOT NULL, result_schema TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS agent_runs (
        id TEXT PRIMARY KEY, agent_id TEXT NOT NULL, project_id TEXT NOT NULL,
        status TEXT NOT NULL, input TEXT NOT NULL, result TEXT, error TEXT,
        created_at TEXT NOT NULL, started_at TEXT, ended_at TEXT, session_id TEXT
      );
      CREATE TABLE IF NOT EXISTS agent_messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, run_id TEXT NOT NULL,
        timestamp TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS artifacts (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, session_id TEXT,
        kind TEXT NOT NULL, name TEXT NOT NULL, content_type TEXT NOT NULL,
        bytes INTEGER NOT NULL, storage_path TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS certificates (
        id TEXT PRIMARY KEY, project_id TEXT NOT NULL, name TEXT NOT NULL,
        certificate_pem TEXT NOT NULL, key_pem TEXT NOT NULL, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS project_settings (
        project_id TEXT PRIMARY KEY, retention_days INTEGER NOT NULL,
        zero_data_retention INTEGER NOT NULL, record_sessions INTEGER NOT NULL,
        record_logs INTEGER NOT NULL, updated_at TEXT NOT NULL
      );
    `);
    this.ensureDefaultProject();
    this.ensureControlPlane();
  }

  ensureControlPlane() {
    const project = this.project();
    if (!this.db.prepare('SELECT id FROM organizations LIMIT 1').get()) {
      const createdAt = now();
      this.db.prepare('INSERT INTO organizations (id,name,created_at) VALUES (?,?,?)').run('org_stratus_demo', 'Stratus Demo', createdAt);
      this.db.prepare('INSERT INTO users (id,email,name,created_at) VALUES (?,?,?,?)').run('usr_owner', 'owner@stratus.local', 'Project Owner', createdAt);
      this.db.prepare('INSERT INTO memberships (organization_id,user_id,role,project_ids,created_at) VALUES (?,?,?,?,?)').run('org_stratus_demo', 'usr_owner', 'ADMIN', JSON.stringify(['*']), createdAt);
    }
    if (!this.db.prepare('SELECT id FROM api_keys WHERE project_id=?').get(project.id)) {
      this.db.prepare('INSERT INTO api_keys (id,project_id,name,key_hash,prefix,created_at) VALUES (?,?,?,?,?,?)')
        .run('key_default', project.id, 'Development key', sha256(config.apiKey), config.apiKey.slice(0, 14), now());
    }
    this.db.prepare(`INSERT OR IGNORE INTO project_settings
      (project_id,retention_days,zero_data_retention,record_sessions,record_logs,updated_at)
      VALUES (?,?,?,?,?,?)`).run(project.id, 30, 0, 1, 1, now());
  }

  ensureDefaultProject() {
    const existing = this.db.prepare('SELECT * FROM projects LIMIT 1').get();
    if (existing) return existing;
    const project = {
      id: 'proj_stratus_demo',
      name: 'Stratus Demo',
      apiKeyHash: sha256(config.apiKey),
      createdAt: now(),
      defaultTimeout: 900,
      concurrency: config.maxConcurrentSessions,
      browserHourAllowance: config.browserHourAllowance
    };
    this.db.prepare(`INSERT INTO projects
      (id,name,api_key_hash,created_at,default_timeout,concurrency,browser_hour_allowance)
      VALUES (?,?,?,?,?,?,?)`).run(project.id, project.name, project.apiKeyHash, project.createdAt,
        project.defaultTimeout, project.concurrency, project.browserHourAllowance);
    return project;
  }

  project() {
    return this.db.prepare('SELECT * FROM projects LIMIT 1').get();
  }

  authenticate(apiKey) {
    if (!apiKey) return false;
    const hash = sha256(apiKey);
    const key = this.db.prepare('SELECT id FROM api_keys WHERE key_hash=? AND revoked_at IS NULL').get(hash);
    if (key) {
      this.db.prepare('UPDATE api_keys SET last_used_at=? WHERE id=?').run(now(), key.id);
      return true;
    }
    return Boolean(this.db.prepare('SELECT id FROM projects WHERE api_key_hash=?').get(hash));
  }

  runningCount() {
    return Number(this.db.prepare("SELECT COUNT(*) count FROM sessions WHERE status IN ('PENDING','RUNNING')").get().count);
  }

  usedHours() {
    const rows = this.db.prepare("SELECT started_at, ended_at FROM sessions WHERE started_at IS NOT NULL").all();
    const current = Date.now();
    return rows.reduce((sum, row) => {
      const start = new Date(row.started_at).getTime();
      const end = row.ended_at ? new Date(row.ended_at).getTime() : current;
      return sum + Math.max(0, end - start) / 3_600_000;
    }, 0);
  }

  reserveSession(input = {}) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const project = this.project();
      const running = this.runningCount();
      const used = this.usedHours();
      if (running >= project.concurrency) {
        throw Object.assign(new Error(`Concurrency limit reached: ${project.concurrency}`), { status: 429, code: 'CONCURRENCY_LIMIT' });
      }
      if (used >= project.browser_hour_allowance) {
        throw Object.assign(new Error(`Browser-hour allowance exhausted: ${project.browser_hour_allowance}`), { status: 402, code: 'BROWSER_HOURS_EXHAUSTED' });
      }
      const timeout = Math.max(60, Math.min(21600, Number(input.timeout || project.default_timeout)));
      const createdAt = now();
      const session = {
        id: id('sess'), projectId: project.id, status: 'PENDING', createdAt, updatedAt: createdAt,
        startedAt: null, endedAt: null, expiresAt: new Date(Date.now() + timeout * 1000).toISOString(),
        keepAlive: Boolean(input.keepAlive), region: input.region || 'us-west-2', contextId: input.context?.id || input.contextId || null,
        userMetadata: input.userMetadata || {}, browserSettings: input.browserSettings || {}, proxyBytes: 0
      };
      this.db.prepare(`INSERT INTO sessions
        (id,project_id,status,created_at,updated_at,expires_at,keep_alive,region,context_id,metadata,settings)
        VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(session.id, session.projectId, session.status, session.createdAt,
          session.updatedAt, session.expiresAt, session.keepAlive ? 1 : 0, session.region, session.contextId,
          JSON.stringify(session.userMetadata), JSON.stringify(session.browserSettings));
      this.audit(project.id, 'session.reserved', session.id, { region: session.region });
      this.db.exec('COMMIT');
      return session;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  updateSession(sessionId, fields) {
    const allowed = {
      status: 'status', startedAt: 'started_at', endedAt: 'ended_at', connectUrl: 'connect_url',
      seleniumRemoteUrl: 'selenium_url', signingKey: 'signing_key', proxyBytes: 'proxy_bytes',
      avgCpuUsage: 'avg_cpu', memoryUsage: 'memory_usage', error: 'error'
    };
    const entries = Object.entries(fields).filter(([key]) => allowed[key]);
    if (!entries.length) return this.getSession(sessionId);
    entries.push(['updatedAt', now()]);
    const clauses = entries.map(([key]) => `${allowed[key] || 'updated_at'}=?`).join(',');
    this.db.prepare(`UPDATE sessions SET ${clauses} WHERE id=?`).run(...entries.map(([, value]) => value), sessionId);
    return this.getSession(sessionId);
  }

  getSession(sessionId) {
    const row = this.db.prepare('SELECT * FROM sessions WHERE id=?').get(sessionId);
    return row ? this.mapSession(row) : null;
  }

  listSessions(status, query) {
    let rows = status
      ? this.db.prepare('SELECT * FROM sessions WHERE status=? ORDER BY created_at DESC').all(status)
      : this.db.prepare('SELECT * FROM sessions ORDER BY created_at DESC').all();
    if (query) rows = rows.filter((row) => JSON.stringify(JSON.parse(row.metadata)).includes(query));
    return rows.map((row) => this.mapSession(row));
  }

  mapSession(row) {
    return {
      id: row.id, projectId: row.project_id, status: row.status, createdAt: row.created_at,
      updatedAt: row.updated_at, startedAt: row.started_at, endedAt: row.ended_at,
      expiresAt: row.expires_at, keepAlive: Boolean(row.keep_alive), region: row.region,
      contextId: row.context_id, userMetadata: JSON.parse(row.metadata), browserSettings: JSON.parse(row.settings),
      proxyBytes: row.proxy_bytes, avgCpuUsage: row.avg_cpu, memoryUsage: row.memory_usage,
      connectUrl: row.connect_url, seleniumRemoteUrl: row.selenium_url, signingKey: row.signing_key,
      error: row.error
    };
  }

  addEvent(sessionId, type, data) {
    const timestamp = Date.now();
    this.db.prepare('INSERT INTO events (session_id,timestamp,type,data) VALUES (?,?,?,?)')
      .run(sessionId, timestamp, type, JSON.stringify(data));
    return { sessionId, timestamp, type, data };
  }

  events(sessionId) {
    return this.db.prepare('SELECT timestamp,type,data FROM events WHERE session_id=? ORDER BY id').all(sessionId)
      .map((row) => ({ sessionId, timestamp: row.timestamp, type: row.type, data: JSON.parse(row.data) }));
  }

  createContext(name = 'Persistent identity') {
    const project = this.project();
    const context = { id: id('ctx'), projectId: project.id, name, createdAt: now(), updatedAt: now() };
    context.statePath = path.join(config.dataDir, 'contexts', `${context.id}.json`);
    fs.writeFileSync(context.statePath, JSON.stringify({ cookies: [], origins: [] }));
    this.db.prepare('INSERT INTO contexts (id,project_id,name,created_at,updated_at,state_path) VALUES (?,?,?,?,?,?)')
      .run(context.id, context.projectId, context.name, context.createdAt, context.updatedAt, context.statePath);
    return context;
  }

  listContexts() {
    return this.db.prepare('SELECT id,project_id projectId,name,created_at createdAt,updated_at updatedAt FROM contexts ORDER BY created_at DESC').all();
  }

  getContext(contextId) {
    return this.db.prepare('SELECT id,project_id projectId,name,created_at createdAt,updated_at updatedAt,state_path statePath FROM contexts WHERE id=?').get(contextId);
  }

  updateContext(contextId, input = {}) {
    const context = this.getContext(contextId);
    if (!context) return null;
    this.db.prepare('UPDATE contexts SET name=?,updated_at=? WHERE id=?').run(input.name || context.name, now(), contextId);
    return this.getContext(contextId);
  }

  deleteContext(contextId) {
    const context = this.getContext(contextId);
    if (!context) return false;
    this.db.prepare('DELETE FROM contexts WHERE id=?').run(contextId);
    if (context.statePath && fs.existsSync(context.statePath)) fs.unlinkSync(context.statePath);
    return true;
  }

  createArtifact({ sessionId = null, kind, name, contentType = 'application/octet-stream', content }) {
    const project = this.project();
    const artifactId = id('file');
    const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = path.join(config.dataDir, 'artifacts', `${artifactId}-${safeName}`);
    const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content || '');
    fs.writeFileSync(storagePath, buffer);
    const artifact = { id: artifactId, projectId: project.id, sessionId, kind, name: safeName, contentType, bytes: buffer.length, storagePath, createdAt: now() };
    this.db.prepare(`INSERT INTO artifacts
      (id,project_id,session_id,kind,name,content_type,bytes,storage_path,created_at)
      VALUES (?,?,?,?,?,?,?,?,?)`).run(artifact.id, artifact.projectId, artifact.sessionId, artifact.kind, artifact.name, artifact.contentType, artifact.bytes, artifact.storagePath, artifact.createdAt);
    return artifact;
  }

  listArtifacts(sessionId, kind) {
    let rows = this.db.prepare('SELECT * FROM artifacts ORDER BY created_at DESC').all();
    if (sessionId) rows = rows.filter((row) => row.session_id === sessionId);
    if (kind) rows = rows.filter((row) => row.kind === kind);
    return rows.map(mapArtifact);
  }

  getArtifact(artifactId) {
    const row = this.db.prepare('SELECT * FROM artifacts WHERE id=?').get(artifactId);
    return row ? mapArtifact(row) : null;
  }

  deleteArtifact(artifactId) {
    const artifact = this.getArtifact(artifactId);
    if (!artifact) return false;
    this.db.prepare('DELETE FROM artifacts WHERE id=?').run(artifactId);
    if (fs.existsSync(artifact.storagePath)) fs.unlinkSync(artifact.storagePath);
    return true;
  }

  audit(projectId, action, resource, metadata = {}) {
    this.db.prepare('INSERT INTO audit_log (project_id,timestamp,action,resource,metadata) VALUES (?,?,?,?,?)')
      .run(projectId, now(), action, resource, JSON.stringify(metadata));
  }

  usage() {
    const project = this.project();
    const used = this.usedHours();
    return {
      concurrent: this.runningCount(), concurrentLimit: project.concurrency,
      browserHoursUsed: Number(used.toFixed(4)), browserHoursAllowance: project.browser_hour_allowance,
      browserHoursRemaining: Number(Math.max(0, project.browser_hour_allowance - used).toFixed(4))
    };
  }
}

function mapArtifact(row) {
  return {
    id: row.id, projectId: row.project_id, sessionId: row.session_id, kind: row.kind,
    name: row.name, contentType: row.content_type, bytes: row.bytes,
    storagePath: row.storage_path, createdAt: row.created_at, downloadUrl: `/v1/files/${row.id}/content`
  };
}
