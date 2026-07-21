<!-- /autoplan restore point: /Users/Mehek1/.gstack/projects/need-you-to-build/main-autoplan-restore-20260721-232106.md -->
# Stratus Platform Build Plan

## Product target

Build a clean-room, self-hostable browser-agent cloud that covers the full product surface of Browserbase as of 2026-07-21. The product name is Stratus. It must provide one API key for managed browser sessions, search, fetch, agent functions, model routing, observability, persistent identities, and SDK access.

## Confirmed premises

1. This is a full product platform, not a compatibility wrapper.
2. The implementation must run locally with real Chromium and include production deployment manifests.
3. The control plane must enforce a 100 concurrent session ceiling and a 500 browser-hour account allowance.
4. Verification must include automated tests, a real browser workflow, dashboard inspection, and screenshots.
5. Proprietary vendor partnerships and undisclosed Browserbase implementation details are outside the clean-room boundary. Equivalent extension points and open implementations are required.

## User journeys

1. Sign in to the dashboard and create a project.
2. Copy a project ID and API key.
3. Create a browser session through the REST API or TypeScript SDK.
4. Connect over Playwright-compatible CDP, navigate, interact, and capture evidence.
5. Watch the browser in Live View and inspect logs, network events, and recordings.
6. End or time out the session, persist usage, and update the 500-hour allowance.
7. Create and reuse a browser context with cookies and local storage.
8. Search the web and fetch a page as cleaned content.
9. Run an agent function immediately or from a schedule.
10. Route an OpenAI-compatible model request through one gateway.
11. Configure identity, proxy, viewport, metadata, extension, file, and webhook settings.

## Product surfaces

### Browser cloud

- Browser session create, list, get, release, timeout, and status APIs
- Playwright and Puppeteer CDP connection URLs
- Selenium endpoint contract and capability metadata
- Isolated Chromium worker processes
- Context persistence for cookies and storage
- Viewport, locale, timezone, geolocation, user agent, headers, blocklists, and metadata
- Proxy profiles and per-session proxy settings
- Extension upload and attachment metadata
- File upload and download artifact storage
- Session logs, console events, network events, screenshots, recording timeline, and live-view stream
- Session sharing tokens and signed inspector links
- Webhook delivery with retries and signatures

### Search and fetch

- Search API with pluggable provider adapters and a local demo provider
- Fetch API that returns HTML, text, or markdown
- SSRF protection, redirect limits, timeout controls, and response size limits
- Cache and request metering

### Agent runtime

- Function registry, versions, environment variables, invoke API, execution logs, and schedules
- Sandboxed Node worker process with strict time and output limits
- Browser session binding for functions
- Natural-language agent primitives: act, observe, and extract through a provider-neutral model adapter

### Model gateway

- OpenAI-compatible chat completion endpoint
- Provider registry, routing policy, retries, usage accounting, and redacted logs
- Local deterministic provider for offline verification

### Identity and access

- Users, organizations, projects, roles, API keys, and hashed secrets
- Persistent identity profiles backed by browser contexts
- Proxy and CAPTCHA provider extension points
- Rate limits, audit log, signed URLs, and project isolation

### Dashboard

- Overview with capacity, usage, running sessions, recent sessions, and service status
- Session list and inspector with live view, timeline, logs, network, artifacts, and metadata
- Playground that launches and controls a real browser
- Contexts, functions, schedules, API keys, webhooks, integrations, and settings screens
- Accessible responsive navigation and loading, empty, error, and success states

### Developer experience

- REST API under `/v1`
- TypeScript SDK with Browserbase-shaped session methods plus Stratus services
- CLI for login, projects, sessions, functions, and diagnostics
- OpenAPI document, copy-paste quickstart, Docker Compose, and Kubernetes deployment
- Health, readiness, metrics, and structured logging endpoints

## Architecture

```text
Dashboard / SDK / CLI
        |
        v
API gateway and auth
        |
        +--> control-plane database
        +--> usage and quota service
        +--> webhook dispatcher
        +--> search/fetch adapters
        +--> model gateway
        +--> function scheduler
        |
        v
session orchestrator -> browser worker pool -> isolated Chromium processes
        |                       |
        +--> event stream <-----+
        +--> artifact store
        +--> context store
        +--> live-view websocket
```

Local mode uses SQLite-compatible in-process persistence and filesystem artifacts. Production mode uses PostgreSQL, Redis, S3-compatible object storage, and horizontally scaled workers. The scheduler uses atomic leases and project-scoped counters so 100 concurrent sessions are an enforceable control-plane invariant. Worker replicas determine how much of that ceiling can run physically.

## Capacity contract

- `MAX_CONCURRENT_SESSIONS=100` by default
- `BROWSER_HOUR_ALLOWANCE=500` by default
- Atomic reservation before a session enters `RUNNING`
- Usage calculated from monotonic session start and end timestamps
- Quota rejection before launch when the allowance is exhausted
- Release always decrements concurrency exactly once
- Load tests exercise 100 simultaneous reservations and reject the 101st
- Kubernetes manifests support a worker replica count and per-pod browser capacity that total 100

## Security boundary

- API keys are shown once and stored as hashes
- Every query is project scoped
- Fetch denies private, loopback, link-local, and metadata-service destinations
- Function execution has no host secrets by default and is terminated on timeout
- Uploaded files and extensions are content-type and size limited
- Webhooks use HMAC signatures and bounded retries
- Sensitive headers, cookies, and model prompts are redacted from logs
- Browser processes run without host filesystem access in production containers

## Verification plan

- Unit tests for auth, quota, state transitions, usage accounting, signing, SSRF checks, and redaction
- API integration tests for projects, sessions, contexts, search, fetch, functions, models, webhooks, and artifacts
- Concurrency test for 100 accepted reservations plus one rejected request
- Browser worker test that launches Chromium, navigates to a deterministic local page, interacts, captures a screenshot, records events, and releases cleanly
- Dashboard end-to-end test that creates a session in Playground, observes Live View, opens Inspector, and verifies usage
- Production manifest validation and container health checks
- Screenshot evidence saved under `outputs/verification/`

## NOT in scope

- Copying Browserbase source code, trademarks, private APIs, proprietary datasets, or confidential partnerships
- Claiming production capacity that has not been provisioned on actual compute
- Circumventing site security controls or access policies
- Paid third-party proxy, CAPTCHA, search, or model capacity without credentials supplied by the operator

## Delivery order

1. Monorepo, schemas, storage, auth, quota, and API contracts
2. Real Chromium worker, session lifecycle, event capture, and artifacts
3. Dashboard, Playground, Live View, and Inspector
4. Contexts, search/fetch, functions, model gateway, identity, webhooks, and extensions
5. SDK, CLI, OpenAPI, docs, Compose, Kubernetes, and observability
6. Full tests, 100-concurrency load verification, screenshots, clean-room review, and GitHub publication
