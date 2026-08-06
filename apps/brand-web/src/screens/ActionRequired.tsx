import { useEffect, useState } from 'react';
import {
  Badge,
  DataTable,
  EmptyState,
  InlineAlert,
  LinkButton,
  PageHeader,
  type Column,
} from '@ruostack/ui';
import { api } from '../lib/api.js';

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

interface Order {
  id: string;
  blocker: string;
  recipient: { name: string; city: string; state: string };
  wallet_charge_cents: number;
  created_at: string;
}

const BLOCKER_LABEL: Record<string, string> = {
  awaiting_funds: 'Awaiting funds',
  needs_address: 'Needs address',
  needs_customer_info: 'Needs customer info',
};

const COLUMNS: Column<Order>[] = [
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
  {
    key: 'blocker',
    header: 'Blocker',
    cell: (o) => <Badge tone="warning">{BLOCKER_LABEL[o.blocker] ?? o.blocker}</Badge>,
  },
];

export function ActionRequired() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ orders: Order[] }>('/api/brand/orders?blocked=true').then((r) => {
      setOrders(r.orders);
      setLoading(false);
    });
  }, []);

  const totalNeeded = orders
    .filter((o) => o.blocker === 'awaiting_funds')
    .reduce((s, o) => s + o.wallet_charge_cents, 0);

  return (
    <>
      <PageHeader
        title="Action Required"
        subtitle="Orders blocked from fulfillment until you resolve them."
      />

      {totalNeeded > 0 && (
        <div className="mb-4">
          <InlineAlert tone="warning" action={<LinkButton to="/app/wallet">Add funds</LinkButton>}>
            {dollars(totalNeeded)} needed to fulfill {orders.length} blocked order
            {orders.length > 1 ? 's' : ''}.
          </InlineAlert>
        </div>
      )}

      <DataTable
        caption="Orders blocked from fulfillment"
        columns={COLUMNS}
        rows={orders}
        rowKey={(o) => o.id}
        loading={loading}
        empty={
          <EmptyState title="Nothing needs attention" hint="Blocked orders will show up here." />
        }
      />
    </>
  );
}
