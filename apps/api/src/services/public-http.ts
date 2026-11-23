import type { LookupFunction } from 'node:net';
import { Agent, fetch, type RequestInit, type Response } from 'undici';
import { publicHttpUrl, resolvePublicHost } from './ssrf-guard.ts';

// Node connects to the addresses returned here, without resolving them again.
// Validate ALL answers before honoring the requested address family. This also
// covers reconnects and dual-stack fallback. The original URL/hostname is kept
// intact for Host, TLS SNI, and certificate verification.
const publicLookup: LookupFunction = (host, options, callback) => {
  void resolvePublicHost(host).then(addresses => {
    const family = options.family === 'IPv4' ? 4 : options.family === 'IPv6' ? 6 : options.family;
    const eligible = family ? addresses.filter(a => a.family === family) : addresses;
    if (!eligible.length) { callback(new Error('No public address in requested family'), ''); return; }
    if (options.all) callback(null, eligible);
    else callback(null, eligible[0]!.address, eligible[0]!.family);
  }, () => callback(new Error('Store URL host is not allowed'), ''));
};

let agent: Agent | undefined;
export async function publicFetch(url: URL, init: RequestInit): Promise<Response> {
  publicHttpUrl(url.href); // IP literals skip lookup, so they must be checked here.
  agent ??= new Agent({ connect: { lookup: publicLookup, timeout: 15_000 } });
  return fetch(url, {
    ...init,
    // A caller cannot opt into an unvalidated redirect or substitute a dispatcher.
    dispatcher: agent,
    redirect: 'manual',
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)]) : AbortSignal.timeout(15_000),
  });
}

/** Release sockets on API shutdown; a subsequent app instance gets a fresh Agent. */
export async function closePublicHttp(): Promise<void> {
  const current = agent;
  agent = undefined;
  await current?.destroy();
}
