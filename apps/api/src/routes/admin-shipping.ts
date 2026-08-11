import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AUDIT_ACTIONS, SERVICE_TIERS } from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { writeAudit } from '../audit.ts';
import { requireAdmin } from '../middleware/guards.ts';
import { NotFound } from '../errors.ts';

/**
 * Admin CRUD for the fulfillment rules engine (§6): the Box catalog + carrier
 * ServiceMappings. All admin-configurable so thresholds/services change without a
 * code deploy. Role-gated on the 'shipping_rules' surface; every write is audited.
 */
const BoxSchema = z.object({
  name: z.string().min(1).max(80),
  inner_length_in: z.number().positive().max(200),
  inner_width_in: z.number().positive().max(200),
  inner_height_in: z.number().positive().max(200),
  max_weight_oz: z.number().int().positive().max(100_000),
  tare_oz: z.number().int().min(0).max(10_000).default(0),
  enabled: z.boolean().default(true),
  sort_order: z.number().int().min(0).max(1000).default(0),
});

const ServiceSchema = z.object({
  tier: z.enum(SERVICE_TIERS),
  carrier_service_code: z.string().min(1).max(80),
  display_label: z.string().min(1).max(120),
  transit_estimate: z.string().min(1).max(80),
  max_weight_oz: z.number().int().positive().max(100_000),
  enabled: z.boolean().default(true),
  selection_policy: z.enum(['cheapest', 'fixed']).default('cheapest'),
  sort_order: z.number().int().min(0).max(1000).default(0),
});

export async function adminShippingRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  async function audit(req: { admin?: { adminUserId: string }; ip: string }, action: string, targetType: string, targetId: string, after: unknown) {
    await writeAudit(prisma, { actorType: 'admin', actorId: req.admin!.adminUserId, action, targetType, targetId, after, ip: req.ip });
  }

  // ── Boxes ──────────────────────────────────────────────────────────────────
  app.get('/api/admin/shipping/boxes', { preHandler: requireAdmin('shipping_rules', 'view') }, async () => {
    return { boxes: await prisma.box.findMany({ orderBy: { sortOrder: 'asc' } }) };
  });

  app.post('/api/admin/shipping/boxes', { preHandler: requireAdmin('shipping_rules', 'write') }, async (req, reply) => {
    const b = BoxSchema.parse(req.body);
    const box = await prisma.box.create({
      data: { name: b.name, innerLengthIn: b.inner_length_in, innerWidthIn: b.inner_width_in, innerHeightIn: b.inner_height_in, maxWeightOz: b.max_weight_oz, tareOz: b.tare_oz, enabled: b.enabled, sortOrder: b.sort_order },
    });
    await audit(req, AUDIT_ACTIONS.shippingRuleUpdated, 'box', box.id, { op: 'create', name: box.name });
    return reply.code(201).send(box);
  });

  app.patch('/api/admin/shipping/boxes/:id', { preHandler: requireAdmin('shipping_rules', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const b = BoxSchema.partial().parse(req.body);
    if (!(await prisma.box.findUnique({ where: { id } }))) throw NotFound('Box not found');
    const box = await prisma.box.update({
      where: { id },
      data: {
        ...(b.name !== undefined ? { name: b.name } : {}),
        ...(b.inner_length_in !== undefined ? { innerLengthIn: b.inner_length_in } : {}),
        ...(b.inner_width_in !== undefined ? { innerWidthIn: b.inner_width_in } : {}),
        ...(b.inner_height_in !== undefined ? { innerHeightIn: b.inner_height_in } : {}),
        ...(b.max_weight_oz !== undefined ? { maxWeightOz: b.max_weight_oz } : {}),
        ...(b.tare_oz !== undefined ? { tareOz: b.tare_oz } : {}),
        ...(b.enabled !== undefined ? { enabled: b.enabled } : {}),
        ...(b.sort_order !== undefined ? { sortOrder: b.sort_order } : {}),
      },
    });
    await audit(req, AUDIT_ACTIONS.shippingRuleUpdated, 'box', box.id, { op: 'update', enabled: box.enabled });
    return box;
  });

  app.delete('/api/admin/shipping/boxes/:id', { preHandler: requireAdmin('shipping_rules', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await prisma.box.findUnique({ where: { id } }))) throw NotFound('Box not found');
    await prisma.box.delete({ where: { id } });
    await audit(req, AUDIT_ACTIONS.shippingRuleUpdated, 'box', id, { op: 'delete' });
    return { ok: true };
  });

  // ── Service mappings ─────────────────────────────────────────────────────────
  app.get('/api/admin/shipping/services', { preHandler: requireAdmin('shipping_rules', 'view') }, async () => {
    return { services: await prisma.serviceMapping.findMany({ orderBy: { sortOrder: 'asc' } }) };
  });

  app.post('/api/admin/shipping/services', { preHandler: requireAdmin('shipping_rules', 'write') }, async (req, reply) => {
    const s = ServiceSchema.parse(req.body);
    const svc = await prisma.serviceMapping.create({
      data: { tier: s.tier, carrierServiceCode: s.carrier_service_code, displayLabel: s.display_label, transitEstimate: s.transit_estimate, maxWeightOz: s.max_weight_oz, enabled: s.enabled, selectionPolicy: s.selection_policy, sortOrder: s.sort_order },
    });
    await audit(req, AUDIT_ACTIONS.shippingRuleUpdated, 'service_mapping', svc.id, { op: 'create', code: svc.carrierServiceCode });
    return reply.code(201).send(svc);
  });

  app.patch('/api/admin/shipping/services/:id', { preHandler: requireAdmin('shipping_rules', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const s = ServiceSchema.partial().parse(req.body);
    if (!(await prisma.serviceMapping.findUnique({ where: { id } }))) throw NotFound('Service not found');
    const svc = await prisma.serviceMapping.update({
      where: { id },
      data: {
        ...(s.tier !== undefined ? { tier: s.tier } : {}),
        ...(s.carrier_service_code !== undefined ? { carrierServiceCode: s.carrier_service_code } : {}),
        ...(s.display_label !== undefined ? { displayLabel: s.display_label } : {}),
        ...(s.transit_estimate !== undefined ? { transitEstimate: s.transit_estimate } : {}),
        ...(s.max_weight_oz !== undefined ? { maxWeightOz: s.max_weight_oz } : {}),
        ...(s.enabled !== undefined ? { enabled: s.enabled } : {}),
        ...(s.selection_policy !== undefined ? { selectionPolicy: s.selection_policy } : {}),
        ...(s.sort_order !== undefined ? { sortOrder: s.sort_order } : {}),
      },
    });
    await audit(req, AUDIT_ACTIONS.shippingRuleUpdated, 'service_mapping', svc.id, { op: 'update', enabled: svc.enabled });
    return svc;
  });

  app.delete('/api/admin/shipping/services/:id', { preHandler: requireAdmin('shipping_rules', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    if (!(await prisma.serviceMapping.findUnique({ where: { id } }))) throw NotFound('Service not found');
    await prisma.serviceMapping.delete({ where: { id } });
    await audit(req, AUDIT_ACTIONS.shippingRuleUpdated, 'service_mapping', id, { op: 'delete' });
    return { ok: true };
  });
}
