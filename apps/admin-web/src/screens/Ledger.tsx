import { useCallback, useEffect, useMemo, useState } from 'react';
import { canWrite } from '@ruostack/shared';
import { api, apiDownload, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Badge, Button, Card, DataTable, EmptyState, Input, KpiTile, PageHeader, Select, Tabs, type Column } from '@ruostack/ui';

/**
 * Ledger & Reconciliation — the Finance surface (architecture §1.3).
 *
 * Wallet movement across every brand, the float, period exports, and the
 * actionable face of the reconciliation worker: drift with a one-click heal.
 */
type TxnType = 'deposit' | 'hold' | 'hold_release' | 'capture' | 'refund_credit' | 'referral_credit' | 'manual_adjustment';

interface Entry {
  id: string;
  seq: string;
  brandId: string;
  brandName: string;
  type: TxnType;
  amount: number;
  balanceAfter: number;
  reason: string | null;
  externalId: string | null;
  createdAt: string;
}

interface BrandSummary {
  brandId: string;
  brandName: string;
  openingBalance: number;
  closingBalance: number;
  net: number;
  byType: Partial<Record<TxnType, number>>;
  entryCount: number;
}

interface Summary {
  totals: { net: number; byType: Partial<Record<TxnType, number>>; entryCount: number; brandCount: number };
  brands: BrandSummary[];
  wallet_float_cents: number;
}

interface Drift {
  kind: 'shipped_not_captured' | 'stale_export' | 'plan_price_mismatch';
  // Optional: order-shaped findings carry order_id; plan_price_mismatch is
  // subscription-shaped and carries brand_id instead — there is no order.
  order_id?: string;
  brand_id?: string;
  brand_name: string;
  detail: string;
  at: string | null;
}

/** Signed cents → an accounting-style string. */
const money = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
const day = (iso: string) => new Date(iso).toLocaleDateString();

const TYPE_LABEL: Record<TxnType, string> = {
  deposit: 'Deposit',
  hold: 'Hold',
  hold_release: 'Hold release',
  capture: 'Capture',
  refund_credit: 'Refund credit',
  referral_credit: 'Referral credit',
  manual_adjustment: 'Manual adjustment',
};

/** Tab → the txn types it covers. `all` sends no type filter. */
const TABS: { key: string; label: string; types?: TxnType[] }[] = [
  { key: 'all', label: 'All' },
  { key: 'deposit', label: 'Deposits', types: ['deposit'] },
  { key: 'capture', label: 'Captures', types: ['capture'] },
  { key: 'credit', label: 'Refunds & credits', types: ['refund_credit', 'referral_credit'] },
  { key: 'manual_adjustment', label: 'Adjustments', types: ['manual_adjustment'] },
];

/** `YYYY-MM-DD` (what <input type="date"> wants) for N days ago. */
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

/* Radix Select rejects an item with an empty value, so the "no brand
 * filter" choice needs a sentinel that maps back to '' for the API. */
const ALL_BRANDS = '__all__';

const SUMMARY_COLUMNS: Column<BrandSummary>[] = [
  { key: 'brand', header: 'Brand', priority: 'primary', minWidth: 160, cell: (b) => b.brandName },
  { key: 'opening', header: 'Opening', align: 'right', mono: true, minWidth: 110, cell: (b) => money(b.openingBalance) },
  { key: 'deposits', header: 'Deposits', align: 'right', mono: true, minWidth: 110, cell: (b) => money(b.byType.deposit ?? 0) },
  { key: 'captures', header: 'Captures', align: 'right', mono: true, minWidth: 110, cell: (b) => money(b.byType.capture ?? 0) },
  {
    key: 'credits',
    header: 'Credits',
    align: 'right',
    mono: true,
    minWidth: 110,
    cell: (b) => money((b.byType.refund_credit ?? 0) + (b.byType.referral_credit ?? 0)),
  },
  {
    key: 'net',
    header: 'Net',
    align: 'right',
    mono: true,
    minWidth: 110,
    cell: (b) => <span className={b.net < 0 ? 'text-danger' : 'text-success'}>{money(b.net)}</span>,
  },
  {
    key: 'closing',
    header: 'Closing',
    align: 'right',
    mono: true,
    minWidth: 110,
    cell: (b) => <span className="font-medium">{money(b.closingBalance)}</span>,
  },
];

const ENTRY_COLUMNS: Column<Entry>[] = [
  { key: 'date', header: 'Date', priority: 'primary', minWidth: 120, cell: (e) => day(e.createdAt) },
  { key: 'brand', header: 'Brand', minWidth: 150, cell: (e) => e.brandName },
  { key: 'type', header: 'Type', minWidth: 130, cell: (e) => TYPE_LABEL[e.type] },
  {
    key: 'reason',
    header: 'Reason',
    minWidth: 200,
    cell: (e) => (
      <span className="block max-w-[280px] truncate" title={e.reason ?? ''}>
        {e.reason ?? '\u2014'}
      </span>
    ),
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    mono: true,
    minWidth: 110,
    cell: (e) => <span className={e.amount < 0 ? 'text-danger' : 'text-success'}>{money(e.amount)}</span>,
  },
  {
    key: 'balance',
    header: 'Balance after',
    align: 'right',
    mono: true,
    minWidth: 130,
    cell: (e) => money(e.balanceAfter),
  },
];

export function Ledger() {
  const { claims } = useAuth();
  const canHeal = claims ? canWrite(claims.role, 'ledger') : false;

  const [tab, setTab] = useState('all');
  const [from, setFrom] = useState(daysAgo(30));
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [brandId, setBrandId] = useState('');
  const [brands, setBrands] = useState<{ id: string; brand_name: string }[]>([]);

  const [entries, setEntries] = useState<Entry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [drift, setDrift] = useState<Drift[]>([]);
  const [loading, setLoading] = useState(true);
  const [healing, setHealing] = useState('');
  const [err, setErr] = useState('');
  const [notice, setNotice] = useState('');

  // The active tab maps to 0..n types; the API filters one at a time, so a
  // multi-type tab (credits) is filtered client-side over the fetched window.
  const activeTypes = TABS.find((t) => t.key === tab)?.types;

  const query = useMemo(() => {
    const p = new URLSearchParams();
    p.set('from', new Date(`${from}T00:00:00Z`).toISOString());
    p.set('to', new Date(`${to}T23:59:59Z`).toISOString());
    if (brandId) p.set('brand_id', brandId);
    if (activeTypes?.length === 1) p.set('type', activeTypes[0]!);
    return p.toString();
  }, [from, to, brandId, activeTypes]);

  const load = useCallback(() => {
    setLoading(true);
    setErr('');
    Promise.all([
      api<{ entries: Entry[] }>(`/api/admin/ledger?${query}`),
      api<Summary>(`/api/admin/ledger/summary?${query}`),
    ])
      .then(([l, s]) => { setEntries(l.entries); setSummary(s); })
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not load the ledger'))
      .finally(() => setLoading(false));
  }, [query]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api<{ brands: { id: string; brand_name: string }[] }>('/api/admin/brands').then((r) => setBrands(r.brands)).catch(() => undefined);
    api<{ drift: Drift[] }>('/api/admin/ledger/drift').then((r) => setDrift(r.drift)).catch(() => undefined);
  }, []);

  const visible = activeTypes && activeTypes.length > 1 ? entries.filter((e) => activeTypes.includes(e.type)) : entries;

  async function heal(orderId: string) {
    setHealing(orderId);
    setErr('');
    setNotice('');
    try {
      const r = await api<{ captured_cents: number; already_captured: boolean }>('/api/admin/ledger/heal/capture', {
        method: 'POST',
        body: { order_id: orderId },
      });
      setNotice(
        r.already_captured
          ? 'That order was already captured — no second charge was booked.'
          : `Captured ${money(r.captured_cents)} from the brand’s wallet.`,
      );
      setDrift((d) => d.filter((x) => x.order_id !== orderId));
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Heal failed');
    } finally {
      setHealing('');
    }
  }

  function exportCsv(shape: 'detail' | 'summary') {
    apiDownload(
      `/api/admin/ledger/export.csv?${query}&shape=${shape}`,
      `ruostack-ledger-${shape}-${from}-to-${to}.csv`,
    ).catch((e) => setErr(e instanceof ApiError ? e.message : 'Export failed'));
  }

  const uncaptured = drift.filter((d) => d.kind === 'shipped_not_captured');

  return (
    <>
      <PageHeader
        title="Ledger & Reconciliation"
        subtitle="Wallet movement across every brand, the float, and drift that needs resolving."
        action={
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => exportCsv('summary')}>Export summary</Button>
            <Button variant="ghost" onClick={() => exportCsv('detail')}>Export detail</Button>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile label="Wallet float (all brands)" value={summary ? money(summary.wallet_float_cents) : '—'} />
        <KpiTile label="Net movement (period)" value={summary ? money(summary.totals.net) : '—'} />
        <KpiTile label="Entries (period)" value={summary ? summary.totals.entryCount : '—'} />
        <KpiTile label="Uncaptured drift" value={uncaptured.length} />
      </div>

      {err && <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
      {notice && <div className="mb-4 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-sm text-success">{notice}</div>}

      {/* ── Drift: the actionable face of the reconciliation worker ────────── */}
      {drift.length > 0 && (
        <Card className="mb-5 p-4">
          <div className="mb-2 text-base font-semibold">Reconciliation drift</div>
          <div className="space-y-2">
            {drift.map((d) => (
              <div key={`${d.kind}:${d.order_id ?? d.brand_id ?? d.brand_name}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                <div className="min-w-0">
                  <Badge tone="warning">
                    {d.kind === 'shipped_not_captured' ? 'not captured' : d.kind === 'stale_export' ? 'stale export' : 'plan/price mismatch'}
                  </Badge>
                  <span className="text-content">{d.brand_name}</span>
                  <span className="ml-2 text-content-muted">{d.detail}</span>
                  {d.at && <span className="ml-2 text-content-faint">{day(d.at)}</span>}
                </div>
                {d.kind === 'shipped_not_captured' && d.order_id ? (
                  canHeal ? (
                    <Button disabled={healing === d.order_id} onClick={() => heal(d.order_id!)}>
                      {healing === d.order_id ? '…' : 'Re-run capture'}
                    </Button>
                  ) : (
                    <span className="text-xs text-content-faint">finance only</span>
                  )
                ) : d.kind === 'stale_export' ? (
                  // The heal for a stale export is a re-queue, which lives with ops.
                  <span className="text-xs text-content-faint">re-send from Fulfillment Queue</span>
                ) : (
                  // plan_price_mismatch: resolving means confirming the brand's
                  // real tier and correcting SubscriptionState — a manual,
                  // judgment call, not a one-click heal.
                  <span className="text-xs text-content-faint">confirm tier with the brand</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={TABS.map((t) => ({ key: t.key, label: t.label }))} active={tab} onChange={setTab} />
        <div className="flex flex-wrap items-center gap-2">
          <Select
            className="max-w-[180px]"
            value={brandId || ALL_BRANDS}
            onValueChange={(v) => setBrandId(v === ALL_BRANDS ? '' : v)}
            options={[
              { value: ALL_BRANDS, label: 'All brands' },
              ...brands.map((b) => ({ value: b.id, label: b.brand_name })),
            ]}
          />
          <Input className="w-[150px]" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <Input className="w-[150px]" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {/* ── Per-brand period summary ──────────────────────────────────────── */}
      {summary && summary.brands.length > 0 && (
        <div className="mb-5">
          <DataTable
            caption="Per-brand wallet summary for the selected period"
            mode="scroll"
            columns={SUMMARY_COLUMNS}
            rows={summary.brands}
            rowKey={(b) => b.brandId}
          />
        </div>
      )}

      {/* ── Entries ───────────────────────────────────────────────────────── */}
      <DataTable
        caption="Wallet ledger entries"
        mode="scroll"
        columns={ENTRY_COLUMNS}
        rows={visible}
        rowKey={(e) => e.id}
        loading={loading}
        empty={
          <EmptyState
            title="No wallet movement in this period"
            hint="Widen the date range or clear the filters."
          />
        }
      />
    </>
  );
}
