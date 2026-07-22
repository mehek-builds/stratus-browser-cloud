# Stratus verification report

Verified on 2026-07-22 with Node.js 22, a locally installed Chrome browser, and Vercel production Functions.

## Result

PASS. The complete automated test suite passed with 18 tests, including the real-browser self-hosted workflow and the managed-provider adapter contract.

The verified flow covers:

1. Dashboard overview rendering
2. Real Chromium launch and navigation
3. Live browser frames, observe, act, extract, and event streaming
4. Session release and metered usage
5. Completed session archive and replay inspector
6. Function deployment and invocation
7. Persistent browser identity creation
8. OpenAI-compatible model gateway invocation
9. Mobile layout without horizontal overflow
10. Protection challenge detection, evidence capture, and human handoff without circumvention
11. Pause policy blocking command and agent automation pending human review
12. Vercel stateless control-plane health and configuration routes
13. Managed action validation and rejection of arbitrary caller code
14. Browserless Function API request and response contract using an isolated provider double
15. Production Vercel UI rendering with no browser console errors
16. Authenticated public CDP relay connection to the running self-hosted browser

## Capacity contract

- Concurrent browser limit: 100
- Included browser-hour allowance: 500
- Scheduler load test: 100 simultaneous reservations accepted
- Over-limit behavior: reservation 101 rejected

This verifies the control-plane capacity contract. Running 100 live Chrome processes simultaneously still requires a production cluster with the CPU and memory described in `deploy/kubernetes.yaml`.

## Free managed capacity

- Concurrent browsers: 2
- Monthly Browserless units: 1,000
- Maximum task duration: 60 seconds
- Vercel production URL: `https://stratus-browser-cloud.vercel.app`

The Vercel control plane is live. The production provider status remains intentionally disabled until a Browserless free-tier token is added as `BROWSERLESS_TOKEN`. Tokens are server-only and are never exposed to the dashboard.

## Evidence

- `01-overview.png`: dashboard and capacity status
- `02-live-browser.png`: running live browser with agent event stream
- `03-session-history.png`: completed browser session archive
- `04-session-inspector.png`: replay and event timeline
- `05-mobile-overview.png`: responsive viewport
- `06-protection-challenge.png`: detected human-verification challenge
- `09-vercel-free-local.png`: local Vercel managed-mode rendering
- `10-vercel-free-production.png`: live production managed-mode rendering
- `e2e-report.json`: machine-readable E2E result

## Reproduce

```sh
npm install
npm run verify
```

The E2E runner starts the service on an isolated local port, launches a real Chrome process, exercises the API and dashboard, writes screenshots, and shuts everything down.
