import { useEffect, useState } from 'react';
import { canWrite } from '@ruostack/shared';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  InlineAlert,
  PageHeader,
  type Column,
} from '@ruostack/ui';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';

interface DeadLetter {
  id: string;
  source: string;
  type: string;
  attempts: number;
  external_id: string;
  created_at: string;
}
interface Drift {
  kind: string;
  // Optional: order-shaped findings (shipped_not_captured, stale_export)
  // carry order_id; subscription-shaped findings (plan_price_mismatch) carry
  // brand_id instead — there is no order to point at.
  order_id?: string;
  brand_id?: string;
  brand_name: string;
  detail: string;
  at: string | null;
}
interface Report {
  dead_letter: DeadLetter[];
  retryable_count: number;
  drift: Drift[];
}
interface RunResult {
  retry: { examined: number; healed: number; failed: number; deadLetter: number };
  drift: Drift[];
  ranAt: string;
}

const DRIFT_LABEL: Record<string, string> = {
  shipped_not_captured: 'Shipped — not captured',
  stale_export: 'Stale export (>24h)',
  plan_price_mismatch: 'Plan/price mismatch',
};

const DRIFT_COLUMNS: Column<Drift>[] = [
  {
    key: 'kind',
    header: 'Kind',
    priority: 'primary',
    minWidth: 180,
    cell: (d) => <Badge tone="warning">{DRIFT_LABEL[d.kind] ?? d.kind}</Badge>,
  },
  { key: 'brand', header: 'Brand', minWidth: 140, cell: (d) => d.brand_name },
  { key: 'order', header: 'Order', mono: true, minWidth: 100, cell: (d) => (d.order_id ? d.order_id.slice(0, 8) : '—') },
  { key: 'detail', header: 'Detail', minWidth: 200, cell: (d) => d.detail },
  {
    key: 'since',
    header: 'Since',
    minWidth: 160,
    cell: (d) => (d.at ? new Date(d.at).toLocaleString() : '—'),
  },
];

const DL_COLUMNS: Column<DeadLetter>[] = [
  {
    key: 'source',
    header: 'Source',
    priority: 'primary',
    minWidth: 110,
    cell: (e) => <span className="capitalize">{e.source}</span>,
  },
  { key: 'type', header: 'Type', minWidth: 160, cell: (e) => e.type },
  {
    key: 'attempts',
    header: 'Attempts',
    minWidth: 90,
    cell: (e) => <Badge tone="danger">{e.attempts}</Badge>,
  },
  { key: 'external', header: 'External ID', mono: true, minWidth: 180, cell: (e) => e.external_id },
  {
    key: 'seen',
    header: 'First seen',
    minWidth: 160,
    cell: (e) => new Date(e.created_at).toLocaleString(),
  },
];

export function Exceptions() {
  const { claims } = useAuth();
  const writable = claims ? canWrite(claims.role, 'exceptions') : false;
  const [rep, setRep] = useState<Report | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');

  function load() {
    api<Report>('/api/admin/reconciliation').then(setRep);
  }
  useEffect(load, []);

  async function run() {
    setBusy(true);
    setErr('');
    setMsg('');
    try {
      const r = await api<RunResult>('/api/admin/reconciliation/run', { method: 'POST' });
      setMsg(
        `Healed ${r.retry.healed}, still failing ${r.retry.failed}, dead-letter ${r.retry.deadLetter}, drift ${r.drift.length}.`,
      );
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Run failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Exceptions & Reconciliation"
        subtitle="Dead-letter webhooks and drift between RUOStack and the external systems. The worker runs automatically; you can also run it on demand."
        action={
          writable ? (
            <Button loading={busy} onClick={run}>
              Run reconciliation
            </Button>
          ) : undefined
        }
      />

      {err && (
        <div className="mb-3">
          <InlineAlert tone="danger">{err}</InlineAlert>
        </div>
      )}
      {msg && (
        <div className="mb-3">
          <InlineAlert tone="info">{msg}</InlineAlert>
        </div>
      )}

      <div className="space-y-6">
        {rep && rep.retryable_count > 0 && (
          <InlineAlert tone="warning">
            {rep.retryable_count} webhook event{rep.retryable_count > 1 ? 's' : ''} pending retry
            (will heal on the next run).
          </InlineAlert>
        )}

        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-faint">
            Drift ({rep?.drift.length ?? 0})
          </div>
          <DataTable
            caption="Drift between RUOStack and external systems"
            mode="scroll"
            columns={DRIFT_COLUMNS}
            rows={rep?.drift ?? []}
            rowKey={(d) => `${d.kind}:${d.order_id ?? d.brand_id ?? d.brand_name}`}
            loading={rep === null}
            empty={<EmptyState title="No drift" hint="Orders, shipments, and the ledger agree." />}
          />
        </section>

        <section>
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-content-faint">
            Dead-letter webhooks ({rep?.dead_letter.length ?? 0})
          </div>
          <DataTable
            caption="Webhooks that exhausted their retries"
            mode="scroll"
            columns={DL_COLUMNS}
            rows={rep?.dead_letter ?? []}
            rowKey={(e) => e.id}
            loading={rep === null}
            empty={<EmptyState title="None" hint="No webhooks exhausted their retries." />}
          />
        </section>
      </div>
    </>
  );
}
