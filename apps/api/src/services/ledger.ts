import type { WalletTxnType } from '@ruostack/db';

/**
 * Ledger & Reconciliation — the Finance surface (architecture §1.3, Gap 4.2).
 *
 * Aggregation and CSV shaping live here as PURE functions over rows the route
 * has already fetched, so the money arithmetic is unit-testable without a
 * database. The route owns querying; this owns what the numbers mean.
 *
 * Note on holds: there is no `hold` ledger row (Phase 0 note in architecture
 * §4.1) — held funds are DERIVED from open orders. So a period summary balances
 * on real movements only; "held" is a point-in-time view, never a period total.
 */

export interface LedgerEntry {
  id: string;
  seq: bigint;
  brandId: string;
  brandName: string;
  type: WalletTxnType;
  amount: number; // signed cents
  balanceAfter: number;
  reason: string | null;
  externalId: string | null;
  createdAt: Date;
}

/** Movement totals for one brand over a period. All cents. */
export interface BrandPeriodSummary {
  brandId: string;
  brandName: string;
  /** Balance before the first entry in the period (balanceAfter − amount). */
  openingBalance: number;
  closingBalance: number;
  net: number;
  byType: Partial<Record<WalletTxnType, number>>;
  entryCount: number;
}

/**
 * Fold a period's entries into per-brand summaries.
 *
 * Opening balance is derived from the FIRST entry in the period
 * (`balanceAfter − amount`) rather than by re-summing history — the ledger
 * already carries a running balance, so trusting it keeps this O(n) and means
 * the summary can never disagree with the rows an accountant drills into.
 *
 * `entries` must be ordered oldest-first.
 */
export function summarizeByBrand(entries: LedgerEntry[]): BrandPeriodSummary[] {
  const byBrand = new Map<string, BrandPeriodSummary>();

  for (const e of entries) {
    let s = byBrand.get(e.brandId);
    if (!s) {
      s = {
        brandId: e.brandId,
        brandName: e.brandName,
        openingBalance: e.balanceAfter - e.amount,
        closingBalance: e.balanceAfter,
        net: 0,
        byType: {},
        entryCount: 0,
      };
      byBrand.set(e.brandId, s);
    }
    s.closingBalance = e.balanceAfter; // entries are oldest-first
    s.net += e.amount;
    s.byType[e.type] = (s.byType[e.type] ?? 0) + e.amount;
    s.entryCount++;
  }

  return [...byBrand.values()].sort((a, b) => a.brandName.localeCompare(b.brandName));
}

/** Platform totals across every brand in the period. */
export interface LedgerTotals {
  net: number;
  byType: Partial<Record<WalletTxnType, number>>;
  entryCount: number;
  brandCount: number;
}

export function totalsFor(entries: LedgerEntry[]): LedgerTotals {
  const byType: Partial<Record<WalletTxnType, number>> = {};
  const brands = new Set<string>();
  let net = 0;
  for (const e of entries) {
    net += e.amount;
    byType[e.type] = (byType[e.type] ?? 0) + e.amount;
    brands.add(e.brandId);
  }
  return { net, byType, entryCount: entries.length, brandCount: brands.size };
}

// ── CSV ──────────────────────────────────────────────────────────────────────

const cell = (v: unknown): string => {
  const s = v == null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

/** Cents → a plain decimal string. No currency symbol: this is for spreadsheets. */
const money = (cents: number): string => (cents / 100).toFixed(2);

const isoDay = (d: Date): string => d.toISOString().slice(0, 10);

/**
 * Line-by-line export — what an accountant drills into. One row per ledger
 * entry, with the running balance carried through so the file reconciles on its
 * own without re-deriving anything.
 */
export function buildLedgerDetailCsv(entries: LedgerEntry[]): string {
  const headers = ['Date', 'Brand', 'Type', 'Amount', 'Balance after', 'Reason', 'External ID'];
  const lines = [headers.join(',')];
  for (const e of entries) {
    lines.push(
      [
        e.createdAt.toISOString(),
        e.brandName,
        e.type,
        money(e.amount),
        money(e.balanceAfter),
        e.reason ?? '',
        e.externalId ?? '',
      ]
        .map(cell)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}

/**
 * Period summary — what an accountant reconciles against. One row per brand:
 * opening balance, movement broken out by type, closing balance.
 *
 * Every wallet transaction type gets a column even when unused in the period, so
 * the file's shape is stable month to month and diffs cleanly.
 */
const SUMMARY_TYPES: WalletTxnType[] = [
  'deposit',
  'capture',
  'refund_credit',
  'referral_credit',
  'manual_adjustment',
  'hold',
  'hold_release',
];

export function buildLedgerSummaryCsv(summaries: BrandPeriodSummary[], from: Date, to: Date): string {
  const headers = [
    'Brand',
    'Period start',
    'Period end',
    'Opening balance',
    ...SUMMARY_TYPES.map((t) => t.replace(/_/g, ' ')),
    'Net movement',
    'Closing balance',
    'Entries',
  ];
  const lines = [headers.join(',')];
  for (const s of summaries) {
    lines.push(
      [
        s.brandName,
        isoDay(from),
        isoDay(to),
        money(s.openingBalance),
        ...SUMMARY_TYPES.map((t) => money(s.byType[t] ?? 0)),
        money(s.net),
        money(s.closingBalance),
        s.entryCount,
      ]
        .map(cell)
        .join(','),
    );
  }
  return lines.join('\n') + '\n';
}
