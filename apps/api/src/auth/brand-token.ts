import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { loadConfig } from '../config.ts';
import { Unauthorized } from '../errors.ts';

/**
 * Verifies a Supabase-issued brand access token and reads the realm/brand_id
 * claims injected by `public.custom_access_token_hook`. Modern Supabase projects
 * sign asymmetrically → verify via JWKS. A legacy HS256 secret is supported as a
 * fallback if SUPABASE_JWT_SECRET is set.
 *
 * Critical invariant #1: a brand token can NEVER satisfy an admin guard. This
 * verifier asserts `realm === 'brand'` and returns a brand principal only.
 */
export interface BrandPrincipal {
  realm: 'brand';
  userId: string;
  brandId: string;
}

/**
 * How long a successfully fetched key set is reused before jose refetches it.
 *
 * jose's default is 10 minutes, and the refetch happens INLINE on whichever
 * request trips the expiry -- measured at 457ms against the live project, versus
 * ~1ms for a cached verification. That is a periodic latency spike on a random
 * user's first API call, which is exactly the "slow sometimes" symptom.
 *
 * A long max age is safe because key ROTATION does not depend on it: when a
 * token presents a `kid` that is not in the cached set, jose fetches
 * immediately regardless of cache age (throttled only by its 30s
 * cooldownDuration). This value governs only how often we re-fetch a key set
 * that is still working.
 */
export const JWKS_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000;

let _jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function jwks() {
  if (!_jwks) {
    const cfg = loadConfig();
    _jwks = createRemoteJWKSet(new URL(`${cfg.SUPABASE_URL}/auth/v1/.well-known/jwks.json`), {
      cacheMaxAge: JWKS_CACHE_MAX_AGE_MS,
    });
  }
  return _jwks;
}

/**
 * Fetch the key set at boot so the first authenticated request does not pay for
 * it. Call from server startup, not from a request path.
 *
 * Never throws: a warm-up is an optimisation, and taking the API down because
 * Supabase was briefly unreachable during boot would be worse than the cold
 * first request this avoids. On failure the key set is simply fetched lazily by
 * the first request, exactly as before.
 *
 * Returns whether the key set is now cached, so the caller can log it.
 */
export async function warmJwks(): Promise<boolean> {
  try {
    // `reload()` is in jose's exported type surface but marked @ignore; if a
    // future release drops it, `pnpm typecheck` fails here rather than silently
    // reverting to lazy fetching at runtime.
    await jwks().reload();
    return true;
  } catch {
    return false;
  }
}

async function verifySignature(token: string): Promise<JWTPayload> {
  const cfg = loadConfig();
  try {
    const { payload } = await jwtVerify(token, jwks(), { audience: 'authenticated' });
    return payload;
  } catch (err) {
    // Fallback: symmetric HS256 (legacy projects only).
    if (cfg.SUPABASE_JWT_SECRET) {
      const secret = new TextEncoder().encode(cfg.SUPABASE_JWT_SECRET);
      const { payload } = await jwtVerify(token, secret, { audience: 'authenticated' });
      return payload;
    }
    throw err;
  }
}

export async function verifyBrandToken(token: string): Promise<BrandPrincipal> {
  let payload: JWTPayload;
  try {
    payload = await verifySignature(token);
  } catch {
    throw Unauthorized('Invalid brand token');
  }

  const realm = payload['realm'];
  const brandId = payload['brand_id'];
  const userId = payload.sub;

  // Reject anything that isn't an authenticated brand token with the hook claims.
  if (realm !== 'brand' || typeof brandId !== 'string' || !userId) {
    throw Unauthorized('Token is not a brand-realm token');
  }
  return { realm: 'brand', userId, brandId };
}
