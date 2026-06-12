import { Prisma, type PrismaClient, type WalletLedger, type WalletTxnType } from '@ruostack/db';

/**
 * Prepaid wallet ledger. The wallet is closed-loop, non-refundable, and
 * non-withdrawable (payments §2) — there is deliberately no withdrawal path.
 * `balance_after` is the running available balance; current balance is the
 * row with the greatest `seq`. Writes go ONLY through here (bypassrls role).
 */

export async function getBalance(db: PrismaClient, brandId: string): Promise<number> {
  const last = await db.walletLedger.findFirst({
    where: { brandId },
    orderBy: { seq: 'desc' },
    select: { balanceAfter: true },
  });
  return last?.balanceAfter ?? 0;
}

/** Funds reserved by open (placed-but-not-shipped) orders — an implicit hold. */
export async function getHeld(db: PrismaClient, brandId: string): Promise<number> {
  const agg = await db.order.aggregate({
    where: { brandId, status: { in: ['ready_for_fulfillment', 'processing'] }, blocker: 'none' },
    _sum: { walletChargeCents: true },
  });
  return agg._sum.walletChargeCents ?? 0;
}

/** balance − held. Insufficient available → an order lands in awaiting_funds. */
export async function getWalletSummary(
  db: PrismaClient,
  brandId: string,
): Promise<{ balance: number; held: number; available: number }> {
  const [balance, held] = await Promise.all([getBalance(db, brandId), getHeld(db, brandId)]);
  return { balance, held, available: balance - held };
}

/**
 * Capture an order's wallet charge on ship — debits the balance. Idempotent on
 * the order id, so re-shipping/retries can't double-charge.
 */
export async function captureOrder(
  db: PrismaClient,
  order: { id: string; brandId: string; walletChargeCents: number },
): Promise<void> {
  await appendEntry(db, {
    brandId: order.brandId,
    type: 'capture',
    amount: -order.walletChargeCents,
    externalId: `order:${order.id}:capture`,
    reason: `Order ${order.id} fulfillment`,
  });
}

export interface AppendEntryInput {
  brandId: string;
  type: WalletTxnType;
  /** Signed delta in cents (deposits/credits positive; capture/hold negative). */
  amount: number;
  externalId?: string | null;
  reason?: string | null;
  createdBy?: string | null;
}

/**
 * Append a ledger entry, recomputing the running balance under a per-brand
 * advisory lock so concurrent writes can't interleave. Idempotent on
 * `externalId`: a replayed processor event returns the existing row instead of
 * double-crediting. Returns `{ entry, duplicate }`.
 */
export async function appendEntry(
  db: PrismaClient,
  input: AppendEntryInput,
): Promise<{ entry: WalletLedger; duplicate: boolean }> {
  return db.$transaction(async (tx) => {
    // Serialize ledger writes for this brand (released at tx end).
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.brandId}), 0)`;

    if (input.externalId) {
      const existing = await tx.walletLedger.findUnique({ where: { externalId: input.externalId } });
      if (existing) return { entry: existing, duplicate: true };
    }

    const last = await tx.walletLedger.findFirst({
      where: { brandId: input.brandId },
      orderBy: { seq: 'desc' },
      select: { balanceAfter: true },
    });
    const balanceAfter = (last?.balanceAfter ?? 0) + input.amount;
    if (balanceAfter < 0) {
      throw new Error(`Wallet balance cannot go negative (brand ${input.brandId})`);
    }

    try {
      const entry = await tx.walletLedger.create({
        data: {
          brandId: input.brandId,
          type: input.type,
          amount: input.amount,
          balanceAfter,
          externalId: input.externalId ?? null,
          reason: input.reason ?? null,
          createdBy: input.createdBy ?? null,
        },
      });
      return { entry, duplicate: false };
    } catch (err) {
      // Lost an idempotency race on externalId — return the winner's row.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002' && input.externalId) {
        const existing = await tx.walletLedger.findUnique({ where: { externalId: input.externalId } });
        if (existing) return { entry: existing, duplicate: true };
      }
      throw err;
    }
  });
}
