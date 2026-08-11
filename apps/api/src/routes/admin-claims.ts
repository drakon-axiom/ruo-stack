import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AUDIT_ACTIONS, CLAIM_SLA_DAYS, ClaimOpenSchema, ClaimResolveSchema, canResolveClaim } from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { writeAudit } from '../audit.ts';
import { requireAdmin } from '../middleware/guards.ts';
import { resolveClaim } from '../services/claims.ts';
import { serializeClaim } from './brand-claims.ts';
import { BadRequest, Conflict, Forbidden, NotFound } from '../errors.ts';

/**
 * Claims queue (§11): operator triage + resolution. States open → investigating →
 * carrier_filed → resolved (reshipped | credited | denied), each reason-coded and
 * audit-logged. Role-gated on 'claims': super_admin / operations write (open +
 * triage); support view. RESOLUTION is a financial action gated more tightly than
 * the surface — only super_admin may resolve, and finance may resolve credits.
 */
export async function adminClaimRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  // Queue.
  app.get('/api/admin/claims', { preHandler: requireAdmin('claims', 'view') }, async (req) => {
    const q = z.object({ status: z.enum(['open', 'investigating', 'carrier_filed', 'resolved']).optional() }).parse(req.query);
    const claims = await prisma.claim.findMany({
      where: { ...(q.status ? { status: q.status } : {}) },
      orderBy: [{ status: 'asc' }, { slaDueAt: 'asc' }],
      take: 300,
      include: { brand: { select: { brandName: true } }, order: { select: { recipientName: true, trackingNumber: true, carrier: true } } },
    });
    return {
      claims: claims.map((c) => ({
        ...serializeClaim(c),
        brand_name: c.brand.brandName,
        recipient_name: c.order.recipientName,
        tracking_number: c.order.trackingNumber,
        carrier: c.order.carrier,
        sla_overdue: c.status !== 'resolved' && c.slaDueAt < new Date(),
      })),
    };
  });

  // Detail.
  app.get('/api/admin/claims/:id', { preHandler: requireAdmin('claims', 'view') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const c = await prisma.claim.findUnique({
      where: { id },
      include: { brand: { select: { brandName: true } }, order: { select: { recipientName: true, city: true, state: true, trackingNumber: true, carrier: true, walletChargeCents: true } } },
    });
    if (!c) throw NotFound('Claim not found');
    return { ...serializeClaim(c), brand_name: c.brand.brandName, order: c.order };
  });

  // Support opens a claim on a brand's behalf.
  app.post('/api/admin/orders/:id/claims', { preHandler: requireAdmin('claims', 'write') }, async (req, reply) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = ClaimOpenSchema.parse(req.body);
    const order = await prisma.order.findUnique({ where: { id }, select: { id: true, brandId: true, status: true } });
    if (!order) throw NotFound('Order not found');
    if (order.status !== 'shipped' && order.status !== 'delivered') throw BadRequest('not_shipped', 'Claims apply to shipped orders only');
    const claim = await prisma.claim.create({
      data: { orderId: id, brandId: order.brandId, type: body.type, description: body.description ?? null, photos: body.photos, openedByType: 'admin', openedById: req.admin!.adminUserId, slaDueAt: new Date(Date.now() + CLAIM_SLA_DAYS * 86_400_000) },
    });
    await writeAudit(prisma, { actorType: 'admin', actorId: req.admin!.adminUserId, action: AUDIT_ACTIONS.claimOpened, targetType: 'claim', targetId: claim.id, after: { order_id: id, type: body.type, on_behalf: true }, ip: req.ip });
    return reply.code(201).send(serializeClaim(claim));
  });

  // Triage: advance status / record the carrier claim id.
  app.patch('/api/admin/claims/:id', { preHandler: requireAdmin('claims', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = z.object({ status: z.enum(['open', 'investigating', 'carrier_filed']).optional(), carrier_claim_id: z.string().max(120).optional() }).parse(req.body);
    const claim = await prisma.claim.findUnique({ where: { id } });
    if (!claim) throw NotFound('Claim not found');
    if (claim.status === 'resolved') throw Conflict('resolved', 'Claim is already resolved');
    const updated = await prisma.claim.update({
      where: { id },
      data: { ...(body.status ? { status: body.status } : {}), ...(body.carrier_claim_id !== undefined ? { carrierClaimId: body.carrier_claim_id } : {}) },
    });
    await writeAudit(prisma, { actorType: 'admin', actorId: req.admin!.adminUserId, action: AUDIT_ACTIONS.claimUpdated, targetType: 'claim', targetId: id, after: { status: updated.status, carrier_claim_id: updated.carrierClaimId }, ip: req.ip });
    return serializeClaim(updated);
  });

  // Resolve: reship / credit / deny. Gated per-ACTION (not just the surface):
  // resolution credits wallets and clones charged orders, so operations (open +
  // triage only) and support are refused here. `requireAdmin('claims','view')`
  // authenticates + supplies the live role; the explicit check does the rest.
  app.post('/api/admin/claims/:id/resolve', { preHandler: requireAdmin('claims', 'view') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = ClaimResolveSchema.parse(req.body);
    const role = req.admin!.role;
    if (!canResolveClaim(role, body.resolution)) throw Forbidden(`Role '${role}' cannot resolve a claim to '${body.resolution}'`);
    const resolved = await resolveClaim(prisma, id, { resolution: body.resolution, reason: body.reason, amountCents: body.amount_cents, comp: body.comp }, req.admin!.adminUserId, req.ip);
    return serializeClaim(resolved);
  });
}
