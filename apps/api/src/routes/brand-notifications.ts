import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getClients } from '../clients.ts';
import { requireBrand } from '../middleware/guards.ts';
import { NotFound } from '../errors.ts';
import { getFeed, getUnreadCount, markAllRead, markRead } from '../services/notifications.ts';

/**
 * Brand Notifications inbox (architecture §1.3) — thin HTTP over
 * `services/notifications.ts`, which owns the visibility rule and is what the
 * DB integration tests exercise directly.
 */
export async function brandNotificationRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  app.get('/api/brand/notifications', { preHandler: requireBrand }, async (req) => {
    const q = z
      .object({
        unread: z.enum(['true', 'false']).optional(),
        limit: z.coerce.number().int().min(1).max(100).default(50),
      })
      .parse(req.query);
    const { brandId, userId } = req.brand!;

    const notifications = await getFeed(prisma, brandId, userId, {
      unreadOnly: q.unread === 'true',
      limit: q.limit,
    });
    return { notifications };
  });

  // Badge count for the top-bar bell — its own endpoint so the bell can poll
  // something cheap without pulling the whole feed.
  app.get('/api/brand/notifications/unread-count', { preHandler: requireBrand }, async (req) => {
    const { brandId, userId } = req.brand!;
    return { unread: await getUnreadCount(prisma, brandId, userId) };
  });

  app.post('/api/brand/notifications/:id/read', { preHandler: requireBrand }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { brandId, userId } = req.brand!;

    const readAt = await markRead(prisma, brandId, userId, id);
    if (!readAt) throw NotFound('Notification not found');
    return { id, read_at: readAt };
  });

  app.post('/api/brand/notifications/read-all', { preHandler: requireBrand }, async (req) => {
    const { brandId, userId } = req.brand!;
    return { marked: await markAllRead(prisma, brandId, userId) };
  });
}
