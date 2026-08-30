import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
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

test('Railway managed-run endpoint is authenticated and validates before opening Chromium', async () => withApp(async (base) => {
  const unauthorized = await fetch(`${base}/api/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}'
  });
  assert.equal(unauthorized.status, 401);

  const wrongMethod = await request(base, '/api/run');
  assert.equal(wrongMethod.status, 405);

  const invalid = await request(base, '/api/run', { method: 'POST', body: '{}' });
  const body = await invalid.json();
  assert.equal(invalid.status, 400);
  assert.equal(body.error.code, 'INVALID_URL');
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
  const fetched = await (await request(base, '/v1/fetch', { method: 'POST', body: JSON.stringify({ url: `${base}/health` }) })).json();
  assert.equal(fetched.status, 200);
  assert.match(fetched.text, /status/);
  const extension = await (await request(base, '/v1/extensions', { method: 'POST', body: JSON.stringify({ name: 'test-extension', contentBase64: Buffer.from('extension-bytes').toString('base64') }) })).json();
  assert.equal(extension.bytes, 15);
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

test('signed webhooks deliver session lifecycle events', async () => {
  const deliveries = [];
  const receiver = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    deliveries.push({ signature: req.headers['x-stratus-signature'], body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
    res.writeHead(204).end();
  });
  await new Promise((resolve) => receiver.listen(0, '127.0.0.1', resolve));
  const receiverUrl = `http://127.0.0.1:${receiver.address().port}/events`;
  try {
    await withApp(async (base) => {
      const webhook = await (await request(base, '/v1/webhooks', { method: 'POST', body: JSON.stringify({ url: receiverUrl, events: ['session.started'], secret: 'verification-secret' }) })).json();
      assert.match(webhook.id, /^wh_/);
      await request(base, '/v1/sessions', { method: 'POST', body: JSON.stringify({ simulated: true }) });
      assert.equal(deliveries.length, 1);
      assert.equal(deliveries[0].body.type, 'session.started');
      assert.match(deliveries[0].signature, /^[a-f0-9]{64}$/);
    });
  } finally {
    await new Promise((resolve) => receiver.close(resolve));
  }
});

test('control plane covers teams, permissions, keys, agents, files, and retention', async () => withApp(async (base) => {
  const team = await (await request(base, '/v1/team')).json();
  assert.equal(team.members[0].role, 'ADMIN');
  assert.ok(team.permissions.VIEWER.includes('sessions.view'));

  const viewer = await (await request(base, '/v1/team/members', {
    method: 'POST', body: JSON.stringify({ email: 'viewer@example.com', role: 'VIEWER', projectIds: ['proj_stratus_demo'] })
  })).json();
  const denied = await request(base, '/v1/api-keys', {
    method: 'POST', headers: { 'X-Stratus-User': viewer.id }, body: JSON.stringify({ name: 'forbidden' })
  });
  assert.equal(denied.status, 403);

  const key = await (await request(base, '/v1/api-keys', { method: 'POST', body: JSON.stringify({ name: 'CI key' }) })).json();
  assert.match(key.secret, /^sk_stratus_/);
  const keyAuth = await fetch(`${base}/v1/projects`, { headers: { 'X-Stratus-API-Key': key.secret } });
  assert.equal(keyAuth.status, 200);

  const agent = await (await request(base, '/v1/agents', {
    method: 'POST', body: JSON.stringify({ name: 'Evidence collector', instructions: 'Collect a concise page summary.' })
  })).json();
  const run = await (await request(base, `/v1/agents/${agent.id}/runs`, {
    method: 'POST', body: JSON.stringify({ task: 'Verify agent lifecycle', simulated: true, mockResult: { verified: true } })
  })).json();
  assert.equal(run.status, 'COMPLETED');
  const messages = await (await request(base, `/v1/agent-runs/${run.id}/messages`)).json();
  assert.deepEqual(messages.at(-1).content.data, { verified: true });

  const file = await (await request(base, '/v1/files', {
    method: 'POST', body: JSON.stringify({ name: 'proof.txt', kind: 'upload', contentType: 'text/plain', contentBase64: Buffer.from('verified').toString('base64') })
  })).json();
  assert.equal(file.bytes, 8);
  const content = await (await request(base, `/v1/files/${file.id}/content`)).text();
  assert.equal(content, 'verified');

  const settings = await (await request(base, '/v1/project-settings', {
    method: 'PUT', body: JSON.stringify({ retentionDays: 7, zeroDataRetention: true, recordSessions: false })
  })).json();
  assert.equal(settings.retentionDays, 7);
  assert.equal(settings.zeroDataRetention, true);
  assert.equal(settings.recordSessions, false);
}));
