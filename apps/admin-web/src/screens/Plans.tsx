import { useEffect, useState } from 'react';
import { canWrite } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import {
  Badge,
  Button,
  DataTable,
  Dialog,
  Drawer,
  EmptyState,
  Field,
  InlineAlert,
  Input,
  PageHeader,
  Textarea,
  type Column,
} from '@ruostack/ui';

type PlanKeyStr = 'starter' | 'pro' | 'volume';

interface PlanRow {
  key: PlanKeyStr;
  name: string;
  features: string[];
  shipping_cutoff: string;
  store_connections: boolean;
  max_orders_per_month: number | null;
  shipping: 'flat' | 'live';
  price_cents: number;
  stripe_price_id: string | null;
  price_version_id: string | null;
}

interface PriceHistoryEntry {
  id: string;
  price_cents: number;
  stripe_price_id: string | null;
  active: boolean;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
  archived_at: string | null;
  reason: string | null;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
// Dollars-string -> cents. Deliberately not the Catalog.tsx `toCents`
// (which coerces garbage input to 0c and would make an unparseable amount
// look identical to a genuine $0 entry) — a price change needs to tell
// "invalid" apart from "zero" so the bounds guard below can reject it.
const parseDollars = (v: string): number | null => {
  if (!/^\d+(\.\d{1,2})?$/.test(v.trim())) return null;
  return Math.round(parseFloat(v) * 100);
};

const PRICE_MIN_CENTS = 100;
const PRICE_MAX_CENTS = 100_000;

/** Server error codes that are not generic failures — an operator needs to
 *  know which one happened. `confirm_large_change_required` is handled as a
 *  flow transition, not a terminal message, so it is not listed here. */
const PRICE_ERROR_COPY: Record<string, string> = {
  validation: `Enter an amount between ${dollars(PRICE_MIN_CENTS)} and ${dollars(PRICE_MAX_CENTS)}, and a reason (1–300 characters).`,
};

export function Plans() {
  const { claims } = useAuth();
  const writable = claims ? canWrite(claims.role, 'plans') : false;
  const [plans, setPlans] = useState<PlanRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [pricing, setPricing] = useState<PlanRow | null>(null);
  const [history, setHistory] = useState<PlanRow | null>(null);

  function load() {
    setLoading(true);
    return api<{ plans: PlanRow[] }>('/api/admin/plans').then((r) => {
      setPlans(r.plans);
      setLoading(false);
    });
  }
  useEffect(() => {
    void load();
  }, []);

  const columns: Column<PlanRow>[] = [
    { key: 'name', header: 'Plan', priority: 'primary', minWidth: 120, cell: (p) => p.name },
    {
      key: 'price',
      header: 'Price',
      align: 'right',
      mono: true,
      minWidth: 110,
      cell: (p) => (p.key === 'starter' ? 'Free' : `${dollars(p.price_cents)}/mo`),
    },
    {
      key: 'cap',
      header: 'Order cap',
      align: 'right',
      mono: true,
      minWidth: 100,
      cell: (p) => (p.max_orders_per_month == null ? 'Unlimited' : p.max_orders_per_month),
    },
    {
      key: 'shipping',
      header: 'Shipping mode',
      minWidth: 120,
      cell: (p) => <span className="capitalize">{p.shipping}</span>,
    },
    {
      key: 'stores',
      header: 'Store connections',
      minWidth: 140,
      cell: (p) => (p.store_connections ? 'Yes' : 'No'),
    },
    { key: 'cutoff', header: 'Shipping cutoff', minWidth: 160, cell: (p) => p.shipping_cutoff },
    {
      key: 'features',
      header: 'Features',
      align: 'right',
      mono: true,
      minWidth: 90,
      cell: (p) => p.features.length,
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      minWidth: 260,
      cell: (p) => (
        <span className="flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" onClick={() => setHistory(p)}>
            History
          </Button>
          {writable && (
            <Button variant="ghost" size="sm" onClick={() => setEditing(p)}>
              Edit
            </Button>
          )}
          {writable && (
            <Button variant="ghost" size="sm" onClick={() => setPricing(p)}>
              Change price
            </Button>
          )}
        </span>
      ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Plans"
        subtitle="Subscription tiers, database-backed. Editing name/features/shipping cutoff is a plain save; changing a price is a separate, deliberate action below it."
      />

      <DataTable
        caption="Subscription plan tiers"
        mode="scroll"
        columns={columns}
        rows={plans}
        rowKey={(p) => p.key}
        loading={loading}
        empty={<EmptyState title="No plans" hint="The plan seed has not run." />}
      />

      {editing && (
        <EditDrawer
          plan={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {pricing && (
        <PriceDialog
          plan={pricing}
          onClose={() => setPricing(null)}
          onSaved={() => {
            setPricing(null);
            void load();
          }}
        />
      )}
      {history && <HistoryDrawer plan={history} onClose={() => setHistory(null)} />}
    </>
  );
}

// ── Edit (name, features, shippingCutoff) — never touches price ────────────

function EditDrawer({ plan, onClose, onSaved }: { plan: PlanRow; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState(plan.name);
  const [featuresText, setFeaturesText] = useState(plan.features.join('\n'));
  const [cutoff, setCutoff] = useState(plan.shipping_cutoff);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  const features = featuresText
    .split('\n')
    .map((f) => f.trim())
    .filter((f) => f.length > 0);
  const valid =
    name.trim().length > 0 &&
    cutoff.trim().length > 0 &&
    features.length <= 20 &&
    features.every((f) => f.length <= 200);

  async function save() {
    setErr('');
    setBusy(true);
    try {
      await api(`/api/admin/plans/${plan.key}`, {
        method: 'PATCH',
        body: { name: name.trim(), features, shipping_cutoff: cutoff.trim() },
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed');
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      title={`Edit ${plan.name}`}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      footer={
        <Button className="w-full" disabled={!valid} loading={busy} onClick={save}>
          Save
        </Button>
      }
    >
      {err && (
        <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>
      )}
      <InlineAlert tone="info">
        Price is not editable here. Use “Change price” on the plan row — it is a separate, confirmed action.
      </InlineAlert>
      <div className="mt-3">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Shipping cutoff" hint="Display-only text shown to brands, e.g. “Ships same day before 2pm ET”.">
          <Input value={cutoff} onChange={(e) => setCutoff(e.target.value)} />
        </Field>
        <Field label="Features" hint="One per line. Up to 20, 200 characters each.">
          <Textarea rows={8} value={featuresText} onChange={(e) => setFeaturesText(e.target.value)} />
        </Field>
      </div>
    </Drawer>
  );
}

// ── Change price — a separate, deliberate action, never coupled to Save ────

type PricePhase = 'amount' | 'confirm' | 'large_confirm';

function PriceDialog({ plan, onClose, onSaved }: { plan: PlanRow; onClose: () => void; onSaved: () => void }) {
  const [phase, setPhase] = useState<PricePhase>('amount');
  const [amountText, setAmountText] = useState('');
  const [reason, setReason] = useState('');
  const [retype, setRetype] = useState('');
  const [largeAck, setLargeAck] = useState(false);
  const [err, setErr] = useState('');
  const [largeChangeMessage, setLargeChangeMessage] = useState('');
  const [busy, setBusy] = useState(false);

  const newCents = parseDollars(amountText);
  const oldCents = plan.price_cents;
  const amountValid =
    newCents != null && newCents >= PRICE_MIN_CENTS && newCents <= PRICE_MAX_CENTS && newCents !== oldCents;
  const reasonValid = reason.trim().length >= 1 && reason.trim().length <= 300;

  const deltaCents = newCents != null ? newCents - oldCents : 0;
  const deltaWords =
    newCents == null
      ? ''
      : deltaCents === 0
        ? 'no change'
        : `${deltaCents > 0 ? 'increase' : 'decrease'} of ${dollars(Math.abs(deltaCents))}/mo`;

  const retypeCents = parseDollars(retype);
  const retypeMatches = newCents != null && retypeCents === newCents;

  async function submit(confirmLargeChange: boolean) {
    if (newCents == null) return;
    setErr('');
    setBusy(true);
    try {
      await api(`/api/admin/plans/${plan.key}/price`, {
        method: 'POST',
        body: { price_cents: newCents, reason: reason.trim(), confirm_large_change: confirmLargeChange },
      });
      onSaved();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'confirm_large_change_required') {
        setLargeChangeMessage(e.message);
        setPhase('large_confirm');
        setBusy(false);
        return;
      }
      if (e instanceof ApiError) {
        setErr(PRICE_ERROR_COPY[e.code] ?? e.message);
      } else {
        setErr('Price change failed');
      }
      setBusy(false);
    }
  }

  // Starter has no Stripe price — the input stays disabled and the reason is
  // explained inline rather than letting an operator fill the whole form out
  // just to hit `starter_is_free` from the server.
  if (plan.key === 'starter') {
    return (
      <Dialog open onOpenChange={(o) => !o && onClose()} title="Change price — Starter">
        <InlineAlert tone="info">
          Starter is free and has no Stripe price to change. It is the fallback tier every lapsed or unconfigured
          brand returns to, so it stays fixed at $0.
        </InlineAlert>
        <div className="mt-3">
          <Field label="Price">
            <Input value="0.00" disabled />
          </Field>
        </div>
      </Dialog>
    );
  }

  return (
    <Dialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`Change price — ${plan.name}`}
      description={
        phase === 'amount'
          ? `Current price: ${dollars(oldCents)}/mo. This is a separate, confirmed action — it never runs as part of the edit form's Save.`
          : undefined
      }
      footer={
        phase === 'amount' ? (
          <>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button disabled={!amountValid || !reasonValid} onClick={() => setPhase('confirm')}>
              Review change
            </Button>
          </>
        ) : phase === 'confirm' ? (
          <>
            <Button variant="ghost" onClick={() => setPhase('amount')}>
              Back
            </Button>
            <Button disabled={!retypeMatches} loading={busy} onClick={() => void submit(false)}>
              Confirm price change
            </Button>
          </>
        ) : (
          <>
            <Button variant="ghost" onClick={() => setPhase('confirm')}>
              Back
            </Button>
            <Button variant="danger" disabled={!largeAck} loading={busy} onClick={() => void submit(true)}>
              Confirm large change
            </Button>
          </>
        )
      }
    >
      {err && (
        <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>
      )}

      {phase === 'amount' && (
        <>
          <Field label="New price ($/mo)" hint={`Between ${dollars(PRICE_MIN_CENTS)} and ${dollars(PRICE_MAX_CENTS)}.`}>
            <Input
              inputMode="decimal"
              placeholder={(oldCents / 100).toFixed(2)}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
            />
          </Field>
          <Field label="Reason" hint="Shown on the price's audit record. 1–300 characters.">
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        </>
      )}

      {phase === 'confirm' && newCents != null && (
        <>
          <div className="mb-3 rounded-[10px] border border-line bg-surface-3 px-4 py-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-content-muted">Current</span>
              <span className="font-mono">{dollars(oldCents)}/mo</span>
            </div>
            <div className="mt-1 flex items-center justify-between text-sm">
              <span className="text-content-muted">New</span>
              <span className="font-mono font-semibold text-content">{dollars(newCents)}/mo</span>
            </div>
            <div className="mt-2 border-t border-line-subtle pt-2 text-sm font-medium text-content">{deltaWords}</div>
          </div>
          <Field
            label={`Type ${(newCents / 100).toFixed(2)} to confirm`}
            hint="Retyping the new amount re-verifies the number that will charge every brand on this plan."
          >
            <Input inputMode="decimal" value={retype} onChange={(e) => setRetype(e.target.value)} />
          </Field>
        </>
      )}

      {phase === 'large_confirm' && (
        <>
          <InlineAlert tone="warning">{largeChangeMessage}</InlineAlert>
          <div className="mt-3 flex items-start gap-2">
            <input
              id="large-ack"
              type="checkbox"
              className="mt-0.5"
              checked={largeAck}
              onChange={(e) => setLargeAck(e.target.checked)}
            />
            <label htmlFor="large-ack" className="text-sm text-content">
              I understand this is an unusually large change (more than ±50%) and want to proceed anyway.
            </label>
          </div>
        </>
      )}
    </Dialog>
  );
}

// ── Price history — read-only timeline over rows Task 8 already writes ─────

function HistoryDrawer({ plan, onClose }: { plan: PlanRow; onClose: () => void }) {
  const [entries, setEntries] = useState<PriceHistoryEntry[] | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api<{ history: PriceHistoryEntry[] }>(`/api/admin/plans/${plan.key}/history`)
      .then((r) => setEntries(r.history))
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Failed to load price history'));
  }, [plan.key]);

  return (
    <Drawer
      open
      title={`Price history — ${plan.name}`}
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
    >
      {err && (
        <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>
      )}
      {plan.key === 'starter' && (
        <InlineAlert tone="info">Starter has never had a Stripe price — it has always been free.</InlineAlert>
      )}
      {entries == null && !err && <p className="text-sm text-content-muted">Loading…</p>}
      {entries != null && entries.length === 0 && plan.key !== 'starter' && (
        <p className="text-sm text-content-muted">No price has been set for this plan yet.</p>
      )}
      {entries != null && entries.length > 0 && (
        <ul className="space-y-3">
          {entries.map((h) => (
            <li key={h.id} className="rounded-[10px] border border-line px-4 py-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-base font-semibold text-content">{dollars(h.price_cents)}/mo</span>
                <Badge tone={h.active ? 'success' : 'neutral'}>{h.active ? 'active' : 'archived'}</Badge>
              </div>
              <dl className="mt-2 space-y-1 text-xs text-content-muted">
                <div className="flex justify-between gap-3">
                  <dt>Set</dt>
                  <dd>{new Date(h.created_at).toLocaleString()}</dd>
                </div>
                <div className="flex justify-between gap-3">
                  <dt>By</dt>
                  <dd>{h.created_by_name ?? 'Unknown'}</dd>
                </div>
                {h.archived_at && (
                  <div className="flex justify-between gap-3">
                    <dt>Archived</dt>
                    <dd>{new Date(h.archived_at).toLocaleString()}</dd>
                  </div>
                )}
                {h.reason && (
                  <div className="border-t border-line-subtle pt-1.5">
                    <dt className="mb-0.5 text-2xs uppercase tracking-[0.1em] text-content-faint">Reason</dt>
                    <dd className="text-content">{h.reason}</dd>
                  </div>
                )}
                <div className="flex justify-between gap-3">
                  <dt>Stripe price</dt>
                  <dd className="font-mono">{h.stripe_price_id ?? '—'}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}
