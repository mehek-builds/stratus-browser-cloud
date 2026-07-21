const challengeSignals = [
  { type: 'captcha', pattern: /\b(?:captcha|hcaptcha|recaptcha)\b/i },
  { type: 'human_verification', pattern: /\b(?:verify you are human|confirm you are human|human verification)\b/i },
  { type: 'access_denied', pattern: /\b(?:access denied|request blocked|temporarily blocked)\b/i },
  { type: 'rate_limited', pattern: /\b(?:too many requests|unusual traffic|rate limit(?:ed)?)\b/i },
  { type: 'managed_challenge', pattern: /\b(?:checking your browser|security check|challenge-platform)\b/i }
];

export function normalizeProtectionPolicy(input = {}) {
  const allowedHosts = Array.isArray(input.allowedHosts)
    ? [...new Set(input.allowedHosts.map((host) => String(host).trim().toLowerCase()).filter(Boolean))]
    : [];
  const challengeBehavior = ['report', 'pause'].includes(input.challengeBehavior) ? input.challengeBehavior : 'report';
  return {
    enabled: input.enabled !== false,
    allowedHosts,
    minNavigationIntervalMs: Math.max(0, Math.min(60_000, Number(input.minNavigationIntervalMs || 0))),
    challengeBehavior,
    captureEvidence: input.captureEvidence !== false
  };
}

export function assertAuthorizedNavigation(rawUrl, policy) {
  let target;
  try {
    target = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('Navigation URL is invalid'), { status: 400, code: 'INVALID_NAVIGATION_URL' });
  }
  if (!['http:', 'https:', 'data:', 'about:'].includes(target.protocol)) {
    throw Object.assign(new Error(`Navigation scheme is not supported: ${target.protocol}`), { status: 400, code: 'UNSUPPORTED_NAVIGATION_SCHEME' });
  }
  if (!policy.enabled || !policy.allowedHosts.length || ['data:', 'about:'].includes(target.protocol)) return target;
  const hostname = target.hostname.toLowerCase();
  const authorized = policy.allowedHosts.some((allowed) => hostname === allowed || hostname.endsWith(`.${allowed}`));
  if (!authorized) {
    throw Object.assign(new Error(`Host is outside this session's authorized scope: ${hostname}`), {
      status: 403,
      code: 'HOST_NOT_AUTHORIZED'
    });
  }
  return target;
}

export function detectProtectionChallenge({ title = '', text = '', status = 0, url = '' } = {}) {
  if ([403, 409, 423, 429, 503].includes(Number(status))) {
    return { detected: true, type: status === 429 ? 'rate_limited' : 'http_challenge', status: Number(status), url };
  }
  const sample = `${title}\n${text}`.slice(0, 100_000);
  const signal = challengeSignals.find(({ pattern }) => pattern.test(sample));
  return signal ? { detected: true, type: signal.type, status: Number(status) || null, url } : { detected: false };
}
