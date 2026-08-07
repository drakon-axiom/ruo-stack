import { useEffect, useState } from 'react';
import {
  Card,
  Check,
  Circle,
  DataTable,
  EmptyState,
  InlineAlert,
  KpiTile,
  LinkButton,
  PageHeader,
  Plus,
  cn,
  type Column,
} from '@ruostack/ui';
import { api } from '../lib/api.js';
import { FulfillmentBadge } from '../lib/fulfillment.js';

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
const PLAN_LABEL: Record<string, string> = { starter: 'Starter', pro: 'Pro', volume: 'Volume' };

interface RecentOrder {
  id: string;
  recipient: { name: string; city: string; state: string };
  wallet_charge_cents: number;
  status: string;
  blocker: string;
  exported_at: string | null;
  tracking_number: string | null;
  created_at: string;
}

interface Overview {
  orders: {
    today: number;
    ready: number;
    shipped: number;
    delivered: number;
    total: number;
    action_required: number;
  };
  wallet: { available_cents: number; balance_cents: number; held_cents: number };
  plan: string;
  checklist: { store_connected: boolean; wallet_funded: boolean; retail_set: boolean; first_order: boolean };
  recent_orders: RecentOrder[];
}

const CHECKLIST: { key: keyof Overview['checklist']; label: string; to: string; cta: string }[] = [
  { key: 'store_connected', label: 'Connect your store', to: '/app/store', cta: 'Connect' },
  { key: 'wallet_funded', label: 'Fund your wallet', to: '/app/wallet', cta: 'Add funds' },
  { key: 'retail_set', label: 'Set your retail prices', to: '/app/catalog', cta: 'Set prices' },
  { key: 'first_order', label: 'Place your first order', to: '/app/orders', cta: 'New order' },
];

const COLUMNS: Column<RecentOrder>[] = [
  { key: 'recipient', header: 'Recipient', priority: 'primary', cell: (o) => o.recipient.name },
  {
    key: 'where',
    header: 'Destination',
    priority: 'meta',
    cell: (o) => `${o.recipient.city}, ${o.recipient.state}`,
  },
  {
    key: 'charge',
    header: 'Charge',
    align: 'right',
    mono: true,
    cell: (o) => dollars(o.wallet_charge_cents),
  },
  { key: 'status', header: 'Status', cell: (o) => <FulfillmentBadge order={o} /> },
  {
    key: 'tracking',
    header: 'Tracking',
    mono: true,
    cell: (o) => <span className="text-accent">{o.tracking_number ?? '—'}</span>,
  },
];

export function Overview() {
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<Overview>('/api/brand/overview').then((r) => {
      setData(r);
      setLoading(false);
    });
  }, []);

  const checklistDone = data ? CHECKLIST.every((c) => data.checklist[c.key]) : true;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Your fulfillment at a glance — orders, wallet, and what to do next."
        action={
          <LinkButton to="/app/orders" icon={Plus}>
            New order
          </LinkButton>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Orders today" value={data ? data.orders.today : '—'} />
        <KpiTile
          label="Action required"
          value={data ? data.orders.action_required : '—'}
          tone={data && data.orders.action_required > 0 ? 'warning' : 'default'}
        />
        <KpiTile
          label="Wallet available"
          value={data ? dollars(data.wallet.available_cents) : '—'}
          tone="accent"
        />
        <KpiTile label="Current plan" value={data ? (PLAN_LABEL[data.plan] ?? data.plan) : '—'} />
      </div>

      {data && data.orders.action_required > 0 && (
        <div className="mt-4">
          <InlineAlert
            tone="warning"
            action={<LinkButton to="/app/action-required">Review</LinkButton>}
          >
            {data.orders.action_required} order{data.orders.action_required > 1 ? 's' : ''} need attention.
          </InlineAlert>
        </div>
      )}

      {data && !checklistDone && (
        <Card className="mt-5 p-5">
          <h2 className="mb-1 text-lg font-semibold">Get started</h2>
          <p className="mb-3 text-xs text-content-muted">
            A few steps to start fulfilling under your label.
          </p>
          <div className="space-y-2">
            {CHECKLIST.map((c) => {
              const done = data.checklist[c.key];
              return (
                <div
                  key={c.key}
                  className="flex items-center justify-between gap-3 rounded-lg border border-line-subtle px-3 py-2"
                >
                  <span className="flex items-center gap-2 text-sm">
                    {done ? (
                      <Check aria-hidden className="h-4 w-4 shrink-0 text-success" />
                    ) : (
                      <Circle aria-hidden className="h-4 w-4 shrink-0 text-content-faint" />
                    )}
                    <span className={cn(done && 'text-content-muted line-through')}>{c.label}</span>
                  </span>
                  {!done && (
                    <LinkButton to={c.to} variant="ghost" size="sm" className="shrink-0">
                      {c.cta}
                    </LinkButton>
                  )}
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <h2 className="mb-2 mt-6 text-2xs uppercase tracking-[0.12em] text-content-faint">Recent orders</h2>
      <DataTable
        caption="Your most recent orders"
        columns={COLUMNS}
        rows={data?.recent_orders ?? []}
        rowKey={(o) => o.id}
        loading={loading}
        empty={
          <EmptyState
            title="No orders yet"
            hint="Create your first order and it will show up here."
          />
        }
      />

      <div className="mt-6 flex flex-wrap gap-2">
        <LinkButton to="/app/orders">Orders</LinkButton>
        <LinkButton to="/app/wallet" variant="ghost">
          Wallet
        </LinkButton>
        <LinkButton to="/app/catalog" variant="ghost">
          Catalog
        </LinkButton>
        <LinkButton to="/app/tracking" variant="ghost">
          Tracking
        </LinkButton>
      </div>
    </>
  );
}
