import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Card, KpiTile, PageHeader } from '@ruostack/ui';

const dollars = (c: number) => `$${(c / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (n: number) => `${(n * 100).toFixed(1)}%`;

interface Report {
  period: { days: number; from: string };
  shipping: { shipments: number; charged_cents: number; label_cost_cents: number; margin_cents: number; labeled_count: number; unlabeled_count: number };
  fallback: { priced: number; fallback: number; share: number; by_source: Record<string, number> };
  orders: { total: number; by_source: Record<string, number> };
  money: { captured_cents: number; wholesale_cents: number };
  subscriptions: { active_by_plan: Record<string, number>; by_status: Record<string, number> };
  claims: { opened: number; by_status: Record<string, number>; by_resolution: Record<string, number>; credits_cents: number; sla_overdue: number };
}

const PERIODS = [7, 30, 90] as const;

function Rows({ map }: { map: Record<string, number> }) {
  const entries = Object.entries(map);
  if (entries.length === 0) return <div className="text-content-muted">—</div>;
  return (
    <div className="space-y-1">
      {entries.map(([k, v]) => (
        <div key={k} className="flex justify-between border-b border-line/40 py-1 text-sm">
          <span className="capitalize text-content-muted">{k.replace(/_/g, ' ')}</span><span className="text-content">{v}</span>
        </div>
      ))}
    </div>
  );
}

/** Titled panel. Named Panel, not Card, so it does not collide with the
 *  design-system <Card> it is built from. */
function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Card className="p-4">
      <div className="mb-2 text-2xs uppercase tracking-[0.1em] text-content-faint">{title}</div>
      {children}
    </Card>
  );
}

export function Reporting() {
  const [days, setDays] = useState<number>(30);
  const [r, setR] = useState<Report | null>(null);

  useEffect(() => { api<Report>(`/api/admin/reporting?days=${days}`).then(setR); }, [days]);

  return (
    <>
      <PageHeader
        title="Reporting"
        subtitle="Shipping margin, fallback rate, and claims economics over the selected window."
        action={
          <div className="flex gap-1">
            {PERIODS.map((d) => (
              <button key={d} onClick={() => setDays(d)} className={`rounded-pill border px-3 py-1 text-xs ${days === d ? 'border-accent bg-accent text-white' : 'border-line-strong text-content-muted'}`}>{d}d</button>
            ))}
          </div>
        }
      />

      {!r ? <Card className="p-10 text-center text-content-muted">Loading…</Card> : (
        <div className="space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <KpiTile label="Shipping margin" value={dollars(r.shipping.margin_cents)} />
            <KpiTile label="Fallback rate" value={pct(r.fallback.share)} />
            <KpiTile label="Captured GMV" value={dollars(r.money.captured_cents)} />
            <KpiTile label="Claims overdue" value={r.claims.sla_overdue} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Panel title={`Shipping economics · ${r.shipping.shipments} shipments`}>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between"><span className="text-content-muted">Charged to brands</span><span>{dollars(r.shipping.charged_cents)}</span></div>
                <div className="flex justify-between"><span className="text-content-muted">Actual label cost</span><span>{dollars(r.shipping.label_cost_cents)}</span></div>
                <div className="flex justify-between border-t border-line/40 pt-1 font-semibold"><span>Margin</span><span className={r.shipping.margin_cents >= 0 ? 'text-success' : 'text-danger'}>{dollars(r.shipping.margin_cents)}</span></div>
                <div className="flex justify-between text-xs text-content-faint"><span>with label cost / manual</span><span>{r.shipping.labeled_count} / {r.shipping.unlabeled_count}</span></div>
              </div>
            </Panel>
            <Panel title={`Rate source · ${r.fallback.fallback}/${r.fallback.priced} fallback`}>
              <Rows map={r.fallback.by_source} />
            </Panel>
            <Panel title={`Orders · ${r.orders.total} placed`}><Rows map={r.orders.by_source} /></Panel>
            <Panel title="Subscriptions (active by plan)"><Rows map={r.subscriptions.active_by_plan} /></Panel>
            <Panel title="Subscription status (incl. dunning)"><Rows map={r.subscriptions.by_status} /></Panel>
            <Panel title={`Claims · ${r.claims.opened} opened · ${dollars(r.claims.credits_cents)} credited`}>
              <div className="grid grid-cols-2 gap-3">
                <div><div className="mb-1 text-2xs text-content-faint">by status</div><Rows map={r.claims.by_status} /></div>
                <div><div className="mb-1 text-2xs text-content-faint">by resolution</div><Rows map={r.claims.by_resolution} /></div>
              </div>
            </Panel>
          </div>
        </div>
      )}
    </>
  );
}
