import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  AdminCreateSchema,
  AdminRolePatchSchema,
  AdminStatusPatchSchema,
  AuditQuerySchema,
  AUDIT_ACTIONS,
} from '@ruostack/shared';
import { getClients } from '../clients.js';
import { writeAudit } from '../audit.js';
import { requireAdmin } from '../middleware/guards.js';
import { Conflict, NotFound } from '../errors.js';
import { hashPassword, randomToken } from '../crypto.js';

/**
 * Admin Users & Roles (super_admin only) + the AuditLog viewer — the artifact
 * that proves the audit spine works end-to-end. All mutations are audited.
 * Role grants and admin suspension are super_admin-only via the role-gate matrix
 * (role_grants / admin_users surfaces); an `operations` admin gets 403.
 */
export async function adminUsersRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, email } = getClients();

  function publicAdmin(a: {
    id: string;
    email: string;
    fullName: string;
    role: string;
    status: string;
    mfaEnabled: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
  }) {
    return {
      id: a.id,
      email: a.email,
      full_name: a.fullName,
      role: a.role,
      status: a.status,
      mfa_enabled: a.mfaEnabled,
      last_login_at: a.lastLoginAt,
      created_at: a.createdAt,
    };
  }

  // List admins — super_admin only (admin_users surface).
  app.get('/api/admin/admins', { preHandler: requireAdmin('admin_users', 'view') }, async () => {
    const admins = await prisma.adminUser.findMany({ orderBy: { createdAt: 'asc' } });
    return { admins: admins.map(publicAdmin) };
  });

  // Create admin + invite. Issues an initial password emailed via EmailAdapter
  // (option a). The invitee enrolls TOTP on first login.
  app.post('/api/admin/admins', { preHandler: requireAdmin('admin_users', 'write') }, async (req, reply) => {
    const body = AdminCreateSchema.parse(req.body);
    const dup = await prisma.adminUser.findUnique({ where: { email: body.email } });
    if (dup) throw Conflict('email_taken', 'An admin with that email already exists');

    const initialPassword = randomToken(12);
    const created = await prisma.$transaction(async (tx) => {
      const a = await tx.adminUser.create({
        data: {
          email: body.email,
          fullName: body.full_name,
          role: body.role,
          passwordHash: await hashPassword(initialPassword),
          createdBy: req.admin!.adminUserId,
        },
      });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.adminCreated,
        targetType: 'admin_user',
        targetId: a.id,
        after: { email: a.email, role: a.role },
        ip: req.ip,
      });
      return a;
    });

    // The admin row is already committed, so a send failure must not 500 the
    // request — a retry would just hit `email_taken`. Report delivery status
    // instead, so the operator knows to convey the temp password another way.
    let emailSent = true;
    try {
      await email.send({
        to: body.email,
        subject: 'Your RUOStack admin account',
        text: [
          `An admin account has been created for you (role: ${body.role}).`,
          '',
          `Temporary password: ${initialPassword}`,
          '',
          'Log in and you will be required to set up TOTP MFA on first login.',
        ].join('\n'),
      });
    } catch (err) {
      emailSent = false;
      req.log.error({ err, adminUserId: created.id }, 'admin invite email failed to send');
    }

    return reply.code(201).send({ ...publicAdmin(created), email_sent: emailSent });
  });

  // Grant/revoke role — super_admin only (role_grants surface).
  app.patch('/api/admin/admins/:id/role', { preHandler: requireAdmin('role_grants', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { role } = AdminRolePatchSchema.parse(req.body);
    const existing = await prisma.adminUser.findUnique({ where: { id } });
    if (!existing) throw NotFound('Admin not found');
    if (existing.role === role) return publicAdmin(existing);

    const updated = await prisma.$transaction(async (tx) => {
      const a = await tx.adminUser.update({ where: { id }, data: { role } });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.roleGranted,
        targetType: 'admin_user',
        targetId: id,
        before: { role: existing.role },
        after: { role: a.role },
        ip: req.ip,
      });
      return a;
    });
    return publicAdmin(updated);
  });

  // Suspend/activate — super_admin only (admin_users surface). Suspend REVOKES
  // the admin's active sessions immediately (critical invariant #7).
  app.patch('/api/admin/admins/:id/status', { preHandler: requireAdmin('admin_users', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { status, reason } = AdminStatusPatchSchema.parse(req.body);
    const existing = await prisma.adminUser.findUnique({ where: { id } });
    if (!existing) throw NotFound('Admin not found');

    const updated = await prisma.$transaction(async (tx) => {
      const a = await tx.adminUser.update({ where: { id }, data: { status } });
      if (status === 'suspended') {
        await tx.adminSession.updateMany({
          where: { adminUserId: id, revokedAt: null },
          data: { revokedAt: new Date() },
        });
      }
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: status === 'suspended' ? AUDIT_ACTIONS.adminSuspended : AUDIT_ACTIONS.adminActivated,
        targetType: 'admin_user',
        targetId: id,
        before: { status: existing.status },
        after: { status: a.status },
        reason,
        ip: req.ip,
      });
      return a;
    });
    return publicAdmin(updated);
  });

  // AuditLog viewer — filterable; any admin role may view (audit_log surface).
  app.get('/api/admin/audit-log', { preHandler: requireAdmin('audit_log', 'view') }, async (req) => {
    const q = AuditQuerySchema.parse(req.query);
    const where = {
      ...(q.actor_type ? { actorType: q.actor_type } : {}),
      ...(q.actor_id ? { actorId: q.actor_id } : {}),
      ...(q.action ? { action: q.action } : {}),
      ...(q.target_type ? { targetType: q.target_type } : {}),
      ...(q.target_id ? { targetId: q.target_id } : {}),
      ...(q.from || q.to
        ? { createdAt: { ...(q.from ? { gte: new Date(q.from) } : {}), ...(q.to ? { lte: new Date(q.to) } : {}) } }
        : {}),
    };
    const rows = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: q.limit + 1,
      ...(q.cursor ? { cursor: { id: q.cursor }, skip: 1 } : {}),
    });
    const hasMore = rows.length > q.limit;
    const page = hasMore ? rows.slice(0, q.limit) : rows;
    return { entries: page, next_cursor: hasMore ? page[page.length - 1]?.id : null };
  });
}
