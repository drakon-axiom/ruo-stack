import { useEffect, useState } from 'react';
import { Badge, DataTable, EmptyState, PageHeader, type Column } from '@ruostack/ui';
import { api } from '../lib/api.js';

interface Order {
  id: string;
  status: string;
  recipient: { name: string; city: string; state: string };
  carrier: string | null;
  tracking_number: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
}

function trackingUrl(carrier: string | null, tracking: string): string | null {
  const c = (carrier ?? '').toUpperCase();
  if (c.includes('USPS')) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${tracking}`;
  if (c.includes('UPS')) return `https://www.ups.com/track?tracknum=${tracking}`;
  if (c.includes('FEDEX')) return `https://www.fedex.com/fedextrack/?trknbr=${tracking}`;
  return null;
}

const COLUMNS: Column<Order>[] = [
  { key: 'recipient', header: 'Recipient', priority: 'primary', cell: (o) => o.recipient.name },
  {
    key: 'where',
    header: 'Destination',
    priority: 'meta',
    cell: (o) => `${o.recipient.city}, ${o.recipient.state}`,
  },
  { key: 'carrier', header: 'Carrier', cell: (o) => o.carrier ?? '—' },
  {
    key: 'tracking',
    header: 'Tracking',
    mono: true,
    cell: (o) => {
      if (!o.tracking_number) return '—';
      const url = trackingUrl(o.carrier, o.tracking_number);
      return url ? (
        <a className="text-accent hover:underline" href={url} target="_blank" rel="noreferrer">
          {o.tracking_number}
        </a>
      ) : (
        o.tracking_number
      );
    },
  },
  {
    key: 'status',
    header: 'Status',
    cell: (o) => <Badge tone={o.status === 'delivered' ? 'success' : 'accent'}>{o.status}</Badge>,
  },
];

export function Tracking() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api<{ orders: Order[] }>('/api/brand/orders').then((r) => {
      setOrders(r.orders.filter((o) => o.status === 'shipped' || o.status === 'delivered'));
      setLoading(false);
    });
  }, []);

  return (
    <>
      <PageHeader title="Tracking" subtitle="Shipments and their carrier tracking." />

      <DataTable
        caption="Shipments and their carrier tracking numbers"
        columns={COLUMNS}
        rows={orders}
        rowKey={(o) => o.id}
        loading={loading}
        empty={<EmptyState title="No shipments yet" hint="Shipped orders appear here with tracking." />}
      />
    </>
  );
}
