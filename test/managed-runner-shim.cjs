// Preload for test/managed-runner-replay.mjs.
//
// SANDBOX_RUNNER is shipped to a Vercel Sandbox that has `playwright` and a Playwright-managed
// Chromium installed. This repo depends on `playwright-core` and CI installs its version-matched
// browser explicitly. Rather than edit the runner for the test (which would stop the test from
// covering the code that actually ships), this maps `require('playwright')` onto playwright-core
// and launches that same Playwright-managed Chromium build.
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
const fs = require('node:fs');
const path = require('node:path');

// Browser replay fixtures intentionally bind loopback servers. Keep that exception out of the
// shipped runner by changing its closed constant only while this test preload compiles the local
// child-process copy.
const nativeCjsLoader = Module._extensions['.cjs'] || Module._extensions['.js'];
Module._extensions['.cjs'] = (module, filename) => {
  if (path.basename(filename) !== 'stratus-runner.cjs') {
    nativeCjsLoader(module, filename);
    return;
  }
  const marker = 'const allowPrivateForTests = false;';
  const source = fs.readFileSync(filename, 'utf8');
  if (source.split(marker).length !== 2) {
    throw new Error('Test runner private-replay marker must occur exactly once');
  }
  module._compile(source.replace(marker, 'const allowPrivateForTests = true;'), filename);
};

const core = require('playwright-core');
const executablePath = process.env.STRATUS_RUNNER_CHROMIUM_PATH || core.chromium.executablePath();
const HOST_RESOLVER_RULES = '--host-resolver-rules=MAP job-boards.greenhouse.io 127.0.0.1';

const playwright = {
  ...core,
  chromium: {
    ...core.chromium,
    launch: async (options = {}) => {
      const browser = await core.chromium.launch({
        ...options,
        executablePath,
        args: [...(options.args || []), HOST_RESOLVER_RULES]
      });
      const seededCookies = process.env.STRATUS_TEST_SEED_COOKIES_JSON
        ? JSON.parse(process.env.STRATUS_TEST_SEED_COOKIES_JSON)
        : null;
      const injectPreArmRequired = process.env.STRATUS_TEST_PRE_ARM_ARIA_REQUIRED === '1';
      const injectPreArmFetch = process.env.STRATUS_TEST_PRE_ARM_FETCH === '1';
      if ((Array.isArray(seededCookies) && seededCookies.length > 0)
        || injectPreArmRequired || injectPreArmFetch) {
        const nativeNewContext = browser.newContext.bind(browser);
        Object.defineProperty(browser, 'newContext', {
          configurable: true,
          value: async (contextOptions = {}) => {
            const context = await nativeNewContext(contextOptions);
            if (Array.isArray(seededCookies) && seededCookies.length > 0) {
              await context.addCookies(seededCookies);
            }
            if (injectPreArmRequired || injectPreArmFetch) {
              const nativeRoute = context.route.bind(context);
              let routeCalls = 0;
              Object.defineProperty(context, 'route', {
                configurable: true,
                value: async (...args) => {
                  routeCalls += 1;
                  if (routeCalls === 2) {
                    const page = context.pages()[0];
                    if (injectPreArmRequired) {
                      await page.evaluate(() => {
                        document.getElementById('pre-arm-required')
                          ?.setAttribute('aria-required', 'true');
                      });
                    }
                    if (injectPreArmFetch) {
                      await page.evaluate(async () => {
                        try {
                          await fetch('/native-get-exfil?channel=pre-arm&value=applicant%40example.com');
                        } catch {}
                      });
                    }
                  }
                  return nativeRoute(...args);
                }
              });
            }
            return context;
          }
        });
      }
      return browser;
    }
  }
};

const load = Module._load;
Module._load = function stratusReplayLoad(request, parent, isMain) {
  if (request === 'playwright') return playwright;
  return load.call(this, request, parent, isMain);
};
