// Preload for test/managed-runner-replay.mjs.
//
// SANDBOX_RUNNER is shipped to a Vercel Sandbox that has `playwright` and a Playwright-managed
// Chromium installed. A dev machine has neither: this repo depends on `playwright-core`, which
// bundles no browser. Rather than edit the runner for the test (which would stop the test from
// covering the code that actually ships), this maps `require('playwright')` onto playwright-core
// and pins the launch to the same Chrome that test/e2e.mjs already requires.
//
// Not a stub: the real Playwright API drives a real browser. Only resolution, the binary path and
// name resolution for one hostname are redirected.
//
// THE HOSTNAME MATTERS TO THE CODE UNDER TEST, which is why it is worth a launch flag. The runner
// reads a Greenhouse confirmation off location.hostname and location.pathname together: that arm is
// the ATS's own published state, it is the strongest evidence readSubmitOutcome can return, and it
// is the only reason a security-code verdict is allowed to outrank a control that has not unmounted
// yet. A fixture served from 127.0.0.1 cannot reach that arm at all, so the case that matters most
// on the security-code path would have had to be pinned against some weaker source that production
// never uses. The map points one name at the loopback fixture server and changes nothing else; the
// runner still reads the real location, and no test asserts on anything but the loopback fixture.
const Module = require('node:module');

const core = require('playwright-core');
const executablePath = process.env.CHROME_EXECUTABLE_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const HOST_RESOLVER_RULES = '--host-resolver-rules=MAP job-boards.greenhouse.io 127.0.0.1';

const playwright = {
  ...core,
  chromium: {
    ...core.chromium,
    launch: (options = {}) => core.chromium.launch({
      ...options,
      executablePath,
      args: [...(options.args || []), HOST_RESOLVER_RULES]
    })
  }
};

const load = Module._load;
Module._load = function stratusReplayLoad(request, parent, isMain) {
  if (request === 'playwright') return playwright;
  return load.call(this, request, parent, isMain);
};
