// Point the JWKS URL at a closed port BEFORE importing anything that reads
// config: loadConfig() memoises on first call, and the JWKS endpoint is derived
// from SUPABASE_URL. A refused connection fails instantly, so these stay offline
// and fast.
process.env.SUPABASE_URL = 'http://127.0.0.1:1';

import { describe, expect, it } from 'vitest';
import { JWKS_CACHE_MAX_AGE_MS, verifyBrandToken, warmJwks } from '../../src/auth/brand-token.ts';

describe('JWKS warm-up', () => {
  // The warm-up runs during boot, off the request path. If it threw, an
  // unreachable or slow Supabase would take the whole API down on start --
  // which is strictly worse than the cold first request it exists to avoid.
  it('resolves false instead of rejecting when the endpoint is unreachable', async () => {
    await expect(warmJwks()).resolves.toBe(false);
  });

  it('stays safe to call more than once', async () => {
    await expect(warmJwks()).resolves.toBe(false);
    await expect(warmJwks()).resolves.toBe(false);
  });

  // jose's default cacheMaxAge is 10 minutes, which puts a blocking refetch
  // (measured at 457ms against the live project) on whichever unlucky request
  // lands after each expiry. A long max age is safe because key ROTATION is
  // handled by a different path: an unknown `kid` triggers an immediate fetch
  // regardless of cache age, throttled only by jose's 30s cooldown.
  it('caches the key set far longer than jose’s 10-minute default', () => {
    expect(JWKS_CACHE_MAX_AGE_MS).toBeGreaterThanOrEqual(60 * 60 * 1000);
  });
});

describe('verifyBrandToken', () => {
  it('rejects a token whose signature cannot be verified', async () => {
    await expect(verifyBrandToken('not.a.jwt')).rejects.toThrow(/Invalid brand token/);
  });
});
