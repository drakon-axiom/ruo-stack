import type { Claim, PrismaClient } from '@ruostack/db';
import { AUDIT_ACTIONS, type ClaimResolution } from '@ruostack/shared';
import { writeAudit } from '../audit.js';
import { appendEntry, getWalletSummary } from './wallet.js';
import { BadRequest, Conflict, NotFound } from '../errors.js';

export interface ResolveInput {
  resolution: ClaimResolution;
  reason: string;
  amountCents?: number;
  comp?: boolean; // reship: platform-comped ($0) vs charged to the brand wallet
}

/**
 * Resolve a claim (§11): wallet credit, reship (clone the order — comp'd or
 * charged), or deny. Reason-coded + audit-logged. Credit is idempotent on the
 * claim id so a retry can't double-credit.
 */
export async function resolveClaim(prisma: PrismaClient, claimId: string, input: ResolveInput, adminId: string, ip?: string | null): Promise<Claim> {
  const claim = await prisma.claim.findUnique({ where: { id: claimId }, include: { order: { include: { items: true } } } });
  if (!claim) throw NotFound('Claim not found');
  if (claim.status === 'resolved') throw Conflict('resolved', 'Claim is already resolved');

  let amountCents: number | null = null;
  let reshipOrderId: string | null = null;

  if (input.resolution === 'credited') {
    if (!input.amountCents || input.amountCents <= 0) throw BadRequest('amount_required', 'A credit amount is required');
    amountCents = input.amountCents;
    await appendEntry(prisma, { brandId: claim.brandId, type: 'refund_credit', amount: amountCents, externalId: `claim:${claimId}:credit`, reason: `Claim ${claimId}: ${input.reason}`, createdBy: adminId });
  } else if (input.resolution === 'reshipped') {
    const o = claim.order;
    const comp = input.comp !== false; // default to platform comp
    const wholesale = comp ? 0 : o.wholesaleTotalCents;
    const shipping = comp ? 0 : o.shippingTotalCents;
    const charge = wholesale + shipping;
    let blocker: 'none' | 'awaiting_funds' = 'none';
    if (!comp && charge > 0) {
      const { available } = await getWalletSummary(prisma, o.brandId);
      if (available < charge) blocker = 'awaiting_funds';
    }
    const reship = await prisma.order.create({
      data: {
        brandId: o.brandId,
        source: 'manual',
        status: 'ready_for_fulfillment',
        blocker,
        recipientName: o.recipientName,
        recipientEmail: o.recipientEmail,
        recipientPhone: o.recipientPhone,
        address1: o.address1,
        address2: o.address2,
        city: o.city,
        state: o.state,
        zip: o.zip,
        country: o.country,
        wholesaleTotalCents: wholesale,
        shippingTotalCents: shipping,
        walletChargeCents: charge,
        shippingServiceCode: o.shippingServiceCode,
        shippingCarrier: o.shippingCarrier,
        boxId: o.boxId,
        boxName: o.boxName,
        boxLengthIn: o.boxLengthIn,
        boxWidthIn: o.boxWidthIn,
        boxHeightIn: o.boxHeightIn,
        billableWeightOz: o.billableWeightOz,
        items: { create: o.items.map((i) => ({ productId: i.productId, qty: i.qty, unitWholesaleCents: comp ? 0 : i.unitWholesaleCents })) },
      },
    });
    reshipOrderId = reship.id;
  }

  return prisma.$transaction(async (tx) => {
    const c = await tx.claim.update({
      where: { id: claimId },
      data: { status: 'resolved', resolution: input.resolution, reason: input.reason, amountCents, reshipOrderId, resolvedAt: new Date() },
    });
    await writeAudit(tx, {
      actorType: 'admin',
      actorId: adminId,
      action: AUDIT_ACTIONS.claimResolved,
      targetType: 'claim',
      targetId: claimId,
      after: { resolution: input.resolution, amount_cents: amountCents, reship_order_id: reshipOrderId },
      reason: input.reason,
      ip: ip ?? null,
    });
    return c;
  });
}
