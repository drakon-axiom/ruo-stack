import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { canWrite, MAX_IMPORT_ROWS } from '@ruostack/shared';
import { api, apiDownload, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Button, DataTable, Download, Drawer, EmptyState, Field, InlineAlert, Input, KpiTile, Lock, PageHeader, Plus, Select, StatusPill, Tabs, Upload, type Column } from '@ruostack/ui';

interface Product {
  id: string;
  canonicalSku: string;
  compound: string;
  dose?: string | null;
  unit?: string | null;
  name: string;
  descriptionTemplate?: string | null;
  wholesaleStarter: number;
  wholesalePro: number;
  wholesaleVolume: number;
  suggestedRetail: number;
  status: 'in_stock' | 'soon' | 'out_of_stock';
  isPublished: boolean;
  archived: boolean;
  weight?: number | null;
  length?: number | null;
  width?: number | null;
  height?: number | null;
  packagingRule?: string | null;
  coaId?: string | null;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const toCents = (v: string) => Math.round(parseFloat(v || '0') * 100);

type Filter = 'all' | 'in_stock' | 'soon' | 'out_of_stock';

// scroll mode: the three wholesale tiers only make sense read across, beside
// the SKU they price.
const COLUMNS: Column<Product>[] = [
  {
    key: 'sku',
    header: 'SKU',
    priority: 'primary',
    mono: true,
    minWidth: 160,
    cell: (p) => <span className="text-accent-hover">{p.canonicalSku}</span>,
  },
  { key: 'name', header: 'Name', minWidth: 200, cell: (p) => p.name },
  {
    key: 'wholesale',
    header: 'Wholesale (S / P / V)',
    mono: true,
    minWidth: 190,
    cell: (p) =>
      `${dollars(p.wholesaleStarter)} / ${dollars(p.wholesalePro)} / ${dollars(p.wholesaleVolume)}`,
  },
  {
    key: 'retail',
    header: 'Retail',
    align: 'right',
    mono: true,
    minWidth: 110,
    cell: (p) => <span className="text-success">{dollars(p.suggestedRetail)}</span>,
  },
  { key: 'status', header: 'Status', minWidth: 120, cell: (p) => <StatusPill value={p.status} /> },
  {
    key: 'published',
    header: 'Published',
    minWidth: 110,
    cell: (p) =>
      p.isPublished ? (
        <span className="inline-flex items-center gap-1">
          <Lock aria-hidden className="h-3 w-3" /> yes
        </span>
      ) : (
        'draft'
      ),
  },
];

export function Catalog() {
  const navigate = useNavigate();
  const { claims } = useAuth();
  const writable = claims ? canWrite(claims.role, 'catalog') : false;
  const [products, setProducts] = useState<Product[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);
  // Archived products are retired — a separate view, not mixed into the live catalog.
  const [showArchived, setShowArchived] = useState(false);
  const [err, setErr] = useState('');

  async function load(archived = showArchived) {
    setLoading(true);
    const { products } = await api<{ products: Product[] }>(`/api/admin/catalog?archived=${archived}`);
    setProducts(products);
    setLoading(false);
  }
  useEffect(() => {
    void load(showArchived);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showArchived]);

  const counts = useMemo(
    () => ({
      all: products.length,
      in_stock: products.filter((p) => p.status === 'in_stock').length,
      soon: products.filter((p) => p.status === 'soon').length,
      out_of_stock: products.filter((p) => p.status === 'out_of_stock').length,
    }),
    [products],
  );

  const visible = products
    .filter((p) => filter === 'all' || p.status === filter)
    .filter((p) =>
      !search
        ? true
        : [p.name, p.canonicalSku, p.compound].some((s) => s.toLowerCase().includes(search.toLowerCase())),
    );

  // The file matches the visible table: same status tab, search box and archived
  // toggle. The screen filters client-side, so those have to be sent explicitly.
  function exportQuery(): string {
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('status', filter);
    if (search.trim()) params.set('search', search.trim());
    if (showArchived) params.set('archived', 'true');
    return params.toString();
  }

  function exportCsv(shape: 'import' | 'full') {
    const q = exportQuery();
    apiDownload(
      `/api/admin/catalog/export.csv?shape=${shape}${q ? `&${q}` : ''}`,
      `ruostack-catalog-${shape}.csv`,
    ).catch((e) => setErr(e instanceof ApiError ? e.message : 'Export failed'));
  }

  return (
    <>
      <PageHeader
        title="Catalog Manager"
        subtitle={
          showArchived
            ? 'Retired products. They keep their history and stay out of every brand catalog until restored.'
            : 'Operator-owned master for every SKU. The brand catalog is a read projection of published products.'
        }
        action={
          <div className="flex items-center gap-2">
            <Button variant="ghost" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Back to catalog' : 'View archived'}
            </Button>
            <Button variant="ghost" icon={Download} onClick={() => exportCsv('import')}>
              Export CSV
            </Button>
            <Button
              variant="ghost"
              icon={Download}
              title="Full snapshot including status, published and archived. For reporting — it cannot be re-imported."
              onClick={() => exportCsv('full')}
            >
              Export snapshot
            </Button>
            {writable && !showArchived && (
              <Button variant="ghost" icon={Upload} onClick={() => navigate('/catalog/import')}>
                Import CSV
              </Button>
            )}
            {writable && !showArchived && (
              <Button onClick={() => setCreating(true)}>
                + Create product
              </Button>
            )}
          </div>
        }
      />

      <div className="mb-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
        <KpiTile label="Total SKUs" value={counts.all} />
        <KpiTile label="In stock" value={counts.in_stock} />
        <KpiTile label="Soon" value={counts.soon} />
        <KpiTile label="Published" value={products.filter((p) => p.isPublished).length} />
      </div>

      <div className="mb-3 flex items-center justify-between gap-4">
        <Tabs<Filter>
          active={filter}
          onChange={setFilter}
          tabs={[
            { key: 'all', label: 'All', count: counts.all },
            { key: 'in_stock', label: 'In stock', count: counts.in_stock },
            { key: 'soon', label: 'Soon', count: counts.soon },
            { key: 'out_of_stock', label: 'Out', count: counts.out_of_stock },
          ]}
        />
        <Input
          className="max-w-xs"
          placeholder="Search name, SKU, compound…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {err && <div className="mb-4"><InlineAlert tone="danger">{err}</InlineAlert></div>}

      {visible.length > MAX_IMPORT_ROWS && (
        <div className="mb-4">
          <InlineAlert tone="warning">
            This selection has {visible.length} products. The importer accepts {MAX_IMPORT_ROWS} rows
            per file, so an exported CSV will need splitting before it can be re-imported. Narrow the
            filter to export a smaller set.
          </InlineAlert>
        </div>
      )}

      <DataTable
        caption="Catalog products with tiered wholesale pricing"
        mode="scroll"
        columns={COLUMNS}
        rows={visible}
        rowKey={(p) => p.id}
        loading={loading}
        onRowClick={setEditing}
        empty={
          <EmptyState
            title="No products"
            hint={
              writable
                ? 'Create the first catalog product to get started.'
                : 'Nothing matches your filters.'
            }
            action={
              writable ? (
                <Button icon={Plus} onClick={() => setCreating(true)}>
                  Create product
                </Button>
              ) : undefined
            }
          />
        }
      />

      {editing && (
        <EditDrawer
          product={editing}
          writable={writable}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
      {creating && (
        <CreateDrawer onClose={() => setCreating(false)} onSaved={() => { setCreating(false); void load(); }} />
      )}
    </>
  );
}

function EditDrawer({
  product,
  writable,
  onClose,
  onSaved,
}: {
  product: Product;
  writable: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [sku, setSku] = useState(product.canonicalSku);
  const [name, setName] = useState(product.name);
  const [costS, setCostS] = useState((product.wholesaleStarter / 100).toString());
  const [costP, setCostP] = useState((product.wholesalePro / 100).toString());
  const [costV, setCostV] = useState((product.wholesaleVolume / 100).toString());
  const [retail, setRetail] = useState((product.suggestedRetail / 100).toString());
  const [weight, setWeight] = useState(product.weight?.toString() ?? '');
  const [packaging, setPackaging] = useState(product.packagingRule ?? '');
  const [coa, setCoa] = useState(product.coaId ?? '');
  const [status, setStatus] = useState(product.status);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  // UI hint only — the server re-checks orders and provisioning records before
  // allowing a hard delete, and 409s with the reason if it can't.
  const canDelete = !product.isPublished;

  async function save() {
    setErr('');
    setBusy(true);
    try {
      await api(`/api/admin/catalog/${product.id}`, {
        method: 'PATCH',
        body: {
          ...(product.isPublished ? {} : { canonical_sku: sku }),
          name,
          wholesale_starter: toCents(costS),
          wholesale_pro: toCents(costP),
          wholesale_volume: toCents(costV),
          suggested_retail: toCents(retail),
          weight: weight ? parseFloat(weight) : undefined,
          packaging_rule: packaging || undefined,
          coa_id: coa || undefined,
        },
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed');
      setBusy(false);
    }
  }

  async function publish() {
    setBusy(true);
    try {
      await api(`/api/admin/catalog/${product.id}/publish`, { method: 'POST' });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Publish failed');
      setBusy(false);
    }
  }

  /** Unpublish also pushes the product out-of-stock in brand storefronts. */
  async function unpublish() {
    if (!confirm('Unpublish this product? Brands can no longer order it, and stores that already carry it will be set out-of-stock.')) return;
    setBusy(true);
    try {
      await api(`/api/admin/catalog/${product.id}/unpublish`, { method: 'POST' });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Unpublish failed');
      setBusy(false);
    }
  }

  async function archive() {
    if (!confirm('Archive this product? It leaves the catalog entirely. You can restore it later.')) return;
    setBusy(true);
    try {
      await api(`/api/admin/catalog/${product.id}/archive`, { method: 'POST' });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Archive failed');
      setBusy(false);
    }
  }

  async function unarchive() {
    setBusy(true);
    try {
      await api(`/api/admin/catalog/${product.id}/unarchive`, { method: 'POST' });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Restore failed');
      setBusy(false);
    }
  }

  /** Hard delete — the API allows it only for a never-published draft. */
  async function remove() {
    if (!confirm(`Delete “${product.name}” permanently? This cannot be undone.`)) return;
    setBusy(true);
    try {
      await api(`/api/admin/catalog/${product.id}`, { method: 'DELETE' });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Delete failed');
      setBusy(false);
    }
  }

  async function changeStock(next: Product['status']) {
    setStatus(next);
    await api(`/api/admin/catalog/${product.id}/stock`, { method: 'POST', body: { status: next } });
    onSaved();
  }

  return (
    <Drawer
      open
      title={product.name}
      onOpenChange={(o) => { if (!o) onClose(); }}
      footer={
        writable && (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2">
              {product.archived ? (
                <Button variant="ghost" onClick={unarchive} disabled={busy}>Restore from archive</Button>
              ) : !product.isPublished ? (
                <Button variant="ghost" onClick={publish} disabled={busy}>Publish</Button>
              ) : (
                <Button variant="ghost" onClick={unpublish} disabled={busy}>Unpublish</Button>
              )}
              <Button onClick={save} disabled={product.archived} loading={busy}>Save</Button>
            </div>

            {!product.archived && (
              <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
                {canDelete ? (
                  <Button variant="danger" onClick={remove} disabled={busy}>Delete</Button>
                ) : (
                  <Button
                    variant="danger" className="disabled:opacity-40"
                    onClick={archive}
                    disabled={busy || status !== 'out_of_stock'}
                    title={
                      status === 'out_of_stock'
                        ? 'Retire this product — it leaves the catalog but keeps its history'
                        : 'Set stock to out_of_stock first, so brand stores stop selling it'
                    }
                  >
                    Archive
                  </Button>
                )}
                <span className="text-2xs text-content-faint">
                  {canDelete
                    ? 'Draft — can be deleted outright'
                    : status === 'out_of_stock'
                      ? 'Has history — archive instead of delete'
                      : 'Set out-of-stock to enable archiving'}
                </span>
              </div>
            )}
          </div>
        )
      }
    >
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
      <Field label="Canonical SKU">
        <Input
          className="disabled:opacity-50"
          value={sku}
          disabled={product.isPublished || !writable}
          title={product.isPublished ? 'SKU is locked once the product is published (immutable)' : ''}
          onChange={(e) => setSku(e.target.value)}
        />
        {product.isPublished && <span className="mt-1 block text-2xs text-content-faint">Locked — immutable after publish.</span>}
      </Field>
      <Field label="Name">
        <Input value={name} disabled={!writable} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="mb-1 mt-1 text-2xs uppercase tracking-[0.1em] text-content-faint">Wholesale cost by plan ($)</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Starter">
          <Input value={costS} disabled={!writable} onChange={(e) => setCostS(e.target.value)} />
        </Field>
        <Field label="Pro">
          <Input value={costP} disabled={!writable} onChange={(e) => setCostP(e.target.value)} />
        </Field>
        <Field label="Volume">
          <Input value={costV} disabled={!writable} onChange={(e) => setCostV(e.target.value)} />
        </Field>
      </div>
      <Field label="Suggested retail ($)">
        <Input value={retail} disabled={!writable} onChange={(e) => setRetail(e.target.value)} />
      </Field>
      <Field label="Stock status">
        <Select
          value={status}
          disabled={!writable}
          onValueChange={(v) => changeStock(v as Product['status'])}
          options={[
            { value: 'in_stock', label: 'in stock' },
            { value: 'soon', label: 'soon' },
            { value: 'out_of_stock', label: 'out of stock' },
          ]}
        />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Weight">
          <Input value={weight} disabled={!writable} onChange={(e) => setWeight(e.target.value)} />
        </Field>
        <Field label="COA id">
          <Input value={coa} disabled={!writable} onChange={(e) => setCoa(e.target.value)} />
        </Field>
      </div>
      <Field label="Packaging rule">
        <Input value={packaging} disabled={!writable} onChange={(e) => setPackaging(e.target.value)} />
      </Field>
    </Drawer>
  );
}

function CreateDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [compound, setCompound] = useState('');
  const [costS, setCostS] = useState('');
  const [costP, setCostP] = useState('');
  const [costV, setCostV] = useState('');
  const [retail, setRetail] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function create() {
    setErr('');
    setBusy(true);
    try {
      await api('/api/admin/catalog', {
        method: 'POST',
        body: {
          canonical_sku: sku,
          name,
          compound,
          wholesale_starter: toCents(costS),
          wholesale_pro: toCents(costP),
          wholesale_volume: toCents(costV),
          suggested_retail: toCents(retail),
        },
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Create failed');
      setBusy(false);
    }
  }

  return (
    <Drawer
      open
      title="Create product"
      onOpenChange={(o) => { if (!o) onClose(); }}
      footer={
        <Button className="w-full" onClick={create} disabled={!sku || !name || !compound} loading={busy}>Create (unpublished)</Button>
      }
    >
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
      <Field label="Canonical SKU">
        <Input value={sku} onChange={(e) => setSku(e.target.value)} />
      </Field>
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Compound">
        <Input value={compound} onChange={(e) => setCompound(e.target.value)} />
      </Field>
      <div className="mb-1 text-2xs uppercase tracking-[0.1em] text-content-faint">Wholesale cost by plan ($)</div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Field label="Starter">
          <Input value={costS} onChange={(e) => setCostS(e.target.value)} />
        </Field>
        <Field label="Pro">
          <Input value={costP} onChange={(e) => setCostP(e.target.value)} />
        </Field>
        <Field label="Volume">
          <Input value={costV} onChange={(e) => setCostV(e.target.value)} />
        </Field>
      </div>
      <Field label="Suggested retail ($)">
        <Input value={retail} onChange={(e) => setRetail(e.target.value)} />
      </Field>
      <p className="text-2xs text-content-faint">SKU is editable until you publish. Publishing locks it permanently.</p>
    </Drawer>
  );
}
