import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Checkbox,
  DataTable,
  Dialog,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  KpiTile,
  PageHeader,
  Plus,
  cn,
  type Column,
} from '@ruostack/ui';
import { api, ApiError } from '../lib/api.js';

interface Entry {
  id: string;
  type: string;
  amount_cents: number;
  balance_after_cents: number;
  reason: string | null;
  created_at: string;
}
interface WalletData {
  balance_cents: number;
  held_cents: number;
  available_cents: number;
  entries: Entry[];
}

const dollars = (c: number) => `${c < 0 ? '-' : ''}$${(Math.abs(c) / 100).toFixed(2)}`;
const PRESETS = [2500, 5000, 10000, 25000];

const COLUMNS: Column<Entry>[] = [
  {
    key: 'type',
    header: 'Type',
    priority: 'primary',
    cell: (e) => <Badge>{e.type.replace(/_/g, ' ')}</Badge>,
  },
  {
    key: 'date',
    header: 'Date',
    priority: 'meta',
    cell: (e) => new Date(e.created_at).toLocaleString(),
  },
  {
    key: 'amount',
    header: 'Amount',
    align: 'right',
    mono: true,
    cell: (e) => (
      <span className={cn('font-medium', e.amount_cents >= 0 ? 'text-success' : 'text-danger')}>
        {e.amount_cents >= 0 ? '+' : ''}
        {dollars(e.amount_cents)}
      </span>
    ),
  },
  {
    key: 'balance',
    header: 'Balance',
    align: 'right',
    mono: true,
    cell: (e) => dollars(e.balance_after_cents),
  },
];

export function Wallet() {
  const [data, setData] = useState<WalletData | null>(null);
  const [modal, setModal] = useState(false);
  const [banner, setBanner] = useState('');

  async function load() {
    setData(await api<WalletData>('/api/brand/wallet'));
  }
  useEffect(() => {
    void load();
    // surface Stripe Checkout return status
    const q = new URLSearchParams(window.location.search).get('status');
    if (q === 'success')
      setBanner('Payment received — your balance updates as soon as the webhook confirms it.');
    if (q === 'cancelled') setBanner('Top-up cancelled.');
  }, []);

  const spent = (data?.entries ?? [])
    .filter((e) => e.amount_cents < 0)
    .reduce((s, e) => s + e.amount_cents, 0);

  return (
    <>
      <PageHeader
        title="Wallet"
        subtitle="Prepaid balance for fulfillment. Funds are non-refundable."
        action={
          <Button icon={Plus} onClick={() => setModal(true)}>
            Add funds
          </Button>
        }
      />

      {banner && (
        <div className="mb-4">
          <InlineAlert tone="success">{banner}</InlineAlert>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <KpiTile
          label={`Available${data && data.held_cents > 0 ? ` (${dollars(data.held_cents)} held)` : ''}`}
          value={data ? dollars(data.available_cents) : '—'}
          tone="accent"
        />
        <KpiTile label="Total balance" value={data ? dollars(data.balance_cents) : '—'} />
        <KpiTile label="Total spent" value={dollars(-spent)} />
      </div>

      <h2 className="mb-2 mt-6 text-2xs uppercase tracking-[0.12em] text-content-faint">Ledger</h2>
      <DataTable
        caption="Your wallet transaction history"
        columns={COLUMNS}
        rows={data?.entries ?? []}
        rowKey={(e) => e.id}
        loading={data === null}
        empty={
          <EmptyState title="No transactions yet" hint="Add funds to get started." />
        }
      />

      {modal && <AddFunds onClose={() => setModal(false)} />}
    </>
  );
}

function AddFunds({ onClose }: { onClose: () => void }) {
  const [amount, setAmount] = useState(5000);
  const [custom, setCustom] = useState('');
  const [ack, setAck] = useState(false);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const cents = custom ? Math.round(parseFloat(custom || '0') * 100) : amount;

  async function go() {
    setErr('');
    setBusy(true);
    try {
      const { url } = await api<{ url: string }>('/api/brand/wallet/topup', {
        method: 'POST',
        body: { amount_cents: cents, acknowledge: true },
      });
      window.location.href = url; // hosted Stripe Checkout
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not start checkout');
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title="Add funds"
      description="Choose an amount to load into your prepaid wallet."
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ack || cents < 1000} loading={busy} onClick={go}>
            Add {dollars(cents)}
          </Button>
        </>
      }
    >
      {err && (
        <div className="mb-3">
          <InlineAlert tone="danger">{err}</InlineAlert>
        </div>
      )}

      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {PRESETS.map((p) => (
          <button
            key={p}
            onClick={() => {
              setAmount(p);
              setCustom('');
            }}
            className={cn(
              'min-h-11 rounded-lg border px-2 text-sm transition-colors duration-fast',
              !custom && amount === p
                ? 'border-accent bg-accent-tint text-accent'
                : 'border-line text-content-muted hover:text-content',
            )}
          >
            ${p / 100}
          </button>
        ))}
      </div>

      <Field label="Custom amount ($)" htmlFor="w-custom">
        <Input
          id="w-custom"
          inputMode="decimal"
          placeholder="e.g. 75"
          value={custom}
          onChange={(e) => setCustom(e.target.value)}
        />
      </Field>

      <div className="mb-1 mt-3">
        <Checkbox
          checked={ack}
          onCheckedChange={setAck}
          label="I understand wallet funds are non-refundable and non-withdrawable, usable only for RUOStack fulfillment services."
        />
      </div>

      <p className="mt-3 text-center text-2xs text-content-faint">
        Minimum $10. Opens secure Stripe Checkout.
      </p>
    </Dialog>
  );
}
