import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AUDIT_ACTIONS, PLAN_KEYS } from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { writeAudit } from '../audit.ts';
import { requireAdmin } from '../middleware/guards.ts';
import { NotFound } from '../errors.ts';
import { getPlanRegistry, invalidatePlanRegistry } from '../services/plan-registry.ts';

/**
 * Admin read/edit surface for the plan registry (`plan` table): name,
 * features, and the display-only shippingCutoff ONLY. Price is deliberately
 * NOT editable here — it lives on the append-only `plan_price` ledger and
 * needs a Stripe round-trip (new Price object, then flip active), which is
 * Task 8's own route, not this simple CRUD.
 *
 * Gated on the 'plans' surface (roles.ts) — see the comment there for why
 * this is not the 'subscription' surface admin-brands.ts already uses.
 * Starter is fully editable here: it has no price to protect, and its name/
 * features/shippingCutoff are exactly as admin-owned as Pro's or Volume's.
 */
const PlanPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  features: z.array(z.string().min(1).max(200)).max(20).optional(),
  shipping_cutoff: z.string().min(1).max(80).optional(),
});

export async function adminPlanRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  // The registry plus each plan's active price — the same read every other
  // consumer (brand-billing, dunning, shipping) gets, so what admins see
  // here can never disagree with what the wire actually serves.
  app.get('/api/admin/plans', { preHandler: requireAdmin('plans', 'view') }, async () => {
    const registry = await getPlanRegistry(prisma);
    return {
      plans: PLAN_KEYS.map((key) => {
        const p = registry[key];
        return {
          key: p.key,
          name: p.name,
          features: p.features,
          shipping_cutoff: p.capabilities.shippingCutoff,
          store_connections: p.capabilities.storeConnections,
          max_orders_per_month: p.capabilities.maxOrdersPerMonth,
          shipping: p.capabilities.shipping,
          price_cents: p.priceCents,
          stripe_price_id: p.stripePriceId,
          price_version_id: p.priceVersionId,
        };
      }),
    };
  });

  app.patch('/api/admin/plans/:key', { preHandler: requireAdmin('plans', 'write') }, async (req) => {
    const { key } = z.object({ key: z.enum(PLAN_KEYS) }).parse(req.params);
    const body = PlanPatchSchema.parse(req.body);

    const existing = await prisma.plan.findUnique({ where: { key } });
    if (!existing) throw NotFound('Plan not found');

    const before = { name: existing.name, features: existing.features, shipping_cutoff: existing.shippingCutoff };
    const data: { name?: string; features?: string[]; shippingCutoff?: string; updatedBy: string } = {
      updatedBy: req.admin!.adminUserId,
    };
    if (body.name !== undefined) data.name = body.name;
    if (body.features !== undefined) data.features = body.features;
    if (body.shipping_cutoff !== undefined) data.shippingCutoff = body.shipping_cutoff;

    const updated = await prisma.$transaction(async (tx) => {
      const row = await tx.plan.update({ where: { key }, data });
      // Passed the transaction client so the audit row commits atomically
      // with the mutation — never a write that lands without its own record.
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: AUDIT_ACTIONS.planUpdated,
        targetType: 'plan',
        targetId: key,
        before,
        after: { name: row.name, features: row.features, shipping_cutoff: row.shippingCutoff },
        ip: req.ip,
      });
      return row;
    });

    // Outside the transaction, after commit: admins would otherwise see
    // their own edit reflected on the very next read for up to 60s
    // (PLAN_CACHE_TTL_SECONDS) if the process-wide cache weren't invalidated.
    invalidatePlanRegistry();

    return {
      key: updated.key,
      name: updated.name,
      features: updated.features,
      shipping_cutoff: updated.shippingCutoff,
    };
  });
}
