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
