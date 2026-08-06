import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { KpiTile, PageHeader } from '@ruostack/ui';

const dollars = (c: number) => `$${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

interface Overview {
  brands: { total: number; active: number; suspended: number };
  orders: { today: number; ready: number; shipped: number; delivered: number; action_required: number };
  money: { captured_gmv_cents: number; wallet_float_cents: number };
  plans: { starter: number; pro: number; volume: number };
  catalog: { published: number };
  webhooks: { processed: number; failed: number; received: number };
  recent_activity: { id: string; actor_type: string; action: string; target_type: string | null; created_at: string }[];
}

export function Overview() {
  const [d, setD] = useState<Overview | null>(null);

  useEffect(() => {
    api<Overview>('/api/admin/overview').then(setD);
  }, []);

  if (!d) return <div className="card p-10 text-center text-muted">Loading…</div>;

  return (
    <>
      <PageHeader title="Overview" subtitle="Platform health at a glance." />

      <div className="mb-4 grid grid-cols-4 gap-3">
        <KpiTile label="Brands" value={d.brands.total} />
        <KpiTile label="Orders today" value={d.orders.today} />
        <KpiTile label="Captured GMV" value={dollars(d.money.captured_gmv_cents)} />
        <KpiTile label="Wallet float" value={dollars(d.money.wallet_float_cents)} />
      </div>
      <div className="mb-4 grid grid-cols-4 gap-3">
        <KpiTile label="Ready to ship" value={d.orders.ready} />
        <KpiTile label="Shipped" value={d.orders.shipped} />
        <KpiTile label="Action required" value={<span className={d.orders.action_required ? 'text-amber' : ''}>{d.orders.action_required}</span>} />
        <KpiTile label="Published SKUs" value={d.catalog.published} />
      </div>

      <div className="grid grid-cols-[1fr_1fr] gap-4">
        <div className="card p-5">
          <h2 className="mb-3 text-[13px] uppercase tracking-[0.12em] text-faint">Plan mix</h2>
          <div className="space-y-2 text-[13px]">
            {([['Starter', d.plans.starter], ['Pro', d.plans.pro], ['Volume', d.plans.volume]] as const).map(([name, n]) => (
              <div key={name} className="flex items-center justify-between">
                <span className="text-muted">{name}</span>
                <span className="font-semibold text-text">{n}</span>
              </div>
            ))}
          </div>
          <h2 className="mb-2 mt-5 text-[13px] uppercase tracking-[0.12em] text-faint">Webhook health</h2>
          <div className="flex gap-2">
            <span className="pill border-success/40 bg-success/10 text-success">{d.webhooks.processed} processed</span>
            {d.webhooks.failed > 0
              ? <span className="pill border-danger/40 bg-danger/10 text-danger">{d.webhooks.failed} failed</span>
              : <span className="pill border-success/40 bg-success/10 text-success">0 failed</span>}
          </div>
        </div>

        <div className="card p-5">
          <h2 className="mb-3 text-[13px] uppercase tracking-[0.12em] text-faint">Recent activity</h2>
          {d.recent_activity.length === 0 ? (
            <p className="text-[13px] text-muted">No activity yet.</p>
          ) : (
            <ul className="space-y-2 text-[13px]">
              {d.recent_activity.map((a) => (
                <li key={a.id} className="flex items-center justify-between">
                  <span><span className="pill mr-2">{a.actor_type}</span><span className="font-mono text-[12px] text-teal-bright">{a.action}</span></span>
                  <span className="text-[11px] text-faint">{new Date(a.created_at).toLocaleTimeString()}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </>
  );
}
