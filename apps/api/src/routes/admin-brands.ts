import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AUDIT_ACTIONS, WalletAdjustSchema } from '@ruostack/shared';
import { getClients } from '../clients.js';
import { writeAudit } from '../audit.js';
import { requireAdmin } from '../middleware/guards.js';
import { loadConfig } from '../config.js';
import { effectivePlan } from '../services/subscription.js';
import { appendEntry, getWalletSummary } from '../services/wallet.js';
import { BadRequest, NotFound } from '../errors.js';

/**
 * Brand Manager (architecture §1.3) — per-brand operator ops. List/detail are
 * viewable by all admins; suspend is super_admin only (brand_suspend surface);
 * manual wallet adjustment is super_admin + finance (wallet_adjust surface).
 */
export async function adminBrandRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, supabaseAdmin } = getClients();

  // List brands with plan + wallet balance.
  app.get('/api/admin/brands', { preHandler: requireAdmin('brands', 'view') }, async () => {
    const brands = await prisma.brand.findMany({ orderBy: { createdAt: 'desc' }, include: { subscriptionState: true } });
    const balances = await prisma.$queryRaw<{ brand_id: string; balance_after: number }[]>`
      SELECT DISTINCT ON (brand_id) brand_id, balance_after FROM wallet_ledger ORDER BY brand_id, seq DESC`;
    const balMap = new Map(balances.map((b) => [b.brand_id, b.balance_after]));
    return {
      brands: brands.map((b) => ({
        id: b.id,
        brand_name: b.brandName,
        status: b.status,
        plan: effectivePlan(b.subscriptionState),
        member_since: b.memberSince,
        balance_cents: balMap.get(b.id) ?? 0,
      })),
    };
  });

  // Brand detail.
  app.get('/api/admin/brands/:id', { preHandler: requireAdmin('brands', 'view') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const brand = await prisma.brand.findUnique({ where: { id }, include: { subscriptionState: true } });
    if (!brand) throw NotFound('Brand not found');

    const owner = await prisma.brandMember.findFirst({ where: { brandId: id, role: 'owner' }, select: { userId: true } });
    let ownerEmail: string | null = null;
    if (owner) ownerEmail = (await supabaseAdmin.auth.admin.getUserById(owner.userId)).data.user?.email ?? null;

    const [wallet, orders, ledger, shippingCfg] = await Promise.all([
      getWalletSummary(prisma, id),
      prisma.order.findMany({ where: { brandId: id }, orderBy: { createdAt: 'desc' }, take: 10 }),
      prisma.walletLedger.findMany({ where: { brandId: id }, orderBy: { seq: 'desc' }, take: 15 }),
      prisma.brandShippingConfig.findUnique({ where: { brandId: id } }),
    ]);
    const globalFee = loadConfig().SHIPPING_PICKPACK_FEE_CENTS;

    return {
      id: brand.id,
      brand_name: brand.brandName,
      status: brand.status,
      owner_email: ownerEmail,
      member_since: brand.memberSince,
      referral_code: brand.referralCode,
      subscription: {
        plan: effectivePlan(brand.subscriptionState),
        status: brand.subscriptionState?.status ?? 'none',
        cancel_at_period_end: brand.subscriptionState?.cancelAtPeriodEnd ?? false,
        current_period_end: brand.subscriptionState?.currentPeriodEnd ?? null,
      },
      wallet: { balance_cents: wallet.balance, held_cents: wallet.held, available_cents: wallet.available },
      shipping: {
        pickpack_fee_override_cents: shippingCfg?.pickpackFeeOverrideCents ?? null,
        pickpack_fee_effective_cents: shippingCfg?.pickpackFeeOverrideCents ?? globalFee,
        global_default_cents: globalFee,
        markup_cents: shippingCfg?.markupCents ?? 0,
      },
      orders: orders.map((o) => ({
        id: o.id,
        status: o.status,
        blocker: o.blocker,
        recipient_name: o.recipientName,
        wallet_charge_cents: o.walletChargeCents,
        created_at: o.createdAt,
      })),
      ledger: ledger.map((e) => ({
        id: e.id,
        type: e.type,
        amount_cents: e.amount,
        balance_after_cents: e.balanceAfter,
        reason: e.reason,
        created_at: e.createdAt,
      })),
    };
  });

  // Suspend / activate — super_admin only.
  app.patch('/api/admin/brands/:id/status', { preHandler: requireAdmin('brand_suspend', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { status, reason } = z
      .object({ status: z.enum(['active', 'suspended']), reason: z.string().max(500).optional() })
      .parse(req.body);
    const brand = await prisma.brand.findUnique({ where: { id }, select: { status: true } });
    if (!brand) throw NotFound('Brand not found');

    await prisma.$transaction(async (tx) => {
      await tx.brand.update({ where: { id }, data: { status } });
      await writeAudit(tx, {
        actorType: 'admin',
        actorId: req.admin!.adminUserId,
        action: status === 'suspended' ? AUDIT_ACTIONS.brandSuspended : AUDIT_ACTIONS.brandActivated,
        targetType: 'brand',
        targetId: id,
        before: { status: brand.status },
        after: { status },
        reason,
        ip: req.ip,
      });
    });
    return { ok: true, status };
  });

  // Per-brand pick-&-pack fee override (RUOStack's margin) — super_admin + finance.
  // null clears the override → the brand uses the global default.
  app.patch('/api/admin/brands/:id/shipping', { preHandler: requireAdmin('wallet_adjust', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { pickpack_fee_override_cents } = z
      .object({ pickpack_fee_override_cents: z.number().int().min(0).max(100_000).nullable() })
      .parse(req.body);
    if (!(await prisma.brand.findUnique({ where: { id }, select: { id: true } }))) throw NotFound('Brand not found');
    const cfg = await prisma.brandShippingConfig.upsert({
      where: { brandId: id },
      create: { brandId: id, pickpackFeeOverrideCents: pickpack_fee_override_cents },
      update: { pickpackFeeOverrideCents: pickpack_fee_override_cents },
    });
    await writeAudit(prisma, {
      actorType: 'admin',
      actorId: req.admin!.adminUserId,
      action: AUDIT_ACTIONS.pickpackOverrideSet,
      targetType: 'brand',
      targetId: id,
      after: { pickpack_fee_override_cents },
      ip: req.ip,
    });
    return { pickpack_fee_override_cents: cfg.pickpackFeeOverrideCents };
  });

  // Manual wallet adjustment — super_admin + finance (refund-to-wallet, §4.3).
  app.post('/api/admin/brands/:id/wallet/adjust', { preHandler: requireAdmin('wallet_adjust', 'write') }, async (req) => {
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const { amount_cents, reason } = WalletAdjustSchema.parse(req.body);
    const brand = await prisma.brand.findUnique({ where: { id }, select: { id: true } });
    if (!brand) throw NotFound('Brand not found');

    let entry;
    try {
      const r = await appendEntry(prisma, {
        brandId: id,
        type: 'manual_adjustment',
        amount: amount_cents,
        reason,
        createdBy: req.admin!.adminUserId,
      });
      entry = r.entry;
    } catch {
      throw BadRequest('would_go_negative', 'Adjustment would make the wallet balance negative');
    }

    await writeAudit(prisma, {
      actorType: 'admin',
      actorId: req.admin!.adminUserId,
      action: AUDIT_ACTIONS.walletManualAdjustment,
      targetType: 'brand',
      targetId: id,
      after: { amount_cents, balance_after_cents: entry.balanceAfter },
      reason,
      ip: req.ip,
    });
    return { ok: true, balance_after_cents: entry.balanceAfter };
  });
}
