import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import ipaddr from 'ipaddr.js';
import { BadRequest } from '../errors.ts';

/** Deny non-unicast ranges, including normalized IPv4-mapped IPv6 addresses. */
export function isPrivateAddress(ip: string): boolean {
  if (!isIP(ip)) return true;
  try {
    const address = ipaddr.process(ip);
    if (address.range() !== 'unicast') return true;
    // IPv6 outside the allocated global-unicast block is denied by default.
    return address.kind() === 'ipv6' && !address.match(ipaddr.parseCIDR('2000::/3'));
  } catch {
    return true;
  }
}

/** Syntax/literal checks shared by preflight and the actual HTTP transport. */
export function publicHttpUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw BadRequest('bad_url', 'Invalid store URL'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw BadRequest('bad_url', 'Store URL must be http or https without embedded credentials');
  }
  // WHATWG URL retains brackets around IPv6 literals.
  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal') ||
      (isIP(host) && isPrivateAddress(host))) {
    throw BadRequest('blocked_host', 'Store URL host is not allowed');
  }
  return url;
}

/** Every DNS answer must be public. The HTTP connector uses these exact answers. */
export async function resolvePublicHost(host: string): Promise<{ address: string; family: number }[]> {
  let addresses: { address: string; family: number }[];
  try { addresses = await lookup(host, { all: true }); }
  catch { throw BadRequest('blocked_host', 'Store URL host could not be resolved'); }
  if (addresses.length === 0 || addresses.some(a => isPrivateAddress(a.address))) {
    throw BadRequest('blocked_host', 'Store URL host is not allowed');
  }
  return addresses;
}

/** Preflight only; callers making requests must also use publicFetch. */
export async function assertPublicHttpUrl(raw: string): Promise<void> {
  const url = publicHttpUrl(raw);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!isIP(host)) await resolvePublicHost(host);
}
