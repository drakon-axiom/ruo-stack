import type { FastifyInstance } from 'fastify';
import type { Claim } from '@ruostack/db';
import { z } from 'zod';
import { AUDIT_ACTIONS, CLAIM_SLA_DAYS, ClaimOpenSchema, claimEligibility } from '@ruostack/shared';
import { getClients } from '../clients.js';
import { writeAudit } from '../audit.js';
import { requireBrand } from '../middleware/guards.js';
import { BadRequest, NotFound } from '../errors.js';

/**
 * Brand-facing claims (§11): open a post-ship problem against an order and track
 * its resolution. No customer refunds once shipped — claims are the remedy path.
 */
export async function brandClaimRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  app.post('/api/brand/orders/:id/claims', { preHandler: requireBrand, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const { brandId, userId } = req.brand!;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = ClaimOpenSchema.parse(req.body);

    const order = await prisma.order.findFirst({ where: { id, brandId }, select: { id: true, status: true, shippedAt: true, deliveredAt: true } });
    if (!order) throw NotFound('Order not found');

    const elig = claimEligibility(body.type, order);
    if (!elig.eligible) throw BadRequest('not_eligible', elig.reason ?? 'Not eligible for a claim');
    if (body.type === 'damaged' && body.photos.length === 0) throw BadRequest('photos_required', 'Damage claims require at least one photo.');

    const claim = await prisma.$transaction(async (tx) => {
      const c = await tx.claim.create({
        data: {
          orderId: id,
          brandId,
          type: body.type,
          description: body.description ?? null,
          photos: body.photos,
          openedByType: 'brand',
          openedById: userId,
          slaDueAt: new Date(Date.now() + CLAIM_SLA_DAYS * 86_400_000),
        },
      });
      await writeAudit(tx, { actorType: 'brand', actorId: userId, action: AUDIT_ACTIONS.claimOpened, targetType: 'claim', targetId: c.id, after: { order_id: id, type: body.type }, ip: req.ip });
      return c;
    });
    return reply.code(201).send(serializeClaim(claim));
  });

  app.get('/api/brand/claims', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const claims = await prisma.claim.findMany({
      where: { brandId },
      orderBy: { createdAt: 'desc' },
      include: { order: { select: { recipientName: true, trackingNumber: true } } },
    });
    return { claims: claims.map((c) => ({ ...serializeClaim(c), recipient_name: c.order.recipientName, tracking_number: c.order.trackingNumber })) };
  });

  app.get('/api/brand/claims/:id', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const claim = await prisma.claim.findFirst({ where: { id, brandId } });
    if (!claim) throw NotFound('Claim not found');
    return serializeClaim(claim);
  });
}

export function serializeClaim(c: Claim) {
  return {
    id: c.id,
    order_id: c.orderId,
    type: c.type,
    status: c.status,
    resolution: c.resolution,
    description: c.description,
    photos: c.photos,
    carrier_claim_id: c.carrierClaimId,
    amount_cents: c.amountCents,
    reship_order_id: c.reshipOrderId,
    reason: c.reason,
    sla_due_at: c.slaDueAt,
    resolved_at: c.resolvedAt,
    created_at: c.createdAt,
  };
}
