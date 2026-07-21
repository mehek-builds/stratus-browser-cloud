import dns from 'node:dns/promises';
import net from 'node:net';

export function isPrivateIp(address) {
  if (!address) return true;
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a >= 224);
  }
  const value = address.toLowerCase();
  return value === '::1' || value === '::' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80');
}

export async function assertPublicUrl(rawUrl, { allowLocalhost = false } = {}) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    throw Object.assign(new Error('URL is invalid'), { status: 400, code: 'INVALID_URL' });
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw Object.assign(new Error('Only http and https URLs are allowed'), { status: 400, code: 'INVALID_PROTOCOL' });
  }
  if (allowLocalhost && ['localhost', '127.0.0.1', '::1'].includes(url.hostname)) return url;
  const records = await dns.lookup(url.hostname, { all: true });
  if (!records.length || records.some((record) => isPrivateIp(record.address))) {
    throw Object.assign(new Error('Private and local network destinations are blocked'), { status: 403, code: 'SSRF_BLOCKED' });
  }
  return url;
}

export function htmlToText(html) {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

export function textToMarkdown(text) {
  return text.split(/\n{2,}/).map((line) => line.trim()).filter(Boolean).join('\n\n');
}
