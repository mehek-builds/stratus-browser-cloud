import { id, now } from './utils.js';

export class AgentRuntime {
  constructor(store, browsers) {
    this.store = store;
    this.browsers = browsers;
  }

  list() {
    return this.store.db.prepare('SELECT * FROM agents ORDER BY created_at DESC').all().map(mapAgent);
  }

  get(agentId) {
    const row = this.store.db.prepare('SELECT * FROM agents WHERE id=?').get(agentId);
    return row ? mapAgent(row) : null;
  }

  create(input = {}) {
    if (!input.name) throw Object.assign(new Error('name is required'), { status: 400 });
    const timestamp = now();
    const agent = {
      id: id('agent'), projectId: this.store.project().id, name: input.name,
      instructions: input.instructions || '', resultSchema: input.resultSchema || null,
      createdAt: timestamp, updatedAt: timestamp
    };
    this.store.db.prepare(`INSERT INTO agents
      (id,project_id,name,instructions,result_schema,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?)`).run(agent.id, agent.projectId, agent.name, agent.instructions,
      agent.resultSchema ? JSON.stringify(agent.resultSchema) : null, agent.createdAt, agent.updatedAt);
    this.store.audit(agent.projectId, 'agent.created', agent.id, { name: agent.name });
    return agent;
  }

  update(agentId, input = {}) {
    const agent = this.get(agentId);
    if (!agent) return null;
    this.store.db.prepare('UPDATE agents SET name=?,instructions=?,result_schema=?,updated_at=? WHERE id=?')
      .run(input.name || agent.name, input.instructions ?? agent.instructions,
        JSON.stringify(input.resultSchema ?? agent.resultSchema), now(), agentId);
    return this.get(agentId);
  }

  delete(agentId) {
    const result = this.store.db.prepare('DELETE FROM agents WHERE id=?').run(agentId);
    return Number(result.changes) > 0;
  }

  runs(agentId) {
    return this.store.db.prepare('SELECT * FROM agent_runs WHERE agent_id=? ORDER BY created_at DESC').all(agentId).map(mapRun);
  }

  getRun(runId) {
    const row = this.store.db.prepare('SELECT * FROM agent_runs WHERE id=?').get(runId);
    return row ? mapRun(row) : null;
  }

  messages(runId) {
    return this.store.db.prepare('SELECT timestamp,role,content FROM agent_messages WHERE run_id=? ORDER BY id').all(runId)
      .map((row) => ({ ...row, content: JSON.parse(row.content) }));
  }

  async run(agentId, input = {}) {
    const agent = this.get(agentId);
    if (!agent) throw Object.assign(new Error('Agent not found'), { status: 404 });
    const run = { id: id('run'), agentId, projectId: agent.projectId, status: 'RUNNING', input, createdAt: now(), startedAt: now() };
    this.store.db.prepare(`INSERT INTO agent_runs
      (id,agent_id,project_id,status,input,created_at,started_at)
      VALUES (?,?,?,?,?,?,?)`).run(run.id, run.agentId, run.projectId, run.status, JSON.stringify(input), run.createdAt, run.startedAt);
    this.addMessage(run.id, 'user', { task: input.task || '', startUrl: input.startUrl || null });
    try {
      if (input.simulated) {
        const result = { completed: true, summary: `Completed: ${input.task || 'agent run'}`, data: input.mockResult || {} };
        return this.complete(run.id, result);
      }
      if (!input.startUrl) throw Object.assign(new Error('startUrl is required for a real agent run'), { status: 400 });
      const session = this.store.reserveSession({ region: input.region, contextId: input.contextId, browserSettings: input.browserSettings });
      const launched = await this.browsers.launch(session);
      this.store.db.prepare('UPDATE agent_runs SET session_id=? WHERE id=?').run(launched.id, run.id);
      await this.browsers.command(launched.id, { action: 'navigate', url: input.startUrl });
      const extracted = await this.browsers.agent(launched.id, 'extract', { selector: input.selector || 'body' });
      await this.browsers.release(launched.id);
      return this.complete(run.id, { completed: true, task: input.task || '', page: extracted });
    } catch (error) {
      this.store.db.prepare('UPDATE agent_runs SET status=?,error=?,ended_at=? WHERE id=?').run('FAILED', error.message, now(), run.id);
      this.addMessage(run.id, 'system', { error: error.message });
      error.runId = run.id;
      throw error;
    }
  }

  async stop(runId) {
    const run = this.getRun(runId);
    if (!run) return null;
    if (run.sessionId) await this.browsers.release(run.sessionId, 'CANCELLED').catch(() => {});
    this.store.db.prepare('UPDATE agent_runs SET status=?,ended_at=? WHERE id=?').run('STOPPED', now(), runId);
    this.addMessage(runId, 'system', { stopped: true });
    return this.getRun(runId);
  }

  complete(runId, result) {
    this.store.db.prepare('UPDATE agent_runs SET status=?,result=?,ended_at=? WHERE id=?').run('COMPLETED', JSON.stringify(result), now(), runId);
    this.addMessage(runId, 'assistant', result);
    return this.getRun(runId);
  }

  addMessage(runId, role, content) {
    this.store.db.prepare('INSERT INTO agent_messages (run_id,timestamp,role,content) VALUES (?,?,?,?)')
      .run(runId, now(), role, JSON.stringify(content));
  }
}

function mapAgent(row) {
  return {
    id: row.id, projectId: row.project_id, name: row.name, instructions: row.instructions,
    resultSchema: row.result_schema ? JSON.parse(row.result_schema) : null,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

function mapRun(row) {
  return {
    id: row.id, agentId: row.agent_id, projectId: row.project_id, status: row.status,
    input: JSON.parse(row.input), result: row.result ? JSON.parse(row.result) : null,
    error: row.error, createdAt: row.created_at, startedAt: row.started_at,
    endedAt: row.ended_at, sessionId: row.session_id
  };
}
