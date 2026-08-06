import { useEffect, useMemo, useState } from 'react';
import {
  provisioningStateExplain,
  provisioningStateLabel,
  type ProvisioningAction,
  type ProvisioningState,
} from '@ruostack/shared';
import { Badge, Button, Card, DataTable, type BadgeTone, type Column } from '@ruostack/ui';
import { api, apiDownload, ApiError } from '../lib/api.js';

/**
 * Product provisioning wizard (fulfillment plan §3, architecture §3.3).
 *
 * Four steps because the logic genuinely branches — a single table can't hold
 * it: Select → Pre-flight → Confirm → Result. NOTHING is written to the brand's
 * store until Confirm, and the pre-flight step is a read-only classification of
 * what *would* happen.
 */
interface CatalogRow { id: string; canonicalSku: string; name: string; retail_cents: number; status: string }

interface PreflightRow {
  product_id: string;
  canonical_sku: string;
  name: string;
  state: ProvisioningState;
  woo_product_id: number | null;
  store_sku: string | null;
  allowed_actions: ProvisioningAction[];
  default_action: ProvisioningAction;
  note?: string;
}

interface Outcome {
  product_id: string;
  canonical_sku: string;
  name: string;
  state: ProvisioningState;
  action: ProvisioningAction;
  result: 'created' | 'updated' | 'adopted' | 'sku_restored' | 'realiased' | 'skipped' | 'error';
  error?: string;
}

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;

const STATE_TONE: Record<ProvisioningState, BadgeTone> = {
  new: 'accent',
  managed: 'success',
  drifted: 'warning',
  conflict: 'danger',
};

const ACTION_LABEL: Record<ProvisioningAction, string> = {
  create: 'Create draft',
  update: 'Re-sync SKU',
  skip: 'Skip',
  adopt: 'Adopt',
  restore_sku: 'Restore SKU',
  realias: 'Re-alias',
};

const RESULT_STYLE: Record<Outcome['result'], string> = {
  created: 'text-success',
  updated: 'text-success',
  adopted: 'text-success',
  sku_restored: 'text-success',
  realiased: 'text-success',
  skipped: 'text-content-muted',
  error: 'text-danger',
};

const RESULT_LABEL: Record<Outcome['result'], string> = {
  created: 'Created as draft',
  updated: 'Stock refreshed',
  adopted: 'Adopted',
  sku_restored: 'SKU restored',
  realiased: 'Re-aliased',
  skipped: 'Skipped',
  error: 'Error',
};

type Step = 1 | 2 | 3 | 4;

export function ProvisioningWizard() {
  const [step, setStep] = useState<Step>(1);
  const [products, setProducts] = useState<CatalogRow[]>([]);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [rows, setRows] = useState<PreflightRow[]>([]);
  const [choices, setChoices] = useState<Record<string, ProvisioningAction>>({});
  const [outcomes, setOutcomes] = useState<Outcome[]>([]);
  const [busy, setBusy] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    api<{ products: CatalogRow[] }>('/api/brand/catalog').then((r) => setProducts(r.products)).catch(() => undefined);
  }, []);

  const allSelected = products.length > 0 && sel.size === products.length;
  const toggle = (id: string) =>
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel(allSelected ? new Set() : new Set(products.map((p) => p.id)));

  async function runPreflight() {
    setErr(''); setBusy('preflight');
    try {
      const r = await api<{ rows: PreflightRow[] }>('/api/brand/store/provisioning/preflight', {
        method: 'POST',
        body: { product_ids: [...sel] },
      });
      setRows(r.rows);
      setChoices(Object.fromEntries(r.rows.map((row) => [row.product_id, row.default_action])));
      setStep(2);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not check your store');
    } finally { setBusy(''); }
  }

  async function runCommit() {
    setErr(''); setBusy('commit');
    try {
      const decisions = rows.map((r) => ({ product_id: r.product_id, action: choices[r.product_id] ?? r.default_action }));
      const r = await api<{ outcomes: Outcome[] }>('/api/brand/store/provisioning/commit', { method: 'POST', body: { decisions } });
      setOutcomes(r.outcomes);
      setStep(4);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Push failed');
    } finally { setBusy(''); }
  }

  async function csv() {
    setErr(''); setBusy('csv');
    try {
      const ids = [...sel];
      await apiDownload(`/api/brand/store/provision.csv${ids.length ? `?ids=${ids.join(',')}` : ''}`, 'ruostack-products.csv');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Download failed');
    } finally { setBusy(''); }
  }

  function restart() {
    setStep(1); setRows([]); setChoices({}); setOutcomes([]); setErr('');
  }

  // What Confirm will actually do — the summary that makes step 3 meaningful.
  const plan = useMemo(() => {
    const counts: Partial<Record<ProvisioningAction, number>> = {};
    for (const r of rows) {
      const a = choices[r.product_id] ?? r.default_action;
      counts[a] = (counts[a] ?? 0) + 1;
    }
    return counts;
  }, [rows, choices]);

  const willWrite = rows.some((r) => (choices[r.product_id] ?? r.default_action) !== 'skip');
  const needsAttention = rows.filter((r) => r.state === 'conflict' || r.state === 'drifted').length;

  return (
    <Card className="mt-4 space-y-4 p-6">
      <div>
        <div className="text-lg font-semibold">Add products to your store</div>
        <p className="mt-1 text-xs text-content-muted">
          Products are seeded carrying the RUOStack SKU so orders match automatically. The SKU is the only field we ever
          write back — everything else in your store stays yours. We check your store first; nothing is written until you
          confirm.
        </p>
      </div>

      <Steps step={step} />

      {err && <div className="rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}

      {/* ── Step 1 · Select ─────────────────────────────────────────────── */}
      {step === 1 && (
        <>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-line dark:border-line">
            <label className="flex items-center gap-2 border-b border-line bg-surface-3/50 px-3 py-2 text-xs font-medium dark:border-line">
              <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              Select all ({products.length})
            </label>
            {products.map((p) => (
              <label key={p.id} className="flex items-center gap-2 border-b border-line/60 px-3 py-2 text-sm last:border-0 dark:border-line/60">
                <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
                <span className="flex-1">{p.name}</span>
                <span className="font-mono text-2xs text-content-faint">{p.canonicalSku}</span>
                <span className="text-content-muted">{dollars(p.retail_cents)}</span>
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <Button disabled={sel.size === 0 || !!busy} onClick={runPreflight}>
              {busy === 'preflight' ? 'Checking your store…' : `Check ${sel.size || ''} product${sel.size === 1 ? '' : 's'}`}
            </Button>
            <Button variant="ghost" disabled={!!busy} onClick={csv}>
              {busy === 'csv' ? '…' : sel.size ? 'Download CSV (selected)' : 'Download CSV (all)'}
            </Button>
          </div>
        </>
      )}

      {/* ── Step 2 · Pre-flight ─────────────────────────────────────────── */}
      {step === 2 && (
        <>
          {needsAttention > 0 && (
            <div className="rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-warning">
              {needsAttention} product{needsAttention === 1 ? ' needs' : 's need'} a decision. We never overwrite a product
              we didn’t create.
            </div>
          )}
          <div className="space-y-2">
            {rows.map((r) => (
              <div key={r.product_id} className="rounded-lg border border-line p-3 dark:border-line">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATE_TONE[r.state]}>{provisioningStateLabel(r.state)}</Badge>
                  <span className="text-sm font-medium">{r.name}</span>
                  <span className="font-mono text-2xs text-content-faint">{r.canonical_sku}</span>
                </div>
                <p className="mt-1.5 text-xs text-content-muted">{provisioningStateExplain(r.state)}</p>
                {r.note && <p className="mt-1 text-xs text-warning">{r.note}</p>}
                {r.store_sku && r.store_sku !== r.canonical_sku && (
                  <p className="mt-1 text-xs text-content-muted">
                    In your store this product’s SKU is <span className="font-mono text-content">{r.store_sku}</span>.
                  </p>
                )}
                {r.allowed_actions.length > 1 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {r.allowed_actions.map((a) => {
                      const active = (choices[r.product_id] ?? r.default_action) === a;
                      return (
                        <button
                          key={a}
                          onClick={() => setChoices((c) => ({ ...c, [r.product_id]: a }))}
                          className={`tab ${active ? 'tab-on' : ''}`}
                        >
                          {ACTION_LABEL[a]}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={restart} disabled={!!busy}>Back</Button>
            <Button onClick={() => setStep(3)} disabled={!!busy}>Review</Button>
          </div>
        </>
      )}

      {/* ── Step 3 · Confirm — the last point before anything is written ── */}
      {step === 3 && (
        <>
          <div className="rounded-lg border border-line p-3 text-sm dark:border-line">
            <div className="mb-2 font-medium">This will:</div>
            {Object.keys(plan).length === 0 ? (
              <div className="text-content-muted">Nothing selected.</div>
            ) : (
              <ul className="space-y-1 text-content-muted">
                {(Object.entries(plan) as [ProvisioningAction, number][]).map(([action, count]) => (
                  <li key={action}>
                    <span className="text-content">{count}</span> × {ACTION_LABEL[action].toLowerCase()}
                  </li>
                ))}
              </ul>
            )}
            {!willWrite && <div className="mt-2 text-xs text-content-muted">Every product is set to skip — nothing will change.</div>}
          </div>
          <p className="text-xs text-content-muted">
            New products arrive in WooCommerce as <span className="text-content">drafts</span> for you to review and publish.
            For products already in your store we only re-sync the RUOStack SKU — your prices, titles, copy and images are
            never overwritten.
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={() => setStep(2)} disabled={!!busy}>Back</Button>
            <Button onClick={runCommit} disabled={!!busy || !willWrite}>
              {busy === 'commit' ? 'Applying…' : 'Confirm & apply'}
            </Button>
          </div>
        </>
      )}

      {/* ── Step 4 · Result ─────────────────────────────────────────────── */}
      {step === 4 && (
        <>
          <div className="space-y-1 rounded-lg border border-line px-3 py-2 text-xs dark:border-line">
            {outcomes.map((o) => (
              <div key={o.product_id} className="flex items-center justify-between gap-3">
                <span className="min-w-0 flex-1 truncate">{o.name || o.canonical_sku}</span>
                <span className={RESULT_STYLE[o.result]}>
                  {RESULT_LABEL[o.result]}
                  {o.error ? ` — ${o.error}` : ''}
                </span>
              </div>
            ))}
          </div>
          {outcomes.some((o) => o.result === 'created') && (
            <p className="text-xs text-content-muted">New products are drafts in WooCommerce — publish them there when you’re ready.</p>
          )}
          <Button variant="ghost" onClick={restart}>Add more products</Button>
        </>
      )}
    </Card>
  );
}

function Steps({ step }: { step: Step }) {
  const labels = ['Select', 'Pre-flight', 'Confirm', 'Result'];
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs">
      {labels.map((label, i) => {
        const n = (i + 1) as Step;
        const state = n === step ? 'on' : n < step ? 'done' : 'todo';
        return (
          <span key={label} className="flex items-center gap-1.5">
            <span
              className={`rounded-full px-2 py-0.5 ${
                state === 'on'
                  ? 'bg-accent/15 text-accent'
                  : state === 'done'
                    ? 'text-success'
                    : 'text-content-faint'
              }`}
            >
              {state === 'done' ? '✓' : n}. {label}
            </span>
            {i < labels.length - 1 && <span className="text-content-faint">→</span>}
          </span>
        );
      })}
    </div>
  );
}

interface ManagedRow {
  product_id: string;
  name: string;
  canonical_sku: string;
  provisioned_sku: string;
  woo_product_id: number;
  adopted: boolean;
  aliased: boolean;
  last_pushed_at: string;
}

// scroll mode, not cards: this is a SKU-match grid and the store SKU has to stay
// visually beside the product it maps to.
const MANAGED_COLUMNS: Column<ManagedRow>[] = [
  { key: 'name', header: 'Product', priority: 'primary', minWidth: 180, cell: (r) => r.name },
  {
    key: 'sku',
    header: 'SKU in store',
    mono: true,
    minWidth: 160,
    cell: (r) => r.provisioned_sku,
  },
  {
    key: 'status',
    header: 'Status',
    minWidth: 120,
    cell: (r) =>
      r.aliased ? (
        <Badge title={`Kept under your SKU; orders still match ${r.canonical_sku}.`}>your SKU</Badge>
      ) : r.adopted ? (
        <Badge>adopted</Badge>
      ) : (
        <Badge tone="success">managed</Badge>
      ),
  },
  {
    key: 'pushed',
    header: 'Last push',
    minWidth: 120,
    cell: (r) => new Date(r.last_pushed_at).toLocaleDateString(),
  },
];

/** The persistent "managed products" table — what we look after, and any drift. */
export function ManagedProducts() {
  const [rows, setRows] = useState<ManagedRow[]>([]);

  useEffect(() => {
    api<{ managed: ManagedRow[] }>('/api/brand/store/provisioning/status')
      .then((r) => setRows(r.managed))
      .catch(() => undefined);
  }, []);

  if (rows.length === 0) return null;

  return (
    <Card className="mt-4 p-6">
      <div className="text-lg font-semibold">Managed products</div>
      <p className="mt-1 text-xs text-content-muted">Products RUOStack maintains in your store.</p>
      <div className="mt-3">
        <DataTable
          caption="Products RUOStack maintains in your store"
          mode="scroll"
          columns={MANAGED_COLUMNS}
          rows={rows}
          rowKey={(r) => r.product_id}
        />
      </div>
    </Card>
  );
}
