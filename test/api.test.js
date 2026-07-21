import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

async function withApp(run) {
  const app = createApp({ database: ':memory:' });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  try { await run(`http://127.0.0.1:${address.port}`); } finally { await app.close(); }
}

const headers = { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me', 'Content-Type': 'application/json' };
const request = (base, path, options = {}) => fetch(`${base}${path}`, { ...options, headers: { ...headers, ...(options.headers || {}) } });

test('API rejects missing credentials with an actionable error', async () => withApp(async (base) => {
  const response = await fetch(`${base}/v1/projects`);
  const body = await response.json();
  assert.equal(response.status, 401);
  assert.match(body.error.message, /valid API key/i);
}));

test('API covers project, context, function, model, and usage flows', async () => withApp(async (base) => {
  assert.equal((await request(base, '/v1/projects')).status, 200);
  const context = await (await request(base, '/v1/contexts', { method: 'POST', body: JSON.stringify({ name: 'API identity' }) })).json();
  assert.match(context.id, /^ctx_/);
  const fn = await (await request(base, '/v1/functions', { method: 'POST', body: JSON.stringify({ name: 'echo', code: 'return { echo: input.value };' }) })).json();
  const run = await (await request(base, `/v1/functions/${fn.id}/invoke`, { method: 'POST', body: JSON.stringify({ value: 42 }) })).json();
  assert.deepEqual(run.output, { echo: 42 });
  const completion = await (await request(base, '/v1/chat/completions', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }) })).json();
  assert.match(completion.choices[0].message.content, /hello/);
  const usage = await (await request(base, '/v1/usage')).json();
  assert.equal(usage.concurrentLimit, 100);
  assert.equal(usage.browserHoursAllowance, 500);
}));

test('simulated session API records lifecycle and events without consuming browser compute', async () => withApp(async (base) => {
  const createdResponse = await request(base, '/v1/sessions', { method: 'POST', body: JSON.stringify({ simulated: true, userMetadata: { suite: 'api' } }) });
  assert.equal(createdResponse.status, 201);
  const session = await createdResponse.json();
  assert.equal(session.status, 'RUNNING');
  const released = await (await request(base, `/v1/sessions/${session.id}`, { method: 'POST', body: JSON.stringify({ status: 'REQUEST_RELEASE' }) })).json();
  assert.equal(released.status, 'COMPLETED');
  const events = await (await request(base, `/v1/sessions/${session.id}/recording`)).json();
  assert.ok(events.some((event) => event.type === 'session.started'));
  assert.ok(events.some((event) => event.type === 'session.ended'));
}));
