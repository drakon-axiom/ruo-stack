import type { FastifyInstance } from 'fastify';
import { AUDIT_ACTIONS } from '@ruostack/shared';
import { z } from 'zod';
import { getClients } from '../clients.js';
import { writeAudit } from '../audit.js';
import { requireAdmin } from '../middleware/guards.js';
import { BadRequest, NotFound } from '../errors.js';
import { captureOrder } from '../services/wallet.js';
import { scanDrift } from '../services/reconciliation.js';
import {
  buildLedgerDetailCsv,
  buildLedgerSummaryCsv,
  summarizeByBrand,
  totalsFor,
  type LedgerEntry,
} from '../services/ledger.js';

/**
 * Ledger & Reconciliation — the Finance surface (architecture §1.3, Gap 4.2).
 *
 * The reconciliation WORKER detects drift; this is where Finance acts on it. The
 * heal is gated on `ledger` (finance + super_admin) rather than `exceptions`
 * (ops), because re-running a capture moves money — the Exceptions console keeps
 * flagging drift, but resolving it is a financial act.
 */
const WALLET_TXN_TYPES = ['deposit', 'hold', 'hold_release', 'capture', 'refund_credit', 'referral_credit', 'manual_adjustment'] as const;

const RangeSchema = z.object({
  brand_id: z.string().uuid().optional(),
  type: z.enum(WALLET_TXN_TYPES).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(1000).default(200),
  /** Seq cursor — entries strictly older than this. `seq` is a unique autoincrement. */
  before_seq: z.coerce.bigint().optional(),
});

export async function adminLedgerRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  /** Default window when none is given: the last 30 days. */
  const defaultFrom = () => new Date(Date.now() - 30 * 86_400_000);

  const whereFor = (q: z.infer<typeof RangeSchema>) => ({
    ...(q.brand_id ? { brandId: q.brand_id } : {}),
    ...(q.type ? { type: q.type } : {}),
    createdAt: {
      gte: q.from ? new Date(q.from) : defaultFrom(),
      ...(q.to ? { lte: new Date(q.to) } : {}),
    },
    ...(q.before_seq !== undefined ? { seq: { lt: q.before_seq } } : {}),
  });

  const toEntries = (rows: { id: string; seq: bigint; brandId: string; type: string; amount: number; balanceAfter: number; reason: string | null; externalId: string | null; createdAt: Date; brand: { brandName: string } }[]): LedgerEntry[] =>
    rows.map((r) => ({
      id: r.id,
      seq: r.seq,
      brandId: r.brandId,
      brandName: r.brand.brandName,
      type: r.type as LedgerEntry['type'],
      amount: r.amount,
      balanceAfter: r.balanceAfter,
      reason: r.reason,
      externalId: r.externalId,
      createdAt: r.createdAt,
    }));

  const SELECT = {
    id: true,
    seq: true,
    brandId: true,
    type: true,
    amount: true,
    balanceAfter: true,
    reason: true,
    externalId: true,
    createdAt: true,
    brand: { select: { brandName: true } },
  } as const;

  // Cross-brand ledger, newest first, seq-cursor paged.
  app.get('/api/admin/ledger', { preHandler: requireAdmin('ledger', 'view') }, async (req) => {
    const q = RangeSchema.parse(req.query);
    const rows = await prisma.walletLedger.findMany({
      where: whereFor(q),
      orderBy: { seq: 'desc' },
      take: q.limit,
      select: SELECT,
    });
    const entries = toEntries(rows);
    return {
      entries: entries.map((e) => ({ ...e, seq: e.seq.toString() })),
      // Cursor for the next page; null when this is the last one.
      next_before_seq: rows.length === q.limit ? rows[rows.length - 1]!.seq.toString() : null,
    };
  });

  // Platform totals + per-brand period summaries + the float.
  app.get('/api/admin/ledger/summary', { preHandler: requireAdmin('ledger', 'view') }, async (req) => {
    const q = RangeSchema.parse(req.query);
    const rows = await prisma.walletLedger.findMany({
      where: whereFor(q),
      orderBy: { seq: 'asc' }, // summarizeByBrand needs oldest-first
      select: SELECT,
    });
    const entries = toEntries(rows);

    // Float = the sum of every brand's CURRENT balance, independent of the
    // period filter — it's a point-in-time liability, not a movement.
    const floatRow = await prisma.$queryRaw<{ float: bigint | null }[]>`
      SELECT COALESCE(SUM(bal), 0)::bigint AS float FROM (
        SELECT DISTINCT ON (brand_id) balance_after AS bal
        FROM wallet_ledger ORDER BY brand_id, seq DESC
      ) t`;

    return {
      totals: totalsFor(entries),
      brands: summarizeByBrand(entries),
      wallet_float_cents: Number(floatRow[0]?.float ?? 0),
    };
  });

  // CSV export — `shape=detail` (line by line) or `shape=summary` (per brand).
  app.get('/api/admin/ledger/export.csv', { preHandler: requireAdmin('ledger', 'view') }, async (req, reply) => {
    const q = RangeSchema.extend({ shape: z.enum(['detail', 'summary']).default('detail') }).parse(req.query);
    const rows = await prisma.walletLedger.findMany({
      where: whereFor(q),
      orderBy: { seq: 'asc' },
      select: SELECT,
    });
    const entries = toEntries(rows);
    const from = q.from ? new Date(q.from) : defaultFrom();
    const to = q.to ? new Date(q.to) : new Date();

    const csv = q.shape === 'summary' ? buildLedgerSummaryCsv(summarizeByBrand(entries), from, to) : buildLedgerDetailCsv(entries);
    const name = `ruostack-ledger-${q.shape}-${from.toISOString().slice(0, 10)}-to-${to.toISOString().slice(0, 10)}.csv`;
    return reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="${name}"`).send(csv);
  });

  // Live drift findings — the actionable face of the reconciliation worker.
  app.get('/api/admin/ledger/drift', { preHandler: requireAdmin('ledger', 'view') }, async () => {
    return { drift: await scanDrift(prisma) };
  });

  /**
   * One-click heal for shipped-but-not-captured (Gap 4.2). Idempotent by
   * construction: `captureOrder` writes with `externalId = order:<id>:capture`,
   * which is UNIQUE — so a double-click books one capture, not two.
   */
  app.post('/api/admin/ledger/heal/capture', { preHandler: requireAdmin('ledger', 'write') }, async (req) => {
    const { order_id } = z.object({ order_id: z.string().uuid() }).parse(req.body);

    const order = await prisma.order.findUnique({
      where: { id: order_id },
      select: { id: true, brandId: true, walletChargeCents: true, status: true },
    });
    if (!order) throw NotFound('Order not found');
    if (order.status !== 'shipped' && order.status !== 'delivered') {
      throw BadRequest('not_shipped', 'Only a shipped or delivered order can be captured');
    }

    const existing = await prisma.walletLedger.findUnique({ where: { externalId: `order:${order.id}:capture` }, select: { id: true } });
    await captureOrder(prisma, order);

    await writeAudit(prisma, {
      actorType: 'admin',
      actorId: req.admin!.adminUserId,
      action: AUDIT_ACTIONS.driftCaptureHealed,
      targetType: 'order',
      targetId: order.id,
      after: { amount_cents: order.walletChargeCents, already_captured: existing !== null },
      reason: 'Reconciliation drift heal (shipped but not captured)',
      ip: req.ip,
    });

    return { order_id: order.id, captured_cents: order.walletChargeCents, already_captured: existing !== null };
  });
}
