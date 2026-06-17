import { useEffect, useState } from 'react';

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
      <h1 className="mb-1 text-[23px] font-bold">Tracking</h1>
      <p className="mb-5 text-[13px] text-muted">Shipments and their carrier tracking.</p>

      {loading ? (
        <div className="surface p-10 text-center text-muted">Loading…</div>
      ) : orders.length === 0 ? (
        <div className="surface p-10 text-center text-muted">No shipments yet.</div>
      ) : (
        <div className="surface overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-lline text-left text-[11px] uppercase tracking-wide text-faint dark:border-line">
                <th className="px-4 py-3">Recipient</th>
                <th className="px-4 py-3">Carrier</th>
                <th className="px-4 py-3">Tracking</th>
                <th className="px-4 py-3">Status</th>
              </tr>
            </thead>
            <tbody>
              {orders.map((o) => {
                const url = o.tracking_number ? trackingUrl(o.carrier, o.tracking_number) : null;
                return (
                  <tr key={o.id} className="border-b border-lline/60 dark:border-line/60">
                    <td className="px-4 py-3 font-medium">{o.recipient.name}<span className="text-muted"> · {o.recipient.city}, {o.recipient.state}</span></td>
                    <td className="px-4 py-3 text-muted">{o.carrier ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-[12px]">
                      {o.tracking_number
                        ? url
                          ? <a className="text-teal hover:underline" href={url} target="_blank" rel="noreferrer">{o.tracking_number}</a>
                          : o.tracking_number
                        : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`pill ${o.status === 'delivered' ? 'border-success/40 bg-success/10 text-success' : 'border-teal/40 bg-teal/10 text-teal'}`}>{o.status}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
