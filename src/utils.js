import crypto from 'node:crypto';

export const id = (prefix) => `${prefix}_${crypto.randomBytes(10).toString('hex')}`;
export const now = () => new Date().toISOString();
export const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

export function json(res, status, body, extraHeaders = {}) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(payload),
    ...extraHeaders
  });
  res.end(payload);
}

export async function readJson(req, limit = 1_000_000) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request body exceeds limit'), { status: 413 });
    chunks.push(chunk);
  }
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw Object.assign(new Error('Request body must be valid JSON'), { status: 400 });
  }
}

export function redact(value) {
  if (typeof value === 'string') {
    return value
      .replace(/(authorization|x-bb-api-key|x-stratus-api-key)["']?\s*[:=]\s*["']?[^\s,"']+/gi, '$1:[REDACTED]')
      .replace(/sk_[a-z0-9_-]{8,}/gi, '[REDACTED_KEY]');
  }
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [
      key,
      /token|secret|password|cookie|authorization|api.?key/i.test(key) ? '[REDACTED]' : redact(item)
    ]));
  }
  return value;
}

export function hmac(secret, body) {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

export function clamp(number, min, max) {
  return Math.max(min, Math.min(max, number));
}
