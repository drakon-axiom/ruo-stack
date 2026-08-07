import { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  KpiTile,
  LinkButton,
  PageHeader,
  Plus,
  Select,
  Tabs,
  X,
  type Column,
} from '@ruostack/ui';
import { api, ApiError } from '../lib/api.js';
import { FulfillmentBadge } from '../lib/fulfillment.js';
import type { Address } from './AddressBook.js';

/**
 * A recipient handed to this screen by "Ship again" on Customers. It prefills a
 * NEW order — it is not a link to the old one, exactly like the address-book
 * picker: fields are copied, nothing is referenced.
 */
export interface ShipTo {
  recipient_name: string;
  recipient_email: string | null;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

interface OrderItem {
  product_id: string;
  qty: number;
  unit_wholesale_cents: number;
}
interface Order {
  id: string;
  status: string;
  blocker: string;
  recipient: {
    name: string;
    email: string | null;
    address1: string;
    address2: string | null;
    city: string;
    state: string;
    zip: string;
    country: string;
  };
  wallet_charge_cents: number;
  shipping_service_code: string | null;
  tracking_number: string | null;
  carrier: string | null;
  exported_at: string | null;
  created_at: string;
  items: OrderItem[];
}
interface CatalogProduct {
  id: string;
  name: string;
  dose?: string | null;
  unit?: string | null;
  wholesale_cents: number;
}
interface ShipOption {
  carrier: string;
  service: string;
  service_code: string;
  amount_cents: number;
  est_days: number | null;
}
interface Quote {
  plan: string;
  wholesale_cents: number;
  shipping_source: string;
  shipping_options: ShipOption[];
  recommended_service_code: string;
}

const isEditable = (o: Order) => o.status === 'ready_for_fulfillment' || o.status === 'processing';

type Filter = 'all' | 'ready_for_fulfillment' | 'shipped' | 'delivered' | 'cancelled';

const FILTERS: Filter[] = ['all', 'ready_for_fulfillment', 'shipped', 'delivered', 'cancelled'];
const filterLabel = (k: Filter) => (k === 'all' ? 'All' : k.replace(/_/g, ' '));

export function Orders() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<Order | null>(null);
  const [prefill, setPrefill] = useState<ShipTo | null>(null);
  const [loading, setLoading] = useState(true);
  const location = useLocation();
  const navigate = useNavigate();

  function load() {
    setLoading(true);
    api<{ orders: Order[] }>('/api/brand/orders').then((r) => {
      setOrders(r.orders);
      setLoading(false);
    });
  }
  useEffect(load, []);

  // "Ship again" on Customers routes here with a recipient in history state.
  // Consume it once and strip it, or a refresh — or a Back into this entry —
  // reopens the drawer with a stale address the operator didn't ask for.
  useEffect(() => {
    const shipTo = (location.state as { shipTo?: ShipTo } | null)?.shipTo;
    if (!shipTo) return;
    setPrefill(shipTo);
    setCreating(true);
    navigate('/app/orders', { replace: true, state: null });
  }, [location.state, navigate]);

  function closeDrawer() {
    setCreating(false);
    setPrefill(null);
  }

  const visible = orders.filter((o) => filter === 'all' || o.status === filter);
  const awaiting = orders.filter((o) => o.blocker !== 'none').length;

  const columns: Column<Order>[] = [
    { key: 'recipient', header: 'Recipient', priority: 'primary', cell: (o) => o.recipient.name },
    {
      key: 'where',
      header: 'Destination',
      priority: 'meta',
      cell: (o) => `${o.recipient.city}, ${o.recipient.state}`,
    },
    {
      key: 'items',
      header: 'Items',
      align: 'right',
      mono: true,
      cell: (o) => o.items.reduce((s, i) => s + i.qty, 0),
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
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (o) =>
        isEditable(o) ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(o)}>
            Edit
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Orders"
        subtitle="Enter orders manually; we fulfill under your label and deduct your wallet."
        action={
          <Button
            icon={Plus}
            onClick={() => {
              setPrefill(null);
              setCreating(true);
            }}
          >
            New manual order
          </Button>
        }
      />

      {awaiting > 0 && (
        <div className="mb-4">
          <InlineAlert
            tone="warning"
            action={<LinkButton to="/app/action-required">Review</LinkButton>}
          >
            {awaiting} order{awaiting > 1 ? 's' : ''} need attention (awaiting funds).
          </InlineAlert>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {(['all', 'ready_for_fulfillment', 'shipped', 'delivered'] as const).map((k) => (
          <KpiTile
            key={k}
            label={k === 'all' ? 'Total' : k.replace(/_/g, ' ')}
            value={k === 'all' ? orders.length : orders.filter((o) => o.status === k).length}
          />
        ))}
      </div>

      <div className="mb-3 mt-5">
        <Tabs
          tabs={FILTERS.map((k) => ({ key: k, label: filterLabel(k) }))}
          active={filter}
          onChange={setFilter}
        />
      </div>

      <DataTable
        caption="Your orders"
        columns={columns}
        rows={visible}
        rowKey={(o) => o.id}
        loading={loading}
        empty={
          <EmptyState
            title="No orders yet"
            hint="Create your first manual order and it will show up here."
          />
        }
      />

      {creating && (
        <OrderDrawer
          prefill={prefill ?? undefined}
          onClose={closeDrawer}
          onSaved={() => {
            closeDrawer();
            load();
          }}
        />
      )}
      {editing && (
        <OrderDrawer
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            load();
          }}
        />
      )}
    </>
  );
}

function OrderDrawer({
  editing,
  prefill,
  onClose,
  onSaved,
}: {
  editing?: Order;
  prefill?: ShipTo;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [catalog, setCatalog] = useState<CatalogProduct[]>([]);
  const [lines, setLines] = useState<{ product_id: string; qty: number }[]>(
    editing ? editing.items.map((i) => ({ product_id: i.product_id, qty: i.qty })) : [],
  );
  const [r, setR] = useState(
    editing
      ? {
          recipient_name: editing.recipient.name,
          recipient_email: editing.recipient.email ?? '',
          address1: editing.recipient.address1,
          address2: editing.recipient.address2 ?? '',
          city: editing.recipient.city,
          state: editing.recipient.state,
          zip: editing.recipient.zip,
          country: editing.recipient.country,
        }
      : prefill
        ? {
            recipient_name: prefill.recipient_name,
            recipient_email: prefill.recipient_email ?? '',
            address1: prefill.address1,
            address2: prefill.address2 ?? '',
            city: prefill.city,
            state: prefill.state,
            zip: prefill.zip,
            country: prefill.country,
          }
        : {
            recipient_name: '',
            recipient_email: '',
            address1: '',
            address2: '',
            city: '',
            state: '',
            zip: '',
            country: 'US',
          },
  );
  const [quote, setQuote] = useState<Quote | null>(null);
  const [service, setService] = useState(editing?.shipping_service_code ?? '');
  const [quoting, setQuoting] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmExported, setConfirmExported] = useState(false);
  const [addresses, setAddresses] = useState<Address[]>([]);
  const [saveAddress, setSaveAddress] = useState(false);

  useEffect(() => {
    api<{ products: CatalogProduct[] }>('/api/brand/catalog').then((x) => setCatalog(x.products));
  }, []);
  // Address Book: only on new orders (editing keeps the order's captured address).
  useEffect(() => {
    if (editing) return;
    api<{ addresses: Address[] }>('/api/brand/addresses')
      .then((x) => setAddresses(x.addresses))
      .catch(() => undefined);
  }, [editing]);

  function fillFromAddress(id: string) {
    const a = addresses.find((x) => x.id === id);
    if (!a) return;
    setR({
      recipient_name: a.recipient_name,
      recipient_email: a.recipient_email ?? '',
      address1: a.address1,
      address2: a.address2 ?? '',
      city: a.city,
      state: a.state,
      zip: a.zip,
      country: a.country,
    });
    setSaveAddress(false); // already saved
  }

  const canQuote = lines.length > 0 && r.zip.length >= 5 && r.state.length >= 2;
  const quoteKey = JSON.stringify({ lines, zip: r.zip, state: r.state });
  useEffect(() => {
    if (!canQuote) {
      setQuote(null);
      return;
    }
    let active = true;
    setQuoting(true);
    api<Quote>('/api/brand/orders/quote', {
      method: 'POST',
      body: { items: lines, zip: r.zip, state: r.state },
    })
      .then((q) => {
        if (active) {
          setQuote(q);
          setService((s) => s || q.recommended_service_code);
        }
      })
      .catch(() => {
        if (active) setQuote(null);
      })
      .finally(() => {
        if (active) setQuoting(false);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quoteKey]);

  const selected = quote?.shipping_options.find((o) => o.service_code === service) ?? quote?.shipping_options[0];
  const wholesale = quote?.wholesale_cents ?? 0;
  const shipping = selected?.amount_cents ?? 0;
  const charge = quote ? wholesale + shipping : 0;

  function addLine() {
    if (catalog[0]) setLines([...lines, { product_id: catalog[0].id, qty: 1 }]);
  }
  function setLine(i: number, patch: Partial<{ product_id: string; qty: number }>) {
    setLines(lines.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  async function submit() {
    // Editing an already-exported order: warn that changes won't reach ShipStation.
    if (editing?.exported_at && !confirmExported) {
      setConfirmExported(true);
      return;
    }
    setErr('');
    setBusy(true);
    try {
      const body = {
        items: lines,
        ...r,
        recipient_email: r.recipient_email || undefined,
        service_code: service || undefined,
      };
      if (editing) await api(`/api/brand/orders/${editing.id}`, { method: 'PATCH', body });
      else await api('/api/brand/orders', { method: 'POST', body });
      // Best-effort: persist the recipient to the address book if requested. A
      // failure here must not fail the placed order.
      if (!editing && saveAddress) {
        await api('/api/brand/addresses', {
          method: 'POST',
          body: {
            recipient_name: r.recipient_name,
            recipient_email: r.recipient_email || undefined,
            address1: r.address1,
            address2: r.address2 || undefined,
            city: r.city,
            state: r.state,
            zip: r.zip,
            country: r.country || 'US',
          },
        }).catch(() => undefined);
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not save order');
      setBusy(false);
      setConfirmExported(false);
    }
  }

  const valid =
    lines.length > 0 && r.recipient_name && r.address1 && r.city && r.state && r.zip && !!quote;

  return (
    <>
      <Drawer
        open
        onOpenChange={(o) => {
          if (!o) onClose();
        }}
        title={editing ? 'Edit order' : prefill ? 'Ship again' : 'New manual order'}
        footer={
          <>
            {quote && quote.shipping_options.length > 1 && (
              <div className="mb-3">
                <span className="mb-1 block text-2xs uppercase tracking-[0.1em] text-content-faint">
                  Shipping {quote.shipping_source !== 'flat' ? '(live)' : ''}
                </span>
                <div className="space-y-1">
                  {quote.shipping_options.map((o) => (
                    <label
                      key={o.service_code}
                      className="flex cursor-pointer items-center justify-between rounded-lg border border-line px-2 py-1.5 text-xs"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="radio"
                          className="accent-accent"
                          checked={service === o.service_code}
                          onChange={() => setService(o.service_code)}
                        />
                        {o.carrier} {o.service}
                        {o.est_days ? ` · ~${o.est_days}d` : ''}
                      </span>
                      <span className="font-mono tabular-nums">{dollars(o.amount_cents)}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}

            <div className="mb-3 space-y-1 text-sm">
              <div className="flex justify-between text-content-muted">
                <span>Wholesale</span>
                <span className="font-mono tabular-nums">{dollars(wholesale)}</span>
              </div>
              <div className="flex justify-between text-content-muted">
                <span>Shipping{quote && quote.shipping_source !== 'flat' ? ' (live)' : ''}</span>
                <span className="font-mono tabular-nums">{quote ? dollars(shipping) : '—'}</span>
              </div>
              <div className="flex justify-between font-semibold">
                <span>Wallet charge</span>
                <span className="font-mono tabular-nums">{quote ? dollars(charge) : '—'}</span>
              </div>
            </div>

            <Button className="w-full" disabled={!valid} loading={busy} onClick={submit}>
              {editing ? 'Save changes' : 'Place order'}
            </Button>
            <p className="mt-2 text-center text-2xs text-content-faint">
              {quoting
                ? 'Fetching live rates…'
                : !canQuote
                  ? 'Add products + destination to see shipping.'
                  : 'Charged from your wallet when we ship.'}
            </p>
          </>
        }
      >
        <div className="space-y-4">
          {err && <InlineAlert tone="danger">{err}</InlineAlert>}

          {prefill && (
            <InlineAlert tone="accent">
              Shipping again to <span className="font-medium">{prefill.recipient_name}</span>, using the
              address from their most recent order. This is a brand-new order — add products and check
              the address before you place it.
            </InlineAlert>
          )}

          {editing?.exported_at && (
            <InlineAlert tone="warning">
              This order is already at the shipping platform. Edits update your record but won't be
              pushed to ShipStation automatically — contact support to change the shipment.
            </InlineAlert>
          )}

          <div>
            <div className="mb-2 flex items-center justify-between">
              <span className="text-2xs uppercase tracking-[0.1em] text-content-faint">Products</span>
              <Button variant="ghost" size="sm" icon={Plus} onClick={addLine}>
                Add product
              </Button>
            </div>

            {lines.length === 0 && (
              <p className="text-xs text-content-faint">Add at least one product.</p>
            )}

            {lines.map((l, i) => (
              <div key={i} className="mb-2 flex items-center gap-2">
                <Select
                  className="flex-1"
                  value={l.product_id}
                  onValueChange={(v) => setLine(i, { product_id: v })}
                  options={catalog.map((p) => ({
                    value: p.id,
                    label: `${p.name} — ${dollars(p.wholesale_cents)}`,
                  }))}
                />
                <Input
                  className="w-16"
                  type="number"
                  min={1}
                  aria-label="Quantity"
                  value={l.qty}
                  onChange={(e) => setLine(i, { qty: Math.max(1, +e.target.value) })}
                />
                <button
                  aria-label="Remove product"
                  className="rounded-md p-2 text-content-faint transition-colors duration-fast hover:text-danger"
                  onClick={() => setLines(lines.filter((_, idx) => idx !== i))}
                >
                  <X aria-hidden className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>

          <div className="space-y-2">
            <span className="text-2xs uppercase tracking-[0.1em] text-content-faint">Ship to</span>

            {!editing && addresses.length > 0 && (
              <Select
                value=""
                placeholder="Choose from address book…"
                onValueChange={(v) => {
                  if (v) fillFromAddress(v);
                }}
                options={addresses.map((a) => ({
                  value: a.id,
                  label: `${a.label ? `${a.label} — ` : ''}${a.recipient_name}, ${a.city} ${a.state}`,
                }))}
              />
            )}

            <Field label="Recipient name" htmlFor="o-name" required>
              <Input
                id="o-name"
                value={r.recipient_name}
                onChange={(e) => setR({ ...r, recipient_name: e.target.value })}
              />
            </Field>
            <Field label="Email (optional)" htmlFor="o-email">
              <Input
                id="o-email"
                type="email"
                value={r.recipient_email}
                onChange={(e) => setR({ ...r, recipient_email: e.target.value })}
              />
            </Field>
            <Field label="Address line 1" htmlFor="o-a1" required>
              <Input id="o-a1" value={r.address1} onChange={(e) => setR({ ...r, address1: e.target.value })} />
            </Field>
            <Field label="Address line 2 (optional)" htmlFor="o-a2">
              <Input id="o-a2" value={r.address2} onChange={(e) => setR({ ...r, address2: e.target.value })} />
            </Field>

            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              <Field label="City" htmlFor="o-city" required>
                <Input id="o-city" value={r.city} onChange={(e) => setR({ ...r, city: e.target.value })} />
              </Field>
              <Field label="State" htmlFor="o-state" required>
                <Input id="o-state" value={r.state} onChange={(e) => setR({ ...r, state: e.target.value })} />
              </Field>
              <Field label="ZIP" htmlFor="o-zip" required>
                <Input id="o-zip" value={r.zip} onChange={(e) => setR({ ...r, zip: e.target.value })} />
              </Field>
            </div>

            {!editing && (
              <Checkbox
                checked={saveAddress}
                onCheckedChange={setSaveAddress}
                label="Save this address to my address book"
              />
            )}
          </div>
        </div>
      </Drawer>

      <Dialog
        open={confirmExported}
        onOpenChange={setConfirmExported}
        title="Order already sent to shipping"
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmExported(false)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={submit}>
              Save anyway
            </Button>
          </>
        }
      >
        <p className="text-sm text-content-muted">
          We've already handed this order to the shipping platform. Saving will update your record here,
          but <span className="font-medium text-content">the change won't be pushed to the shipping platform</span>.
          To change the actual shipment, contact support.
        </p>
      </Dialog>
    </>
  );
}
