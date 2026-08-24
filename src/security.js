import dns from 'node:dns/promises';
import net from 'node:net';

const nonGlobalIpv6Ranges = new net.BlockList();
for (const [network, prefix] of [
  ['2001::', 32],
  ['2001:2::', 48],
  ['2001:10::', 28],
  ['2001:20::', 28],
  ['2001:db8::', 32],
  ['3fff::', 20]
]) {
  nonGlobalIpv6Ranges.addSubnet(network, prefix, 'ipv6');
}

export function isPrivateIp(address) {
  if (!address) return true;
  if (net.isIPv4(address)) {
    const [a, b, c] = address.split('.').map(Number);
    return a === 0
      || a === 10
      || (a === 100 && b >= 64 && b <= 127)
      || a === 127
      || (a === 169 && b === 254)
      || (a === 172 && b >= 16 && b <= 31)
      || (a === 192 && b === 0 && (c === 0 || c === 2))
      || (a === 192 && b === 88 && c === 99)
      || (a === 192 && b === 168)
      || (a === 198 && (b === 18 || b === 19))
      || (a === 198 && b === 51 && c === 100)
      || (a === 203 && b === 0 && c === 113)
      || a >= 224;
  }
  const value = address.toLowerCase();
  if (!net.isIPv6(value)) return true;
  // Reject every IPv4-mapped form before considering global IPv6. Otherwise
  // ::ffff:127.0.0.1 and ::ffff:169.254.169.254 bypass the IPv4 ranges above.
  if (value.startsWith('::ffff:')) return true;
  // IPv6 global unicast is 2000::/3. Fail closed on every other range and on
  // special-purpose ranges inside that aggregate, including benchmarking,
  // ORCHID, ORCHIDv2, Teredo and documentation prefixes.
  const firstHextet = Number.parseInt(value.split(':', 1)[0], 16);
  return !Number.isInteger(firstHextet)
    || (firstHextet & 0xe000) !== 0x2000
    || nonGlobalIpv6Ranges.check(value, 'ipv6');
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
