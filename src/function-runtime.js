import vm from 'node:vm';
import { id, now, redact } from './utils.js';

export class FunctionRuntime {
  constructor(store, browserManager) {
    this.store = store;
    this.browserManager = browserManager;
  }

  create(input) {
    if (!input.name || !input.code) throw Object.assign(new Error('name and code are required'), { status: 400 });
    const fn = {
      id: id('fn'), projectId: this.store.project().id, name: input.name, code: input.code,
      createdAt: now(), updatedAt: now(), timeoutMs: Math.min(Number(input.timeoutMs || 30_000), 120_000),
      schedule: input.schedule || null, enabled: input.enabled !== false
    };
    this.store.db.prepare(`INSERT INTO functions
      (id,project_id,name,code,created_at,updated_at,timeout_ms,schedule,enabled) VALUES (?,?,?,?,?,?,?,?,?)`)
      .run(fn.id, fn.projectId, fn.name, fn.code, fn.createdAt, fn.updatedAt, fn.timeoutMs, fn.schedule, fn.enabled ? 1 : 0);
    return fn;
  }

  list() {
    return this.store.db.prepare('SELECT id,project_id projectId,name,created_at createdAt,updated_at updatedAt,timeout_ms timeoutMs,schedule,enabled FROM functions ORDER BY created_at DESC').all()
      .map((row) => ({ ...row, enabled: Boolean(row.enabled) }));
  }

  async invoke(functionId, input = {}) {
    const fn = this.store.db.prepare('SELECT * FROM functions WHERE id=?').get(functionId);
    if (!fn) throw Object.assign(new Error('Function not found'), { status: 404 });
    const runId = id('run');
    const createdAt = now();
    const logs = [];
    this.store.db.prepare('INSERT INTO function_runs (id,function_id,status,created_at,input,logs) VALUES (?,?,?,?,?,?)')
      .run(runId, functionId, 'RUNNING', createdAt, JSON.stringify(redact(input)), '[]');
    try {
      const sandbox = {
        input: structuredClone(input),
        console: { log: (...args) => logs.push(args.map(String).join(' ')) },
        result: undefined,
        fetch: async (url, options = {}) => {
          const response = await fetch(url, { ...options, signal: AbortSignal.timeout(10_000) });
          return { status: response.status, text: await response.text() };
        }
      };
      const context = vm.createContext(sandbox, { name: `stratus-function-${functionId}`, codeGeneration: { strings: false, wasm: false } });
      const script = new vm.Script(`(async () => { ${fn.code}\n })()`, { filename: `${fn.name}.js` });
      const output = await script.runInContext(context, { timeout: fn.timeout_ms });
      const endedAt = now();
      this.store.db.prepare('UPDATE function_runs SET status=?,ended_at=?,output=?,logs=? WHERE id=?')
        .run('COMPLETED', endedAt, JSON.stringify(redact(output)), JSON.stringify(logs), runId);
      return { id: runId, functionId, status: 'COMPLETED', createdAt, endedAt, output, logs };
    } catch (error) {
      const endedAt = now();
      this.store.db.prepare('UPDATE function_runs SET status=?,ended_at=?,error=?,logs=? WHERE id=?')
        .run('ERROR', endedAt, error.message, JSON.stringify(logs), runId);
      throw Object.assign(new Error(`Function failed: ${error.message}`), { status: 422, runId });
    }
  }
}
