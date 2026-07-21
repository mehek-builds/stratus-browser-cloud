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
      recording: (sessionId) => this.request(`/v1/sessions/${sessionId}/recording`),
      observe: (sessionId, input = {}) => this.request(`/v1/sessions/${sessionId}/observe`, { method: 'POST', body: input }),
      act: (sessionId, instruction, options = {}) => this.request(`/v1/sessions/${sessionId}/act`, { method: 'POST', body: { instruction, ...options } }),
      extract: (sessionId, input = {}) => this.request(`/v1/sessions/${sessionId}/extract`, { method: 'POST', body: input })
    };
    this.contexts = { create: (input = {}) => this.request('/v1/contexts', { method: 'POST', body: input }), list: () => this.request('/v1/contexts') };
    this.search = (query, options = {}) => this.request('/v1/search', { method: 'POST', body: { query, ...options } });
    this.fetch = (url, options = {}) => this.request('/v1/fetch', { method: 'POST', body: { url, ...options } });
    this.functions = { create: (input) => this.request('/v1/functions', { method: 'POST', body: input }), list: () => this.request('/v1/functions'), invoke: (functionId, input) => this.request(`/v1/functions/${functionId}/invoke`, { method: 'POST', body: input }) };
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

export default Stratus;
