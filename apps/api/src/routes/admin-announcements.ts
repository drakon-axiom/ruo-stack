import type { FastifyInstance } from 'fastify';
import {
  ANNOUNCEMENT_STATUSES,
  AUDIT_ACTIONS,
  AnnouncementCreateSchema,
  AnnouncementUpdateSchema,
  announcementDisplayState,
} from '@ruostack/shared';
import { z } from 'zod';
import { getClients } from '../clients.js';
import { writeAudit } from '../audit.js';
import { requireAdmin } from '../middleware/guards.js';
import { BadRequest, NotFound } from '../errors.js';

/**
 * Announcements admin (architecture §1.3) — authors the broadcasts that become
 * the brand Notifications inbox. Nothing is fanned out: publishing flips
 * `status`, and the brand side derives visibility (see @ruostack/shared
 * `isAnnouncementVisible`). Every mutation writes an AuditLog.
 */
export async function adminAnnouncementRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  const publicRow = (a: {
    id: string;
    audience: string;
    brandId: string | null;
    type: string;
    title: string;
    body: string;
    publishAt: Date | null;
    expiresAt: Date | null;
    status: string;
    createdBy: string;
    createdAt: Date;
    updatedAt: Date;
    brand?: { brandName: string } | null;
  }) => ({
    id: a.id,
    audience: a.audience,
    brand_id: a.brandId,
    brand_name: a.brand?.brandName ?? null,
    type: a.type,
    title: a.title,
    body: a.body,
    publish_at: a.publishAt,
    expires_at: a.expiresAt,
    status: a.status,
    // Derived — "scheduled"/"expired" are never stored (see the enum's comment).
    display_state: announcementDisplayState({
      status: a.status as never,
      publishAt: a.publishAt,
      expiresAt: a.expiresAt,
    }),
    created_by: a.createdBy,
    created_at: a.createdAt,
    updated_at: a.updatedAt,
  });

  // List + filter. `state` filters on the DERIVED display state, which is what
  // the admin tabs show (Draft / Scheduled / Live / Expired / Archived).
  app.get('/api/admin/announcements', { preHandler: requireAdmin('announcements', 'view') }, async (req) => {
    const q = z
      .object({
        status: z.enum(ANNOUNCEMENT_STATUSES).optional(),
        state: z.enum(['draft', 'scheduled', 'live', 'expired', 'archived']).optional(),
        search: z.string().max(120).optional(),
      })
      .parse(req.query);

    const rows = await prisma.announcement.findMany({
      where: {
        ...(q.status ? { status: q.status } : {}),
        ...(q.search
          ? {
              OR: [
                { title: { contains: q.search, mode: 'insensitive' as const } },
                { body: { contains: q.search, mode: 'insensitive' as const } },
              ],
            }
          : {}),
      },
      include: { brand: { select: { brandName: true } } },
      orderBy: { createdAt: 'desc' },
    });

    const announcements = rows.map(publicRow).filter((a) => !q.state || a.display_state === q.state);
    return { announcements };
  });

  app.get('/api/admin/announcements/:id', { preHandler: requireAdmin('announcements', 'view') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const row = await prisma.announcement.findUnique({ where: { id }, include: { brand: { select: { brandName: true } } } });
    if (!row) throw NotFound('Announcement not found');
    return publicRow(row);
  });

  // Create — always lands as a draft; publishing is an explicit second action so
  // a broadcast can't go out on a typo.
  app.post('/api/admin/announcements', { preHandler: requireAdmin('announcements', 'write') }, async (req, reply) => {
    const body = AnnouncementCreateSchema.parse(req.body);
    if (body.brand_id) {
      const brand = await prisma.brand.findUnique({ where: { id: body.brand_id }, select: { id: true } });
      if (!brand) throw BadRequest('unknown_brand', 'No brand with that id');
    }

    const created = await prisma.$transaction(async (tx) => {
      const a = await tx.announcement.create({
        data: {
          audience: body.audience,
          brandId: body.brand_id ?? null,
          type: body.type,
          title: body.title,
          body: body.body,
          publishAt: body.publish_at ? new Date(body.publish_at) : null,
          expiresAt: body.expires_at ? new Date(body.expires_at) : null,
          status: 'draft',
          createdBy: req.admin!.adminUserId,
        },
        include: { brand: { select: { brandName: true } } },
      });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.announcementCreated,
        targetType: 'announcement',
        targetId: a.id,
        after: { title: a.title, audience: a.audience, brand_id: a.brandId, type: a.type },
        ip: req.ip,
      });
      return a;
    });

    return reply.code(201).send(publicRow(created));
  });

  // Edit / publish / archive. A status transition is audited under its own
  // action so "who published this" is answerable from the audit log alone.
  app.patch('/api/admin/announcements/:id', { preHandler: requireAdmin('announcements', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const patch = AnnouncementUpdateSchema.parse(req.body);
    const existing = await prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw NotFound('Announcement not found');

    // Audience and brand_id are a pair: changing one without the other would
    // violate the DB check constraint, so resolve both against the merged state.
    const audience = patch.audience ?? existing.audience;
    const brandId = patch.brand_id !== undefined ? patch.brand_id ?? null : existing.brandId;
    if (audience === 'single_brand' && !brandId) throw BadRequest('brand_required', 'brand_id is required when audience is single_brand');
    if (audience !== 'single_brand' && brandId) throw BadRequest('brand_not_allowed', 'brand_id is only valid when audience is single_brand');
    if (brandId && brandId !== existing.brandId) {
      const brand = await prisma.brand.findUnique({ where: { id: brandId }, select: { id: true } });
      if (!brand) throw BadRequest('unknown_brand', 'No brand with that id');
    }

    const statusChanged = patch.status && patch.status !== existing.status;
    const action = !statusChanged
      ? AUDIT_ACTIONS.announcementUpdated
      : patch.status === 'published'
        ? AUDIT_ACTIONS.announcementPublished
        : patch.status === 'archived'
          ? AUDIT_ACTIONS.announcementArchived
          : AUDIT_ACTIONS.announcementUpdated;

    const updated = await prisma.$transaction(async (tx) => {
      const a = await tx.announcement.update({
        where: { id },
        data: {
          audience,
          brandId,
          ...(patch.type !== undefined ? { type: patch.type } : {}),
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.body !== undefined ? { body: patch.body } : {}),
          ...(patch.publish_at !== undefined ? { publishAt: patch.publish_at ? new Date(patch.publish_at) : null } : {}),
          ...(patch.expires_at !== undefined ? { expiresAt: patch.expires_at ? new Date(patch.expires_at) : null } : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
        },
        include: { brand: { select: { brandName: true } } },
      });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action,
        targetType: 'announcement',
        targetId: a.id,
        before: { title: existing.title, status: existing.status, audience: existing.audience },
        after: { title: a.title, status: a.status, audience: a.audience },
        ip: req.ip,
      });
      return a;
    });

    return publicRow(updated);
  });

  // Hard delete is drafts-only — anything that was ever published is archived
  // instead, so the audit trail always has the broadcast it refers to.
  app.delete('/api/admin/announcements/:id', { preHandler: requireAdmin('announcements', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await prisma.announcement.findUnique({ where: { id } });
    if (!existing) throw NotFound('Announcement not found');
    if (existing.status !== 'draft') {
      throw BadRequest('not_a_draft', 'Only drafts can be deleted — archive a published announcement instead');
    }

    await prisma.$transaction(async (tx) => {
      await tx.announcement.delete({ where: { id } });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.announcementDeleted,
        targetType: 'announcement',
        targetId: id,
        before: { title: existing.title, status: existing.status },
        ip: req.ip,
      });
    });

    return { deleted: true };
  });
}
