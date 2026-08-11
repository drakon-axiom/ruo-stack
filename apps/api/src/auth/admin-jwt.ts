import jwt from 'jsonwebtoken';
import type { AdminRole } from '@ruostack/shared';
import { loadConfig } from '../config.ts';
import { Unauthorized } from '../errors.ts';

/**
 * Hand-rolled admin identity (option a), kept OUT of the customer pool with its
 * OWN signing secret (JWT_ADMIN_SECRET). A Supabase brand token is signed by a
 * different key and carries no admin claim → it can never verify here.
 */
export interface AdminTokenPayload {
  sub: string; // AdminUser.id
  realm: 'admin';
  role: AdminRole;
  sid: string; // AdminSession.id (for revocation checks)
}

export interface AdminPrincipal {
  realm: 'admin';
  adminUserId: string;
  role: AdminRole;
  sessionId: string;
}

export function signAdminAccessToken(p: Omit<AdminTokenPayload, 'realm'>): string {
  const cfg = loadConfig();
  return jwt.sign({ ...p, realm: 'admin' }, cfg.JWT_ADMIN_SECRET, {
    algorithm: 'HS256',
    expiresIn: cfg.JWT_ADMIN_ACCESS_TTL,
  });
}

export function verifyAdminAccessToken(token: string): AdminPrincipal {
  const cfg = loadConfig();
  let decoded: jwt.JwtPayload | string;
  try {
    decoded = jwt.verify(token, cfg.JWT_ADMIN_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw Unauthorized('Invalid admin token');
  }
  if (typeof decoded === 'string' || decoded['realm'] !== 'admin' || !decoded.sub) {
    throw Unauthorized('Token is not an admin-realm token');
  }
  return {
    realm: 'admin',
    adminUserId: String(decoded.sub),
    role: decoded['role'] as AdminRole,
    sessionId: String(decoded['sid']),
  };
}
