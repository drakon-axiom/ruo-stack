import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose';
import { loadConfig } from '../config.js';
import { Unauthorized } from '../errors.js';

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

let _jwks: ReturnType<typeof createRemoteJWKSet> | undefined;
function jwks() {
  if (!_jwks) {
    const cfg = loadConfig();
    _jwks = createRemoteJWKSet(new URL(`${cfg.SUPABASE_URL}/auth/v1/.well-known/jwks.json`));
  }
  return _jwks;
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
