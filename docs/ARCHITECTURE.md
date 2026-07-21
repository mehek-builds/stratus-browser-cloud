# Architecture

```text
Dashboard, SDK, CLI
        |
        v
HTTP API and API-key auth
        |
        +----> SQLite control-plane store
        +----> atomic quota reservation
        +----> search and fetch adapters
        +----> sandboxed function runtime
        +----> model provider router
        +----> signed webhook dispatcher
        |
        v
Browser manager
        |
        +----> Playwright browser server and WebSocket endpoint
        +----> isolated browser context
        +----> page event capture
        +----> live JPEG frames
        +----> artifact and context persistence
```

## Session state machine

```text
POST /sessions
      |
      v
   PENDING ---- launch failure ----> ERROR
      |
      v
   RUNNING ---- timeout -----------> TIMED_OUT
      |
      +-------- release -----------> COMPLETED
```

The store reserves capacity inside `BEGIN IMMEDIATE`, so two creators cannot take the same final slot. `PENDING` and `RUNNING` count against concurrency. Terminal states do not. Browser time is derived from persisted start and end timestamps, including time consumed by sessions that are still running.

## Failure modes

| Failure | Detection | User result | Recovery |
|---|---|---|---|
| Chromium missing | Readiness probe and launch error | Session enters `ERROR` with request ID | Install Chrome or correct executable path |
| 101st concurrent request | Atomic counter check | HTTP 429 `CONCURRENCY_LIMIT` | Release a browser or add capacity later |
| 500 hours exhausted | Usage check before reservation | HTTP 402 `BROWSER_HOURS_EXHAUSTED` | Increase allowance or wait for a new billing period |
| Browser timeout | Per-session timer | `TIMED_OUT` event and usage persisted | Create a new session |
| Function exception | VM error capture | HTTP 422 with run ID | Inspect run logs and deploy corrected code |
| Private fetch target | DNS resolution and range check | HTTP 403 `SSRF_BLOCKED` | Fetch a public URL |
| Webhook destination fails | Three bounded attempts | Server log and no silent retry loop | Fix endpoint and replay from audit data |

## Production evolution

The current build is a verified single-node platform. A multi-node fleet should replace SQLite with PostgreSQL, use Redis leases for worker assignment and counters, place artifacts in S3-compatible storage, and route Playwright WebSockets through a session-aware proxy. Those changes are required before claiming region-distributed physical capacity.
