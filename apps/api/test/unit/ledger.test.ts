import { describe, expect, it } from 'vitest';
import {
  buildLedgerDetailCsv,
  buildLedgerSummaryCsv,
  summarizeByBrand,
  totalsFor,
  type LedgerEntry,
} from '../../src/services/ledger.ts';

/**
 * Ledger aggregation — the numbers Finance reconciles against, so the arithmetic
 * is pinned directly rather than inferred from a screenshot.
 */
let seq = 0n;
const entry = (over: Partial<LedgerEntry> & Pick<LedgerEntry, 'brandId' | 'type' | 'amount' | 'balanceAfter'>): LedgerEntry => ({
  id: `e${seq}`,
  seq: ++seq,
  brandName: over.brandId === 'b1' ? 'Alpha' : 'Beta',
  reason: null,
  externalId: null,
  createdAt: new Date('2026-07-15T12:00:00Z'),
  ...over,
});

describe('summarizeByBrand', () => {
  it('derives opening balance from the first entry, not by re-summing history', () => {
    // The ledger already carries a running balance; trusting it means the
    // summary can never disagree with the rows an accountant drills into.
    const s = summarizeByBrand([
      entry({ brandId: 'b1', type: 'deposit', amount: 10_000, balanceAfter: 12_000 }),
    ]);
    expect(s[0]?.openingBalance).toBe(2_000); // 12,000 − 10,000
  });

  it('tracks closing balance from the LAST entry and nets the movements', () => {
    const s = summarizeByBrand([
      entry({ brandId: 'b1', type: 'deposit', amount: 10_000, balanceAfter: 10_000 }),
      entry({ brandId: 'b1', type: 'capture', amount: -3_500, balanceAfter: 6_500 }),
      entry({ brandId: 'b1', type: 'refund_credit', amount: 1_000, balanceAfter: 7_500 }),
    ]);
    expect(s[0]?.openingBalance).toBe(0);
    expect(s[0]?.closingBalance).toBe(7_500);
    expect(s[0]?.net).toBe(7_500);
    expect(s[0]?.entryCount).toBe(3);
  });

  it('breaks movement out by type, keeping capture negative', () => {
    const s = summarizeByBrand([
      entry({ brandId: 'b1', type: 'deposit', amount: 5_000, balanceAfter: 5_000 }),
      entry({ brandId: 'b1', type: 'capture', amount: -2_000, balanceAfter: 3_000 }),
      entry({ brandId: 'b1', type: 'capture', amount: -1_000, balanceAfter: 2_000 }),
    ]);
    expect(s[0]?.byType.deposit).toBe(5_000);
    expect(s[0]?.byType.capture).toBe(-3_000);
  });

  it('separates brands and sorts them by name', () => {
    const s = summarizeByBrand([
      entry({ brandId: 'b2', type: 'deposit', amount: 1_000, balanceAfter: 1_000 }),
      entry({ brandId: 'b1', type: 'deposit', amount: 2_000, balanceAfter: 2_000 }),
    ]);
    expect(s.map((x) => x.brandName)).toEqual(['Alpha', 'Beta']);
    expect(s.find((x) => x.brandId === 'b1')?.net).toBe(2_000);
    expect(s.find((x) => x.brandId === 'b2')?.net).toBe(1_000);
  });

  it('is empty for an empty period rather than throwing', () => {
    expect(summarizeByBrand([])).toEqual([]);
  });
});

describe('totalsFor', () => {
  it('nets across every brand and counts distinct brands', () => {
    const t = totalsFor([
      entry({ brandId: 'b1', type: 'deposit', amount: 10_000, balanceAfter: 10_000 }),
      entry({ brandId: 'b2', type: 'capture', amount: -4_000, balanceAfter: 1_000 }),
      entry({ brandId: 'b2', type: 'deposit', amount: 5_000, balanceAfter: 6_000 }),
    ]);
    expect(t.net).toBe(11_000);
    expect(t.brandCount).toBe(2);
    expect(t.entryCount).toBe(3);
    expect(t.byType.capture).toBe(-4_000);
  });
});

describe('CSV exports', () => {
  const rows = [
    entry({ brandId: 'b1', type: 'deposit', amount: 10_000, balanceAfter: 10_000, reason: 'Top-up' }),
    entry({ brandId: 'b1', type: 'capture', amount: -2_500, balanceAfter: 7_500, reason: 'Order abc' }),
  ];

  it('detail export carries the running balance so the file reconciles alone', () => {
    const csv = buildLedgerDetailCsv(rows);
    const lines = csv.trim().split('\n');
    expect(lines[0]).toBe('Date,Brand,Type,Amount,Balance after,Reason,External ID');
    expect(lines[1]).toContain('100.00');
    expect(lines[2]).toContain('-25.00'); // captures stay signed
    expect(lines[2]).toContain('75.00');
  });

  it('summary export emits a stable column per txn type even when unused', () => {
    // Stable shape means month-to-month files diff cleanly.
    const csv = buildLedgerSummaryCsv(summarizeByBrand(rows), new Date('2026-07-01'), new Date('2026-07-31'));
    const [header, row] = csv.trim().split('\n');
    expect(header).toContain('referral credit');
    expect(header).toContain('manual adjustment');
    expect(row).toContain('Alpha');
    expect(row).toContain('2026-07-01');
    expect(row).toContain('75.00'); // closing
  });

  it('quotes fields containing commas so a reason cannot shift the columns', () => {
    const csv = buildLedgerDetailCsv([
      entry({ brandId: 'b1', type: 'manual_adjustment', amount: 100, balanceAfter: 100, reason: 'Goodwill, per support' }),
    ]);
    expect(csv).toContain('"Goodwill, per support"');
  });

  it('emits a header even with no rows, so an empty period still produces a valid file', () => {
    expect(buildLedgerDetailCsv([]).trim()).toBe('Date,Brand,Type,Amount,Balance after,Reason,External ID');
  });
});
