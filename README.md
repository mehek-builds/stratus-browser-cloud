# Stratus

Stratus is a clean-room, self-hostable browser-agent cloud. It combines managed Chromium sessions, persistent identities, live view, session recordings, search and fetch, agent functions, an OpenAI-compatible model gateway, usage metering, SDK access, and an operations dashboard under one API key.

## What works

- Real isolated Chromium sessions with Playwright WebSocket endpoints
- Session create, list, inspect, command, release, timeout, metadata, and region contracts
- Live browser frames, console events, network events, command timeline, screenshots, and artifacts
- Persistent browser contexts for cookies and storage state
- Strict 100 concurrent-session reservation limit
- Strict 500 browser-hour project allowance and real-time usage accounting
- Search provider adapter and SSRF-protected fetch endpoint
- Sandboxed JavaScript functions with logs, timeouts, inputs, outputs, and schedules metadata
- OpenAI-compatible chat completion gateway with an offline deterministic provider
- Signed webhooks with three bounded delivery attempts
- Extension metadata upload, audit log, health, readiness, metrics, and OpenAPI endpoints
- TypeScript-compatible JavaScript SDK and CLI
- Responsive operations dashboard, Playground, Live View, Inspector, identities, functions, and gateway screens

## Run locally

Requirements: Node.js 22 or newer and Google Chrome installed.

```bash
npm install
cp .env.example .env
npm start
```

Open [http://localhost:4100](http://localhost:4100). The development key is `sk_stratus_dev_change_me`.

## Launch a real browser

```bash
curl -X POST http://localhost:4100/v1/sessions \
  -H 'X-Stratus-API-Key: sk_stratus_dev_change_me' \
  -H 'Content-Type: application/json' \
  -d '{"region":"us-west-2","keepAlive":true,"browserSettings":{"viewport":{"width":1440,"height":900}}}'
```

The response includes a Playwright `connectUrl`. You can also drive the session through the command API:

```bash
curl -X POST http://localhost:4100/v1/sessions/SESSION_ID/commands \
  -H 'X-Stratus-API-Key: sk_stratus_dev_change_me' \
  -H 'Content-Type: application/json' \
  -d '{"action":"navigate","url":"https://example.com"}'
```

Supported command actions are `navigate`, `click`, `fill`, `evaluate`, `content`, and `screenshot`.

## SDK

```js
import { Stratus } from './packages/sdk/index.js';

const stratus = new Stratus({
  apiKey: process.env.STRATUS_API_KEY,
  baseUrl: 'http://localhost:4100'
});

const session = await stratus.sessions.create({
  region: 'us-west-2',
  keepAlive: true
});

await stratus.sessions.command(session.id, {
  action: 'navigate',
  url: 'https://example.com'
});

await stratus.sessions.release(session.id);
```

## CLI

```bash
node bin/stratus.js doctor
node bin/stratus.js usage
node bin/stratus.js launch us-west-2
node bin/stratus.js sessions
node bin/stratus.js release SESSION_ID
```

## Verify

```bash
npm run verify
```

The verification suite checks auth, state transitions, quota accounting, SSRF defenses, redaction, contexts, functions, the model gateway, 100 concurrent reservations, the rejected 101st reservation, and a real Chromium dashboard flow. Screenshot evidence is written to `outputs/verification/`.

## Capacity and production boundary

The control plane atomically enforces 100 session reservations and a 500-hour allowance. Actual simultaneous Chromium capacity depends on the compute assigned to the running Stratus process. The included Kubernetes manifest requests a large dedicated node because 100 browsers cannot be truthfully guaranteed on a laptop or a small container. For a production fleet, split the browser manager into worker pods backed by PostgreSQL and Redis leases, then scale workers until the capacity test passes on the target cluster.

## API map

| Surface | Endpoints |
|---|---|
| Sessions | `GET/POST /v1/sessions`, `GET/POST /v1/sessions/:id` |
| Control | `POST /v1/sessions/:id/commands`, `GET /live-frame`, WebSocket `/live` |
| Observability | `GET /recording`, `GET /logs`, `GET /network`, `GET /metrics` |
| Identities | `GET/POST /v1/contexts` |
| Retrieval | `POST /v1/search`, `POST /v1/fetch` |
| Functions | `GET/POST /v1/functions`, `POST /v1/functions/:id/invoke` |
| Models | `POST /v1/chat/completions` |
| Integrations | `GET/POST /v1/webhooks`, `POST /v1/extensions` |
| Project | `GET /v1/projects`, `GET /v1/usage`, `GET /v1/audit-log` |
| Operations | `GET /health`, `GET /ready`, `GET /metrics`, `GET /openapi.json` |

## Clean-room boundary

Stratus does not copy Browserbase source code, branding, private APIs, proprietary datasets, or confidential partnerships. It implements the product category from public behavior and open infrastructure. Paid proxy, CAPTCHA, search, and model providers require operator-supplied credentials and adapters.
