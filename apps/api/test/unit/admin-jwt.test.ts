import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { signAdminAccessToken, verifyAdminAccessToken } from '../../src/auth/admin-jwt.ts';
import { loadConfig } from '../../src/config.ts';
import { HttpError } from '../../src/errors.ts';

// Critical invariant #1 (realm isolation), admin side: the admin credential is
// signed with its OWN secret and must carry realm:'admin'. A brand-shaped token
// — even one forged with the admin secret — must NOT verify as admin.
describe('admin JWT verification', () => {
  it('round-trips a valid admin token', () => {
    const token = signAdminAccessToken({ sub: 'admin-1', role: 'operations', sid: 'sess-1' });
    const p = verifyAdminAccessToken(token);
    expect(p.realm).toBe('admin');
    expect(p.adminUserId).toBe('admin-1');
    expect(p.role).toBe('operations');
    expect(p.sessionId).toBe('sess-1');
  });

  it('rejects a token signed with a different secret', () => {
    const forged = jwt.sign({ sub: 'x', realm: 'admin', role: 'super_admin', sid: 's' }, 'not-the-admin-secret');
    expect(() => verifyAdminAccessToken(forged)).toThrow(HttpError);
  });

  it('rejects a brand-realm token even when signed with the admin secret', () => {
    const cfg = loadConfig();
    // Simulates a brand claim shape trying to pass the admin guard.
    const brandish = jwt.sign({ sub: 'u', realm: 'brand', brand_id: 'b1' }, cfg.JWT_ADMIN_SECRET);
    expect(() => verifyAdminAccessToken(brandish)).toThrow(/admin-realm/);
  });
});
