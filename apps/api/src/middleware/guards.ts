import type { FastifyReply, FastifyRequest, preHandlerHookHandler } from 'fastify';
import { canView, canWrite, type Surface } from '@ruostack/shared';
import { verifyBrandToken } from '../auth/brand-token.js';
import { verifyAdminAccessToken } from '../auth/admin-jwt.js';
import { getClients } from '../clients.js';
import { Forbidden, Unauthorized } from '../errors.js';

function bearer(req: FastifyRequest): string {
  const h = req.headers.authorization;
  if (!h || !h.startsWith('Bearer ')) throw Unauthorized('Missing bearer token');
  return h.slice('Bearer '.length).trim();
}

/**
 * Brand-realm guard. Verifies a Supabase JWT carrying realm:'brand' + brand_id.
 * An admin token (different signing key, no brand claim) cannot satisfy this.
 */
export const requireBrand: preHandlerHookHandler = async (req: FastifyRequest, _reply: FastifyReply) => {
  const principal = await verifyBrandToken(bearer(req));
  // A suspended brand is locked out of all brand routes (operator action).
  const { prisma } = getClients();
  const brand = await prisma.brand.findUnique({ where: { id: principal.brandId }, select: { status: true } });
  if (!brand) throw Unauthorized('Brand not found');
  if (brand.status === 'suspended') throw Forbidden('This account is suspended — contact support');
  req.brand = principal;
};

/**
 * Admin-realm guard, parameterized by the role-gate surface + required access.
 * Enforced SERVER-SIDE (critical invariant #7). Also re-checks live session
 * revocation + admin status, so suspending an admin (which revokes sessions)
 * takes effect immediately. A brand Supabase token cannot verify here.
 */
export function requireAdmin(surface: Surface, access: 'view' | 'write' = 'view'): preHandlerHookHandler {
  return async (req: FastifyRequest, _reply: FastifyReply) => {
    const principal = verifyAdminAccessToken(bearer(req));
    const { prisma } = getClients();

    // Session must exist, not be revoked, and not be expired.
    const session = await prisma.adminSession.findUnique({ where: { id: principal.sessionId } });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw Unauthorized('Session revoked or expired');
    }

    // Admin must still be active (suspension revokes sessions, but double-check).
    const admin = await prisma.adminUser.findUnique({ where: { id: principal.adminUserId } });
    if (!admin || admin.status !== 'active') throw Unauthorized('Admin inactive');

    // Role gate (server-side authority — never trust the UI).
    const ok = access === 'write' ? canWrite(admin.role, surface) : canView(admin.role, surface);
    if (!ok) throw Forbidden(`Role '${admin.role}' lacks ${access} on '${surface}'`);

    // Use the live role from the DB (not the possibly-stale token claim).
    req.admin = { ...principal, role: admin.role };
  };
}
