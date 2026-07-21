# Stratus verification report

Verified on 2026-07-21 with Node.js 22 and a locally installed Chrome browser.

## Result

PASS. The complete automated test suite passed with 9 tests, including the real-browser end-to-end workflow.

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

## Capacity contract

- Concurrent browser limit: 100
- Included browser-hour allowance: 500
- Scheduler load test: 100 simultaneous reservations accepted
- Over-limit behavior: reservation 101 rejected

This verifies the control-plane capacity contract. Running 100 live Chrome processes simultaneously still requires a production cluster with the CPU and memory described in `deploy/kubernetes.yaml`.

## Evidence

- `01-overview.png`: dashboard and capacity status
- `02-live-browser.png`: running live browser with agent event stream
- `03-session-history.png`: completed browser session archive
- `04-session-inspector.png`: replay and event timeline
- `05-mobile-overview.png`: responsive viewport
- `e2e-report.json`: machine-readable E2E result

## Reproduce

```sh
npm install
npm run verify
```

The E2E runner starts the service on an isolated local port, launches a real Chrome process, exercises the API and dashboard, writes screenshots, and shuts everything down.
