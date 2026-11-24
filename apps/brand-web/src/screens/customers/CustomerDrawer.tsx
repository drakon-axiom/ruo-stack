import { useEffect, useState } from 'react';
import { Button, Drawer, Package } from '@ruostack/ui';
import { api } from '../../lib/api.js';
import { FulfillmentBadge } from '../../lib/fulfillment.js';
import { dollars, fmtDate, type Customer, type OrderRow, type Totals } from './types.js';

export function CustomerDrawer({ customer: open, onClose, onShipAgain }: { customer: Customer; onClose: () => void; onShipAgain: (customer: Customer) => void }) {
  const [history, setHistory] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    setHistory(null); setError(null);
    api<{ customers: Customer[]; totals: Totals }>(`/api/brand/customers?view=history&customer_key=${encodeURIComponent(open.key)}`)
      .then(result => { if (active) { setHistory(result.customers[0]?.order_list ?? []); setTruncated(result.totals.truncated); } })
      .catch(() => { if (active) setError('Could not load order history.'); });
    return () => { active = false; };
  }, [open.key, attempt]);
  return (
      <Drawer
        open={true}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        title={open?.name ?? 'Customer'}
        footer={
          open?.ship_to ? (
            <Button className="w-full" icon={Package} onClick={() => onShipAgain(open)}>
              Ship again
            </Button>
          ) : (
            <p className="text-center text-xs text-content-faint">
              No complete address on file — can't reship
            </p>
          )
        }
      >
        {open && (
          <div className="space-y-4">
            <dl className="space-y-1.5 text-sm">
              <div className="flex justify-between gap-3">
                <dt className="text-content-faint">Email</dt>
                <dd>{open.email ?? '—'}</dd>
              </div>
              {open.phone && (
                <div className="flex justify-between gap-3">
                  <dt className="text-content-faint">Phone</dt>
                  <dd>{open.phone}</dd>
                </div>
              )}
              <div className="flex justify-between gap-3">
                <dt className="text-content-faint">Location</dt>
                <dd>
                  {open.city}, {open.state}
                </dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-content-faint">First order</dt>
                <dd>{fmtDate(open.first_order)}</dd>
              </div>
              <div className="flex justify-between gap-3">
                <dt className="text-content-faint">Total orders</dt>
                <dd className="tabular-nums">{open.orders}</dd>
              </div>
            </dl>

            {open.ship_to && (
              // Spelled out so "again" is never ambiguous: this is the address
              // from their most recent order that had one.
              <p className="text-xs text-content-faint">
                Ships to {open.ship_to.address1}
                {open.ship_to.address2 ? `, ${open.ship_to.address2}` : ''}, {open.ship_to.city}{' '}
                {open.ship_to.state} {open.ship_to.zip}
              </p>
            )}

            <div>
              <h3 className="mb-2 text-2xs uppercase tracking-[0.1em] text-content-faint">
                Order history
              </h3>
              {history === null && !error && <p role="status">Loading order history…</p>}
              {error && <div role="alert"><p>{error}</p><Button onClick={() => setAttempt(a => a + 1)}>Retry history</Button></div>}
              {truncated && <p className="text-xs text-content-faint">History covers the most recent 5,000 orders for your brand.</p>}
              {history?.length === 0 && <p>No orders in the current reporting window.</p>}
              <div className="space-y-2">
                {(history ?? []).map((o) => (
                  <div
                    key={o.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-line-subtle px-3 py-2 text-xs"
                  >
                    <span className="text-content-muted">{fmtDate(o.created_at)}</span>
                    <span className="font-mono tabular-nums">{dollars(o.wallet_charge_cents)}</span>
                    <span className="font-mono text-content-muted">{o.tracking_number ?? '—'}</span>
                    <FulfillmentBadge
                      order={{ status: o.status, blocker: o.blocker, exported_at: o.exported_at }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Drawer>
  );
}
