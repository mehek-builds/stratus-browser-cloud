// Preload for test/managed-runner-replay.mjs.
//
// SANDBOX_RUNNER is shipped to a Vercel Sandbox that has `playwright` and a Playwright-managed
// Chromium installed. A dev machine has neither: this repo depends on `playwright-core`, which
// bundles no browser. Rather than edit the runner for the test (which would stop the test from
// covering the code that actually ships), this maps `require('playwright')` onto playwright-core
// and pins the launch to the same Chrome that test/e2e.mjs already requires.
//
// Not a stub: the real Playwright API drives a real browser. Only resolution and the binary path
// are redirected.
const Module = require('node:module');

const core = require('playwright-core');
const executablePath = process.env.CHROME_EXECUTABLE_PATH
  || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const playwright = {
  ...core,
  chromium: {
    ...core.chromium,
    launch: (options = {}) => core.chromium.launch({ ...options, executablePath })
  }
};

const load = Module._load;
Module._load = function stratusReplayLoad(request, parent, isMain) {
  if (request === 'playwright') return playwright;
  return load.call(this, request, parent, isMain);
};
