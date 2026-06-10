'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { adminApi } from '@/lib/adminApi';
import { Drawer } from '@/components/admin/Drawer';
import { StatusBadge, Pill, money } from '@/components/admin/ui';

export type AdminOrder = {
  id: string;
  brand_name: string;
  source: string;
  status: string;
  customer_name: string;
  customer_email: string | null;
  ship_name: string | null;
  ship_street: string | null;
  ship_street2: string | null;
  ship_city: string | null;
  ship_state: string | null;
  ship_zip: string | null;
  ship_country: string | null;
  ship_phone: string | null;
  fulfillment_cost: number;
  shipping_cost: number;
  order_total: number | null;
  carrier: string | null;
  tracking_number: string | null;
  created_at: string;
  items: { product_name: string; sku: string | null; quantity: number }[];
  notes: { note_text: string; author: string | null; created_at: string }[];
};

const STATUSES = [
  'pending',
  'awaiting_funds',
  'processing',
  'shipped',
  'delivered',
  'fulfilled',
  'cancelled',
  'refunded',
];

export function OrdersTable({ orders }: { orders: AdminOrder[] }) {
  const router = useRouter();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return orders.filter((o) => {
      if (status !== 'all' && o.status !== status) return false;
      if (!q) return true;
      return [o.customer_name, o.brand_name, o.tracking_number, o.customer_email, o.id]
        .filter(Boolean)
        .some((v) => v!.toLowerCase().includes(q));
    });
  }, [orders, query, status]);

  const selected = selectedId ? orders.find((o) => o.id === selectedId) ?? null : null;

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 sm:max-w-xs">
          <svg
            className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" />
            <line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search customer, brand, tracking…"
            className="w-full rounded-lg border bg-card py-2 pl-9 pr-3 text-sm outline-none transition-shadow focus:ring-2 focus:ring-ring"
          />
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value)}
          className="rounded-lg border bg-card px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
        >
          <option value="all">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')}
            </option>
          ))}
        </select>
        <span className="ml-auto text-xs text-muted-foreground">
          {rows.length} of {orders.length}
        </span>
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-lg border bg-card shadow-brand-sm">
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th className="px-4 py-3 font-medium">Customer</th>
              <th className="px-4 py-3 font-medium">Brand</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 text-right font-medium">Cost</th>
              <th className="px-4 py-3 font-medium">Created</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {rows.map((o) => (
              <tr
                key={o.id}
                onClick={() => setSelectedId(o.id)}
                className="cursor-pointer border-t transition-colors hover:bg-accent/40"
              >
                <td className="px-4 py-3">
                  <div className="font-medium">{o.customer_name}</div>
                  <div className="text-xs text-muted-foreground">
                    {o.items.reduce((n, it) => n + it.quantity, 0)} item
                    {o.items.reduce((n, it) => n + it.quantity, 0) === 1 ? '' : 's'}
                    {o.tracking_number ? ` · ${o.tracking_number}` : ''}
                  </div>
                </td>
                <td className="px-4 py-3">{o.brand_name}</td>
                <td className="px-4 py-3">
                  <StatusBadge kind="order" value={o.status} />
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{money(o.fulfillment_cost)}</td>
                <td className="px-4 py-3 text-muted-foreground">
                  {new Date(o.created_at).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right text-muted-foreground">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="9 18 15 12 9 6" />
                  </svg>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center text-sm text-muted-foreground">
                  No orders match.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Drawer
        open={!!selected}
        onClose={() => setSelectedId(null)}
        title={selected?.customer_name ?? ''}
        subtitle={selected ? `${selected.brand_name} · #${selected.id.slice(0, 8)}` : ''}
      >
        {selected && (
          <OrderDetail
            key={selected.id}
            order={selected}
            onChanged={() => router.refresh()}
          />
        )}
      </Drawer>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className="mt-1 text-sm">{children}</div>
    </div>
  );
}

function OrderDetail({ order, onChanged }: { order: AdminOrder; onChanged: () => void }) {
  const [status, setStatus] = useState(order.status);
  const [carrier, setCarrier] = useState(order.carrier ?? '');
  const [tracking, setTracking] = useState(order.tracking_number ?? '');
  const [note, setNote] = useState('');
  const [refundAmount, setRefundAmount] = useState('');
  const [refundReason, setRefundReason] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const dirty =
    status !== order.status ||
    carrier !== (order.carrier ?? '') ||
    tracking !== (order.tracking_number ?? '');

  async function run(key: string, fn: () => Promise<unknown>) {
    setBusy(key);
    setError(null);
    try {
      await fn();
      onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const ship = [
    order.ship_name,
    order.ship_street,
    order.ship_street2,
    [order.ship_city, order.ship_state, order.ship_zip].filter(Boolean).join(', '),
    order.ship_country,
  ].filter(Boolean);

  return (
    <div className="space-y-6">
      {error && (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
          {error}
        </p>
      )}

      {/* Status + tracking */}
      <section className="space-y-3 rounded-lg border bg-background/40 p-4">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Status &amp; tracking</p>
          <StatusBadge kind="order" value={order.status} />
        </div>
        <label className="block text-xs text-muted-foreground">
          Status
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value)}
            className="mt-1 w-full rounded-md border bg-card px-2 py-1.5 text-sm text-foreground outline-none focus:ring-2 focus:ring-ring"
          >
            {STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.replace('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs text-muted-foreground">
            Carrier
            <input
              value={carrier}
              onChange={(e) => setCarrier(e.target.value)}
              placeholder="USPS"
              className="mt-1 w-full rounded-md border bg-card px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
          <label className="block text-xs text-muted-foreground">
            Tracking #
            <input
              value={tracking}
              onChange={(e) => setTracking(e.target.value)}
              placeholder="—"
              className="mt-1 w-full rounded-md border bg-card px-2 py-1.5 text-sm font-mono outline-none focus:ring-2 focus:ring-ring"
            />
          </label>
        </div>
        <button
          disabled={!dirty || busy === 'save'}
          onClick={() =>
            run('save', () =>
              adminApi('update_order', {
                order_id: order.id,
                status,
                tracking_number: tracking || null,
                carrier: carrier || null,
              })
            )
          }
          className="w-full rounded-md bg-primary px-3 py-2 text-sm font-medium text-primary-foreground shadow-brand-sm transition-opacity disabled:opacity-50"
        >
          {busy === 'save' ? 'Saving…' : 'Save changes'}
        </button>
      </section>

      {/* Meta */}
      <section className="grid grid-cols-2 gap-4">
        <Field label="Seller">{order.brand_name}</Field>
        <Field label="Source">
          <Pill>{order.source}</Pill>
        </Field>
        <Field label="Customer">
          <div>{order.customer_name}</div>
          {order.customer_email && (
            <div className="text-xs text-muted-foreground">{order.customer_email}</div>
          )}
        </Field>
        <Field label="Placed">{new Date(order.created_at).toLocaleString()}</Field>
      </section>

      <Field label="Ship to">
        {ship.length ? (
          <address className="not-italic leading-relaxed text-muted-foreground">
            {ship.map((line, i) => (
              <div key={i}>{line}</div>
            ))}
            {order.ship_phone && <div>{order.ship_phone}</div>}
          </address>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </Field>

      {/* Items */}
      <Field label={`Items (${order.items.length})`}>
        <ul className="divide-y rounded-lg border">
          {order.items.map((it, i) => (
            <li key={i} className="flex items-center justify-between px-3 py-2 text-sm">
              <span>
                <span className="font-medium">{it.quantity}×</span> {it.product_name}
                {it.sku && <span className="ml-1 font-mono text-xs text-muted-foreground">{it.sku}</span>}
              </span>
            </li>
          ))}
          {order.items.length === 0 && (
            <li className="px-3 py-2 text-sm text-muted-foreground">No line items.</li>
          )}
        </ul>
      </Field>

      {/* Money */}
      <section className="space-y-1 rounded-lg border bg-background/40 p-4 text-sm">
        <div className="flex justify-between">
          <span className="text-muted-foreground">Fulfillment cost</span>
          <span className="tabular-nums">{money(order.fulfillment_cost)}</span>
        </div>
        <div className="flex justify-between">
          <span className="text-muted-foreground">Shipping</span>
          <span className="tabular-nums">{money(order.shipping_cost)}</span>
        </div>
        {order.order_total != null && (
          <div className="flex justify-between">
            <span className="text-muted-foreground">Seller charged customer</span>
            <span className="tabular-nums">{money(order.order_total)}</span>
          </div>
        )}
      </section>

      {/* Notes */}
      <Field label={`Notes (${order.notes.length})`}>
        <ul className="space-y-2">
          {order.notes.map((n, i) => (
            <li key={i} className="rounded-lg border bg-background/40 px-3 py-2 text-sm">
              <p>{n.note_text}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {n.author ?? 'system'} · {new Date(n.created_at).toLocaleString()}
              </p>
            </li>
          ))}
          {order.notes.length === 0 && (
            <li className="text-sm text-muted-foreground">No notes yet.</li>
          )}
        </ul>
        <div className="mt-2 flex gap-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add an internal note…"
            className="flex-1 rounded-md border bg-card px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <button
            disabled={!note.trim() || busy === 'note'}
            onClick={() =>
              run('note', async () => {
                await adminApi('add_order_note', { order_id: order.id, note_text: note.trim() });
                setNote('');
              })
            }
            className="rounded-md border px-3 py-1.5 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
          >
            {busy === 'note' ? '…' : 'Add'}
          </button>
        </div>
      </Field>

      {/* Refund (destructive) */}
      <section className="space-y-2 rounded-lg border border-rose-200 bg-rose-50/50 p-4 dark:border-rose-900/60 dark:bg-rose-950/20">
        <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">Refund to wallet</p>
        <p className="text-xs text-muted-foreground">
          Credits the seller’s wallet and marks the order refunded. Leave amount blank for a full
          refund of the fulfillment cost.
        </p>
        <div className="grid grid-cols-2 gap-2">
          <input
            value={refundAmount}
            onChange={(e) => setRefundAmount(e.target.value)}
            inputMode="decimal"
            placeholder={`Full (${money(order.fulfillment_cost)})`}
            className="rounded-md border bg-card px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
          <input
            value={refundReason}
            onChange={(e) => setRefundReason(e.target.value)}
            placeholder="Reason (optional)"
            className="rounded-md border bg-card px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <button
          disabled={busy === 'refund' || order.status === 'refunded'}
          onClick={() => {
            const amt = refundAmount.trim() ? Number(refundAmount) : null;
            if (amt != null && (isNaN(amt) || amt <= 0)) {
              setError('Enter a valid refund amount.');
              return;
            }
            if (!confirm(`Refund ${amt != null ? money(amt) : 'the full fulfillment cost'} to ${order.brand_name}?`))
              return;
            run('refund', () =>
              adminApi('refund_order', {
                order_id: order.id,
                amount: amt,
                reason: refundReason.trim() || null,
              })
            );
          }}
          className="w-full rounded-md bg-rose-600 px-3 py-2 text-sm font-medium text-white transition-opacity hover:bg-rose-700 disabled:opacity-50"
        >
          {order.status === 'refunded'
            ? 'Already refunded'
            : busy === 'refund'
              ? 'Refunding…'
              : 'Refund order'}
        </button>
      </section>
    </div>
  );
}
