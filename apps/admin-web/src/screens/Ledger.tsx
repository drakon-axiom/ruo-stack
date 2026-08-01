import { useCallback, useEffect, useMemo, useState } from 'react';
import { canWrite } from '@ruostack/shared';
import { api, apiDownload, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { EmptyState, KpiCard, PageHeader, Tabs } from '../components/ui.js';

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
  kind: 'shipped_not_captured' | 'stale_export';
  order_id: string;
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
            <button className="btn-ghost" onClick={() => exportCsv('summary')}>Export summary</button>
            <button className="btn-ghost" onClick={() => exportCsv('detail')}>Export detail</button>
          </div>
        }
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiCard label="Wallet float (all brands)" value={summary ? money(summary.wallet_float_cents) : '—'} />
        <KpiCard label="Net movement (period)" value={summary ? money(summary.totals.net) : '—'} />
        <KpiCard label="Entries (period)" value={summary ? summary.totals.entryCount : '—'} />
        <KpiCard label="Uncaptured drift" value={uncaptured.length} />
      </div>

      {err && <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}
      {notice && <div className="mb-4 rounded-lg border border-success/40 bg-success/10 px-3 py-2 text-[13px] text-success">{notice}</div>}

      {/* ── Drift: the actionable face of the reconciliation worker ────────── */}
      {drift.length > 0 && (
        <div className="card mb-5 p-4">
          <div className="mb-2 text-[14px] font-semibold">Reconciliation drift</div>
          <div className="space-y-2">
            {drift.map((d) => (
              <div key={`${d.kind}:${d.order_id}`} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line px-3 py-2 text-[13px]">
                <div className="min-w-0">
                  <span className={`pill mr-2 ${d.kind === 'shipped_not_captured' ? 'border-danger/40 bg-danger/10 text-danger' : 'border-amber/40 bg-amber/10 text-amber'}`}>
                    {d.kind === 'shipped_not_captured' ? 'not captured' : 'stale export'}
                  </span>
                  <span className="text-text">{d.brand_name}</span>
                  <span className="ml-2 text-muted">{d.detail}</span>
                  {d.at && <span className="ml-2 text-faint">{day(d.at)}</span>}
                </div>
                {d.kind === 'shipped_not_captured' ? (
                  canHeal ? (
                    <button className="btn" disabled={healing === d.order_id} onClick={() => heal(d.order_id)}>
                      {healing === d.order_id ? '…' : 'Re-run capture'}
                    </button>
                  ) : (
                    <span className="text-[12px] text-faint">finance only</span>
                  )
                ) : (
                  // The heal for a stale export is a re-queue, which lives with ops.
                  <span className="text-[12px] text-faint">re-send from Fulfillment Queue</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Filters ───────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs tabs={TABS.map((t) => ({ key: t.key, label: t.label }))} active={tab} onChange={setTab} />
        <div className="flex flex-wrap items-center gap-2">
          <select className="input max-w-[180px]" value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">All brands</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
          </select>
          <input className="input w-[150px]" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          <input className="input w-[150px]" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
        </div>
      </div>

      {/* ── Per-brand period summary ──────────────────────────────────────── */}
      {summary && summary.brands.length > 0 && (
        <div className="card mb-5 overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3 text-right">Opening</th>
                <th className="px-4 py-3 text-right">Deposits</th>
                <th className="px-4 py-3 text-right">Captures</th>
                <th className="px-4 py-3 text-right">Credits</th>
                <th className="px-4 py-3 text-right">Net</th>
                <th className="px-4 py-3 text-right">Closing</th>
              </tr>
            </thead>
            <tbody>
              {summary.brands.map((b) => (
                <tr key={b.brandId} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2.5">{b.brandName}</td>
                  <td className="px-4 py-2.5 text-right text-muted">{money(b.openingBalance)}</td>
                  <td className="px-4 py-2.5 text-right">{money(b.byType.deposit ?? 0)}</td>
                  <td className="px-4 py-2.5 text-right">{money(b.byType.capture ?? 0)}</td>
                  <td className="px-4 py-2.5 text-right">{money((b.byType.refund_credit ?? 0) + (b.byType.referral_credit ?? 0))}</td>
                  <td className={`px-4 py-2.5 text-right ${b.net < 0 ? 'text-danger' : 'text-success'}`}>{money(b.net)}</td>
                  <td className="px-4 py-2.5 text-right font-medium">{money(b.closingBalance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Entries ───────────────────────────────────────────────────────── */}
      {loading ? (
        <div className="card p-10 text-center text-muted">Loading…</div>
      ) : visible.length === 0 ? (
        <EmptyState title="No wallet movement in this period" hint="Widen the date range or clear the filters." />
      ) : (
        <div className="card overflow-x-auto">
          <table className="w-full text-[13px]">
            <thead className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
              <tr>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3">Brand</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Reason</th>
                <th className="px-4 py-3 text-right">Amount</th>
                <th className="px-4 py-3 text-right">Balance after</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((e) => (
                <tr key={e.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-2.5 text-muted">{day(e.createdAt)}</td>
                  <td className="px-4 py-2.5">{e.brandName}</td>
                  <td className="px-4 py-2.5">{TYPE_LABEL[e.type]}</td>
                  <td className="px-4 py-2.5 max-w-[280px] truncate text-muted" title={e.reason ?? ''}>{e.reason ?? '—'}</td>
                  <td className={`px-4 py-2.5 text-right ${e.amount < 0 ? 'text-danger' : 'text-success'}`}>{money(e.amount)}</td>
                  <td className="px-4 py-2.5 text-right text-muted">{money(e.balanceAfter)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
