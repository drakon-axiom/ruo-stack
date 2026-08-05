import { isIP } from 'node:net';
import { lookup } from 'node:dns/promises';
import { BadRequest } from '../errors.js';

/**
 * SSRF egress guard for brand-supplied URLs (e.g. a WooCommerce `store_url`).
 * The API issues authenticated server-side requests to these hosts, so an
 * unvalidated URL lets a brand point us at cloud metadata (169.254.169.254) or
 * internal services. We reject non-http(s) schemes and any host that is — or
 * resolves to — a private/loopback/link-local/reserved address.
 */

/** True for IPv4/IPv6 ranges that must never be reachable from a brand URL. */
export function isPrivateAddress(ip: string): boolean {
  const kind = isIP(ip);
  if (kind === 4) {
    const p = ip.split('.').map(Number);
    if (p.length !== 4 || p.some((n) => Number.isNaN(n))) return true; // malformed → deny
    const a = p[0]!;
    const b = p[1]!;
    if (a === 0) return true; // "this" network
    if (a === 10) return true; // private
    if (a === 127) return true; // loopback
    if (a === 169 && b === 254) return true; // link-local (incl. cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return true; // private
    if (a === 192 && b === 168) return true; // private
    if (a === 100 && b >= 64 && b <= 127) return true; // CGNAT
    if (a >= 224) return true; // multicast / reserved
    return false;
  }
  if (kind === 6) {
    const s = ip.toLowerCase();
    if (s === '::1' || s === '::') return true; // loopback / unspecified
    // IPv4-mapped (::ffff:a.b.c.d) — evaluate the embedded v4 address.
    const mapped = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
    if (mapped) return isPrivateAddress(mapped[1]!);
    if (s.startsWith('fe80')) return true; // link-local
    if (s.startsWith('fc') || s.startsWith('fd')) return true; // unique local
    if (s.startsWith('ff')) return true; // multicast
    return false;
  }
  return true; // not a recognizable IP → deny
}

/**
 * Throw BadRequest unless `raw` is an http(s) URL whose host is public. For
 * hostnames, every resolved address must be public (basic DNS-rebinding guard).
 */
export async function assertPublicHttpUrl(raw: string): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw BadRequest('bad_url', 'Invalid store URL');
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') {
    throw BadRequest('bad_url', 'Store URL must be http or https');
  }
  const host = u.hostname.toLowerCase();
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) {
    throw BadRequest('blocked_host', 'Store URL host is not allowed');
  }
  if (isIP(host)) {
    if (isPrivateAddress(host)) throw BadRequest('blocked_host', 'Store URL host is not allowed');
    return;
  }
  let addrs: { address: string }[];
  try {
    addrs = await lookup(host, { all: true });
  } catch {
    throw BadRequest('blocked_host', 'Store URL host could not be resolved');
  }
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) {
    throw BadRequest('blocked_host', 'Store URL host is not allowed');
  }
}
