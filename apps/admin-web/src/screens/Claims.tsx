import { useEffect, useState } from 'react';
import { canWrite, canResolveClaim, claimTypeLabel, type ClaimType } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Badge, Button, Card, DataTable, Drawer, EmptyState, Field, Input, PageHeader, Select, Tabs, type Column } from '@ruostack/ui';

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

interface ClaimRow {
  id: string;
  order_id: string;
  type: ClaimType;
  status: string;
  resolution: string | null;
  brand_name: string;
  recipient_name: string;
  tracking_number: string | null;
  carrier: string | null;
  sla_due_at: string;
  sla_overdue: boolean;
}
interface ClaimDetail extends ClaimRow {
  description: string | null;
  photos: string[];
  carrier_claim_id: string | null;
  amount_cents: number | null;
  reship_order_id: string | null;
  reason: string | null;
  order: { recipientName: string; city: string; state: string; trackingNumber: string | null; carrier: string | null; walletChargeCents: number };
}

type Filter = 'open' | 'investigating' | 'carrier_filed' | 'resolved' | 'all';
const STATUS_TONE: Record<string, string> = {
  open: 'border-warning/40 bg-warning/10 text-warning',
  investigating: 'border-accent/40 bg-accent/10 text-accent',
  carrier_filed: 'border-accent/40 bg-accent/10 text-accent-hover',
  resolved: 'border-success/40 bg-success/10 text-success',
};

const COLUMNS: Column<ClaimRow>[] = [
  { key: 'brand', header: 'Brand', priority: 'primary', cell: (c) => c.brand_name },
  { key: 'type', header: 'Type', cell: (c) => claimTypeLabel(c.type) },
  { key: 'recipient', header: 'Recipient', priority: 'meta', cell: (c) => c.recipient_name },
  {
    key: 'status',
    header: 'Status',
    cell: (c) => (
      <Badge >
        {c.status.replace(/_/g, ' ')}
        {c.resolution ? ` \u00b7 ${c.resolution}` : ''}
      </Badge>
    ),
  },
  {
    key: 'sla',
    header: 'SLA',
    cell: (c) =>
      c.status === 'resolved' ? null : c.sla_overdue ? (
        <Badge tone="danger">overdue</Badge>
      ) : (
        new Date(c.sla_due_at).toLocaleDateString()
      ),
  },
];

export function Claims() {
  const { claims: authClaims } = useAuth();
  const role = authClaims?.role;
  const writable = role ? canWrite(role, 'claims') : false; // open + triage
  // Resolution is gated tighter than the surface (mirrors the API predicate):
  // super_admin resolves any outcome; finance may only issue wallet credits.
  const canResolve = role ? canResolveClaim(role, 'credited') : false;
  const creditOnly = role ? canResolveClaim(role, 'credited') && !canResolveClaim(role, 'reshipped') : false;
  const [filter, setFilter] = useState<Filter>('open');
  const [rows, setRows] = useState<ClaimRow[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  function load() {
    const q = filter === 'all' ? '' : `?status=${filter}`;
    api<{ claims: ClaimRow[] }>(`/api/admin/claims${q}`).then((r) => setRows(r.claims));
  }
  useEffect(load, [filter]);

  return (
    <>
      <PageHeader title="Claims Queue" subtitle="Lost / damaged / not-received claims. Triage and resolve as reship, wallet credit, or deny." />
      <div className="mb-3">
        <Tabs<Filter> active={filter} onChange={setFilter} tabs={[
          { key: 'open', label: 'Open' }, { key: 'investigating', label: 'Investigating' }, { key: 'carrier_filed', label: 'Carrier filed' }, { key: 'resolved', label: 'Resolved' }, { key: 'all', label: 'All' },
        ]} />
      </div>

      <DataTable
        caption="Claims queue"
        columns={COLUMNS}
        rows={rows}
        rowKey={(c) => c.id}
        onRowClick={(c) => setOpenId(c.id)}
        empty={<EmptyState title="Nothing here" hint="No claims in this state." />}
      />

      {openId && <ClaimDrawer id={openId} writable={writable} canResolve={canResolve} creditOnly={creditOnly} onClose={() => setOpenId(null)} onChanged={() => { load(); }} />}
    </>
  );
}

function ClaimDrawer({ id, writable, canResolve, creditOnly, onClose, onChanged }: { id: string; writable: boolean; canResolve: boolean; creditOnly: boolean; onClose: () => void; onChanged: () => void }) {
  const [c, setC] = useState<ClaimDetail | null>(null);
  const [carrierId, setCarrierId] = useState('');
  const [res, setRes] = useState<'reshipped' | 'credited' | 'denied'>(creditOnly ? 'credited' : 'reshipped');
  const [reason, setReason] = useState('');
  const [amount, setAmount] = useState('');
  const [comp, setComp] = useState(true);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  function load() { api<ClaimDetail>(`/api/admin/claims/${id}`).then(setC); }
  useEffect(load, [id]);

  async function patch(body: Record<string, unknown>) {
    setErr(''); setBusy(true);
    try { await api(`/api/admin/claims/${id}`, { method: 'PATCH', body }); load(); onChanged(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Failed'); }
    finally { setBusy(false); }
  }
  async function resolve() {
    setErr(''); setBusy(true);
    try {
      const body: Record<string, unknown> = { resolution: res, reason };
      if (res === 'credited') body.amount_cents = Math.round(parseFloat(amount || '0') * 100);
      if (res === 'reshipped') body.comp = comp;
      await api(`/api/admin/claims/${id}/resolve`, { method: 'POST', body });
      load(); onChanged();
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Resolve failed'); }
    finally { setBusy(false); }
  }

  return (
    <Drawer open title={c ? `${claimTypeLabel(c.type)} — ${c.brand_name}` : 'Claim'} onOpenChange={(o) => { if (!o) onClose(); }}>
      {!c ? <div className="text-content-muted">Loading…</div> : (
        <div className="space-y-4 text-sm">
          {err && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-danger">{err}</div>}
          <div className="flex items-center gap-2">
            <Badge >{c.status.replace(/_/g, ' ')}{c.resolution ? ` · ${c.resolution}` : ''}</Badge>
            {c.order.trackingNumber && <span className="font-mono text-2xs text-content-muted">{c.order.carrier} {c.order.trackingNumber}</span>}
          </div>
          <div className="text-content-muted">{c.order.recipientName} · {c.order.city}, {c.order.state} · order value {dollars(c.order.walletChargeCents)}</div>
          {c.description && <div className="rounded-lg border border-line bg-surface-3 px-3 py-2">{c.description}</div>}
          {c.photos.length > 0 && <div className="flex flex-wrap gap-2">{c.photos.map((p, i) => <a key={i} className="text-2xs text-accent underline" href={p} target="_blank" rel="noreferrer">photo {i + 1}</a>)}</div>}
          {c.carrier_claim_id && <div className="text-content-muted">Carrier claim: <span className="font-mono">{c.carrier_claim_id}</span></div>}
          {c.resolution && <div className="rounded-lg border border-line bg-surface-3 px-3 py-2">Resolved <span className="text-content">{c.resolution}</span>{c.amount_cents ? ` · ${dollars(c.amount_cents)}` : ''}{c.reason ? ` — ${c.reason}` : ''}{c.reship_order_id ? ` · reship ${c.reship_order_id.slice(0, 8)}` : ''}</div>}

          {writable && c.status !== 'resolved' && (
            <div className="flex flex-wrap gap-2">
              {c.status === 'open' && <Button variant="ghost" disabled={busy} onClick={() => patch({ status: 'investigating' })}>Start investigating</Button>}
              <span className="flex items-center gap-1">
                <Input className="w-40" placeholder="carrier claim id" value={carrierId} onChange={(e) => setCarrierId(e.target.value)} />
                <Button variant="ghost" disabled={busy || !carrierId} onClick={() => patch({ status: 'carrier_filed', carrier_claim_id: carrierId })}>File carrier claim</Button>
              </span>
            </div>
          )}

          {canResolve && c.status !== 'resolved' && (
            <Card className="space-y-2 p-3">
              <div className="text-2xs uppercase tracking-[0.1em] text-content-faint">Resolve</div>
              <Field label="Resolution">
                <Select
                  value={res}
                  disabled={creditOnly}
                  onValueChange={(v) => setRes(v as typeof res)}
                  options={[
                    // Gated: a credit-only role is offered the credit outcome
                    // and nothing else.
                    ...(creditOnly ? [] : [{ value: 'reshipped', label: 'Reship' }]),
                    { value: 'credited', label: 'Wallet credit' },
                    ...(creditOnly ? [] : [{ value: 'denied', label: 'Deny' }]),
                  ]}
                />
              </Field>
              {res === 'credited' && <Field label="Credit amount ($)"><Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={(c.order.walletChargeCents / 100).toFixed(2)} /></Field>}
              {res === 'reshipped' && <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={comp} onChange={(e) => setComp(e.target.checked)} /> Platform-comped ($0) — uncheck to charge the brand's wallet</label>}
              <Field label="Reason"><Input value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
              <Button className="w-full" disabled={busy || !reason || (res === 'credited' && !amount)} onClick={resolve}>Resolve claim</Button>
            </Card>
          )}
        </div>
      )}
    </Drawer>
  );
}
