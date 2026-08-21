// The actual guarantee behind Task 9 (see FakePaymentsAdapter.ts for the
// discipline half). Installed once from test/setup.ts, this makes any
// outbound request to api.stripe.com throw — a mistakenly-real
// `StripeAdapter` (e.g. someone forgot to call `setClientsForTest`) fails
// loudly instead of quietly hitting the live Stripe API from a test run.
//
// Coverage — deliberately stated, not assumed:
//   - global `fetch` (undici, Node 22's built-in) — covers any code that
//     calls fetch() directly against api.stripe.com.
//   - node:http / node:https `request()` and `get()` — covers the Stripe SDK
//     itself. Verified against the installed stripe@17.7.0: its default Node
//     HttpClient (cjs/net/NodeHttpClient.js, selected by
//     cjs/platform/NodePlatformFunctions.js) uses `https.request()` directly,
//     NOT global fetch. A fetch-only rail would silently let the real SDK
//     through, so both layers are patched.
//   - NOT covered: a raw TCP socket opened straight against api.stripe.com
//     bypassing both http(s) and fetch. No code path in this repo does that
//     (Prisma/pg talk Postgres wire protocol to Supabase, not HTTP, so they
//     are unaffected by this rail either way).
import * as httpModule from 'node:http';
import * as httpsModule from 'node:https';
import { createRequire } from 'node:module';

/** Thrown by the rail. A distinct class (not a bare Error) so tests can assert on it precisely. */
export class StripeNetworkRailError extends Error {
  constructor(detail: string) {
    super(
      `[stripe-network-rail] Blocked an outbound request to api.stripe.com (${detail}). ` +
        'Tests must never reach the real Stripe API — inject a FakePaymentsAdapter via setClientsForTest() instead.',
    );
    this.name = 'StripeNetworkRailError';
  }
}

const BLOCKED_HOST = 'api.stripe.com';

type RequestFn = (...args: unknown[]) => unknown;

/** Node core modules are CJS singletons under the hood; `createRequire` gets
 *  the same mutable module.exports object the compiled Stripe SDK itself
 *  obtains via `require('https')` — not a read-only ESM namespace binding. */
const require = createRequire(import.meta.url);
const http = require('node:http') as typeof httpModule;
const https = require('node:https') as typeof httpsModule;

/** Best-effort host extraction across every `request()`/`get()` call shape
 *  Node supports: `(url)`, `(url, options)`, `(options)`, each optionally
 *  followed by a callback (which we never touch). */
function extractHost(args: unknown[]): string | undefined {
  const isPlainOptions = (v: unknown): v is { hostname?: string; host?: string } =>
    !!v && typeof v === 'object' && !(v instanceof URL);

  const [a0, a1] = args;
  let urlHost: string | undefined;
  let optsHost: string | undefined;

  if (typeof a0 === 'string') {
    try {
      urlHost = new URL(a0).hostname;
    } catch {
      // Not an absolute URL (e.g. just a path) — no host to read from it.
    }
  } else if (a0 instanceof URL) {
    urlHost = a0.hostname;
  } else if (isPlainOptions(a0)) {
    optsHost = a0.hostname ?? a0.host;
  }

  if (isPlainOptions(a1)) {
    optsHost = a1.hostname ?? a1.host ?? optsHost;
  }

  return optsHost ?? urlHost;
}

function guard(label: string, original: RequestFn): RequestFn {
  return function (this: unknown, ...args: unknown[]) {
    const host = extractHost(args);
    if (host === BLOCKED_HOST) {
      throw new StripeNetworkRailError(label);
    }
    return original.apply(this, args);
  };
}

interface Installed {
  httpRequest: RequestFn;
  httpGet: RequestFn;
  httpsRequest: RequestFn;
  httpsGet: RequestFn;
  fetch: typeof globalThis.fetch;
}

let originals: Installed | undefined;

/** Idempotent — calling this more than once (e.g. setup.ts re-imported across
 *  test files) does not double-wrap the already-guarded functions. */
export function installStripeNetworkRail(): void {
  if (originals) return;

  originals = {
    httpRequest: http.request as unknown as RequestFn,
    httpGet: http.get as unknown as RequestFn,
    httpsRequest: https.request as unknown as RequestFn,
    httpsGet: https.get as unknown as RequestFn,
    fetch: globalThis.fetch,
  };

  // `get()` does not delegate to the (possibly patched) exported `request` —
  // Node's implementation closes over its own local `request` reference — so
  // both must be wrapped independently.
  http.request = guard('http.request', originals.httpRequest) as typeof http.request;
  http.get = guard('http.get', originals.httpGet) as typeof http.get;
  https.request = guard('https.request', originals.httpsRequest) as typeof https.request;
  https.get = guard('https.get', originals.httpsGet) as typeof https.get;

  const originalFetch = originals.fetch;
  type FetchInput = Parameters<typeof fetch>[0];
  type FetchInit = Parameters<typeof fetch>[1];
  globalThis.fetch = (async (input: FetchInput, init?: FetchInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url;
    let hostname: string | undefined;
    try {
      hostname = new URL(url).hostname;
    } catch {
      hostname = undefined;
    }
    if (hostname === BLOCKED_HOST) {
      throw new StripeNetworkRailError(`fetch ${url}`);
    }
    return originalFetch(input, init);
  }) as typeof fetch;
}

/** Restore the pre-install functions. Exposed for the rail's own test to prove installation is reversible. */
export function uninstallStripeNetworkRail(): void {
  if (!originals) return;
  http.request = originals.httpRequest as typeof http.request;
  http.get = originals.httpGet as typeof http.get;
  https.request = originals.httpsRequest as typeof https.request;
  https.get = originals.httpsGet as typeof https.get;
  globalThis.fetch = originals.fetch;
  originals = undefined;
}
