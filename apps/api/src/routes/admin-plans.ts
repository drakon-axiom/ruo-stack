import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AUDIT_ACTIONS, PLAN_KEYS } from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { writeAudit } from '../audit.ts';
import { requireAdmin } from '../middleware/guards.ts';
import { NotFound } from '../errors.ts';
import { getPlanRegistry, invalidatePlanRegistry } from '../services/plan-registry.ts';
import { changePlanPrice } from '../services/plan-price.ts';

/**
 * Admin read/edit surface for the plan registry. `PATCH /api/admin/plans/:key`
 * is simple CRUD over the `plan` table: name, features, and the display-only
 * shippingCutoff. Price is a different shape entirely — it lives on the
 * append-only `plan_price` ledger and needs a Stripe round-trip (new Price
 * object, then flip active) — so it gets its own route,
 * `POST /api/admin/plans/:key/price`, backed by `changePlanPrice()`
 * (services/plan-price.ts).
 *
 * Gated on the 'plans' surface (roles.ts) — see the comment there for why
 * this is not the 'subscription' surface admin-brands.ts already uses.
 * Starter is fully editable via PATCH here: it has no price to protect, and
 * its name/features/shippingCutoff are exactly as admin-owned as Pro's or
 * Volume's. The price route rejects starter (`starter_is_free`) — Starter
 * has no Stripe price to change.
 */
const PlanPatchSchema = z.object({
  name: z.string().min(1).max(120).optional(),
  features: z.array(z.string().min(1).max(200)).max(20).optional(),
  shipping_cutoff: z.string().min(1).max(80).optional(),
});

const PricePatchSchema = z.object({
  price_cents: z.number().int().min(100).max(100_000),
  reason: z.string().min(1).max(300),
  confirm_large_change: z.boolean().optional(),
});

export async function adminPlanRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, payments } = getClients();

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

  // Read-only price timeline for one plan (Task 10). A separate endpoint,
  // not a field bolted onto GET /api/admin/plans: the list route is read on
  // every load of the Plans screen and only ever needs the one active price
  // (the same shape every other consumer reads), while the full ledger —
  // joined against admin_user for who and audit_log for the mandatory
  // reason — is only useful once an operator opens one plan's history, so
  // it is fetched lazily, per plan, on demand.
  //
  // Only rows that reached Step B of changePlanPrice() (a real Stripe Price
  // was created — stripePriceId is non-null) are "a price this tier has
  // had". A row stuck at stripePriceId: null is an abandoned PENDING
  // attempt (Step A ran, Step B never completed) — it was never live and
  // never charged anyone, so it does not belong in an operator-facing
  // timeline of prices the tier actually carried.
  app.get('/api/admin/plans/:key/history', { preHandler: requireAdmin('plans', 'view') }, async (req) => {
    const { key } = z.object({ key: z.enum(PLAN_KEYS) }).parse(req.params);

    const rows = await prisma.planPrice.findMany({
      where: { plan: key, stripePriceId: { not: null } },
      orderBy: { createdAt: 'desc' },
    });

    const adminIds = [...new Set(rows.map((r) => r.createdBy).filter((id): id is string => id != null))];
    const admins = adminIds.length
      ? await prisma.adminUser.findMany({ where: { id: { in: adminIds } }, select: { id: true, fullName: true } })
      : [];
    const nameById = new Map(admins.map((a) => [a.id, a.fullName]));

    // The mandatory `reason` lives on the audit row `changePlanPrice()`
    // writes in the same Step C transaction that activates the row
    // (action: planPriceChanged, targetType: 'plan_price', targetId: the
    // plan_price row's id) — never on plan_price itself.
    const rowIds = rows.map((r) => r.id);
    const audits = rowIds.length
      ? await prisma.auditLog.findMany({
          where: { action: AUDIT_ACTIONS.planPriceChanged, targetType: 'plan_price', targetId: { in: rowIds } },
          select: { targetId: true, reason: true },
        })
      : [];
    const reasonById = new Map(audits.map((a) => [a.targetId!, a.reason]));

    return {
      plan: key,
      history: rows.map((r) => ({
        id: r.id,
        price_cents: r.priceCents,
        stripe_price_id: r.stripePriceId,
        active: r.active,
        created_by: r.createdBy,
        created_by_name: r.createdBy ? (nameById.get(r.createdBy) ?? null) : null,
        created_at: r.createdAt.toISOString(),
        archived_at: r.archivedAt ? r.archivedAt.toISOString() : null,
        reason: reasonById.get(r.id) ?? null,
      })),
    };
  });

  // The price-change transaction (Task 8). See changePlanPrice() for the
  // full ordering (insert pending → Stripe → atomic commit → deferred
  // archive) and its guards (starter, unchanged price, migration_required,
  // bounds, large-change confirmation, mandatory reason) — all of which
  // reject before any Stripe call.
  app.post('/api/admin/plans/:key/price', { preHandler: requireAdmin('plans', 'write') }, async (req) => {
    const { key } = z.object({ key: z.enum(PLAN_KEYS) }).parse(req.params);
    const body = PricePatchSchema.parse(req.body);

    const result = await changePlanPrice(prisma, payments, {
      plan: key,
      priceCents: body.price_cents,
      reason: body.reason,
      confirmLargeChange: body.confirm_large_change ?? false,
      actorId: req.admin!.adminUserId,
      ip: req.ip,
    });

    return {
      plan: key,
      plan_price_id: result.planPriceId,
      price_cents: result.priceCents,
      stripe_price_id: result.stripePriceId,
      previous_price_cents: result.previousPriceCents,
      previous_stripe_price_id: result.previousStripePriceId,
    };
  });
}
