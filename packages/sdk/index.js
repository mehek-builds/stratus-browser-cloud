export class Stratus {
  constructor({ apiKey, baseUrl = 'http://localhost:4100' }) {
    if (!apiKey) throw new Error('apiKey is required');
    this.apiKey = apiKey;
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.sessions = {
      create: (input = {}) => this.request('/v1/sessions', { method: 'POST', body: input }),
      list: (query = {}) => this.request(`/v1/sessions?${new URLSearchParams(query)}`),
      retrieve: (sessionId) => this.request(`/v1/sessions/${sessionId}`),
      release: (sessionId) => this.request(`/v1/sessions/${sessionId}`, { method: 'POST', body: { status: 'REQUEST_RELEASE' } }),
      command: (sessionId, command) => this.request(`/v1/sessions/${sessionId}/commands`, { method: 'POST', body: command }),
      resume: (sessionId) => this.request(`/v1/sessions/${sessionId}/commands`, { method: 'POST', body: { action: 'resume' } }),
      recording: (sessionId) => this.request(`/v1/sessions/${sessionId}/recording`),
      observe: (sessionId, input = {}) => this.request(`/v1/sessions/${sessionId}/observe`, { method: 'POST', body: input }),
      act: (sessionId, instruction, options = {}) => this.request(`/v1/sessions/${sessionId}/act`, { method: 'POST', body: { instruction, ...options } }),
      extract: (sessionId, input = {}) => this.request(`/v1/sessions/${sessionId}/extract`, { method: 'POST', body: input }),
      protection: (sessionId) => this.request(`/v1/sessions/${sessionId}/protection`),
      debug: (sessionId) => this.request(`/v1/sessions/${sessionId}/debug`)
    };
    this.contexts = {
      create: (input = {}) => this.request('/v1/contexts', { method: 'POST', body: input }),
      list: () => this.request('/v1/contexts'),
      retrieve: (contextId) => this.request(`/v1/contexts/${contextId}`),
      update: (contextId, input) => this.request(`/v1/contexts/${contextId}`, { method: 'PUT', body: input }),
      delete: (contextId) => this.request(`/v1/contexts/${contextId}`, { method: 'DELETE' })
    };
    this.search = (query, options = {}) => this.request('/v1/search', { method: 'POST', body: { query, ...options } });
    this.fetch = (url, options = {}) => this.request('/v1/fetch', { method: 'POST', body: { url, ...options } });
    this.functions = { create: (input) => this.request('/v1/functions', { method: 'POST', body: input }), list: () => this.request('/v1/functions'), invoke: (functionId, input) => this.request(`/v1/functions/${functionId}/invoke`, { method: 'POST', body: input }) };
    this.agents = {
      create: (input) => this.request('/v1/agents', { method: 'POST', body: input }),
      list: () => this.request('/v1/agents'), retrieve: (agentId) => this.request(`/v1/agents/${agentId}`),
      update: (agentId, input) => this.request(`/v1/agents/${agentId}`, { method: 'PUT', body: input }),
      delete: (agentId) => this.request(`/v1/agents/${agentId}`, { method: 'DELETE' }),
      run: (agentId, input) => this.request(`/v1/agents/${agentId}/runs`, { method: 'POST', body: input }),
      runs: (agentId) => this.request(`/v1/agents/${agentId}/runs`),
      messages: (runId) => this.request(`/v1/agent-runs/${runId}/messages`),
      stop: (runId) => this.request(`/v1/agent-runs/${runId}/stop`, { method: 'POST', body: {} })
    };
    this.files = {
      list: (query = {}) => this.request(`/v1/files?${new URLSearchParams(query)}`),
      upload: ({ content, ...input }) => this.request('/v1/files', { method: 'POST', body: { ...input, contentBase64: toBase64(content) } }),
      retrieve: (fileId) => this.request(`/v1/files/${fileId}`),
      delete: (fileId) => this.request(`/v1/files/${fileId}`, { method: 'DELETE' })
    };
    this.team = { retrieve: () => this.request('/v1/team'), addMember: (input) => this.request('/v1/team/members', { method: 'POST', body: input }) };
    this.apiKeys = { list: () => this.request('/v1/api-keys'), create: (input = {}) => this.request('/v1/api-keys', { method: 'POST', body: input }), revoke: (keyId) => this.request(`/v1/api-keys/${keyId}`, { method: 'DELETE' }) };
    this.settings = { retrieve: () => this.request('/v1/project-settings'), update: (input) => this.request('/v1/project-settings', { method: 'PUT', body: input }) };
    this.models = { chat: (input) => this.request('/v1/chat/completions', { method: 'POST', body: input }) };
    this.usage = () => this.request('/v1/usage');
  }

  async request(path, { method = 'GET', body } = {}) {
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: { 'X-Stratus-API-Key': this.apiKey, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const data = await response.json();
    if (!response.ok) throw Object.assign(new Error(data.error?.message || `Stratus request failed: ${response.status}`), { status: response.status, code: data.error?.code, requestId: data.error?.requestId });
    return data;
  }
}

function toBase64(content) {
  if (typeof Buffer !== 'undefined') return Buffer.from(content).toString('base64');
  const bytes = content instanceof Uint8Array ? content : new TextEncoder().encode(String(content));
  return btoa(String.fromCharCode(...bytes));
}

export default Stratus;
