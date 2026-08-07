import { useEffect, useState } from 'react';
import { CLAIM_TYPES, claimTypeLabel, type ClaimType } from '@ruostack/shared';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  InlineAlert,
  PageHeader,
  Select,
  Textarea,
  type BadgeTone,
  type Column,
} from '@ruostack/ui';
import { api, ApiError } from '../lib/api.js';

interface Order {
  id: string;
  status: string;
  recipient: { name: string; city: string; state: string };
  tracking_number: string | null;
}
interface Claim {
  id: string;
  order_id: string;
  type: ClaimType;
  status: string;
  resolution: string | null;
  reason: string | null;
  amount_cents: number | null;
  recipient_name: string;
  created_at: string;
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

const STATUS_TONE: Record<string, BadgeTone> = {
  open: 'warning',
  investigating: 'accent',
  carrier_filed: 'accent',
  resolved: 'success',
};

export function Claims() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [claims, setClaims] = useState<Claim[]>([]);
  const [filing, setFiling] = useState(false);
  const [loading, setLoading] = useState(true);

  function load() {
    api<{ orders: Order[] }>('/api/brand/orders').then((r) =>
      setOrders(r.orders.filter((o) => o.status === 'shipped' || o.status === 'delivered')),
    );
    api<{ claims: Claim[] }>('/api/brand/claims').then((r) => {
      setClaims(r.claims);
      setLoading(false);
    });
  }
  useEffect(load, []);

  const columns: Column<Claim>[] = [
    { key: 'type', header: 'Type', priority: 'primary', cell: (c) => claimTypeLabel(c.type) },
    { key: 'recipient', header: 'Recipient', priority: 'meta', cell: (c) => c.recipient_name },
    {
      key: 'status',
      header: 'Status',
      cell: (c) => (
        <Badge tone={STATUS_TONE[c.status] ?? 'neutral'}>{c.status.replace(/_/g, ' ')}</Badge>
      ),
    },
    {
      key: 'outcome',
      header: 'Outcome',
      cell: (c) =>
        c.resolution ? `${c.resolution}${c.amount_cents ? ` · ${dollars(c.amount_cents)}` : ''}` : '—',
    },
    {
      key: 'filed',
      header: 'Filed',
      cell: (c) => new Date(c.created_at).toLocaleDateString(),
    },
  ];

  return (
    <>
      <PageHeader
        title="Claims"
        subtitle="Report a lost, damaged, or wrong shipment. We triage with the carrier and resolve with a reship or wallet credit."
        action={orders.length > 0 ? <Button onClick={() => setFiling(true)}>File a claim</Button> : undefined}
      />

      <DataTable
        caption="Claims you have filed"
        columns={columns}
        rows={claims}
        rowKey={(c) => c.id}
        loading={loading}
        empty={<EmptyState title="No claims yet" hint="Filed claims and their outcomes appear here." />}
      />

      {filing && (
        <FileClaim
          orders={orders}
          onClose={() => setFiling(false)}
          onSaved={() => {
            setFiling(false);
            load();
          }}
        />
      )}
    </>
  );
}

function FileClaim({
  orders,
  onClose,
  onSaved,
}: {
  orders: Order[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [orderId, setOrderId] = useState(orders[0]?.id ?? '');
  const [type, setType] = useState<ClaimType>('damaged');
  const [description, setDescription] = useState('');
  const [photos, setPhotos] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit() {
    setErr('');
    setBusy(true);
    try {
      const photoList = photos
        .split('\n')
        .map((s) => s.trim())
        .filter(Boolean);
      await api(`/api/brand/orders/${orderId}/claims`, {
        method: 'POST',
        body: { type, description: description || undefined, photos: photoList },
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not file the claim');
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="File a claim"
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!orderId} loading={busy} onClick={submit}>
            Submit claim
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {err && <InlineAlert tone="danger">{err}</InlineAlert>}

        <Field label="Order" htmlFor="c-order">
          <Select
            id="c-order"
            value={orderId}
            onValueChange={setOrderId}
            options={orders.map((o) => ({
              value: o.id,
              label: `${o.recipient.name} · ${o.recipient.city}, ${o.recipient.state}${
                o.tracking_number ? ` · ${o.tracking_number}` : ''
              }`,
            }))}
          />
        </Field>

        <Field label="What happened?" htmlFor="c-type">
          <Select
            id="c-type"
            value={type}
            onValueChange={(v) => setType(v as ClaimType)}
            options={CLAIM_TYPES.map((t) => ({ value: t, label: claimTypeLabel(t) }))}
          />
        </Field>

        <Field label="Details" htmlFor="c-desc">
          <Textarea
            id="c-desc"
            className="min-h-[70px]"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Describe the issue"
          />
        </Field>

        <Field
          label="Photo URLs"
          htmlFor="c-photos"
          hint={type === 'damaged' ? 'Required for damage claims.' : undefined}
        >
          <Textarea
            id="c-photos"
            className="min-h-[50px] font-mono text-xs"
            value={photos}
            onChange={(e) => setPhotos(e.target.value)}
            placeholder="https://… (one per line)"
          />
        </Field>
      </div>
    </Dialog>
  );
}
