# Stratus

Stratus is a clean-room browser-agent cloud with self-hosted and free managed deployment modes. It combines Chromium automation, persistent identities, live view, session recordings, search and fetch, agent functions, an OpenAI-compatible model gateway, usage metering, SDK access, and an operations dashboard under one API key.

## Free managed mode

Vercel hosts a stateless Stratus control plane while Vercel Sandbox runs each bounded browser task in an isolated Chromium microVM. The current Hobby allowance supports up to 10 concurrent sandboxes, 5 active CPU hours per month, and 60 seconds per Stratus task. Free infrastructure does not supply 100 concurrent browsers or 500 browser hours. Those remain configurable self-hosted capacity targets and require paid compute.

1. Import this repository into Vercel or run `vercel link`.
2. Run `vercel env pull .env.local` for local Sandbox authentication.
3. Run `vercel --prod`.

Production authentication uses Vercel OIDC automatically, so no external browser provider or token is required. Preview deployments are also closed by default. A dedicated integration preview may set `STRATUS_ALLOW_LITOS_DEVELOPMENT_OIDC=1`; that accepts only the exact `student-outreach-backend` development OIDC subject. The flag is ignored in production, where the production subject remains the only accepted OIDC identity. The browser execution system is owned by Stratus: it provisions the Chromium runtime, maintains the template snapshot, validates declarative actions, forks isolated workers, collects results, and destroys workers after every task. The managed UI calls `POST /api/run`. Set optional `STRATUS_API_KEY` to require an `X-Stratus-API-Key` header.

```json
{
  "url": "https://example.com",
  "actions": [{ "type": "extract", "selector": "h1" }],
  "screenshot": true,
  "fullPage": true
}
```

Supported actions are `click`, `fill`, `fillByLabelText`, `upload`, `waitForSelector`, `press`, `select`, `extract`, `discover`, and `confirmAndSubmit`. Arbitrary caller-supplied JavaScript is rejected.

Any action may carry `optional: true`, which means "step over this rather than fail the run". Whether the element is there is decided by a single instantaneous check, with one exception: an optional `waitForSelector` is exempt and honours its own `timeout`, which is clamped to between 100 and 20000 ms. That exception matters because `waitForSelector` is the one action whose entire job is to wait, and a check that can answer "not there" before its timeout starts cancels it outright. If a control renders asynchronously, declare a `waitForSelector` for it; the runner will not guess a wait on your behalf, because measured against two live Greenhouse forms a blanket grace changed no outcome and cost about 4.3 seconds a run. Every optional action that is stepped over is reported in the run's `skipped` array.

A `click` that is the final submit, either labelled `final_submit` or targeting a submit control, is gated: the runner reads the form the way the employer's validator would and withholds the click while any required control is still empty, listing them in `blockers`. The check is asked of each required control rather than of the block around it, so an empty required input is not treated as answered because something else in its block was. Validation text left over from an earlier pass, over a control that is now filled, is reported in `skipped` and never blocks.

Use one `confirmAndSubmit` action for an authorized final submit. The action contract remains version 2 and uses the fixed candidate set `button, input[type="submit"], input[type="button"], input[type="image"], [role="button"]`. Its `chooserPolicy` must be the complete canonical `litos-final-submit` policy version 3 or version 4, including the exact positive grammar, exclusion grammar, and SHA-256 grammar hash. The runner verifies those bytes before launching a browser. It chooses one viable application or verification control semantically, retains that exact DOM node and its application scope, confirms affected answered fields, verifies the retained node and scope fingerprint, then performs the physical click itself. There is no separate submit click. Social handoffs and multistep controls such as `Apply with LinkedIn`, `Continue`, and `Next` are never final-submit candidates. A replaced submit node returns a blocked pass with `sameNode: false`.

Chooser v4 requires explicit capability negotiation. The action list must contain exactly one non-optional `requireCapability` for `exact-page-url-v1`, with `expectedPageUrl` equal to the `confirmAndSubmit` action's `expectedPageUrl`, and exactly one non-optional `requireCapability` for `atomic-submit-v4`. That v4 capability must include `applicationScopeSelector`, which must resolve once to exactly one connected `HTMLFormElement` before applicant actions begin. The expected URL must also equal the submitted run URL after fragment removal. Stratus proves that same canonical URL before application actions, before applicant data, before the final chooser, and immediately before activation.

V4 is intentionally native-form-only, same-origin, and POST-only. The selected control must be the exact associated native submitter for the caller-bound form, use `_self`, keep native constraint validation enabled, and produce exactly one trusted main-frame POST document request to the validated page origin. Every successful fill, selection, security-code entry, or upload proof must belong to that same caller-bound form; a successful mutation in another form makes every final candidate non-viable, including explicit `Submit application` wording. Security-bearing DOM reads and activation witnesses run in Playwright's isolated utility world, installed before employer scripts and refreshed after every navigation. Stratus blocks service workers and WebSockets, makes the page network-silent after the initial load, observes trusted submit and form-data events through capture and bubble, watches the protected form graph for transient mutations, and holds every request during activation while it compares the effective action, method, target, encoding, and ordered duplicate-preserving payload. Any fetch, image, ping, frame, navigation, or other ancillary request observed before the validated write is released is blocked and makes final submission non-viable. A later ancillary request remains blocked and is reported as `ancillary_transport_blocked_after_release` when observed before the run ends, but it cannot retroactively cancel a write already dispatched. For the validated write, Stratus resolves and pins a public address, performs one server-side HTTP response hop with the observed URL, method, body, and full browser header set, including an explicit empty `Cookie` header when Chromium omitted cookies, then fulfills the browser navigation from that response. A same-origin 301, 302, or 303 may add one read-only receipt GET through the same pinned address. Chromium receives the redirect itself, so receipt cookies, history, URL fragments, and the committed page URL retain browser semantics. Write-preserving redirects, additional redirects, and cross-origin receipt redirects are blocked before their destination receives the application body. This is not the original Chromium network connection. Cross-origin, private, connection-bound, or browser-network-identity-dependent endpoints are unsupported and must remain on v3. Direct `form.submit()`, native GET submission, form-level `novalidate`, submitter-level `formnovalidate`, managed React submission, ancillary GET transport, XHR/fetch/ping, iframe or popup navigation, changed payloads, and missing witnesses fail closed before release. Native multipart POST forms, including empty and populated file controls and duplicate field names, are supported. A populated upload is unsupported under `application/x-www-form-urlencoded`, because that encoding carries only the filename and cannot deliver the caller-verified bytes. ATS flows that require GET submission, disabled native constraint validation, a cross-origin action, post-load network reads, a separate or pre-submit managed upload endpoint, autosave, or a managed JavaScript submit must remain on v3 until a future capability pins those prerequisite and final managed endpoints. Bare `Send` also requires at least two distinct successful controls on the exact bound form. It never earns authority from page-authored ids, classes, actions, or resume-like tokens.

V4 no-click decisions are returned as typed telemetry instead of a generic runner failure. In addition to `selected`, `no_submit_control`, and `ambiguous_submit`, safety outcomes include `application_scope_invalid`, `transport_unsupported`, `binding_changed`, and `activation_blocked`, with a specific `blockerReason`. A blocked result performs no released request and still returns the screenshot, exact URL proof, readiness result, blockers, skipped actions, and action diagnostics needed to inspect the page. Roll out compatibility in two steps: deploy Stratus with dual v3 and v4 support first, then move only native-form callers to v4 after the runtime advertises `atomic-submit-v4`. V3 remains accepted during that transition.

The required-field detector covers native required and `aria-required` controls, Ashby-style required classes, literal `Label *` markers, React Select, custom controls, and required file uploads. Text and date controls receive focus, input, change, and blur. React Select receives an exact control click, Escape, and blur. Selected radios use their associated label. Checked checkboxes receive non-toggling input and change commits. Custom selected controls restore and verify the same semantic value if a click behaves as a toggle. Every required control receives one exhaustive result record and an affected control gets at most one selective retry. The contract-version-2 receipt binds each pass to opaque scope and submit fingerprints, reports the exact required-control count, durable selectors, attempts, retry count, unresolved fields, same-node result, and click outcome. A security-code flow runs a fresh verification pass against the changed DOM before its second physical click.

V4 also removes route-invisible browser transports before employer scripts run. WebRTC, WebTransport, dedicated and shared workers, speculative DNS, and preconnect hints are disabled or synchronously denied in every page and frame. An attempt observed before write release records an unpinned transport blocker and makes the final native submit non-viable. A later attempt is still synchronously denied and reported without claiming that an already dispatched write was canceled. The isolated required scan independently checks native constraints, custom `aria-required` controls, `_required_` label classes, and literal starred labels. A custom required control is considered answered only when one unambiguous named form-associated native backing control, or one coherent same-name and same-type native choice group, contributes its value to the bound payload.

## What works

- Real isolated Chromium sessions with Playwright WebSocket endpoints
- Session create, list, inspect, command, release, timeout, metadata, and region contracts
- Live browser frames, console events, network events, command timeline, screenshots, and artifacts
- Persistent browser contexts for cookies and storage state
- Strict 100 concurrent-session reservation limit
- Strict 500 browser-hour project allowance and real-time usage accounting
- Search provider adapter and SSRF-protected fetch endpoint
- Sandboxed JavaScript functions with logs, timeouts, inputs, outputs, and schedules metadata
- Agent-native `observe`, `act`, and `extract` primitives on live browser sessions
- Authorized-site protection policies with host scoping, request pacing, challenge detection, evidence capture, and human review handoff
- OpenAI-compatible chat completion gateway with an offline deterministic provider
- Signed webhooks with three bounded delivery attempts
- Extension metadata upload, audit log, health, readiness, metrics, and OpenAPI endpoints
- TypeScript-compatible JavaScript SDK and CLI
- Responsive operations dashboard, Playground, Live View, Inspector, identities, functions, and gateway screens
- Reusable agents with runs, messages, structured results, and stop controls
- Admin, Contributor, and Viewer roles with selected-project access
- Hashed, regenerable, revocable project API keys
- File upload/download APIs, screenshot and PDF artifacts, certificates, and retention/ZDR controls

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

Supported command actions are `navigate`, `click`, `fill`, `evaluate`, `content`, `screenshot`, and `pdf`.

Agent primitives are available at `POST /v1/sessions/:id/observe`, `/act`, and `/extract`. They inspect interactive elements, translate concise instructions such as `click Verify interaction`, and return clean structured page content.

## SDK

```js
import { Stratus } from './packages/sdk/index.js';

const stratus = new Stratus({
  apiKey: process.env.STRATUS_API_KEY,
  baseUrl: 'http://localhost:4100'
});

const session = await stratus.sessions.create({
  region: 'us-west-2',
  keepAlive: true,
  browserSettings: {
    protectionPolicy: {
      allowedHosts: ['example.com'],
      minNavigationIntervalMs: 1000,
      challengeBehavior: 'pause'
    }
  }
});

await stratus.sessions.command(session.id, {
  action: 'navigate',
  url: 'https://example.com'
});

await stratus.sessions.release(session.id);
```

## Site protection policy

Protection policies are designed for authorized automation. `allowedHosts` restricts navigation to owned or approved domains, `minNavigationIntervalMs` prevents burst navigation, and `challengeBehavior: "pause"` stops API commands and agent actions when Stratus detects CAPTCHA, human verification, access-denied, rate-limit, or managed-challenge signals. Evidence is captured to the session artifacts and exposed through `GET /v1/sessions/:id/protection`. After a person resolves the challenge through the live browser connection, send `{ "action": "resume" }` to the command endpoint. Stratus rechecks the page before continuing.

Stratus reports protection challenges and supports a human handoff. It does not solve CAPTCHAs, forge fingerprints, suppress automation indicators, or circumvent third-party access controls.

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
| Agents | `GET/POST /v1/agents`, `GET/POST /v1/agents/:id/runs`, run messages and stop |
| Files | `GET/POST /v1/files`, metadata, content, and delete routes |
| Retrieval | `POST /v1/search`, `POST /v1/fetch` |
| Functions | `GET/POST /v1/functions`, `POST /v1/functions/:id/invoke` |
| Models | `POST /v1/chat/completions` |
| Integrations | `GET/POST /v1/webhooks`, `POST /v1/extensions` |
| Access | `GET /v1/team`, members, API keys, project settings, certificates |
| Project | `GET /v1/projects`, `GET /v1/usage`, `GET /v1/audit-log` |
| Operations | `GET /health`, `GET /ready`, `GET /metrics`, `GET /openapi.json` |

## Clean-room boundary

Stratus does not copy Browserbase source code, branding, private APIs, proprietary datasets, or confidential partnerships. It implements the product category from public behavior and open infrastructure. Paid proxy, CAPTCHA, search, and model providers require operator-supplied credentials and adapters.
