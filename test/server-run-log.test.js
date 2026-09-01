import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../src/server.js';

async function withApp(run) {
  const app = createApp({ database: ':memory:' });
  await new Promise((resolve) => app.server.listen(0, '127.0.0.1', resolve));
  const address = app.server.address();
  try { await run(`http://127.0.0.1:${address.port}`); } finally { await app.close(); }
}

function captureConsole(method) {
  const lines = [];
  const original = console[method];
  console[method] = (line) => { lines.push(String(line)); };
  return { lines, restore: () => { console[method] = original; } };
}

test('the Railway /api/run branch logs a refused run with its code and no page content', async () => withApp(async (base) => {
  const captured = captureConsole('error');
  try {
    const response = await fetch(`${base}/api/run`, {
      method: 'POST',
      headers: { 'X-Stratus-API-Key': 'sk_stratus_dev_change_me', 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'not a url', actions: [] }),
    });
    assert.equal(response.status, 400);
  } finally { captured.restore(); }
  const line = captured.lines.map((entry) => { try { return JSON.parse(entry); } catch { return null; } })
    .find((entry) => entry && entry.url === '/api/run');
  assert.ok(line, 'the request-level failure line was written');
  assert.equal(line.code, 'INVALID_URL');
  assert.equal(line.status, 400);
  assert.ok(!('runProgress' in line), 'no progress before a runner was spawned');
}));
