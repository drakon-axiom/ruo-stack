import { useEffect, useRef, useState } from 'react';
import { Button, Drawer, Package } from '@ruostack/ui';
import { api } from '../../lib/api.js';
import { FulfillmentBadge } from '../../lib/fulfillment.js';
import { dollars, fmtDate, type Customer, type OrderRow, type HistoryCursor, type HistoryResponse } from './types.js';

export function CustomerDrawer({ customer, onClose, onShipAgain }: { customer: Customer; onClose: () => void; onShipAgain: (customer: Customer) => void }) {
  const [details, setDetails] = useState<Customer | null>(null);
  const [missing, setMissing] = useState(false);
  const open = missing ? null : details ?? customer;
  const [history, setHistory] = useState<OrderRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cursor, setCursor] = useState<HistoryCursor | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  const generation = useRef(0);
  const fetchingMore = useRef(false);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true;
    generation.current++; fetchingMore.current = false;
    setCursor(null); setLoadingMore(false); setMoreError(false);
    setHistory(null); setDetails(null); setError(null); setMissing(false);
    api<HistoryResponse>('/api/brand/customers/history/page', { method: 'POST', body: { customer_key: customer.key, limit: 50 } })
      .then(result => { if (active) { setMissing(result.customers.length === 0); setDetails(result.customers[0] ?? null); setHistory(result.customers[0]?.order_list ?? []); setCursor(result.page?.next_cursor ?? null); } })
      .catch(() => { if (active) setError('Could not load order history.'); });
    return () => { active = false; generation.current++; };
  }, [customer.key, attempt]);
  async function loadMore() {
    if (!cursor || fetchingMore.current) return;
    const current = generation.current;
    fetchingMore.current = true; setLoadingMore(true); setMoreError(false);
    try {
      const result = await api<HistoryResponse>('/api/brand/customers/history/page', {
        method: 'POST', body: { customer_key: customer.key, limit: 50, cursor },
      });
      if (current !== generation.current) return;
      if (result.customers.length === 0) {
        setMissing(true); setDetails(null); setHistory([]); setCursor(null); return;
      }
      setMissing(false);
      setDetails(result.customers[0] ?? null);
      setHistory(previous => {
        const byId = new Map((previous ?? []).map(order => [order.id, order]));
        for (const order of result.customers[0]?.order_list ?? []) byId.set(order.id, order);
        return [...byId.values()];
      });
      setCursor(result.page.next_cursor);
    } catch { if (current === generation.current) setMoreError(true); }
    finally { if (current === generation.current) { fetchingMore.current = false; setLoadingMore(false); } }
  }
  return (
      <Drawer
        open={true}
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        title={open?.name ?? 'Customer'}
        footer={
          missing ? undefined : details?.ship_to ? (
            <Button className="w-full" icon={Package} onClick={() => onShipAgain(details)}>
              Ship again
            </Button>
          ) : (
            <p className="text-center text-xs text-content-faint">
              {history === null ? 'Load order history before shipping again.' : "No complete address on file — can't reship"}
            </p>
          )
        }
      >
        {missing && <p role="status">This customer no longer has any qualifying orders.</p>}
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
              {moreError && <p role="alert">Could not load older orders.</p>}
              {cursor && <Button disabled={loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading older orders…' : 'Load older orders'}</Button>}
              {history?.length === 0 && <p>No orders found.</p>}
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
