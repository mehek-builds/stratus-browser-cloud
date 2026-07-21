# Stratus and Browserbase parity audit

Audit date: 2026-07-22

## Result

Stratus now implements the main clean-room product categories of a browser-agent cloud: managed Chromium sessions, CDP connectivity, live view, browser commands, observe/act/extract, persistent contexts, reusable agents and runs, server-side functions, search and fetch, model routing, files, extensions, webhooks, teams and roles, project keys, usage limits, retention controls, audit logs, SDK/CLI access, and an operations dashboard.

This is not a claim that Stratus is Browserbase, that it has Browserbase certifications or partner inventory, or that a single local process can physically supply 100 simultaneous browsers. The code enforces 100 reservations and 500 browser hours. Physical concurrency requires a provisioned worker fleet and a load test against that fleet.

## Capability matrix

| Area | Browserbase public surface | Stratus status | Evidence or boundary |
|---|---|---|---|
| Sessions | Create, connect, inspect, release, timeouts, keep-alive, regions, metadata | Implemented | REST API, Playwright WebSocket endpoint, lifecycle tests |
| Capacity plan | Startup tier lists 100 concurrency and 500 browser hours | Contract implemented | Atomic 100 reservation test, 101st rejection, 500-hour accounting |
| Live and observability | Live view, logs, network, recording, replay | Partially implemented | Live JPEG frames and event timeline work. HLS/rrweb replay is not implemented |
| Browser automation | Playwright, Puppeteer, Selenium | Partial | Playwright CDP is real. Puppeteer can use CDP. Selenium URL is contract metadata, not a Grid implementation |
| Contexts | Persistent browser contexts | Implemented | Create, read, update, delete, persisted storage state |
| Files | Uploads and session downloads | Implemented | Project file CRUD, content download, screenshots and PDFs as artifacts |
| Extensions | Upload, get, list, delete | Implemented at metadata/API level | Extension execution packaging still needs signed browser deployment handling |
| Agents | Reusable agents, runs, messages, results, stop | Implemented | CRUD, real URL run path, deterministic test path, message history |
| Agent primitives | Navigate, act, observe, extract | Implemented | Real-browser E2E |
| Functions | Deploy and invoke runtime functions | Partial | Sandboxed JavaScript execution works. Remote build/version pipeline is not implemented |
| Search and Fetch | Agent retrieval APIs | Implemented with adapters | DuckDuckGo HTML search and SSRF-protected fetch |
| Model gateway | Unified model route and BYO model | Partial | OpenAI-shaped endpoint and local provider work. Hosted provider adapters need credentials |
| Team roles | Admin, Contributor, Viewer, selected projects | Implemented in control-plane model | Permission matrix, memberships, selected project IDs, forbidden Viewer key rotation test |
| Project keys | View and regenerate project keys | Implemented | Hashed storage, one-time secret return, revoke, last-used time |
| Data controls | Recording/log toggles, retention, ZDR | Implemented as settings | Dashboard and API verified. Storage deletion worker is still required for timed purging |
| Enterprise auth | SSO/SAML | Not implemented | Requires an identity provider and enterprise configuration |
| BYOS | Customer S3 buckets | Not implemented | Requires cloud credentials and object-store adapter |
| Proxies | Managed residential and custom proxy inventory | Adapter boundary only | No proxy supplier or paid inventory is bundled |
| CAPTCHA | Automatic solving | Not implemented by design | Stratus detects challenges, captures evidence, pauses, and supports human review |
| Verified agents | Partner identity and allow-listing | Not implemented | Requires external partnerships and authorization |
| Isolation | One browser per VM, subnet and firewall controls | Deployment-dependent | Local mode uses isolated browser processes. Dedicated VM isolation needs cloud infrastructure |
| Compliance | SOC 2, HIPAA, BAA, DPA | Not a code feature | Requires audits, policies, contracts, and an operated environment |
| Regions | US, EU, Asia placement | Contract only in local mode | Real placement requires regional clusters |
| Dashboard | Sessions, playground, contexts, agents, functions, API, settings | Implemented | Desktop and mobile browser screenshots |

## Permission parity

The implemented dashboard permission matrix follows Browserbase's published team roles:

| Permission | Admin | Contributor | Viewer |
|---|---:|---:|---:|
| Manage members | Yes | No | No |
| View sessions | Yes | Yes | Yes |
| Stop sessions | Yes | Yes | No |
| View usage | Yes | Yes | No |
| Run scripts | Yes | Yes | No |
| Change project settings | Yes | Yes | No |
| View API keys | Yes | Yes | No |
| Regenerate API keys | Yes | No | No |

## Official comparison sources

- [Browserbase pricing](https://www.browserbase.com/pricing)
- [Browserbase team roles](https://docs.browserbase.com/account/team/roles)
- [Browserbase enterprise security](https://docs.browserbase.com/account/enterprise/security)
- [Browserbase create session API](https://docs.browserbase.com/reference/api/create-a-session)
- [Browserbase session management](https://docs.browserbase.com/platform/browser/getting-started/manage-browser-session)
- [Browserbase browser usage](https://docs.browserbase.com/platform/browser/getting-started/using-browser-session)
- [Browserbase agents](https://docs.browserbase.com/platform/agents/how-it-works)
- [Browserbase runtime](https://docs.browserbase.com/platform/runtime/overview)
- [Browserbase session replay](https://docs.browserbase.com/platform/browser/observability/session-replay)
- [Browserbase BYOS](https://docs.browserbase.com/account/enterprise/byos-setup-guide)

## Verification evidence

The automated suite verifies 13 API, security, quota, and control-plane behaviors plus a real Chromium E2E flow. Screenshots and the machine-readable report are in `outputs/verification/`.

The remaining production proof requires three external prerequisites: an authenticated GitHub account that can create and push a repository, a deployment target that can run long-lived Chromium processes and persistent storage, and enough provisioned compute to run a real 100-browser load test.
