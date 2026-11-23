import { type Prisma, type PrismaClient, type WalletLedger, type WalletTxnType } from '@ruostack/db';
import { Conflict } from '../errors.ts';

/**
 * Prepaid wallet ledger. The wallet is closed-loop, non-refundable, and
 * non-withdrawable (payments §2) — there is deliberately no withdrawal path.
 * `balance_after` is the running available balance; current balance is the
 * row with the greatest `seq`. Writes go ONLY through here (bypassrls role).
 */

/** Reads work on either the client or a transaction client. */
type WalletDb = PrismaClient | Prisma.TransactionClient;

/**
 * Take the per-brand reservation lock inside a transaction (same key the ledger
 * append uses). Serializes funds decisions — the available-balance read and the
 * order write that depends on it — so two concurrent orders can't both reserve
 * the same funds. Released at transaction end.
 */
export async function lockBrandWallet(tx: Prisma.TransactionClient, brandId: string): Promise<void> {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${brandId}), 0)`;
}

export async function getBalance(db: WalletDb, brandId: string): Promise<number> {
  const last = await db.walletLedger.findFirst({
    where: { brandId },
    orderBy: { seq: 'desc' },
    select: { balanceAfter: true },
  });
  return last?.balanceAfter ?? 0;
}

/** Funds reserved by open (placed-but-not-shipped) orders — an implicit hold. */
export async function getHeld(db: WalletDb, brandId: string): Promise<number> {
  const agg = await db.order.aggregate({
    where: { brandId, status: { in: ['ready_for_fulfillment', 'processing'] }, blocker: 'none' },
    _sum: { walletChargeCents: true },
  });
  return agg._sum.walletChargeCents ?? 0;
}

/** balance − held. Insufficient available → an order lands in awaiting_funds. */
export async function getWalletSummary(
  db: WalletDb,
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
  return db.$transaction(tx => appendEntryTx(tx, input));
}

/** Append within a caller-owned transaction so the business outcome and audit
 * commit with the money. Always acquire the wallet lock before other row locks. */
export async function appendEntryTx(
  tx: Prisma.TransactionClient,
  input: AppendEntryInput,
): Promise<{ entry: WalletLedger; duplicate: boolean }> {
  await lockBrandWallet(tx, input.brandId);
  if (input.externalId) {
    // externalId is globally unique, while wallets are locked per brand. A
    // separate namespace serializes cross-brand collisions before INSERT so a
    // unique violation cannot abort the transaction before replay validation.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${input.externalId}), 1)`;
    const existing = await tx.walletLedger.findUnique({ where: { externalId: input.externalId } });
    if (existing) {
      if (existing.brandId !== input.brandId || existing.type !== input.type || existing.amount !== input.amount) {
        throw Conflict('ledger_replay_conflict', 'Ledger reference already used with different parameters');
      }
      return { entry: existing, duplicate: true };
    }
  }

  const balanceAfter = await getBalance(tx, input.brandId) + input.amount;
  if (balanceAfter < 0) throw new Error(`Wallet balance cannot go negative (brand ${input.brandId})`);
  const entry = await tx.walletLedger.create({ data: {
    brandId: input.brandId,
    type: input.type,
    amount: input.amount,
    balanceAfter,
    externalId: input.externalId ?? null,
    reason: input.reason ?? null,
    createdBy: input.createdBy ?? null,
  } });
  return { entry, duplicate: false };
}
