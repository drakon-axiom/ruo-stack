import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { FLAT_FALLBACK } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';
import { Card, buttonClass } from '@ruostack/ui';

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
const SHIP = FLAT_FALLBACK.amountCents;

interface Order {
  id: string;
  status: string;
  shipped_at: string | null;
  delivered_at: string | null;
  created_at: string;
}
// 'set' = markup loaded; 'locked' = Starter plan (403); 'loading' = pending.
type Markup = { state: 'loading' } | { state: 'locked' } | { state: 'set'; cents: number };

export function Shipping() {
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [markup, setMarkup] = useState<Markup>({ state: 'loading' });

  useEffect(() => {
    api<{ orders: Order[] }>('/api/brand/orders').then((r) => setOrders(r.orders));
    api<{ markup_cents: number }>('/api/brand/store/shipping')
      .then((r) => setMarkup({ state: 'set', cents: r.markup_cents }))
      .catch((e) => setMarkup(e instanceof ApiError && e.status === 403 ? { state: 'locked' } : { state: 'set', cents: 0 }));
  }, []);

  const startOfMonth = new Date();
  startOfMonth.setUTCDate(1);
  startOfMonth.setUTCHours(0, 0, 0, 0);

  const all = orders ?? [];
  const shippedThisMonth = all.filter((o) => o.shipped_at && new Date(o.shipped_at) >= startOfMonth).length;
  const delivered = all.filter((o) => o.status === 'delivered').length;
  const inProgress = all.filter((o) => o.status === 'ready_for_fulfillment' || o.status === 'processing').length;

  return (
    <>
      <h1 className="mb-1 text-2xl font-bold">Shipping</h1>
      <p className="mb-5 text-sm text-content-muted">
        We fulfill every order under your label. Here's your carrier, what's included, and how it works.
      </p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="p-4">
          <div className="text-3xl font-extrabold">{orders ? shippedThisMonth : '—'}</div>
          <div className="text-xs text-content-muted">Shipped this month</div>
        </Card>
        <Card className="p-4">
          <div className="text-3xl font-extrabold text-success">{orders ? delivered : '—'}</div>
          <div className="text-xs text-content-muted">Delivered (all time)</div>
        </Card>
        <Card className="p-4">
          <div className="text-3xl font-extrabold text-accent">{orders ? inProgress : '—'}</div>
          <div className="text-xs text-content-muted">In progress</div>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {/* Carrier */}
        <Card className="mt-5 p-5">
          <h2 className="mb-1 text-lg font-semibold">Default carrier</h2>
          <div className="mb-3 flex items-baseline justify-between">
            <span className="text-xl font-bold">{FLAT_FALLBACK.carrier} Ground Advantage</span>
            <span className="text-xl font-extrabold text-accent">{dollars(SHIP)}</span>
          </div>
          <ul className="space-y-1 text-sm text-content-muted">
            <li>· Flat-rate domestic (US) shipping</li>
            <li>· 2–5 business day delivery</li>
            <li>· Tracking on every shipment</li>
          </ul>
        </Card>

        {/* Markup */}
        <Card className="mt-5 p-5">
          <h2 className="mb-1 text-lg font-semibold">Your shipping markup</h2>
          {markup.state === 'loading' ? (
            <div className="text-sm text-content-muted">Loading…</div>
          ) : markup.state === 'locked' ? (
            <>
              <p className="mb-3 text-sm text-content-muted">
                Add a per-order shipping markup as profit on every store order. Available on Pro & Volume.
              </p>
              <Link to="/app/account" className={buttonClass('primary', 'md')}>Upgrade plan</Link>
            </>
          ) : (
            <>
              <div className="mb-2 text-3xl font-extrabold">{dollars(markup.cents)}</div>
              <p className="text-sm text-content-muted">
                Added to each store order's shipping as your profit. Edit this in <Link to="/app/store" className="text-accent">My Store</Link>.
              </p>
            </>
          )}
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Card className="mt-4 p-5 text-sm text-content-muted">
          <h2 className="mb-2 text-lg font-semibold text-content">What's included</h2>
          <ul className="space-y-1">
            <li>· Pick &amp; pack under your brand</li>
            <li>· Carrier label &amp; postage</li>
            <li>· Tracking written back to your store</li>
            <li>· Claims support for lost/damaged shipments</li>
          </ul>
        </Card>
        <Card className="mt-4 p-5 text-sm text-content-muted">
          <h2 className="mb-2 text-lg font-semibold text-content">How fulfillment works</h2>
          <ol className="list-decimal space-y-1 pl-5">
            <li>An order arrives (manually or from your store).</li>
            <li>We reserve funds from your wallet and pick the order.</li>
            <li>We ship it under your label and write tracking back.</li>
            <li>Your wallet is charged only when it ships.</li>
          </ol>
        </Card>
      </div>

      <Card className="mt-4 p-5">
        <h2 className="mb-1 text-lg font-semibold">Custom return address</h2>
        <p className="text-sm text-content-muted">
          Branded return addresses on the shipping label are coming soon. For now, shipments use the RUOStack fulfillment return address.
        </p>
      </Card>
    </>
  );
}
