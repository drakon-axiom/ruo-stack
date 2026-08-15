// Point the JWKS URL at a closed port BEFORE importing anything that reads
// config: loadConfig() memoises on first call, and the JWKS endpoint is derived
// from SUPABASE_URL. A refused connection fails instantly, so these stay offline
// and fast. delayMs: 0 keeps the retry backoff out of the test runtime.
process.env.SUPABASE_URL = 'http://127.0.0.1:1';

import { describe, expect, it } from 'vitest';
import {
  JWKS_CACHE_MAX_AGE_MS,
  JWKS_WARM_ATTEMPTS,
  verifyBrandToken,
  warmJwks,
} from '../../src/auth/brand-token.ts';

describe('JWKS warm-up', () => {
  // The warm-up runs during boot, off the request path. If it threw, an
  // unreachable or slow Supabase would take the whole API down on start --
  // which is strictly worse than the cold first request it exists to avoid.
  it('reports failure instead of rejecting when the endpoint is unreachable', async () => {
    const r = await warmJwks({ delayMs: 0 });
    expect(r.warmed).toBe(false);
  });

  // The first boot after a deploy timed out at jose's 5s default while the same
  // fetch took ~150-500ms moments later: cold modules, DNS and TLS competing
  // with Prisma and four background workers starting in the same window. One
  // attempt is not enough precisely when it matters most -- a cold restart.
  it('retries before giving up', async () => {
    const r = await warmJwks({ delayMs: 0 });
    expect(r.attempts).toBe(JWKS_WARM_ATTEMPTS);
    expect(JWKS_WARM_ATTEMPTS).toBeGreaterThan(1);
  });

  it('honours an explicit attempt count', async () => {
    const r = await warmJwks({ attempts: 1, delayMs: 0 });
    expect(r.attempts).toBe(1);
  });

  // The original version swallowed the error entirely, so a failed warm-up in
  // production could only be diagnosed by inferring the cause from the gap
  // between log timestamps. The reason must reach the caller.
  it('surfaces why it failed', async () => {
    const r = await warmJwks({ delayMs: 0 });
    expect(r.error).toBeTruthy();
    expect(typeof r.error).toBe('string');
  });

  it('stays safe to call more than once', async () => {
    await expect(warmJwks({ delayMs: 0 })).resolves.toMatchObject({ warmed: false });
    await expect(warmJwks({ delayMs: 0 })).resolves.toMatchObject({ warmed: false });
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
