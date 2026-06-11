import { useEffect, useMemo, useState } from 'react';
import { canWrite } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Drawer, EmptyState, Field, KpiCard, PageHeader, StatusPill, Tabs } from '../components/ui.js';

interface Product {
  id: string;
  canonicalSku: string;
  compound: string;
  dose?: string | null;
  unit?: string | null;
  name: string;
  descriptionTemplate?: string | null;
  wholesaleCost: number;
  suggestedRetail: number;
  status: 'in_stock' | 'soon' | 'out_of_stock';
  isPublished: boolean;
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

export function Catalog() {
  const { claims } = useAuth();
  const writable = claims ? canWrite(claims.role, 'catalog') : false;
  const [products, setProducts] = useState<Product[]>([]);
  const [filter, setFilter] = useState<Filter>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Product | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const { products } = await api<{ products: Product[] }>('/api/admin/catalog');
    setProducts(products);
    setLoading(false);
  }
  useEffect(() => {
    void load();
  }, []);

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

  return (
    <>
      <PageHeader
        title="Catalog Manager"
        subtitle="Operator-owned master for every SKU. The brand catalog is a read projection of published products."
        action={
          writable && (
            <button className="btn" onClick={() => setCreating(true)}>
              + Create product
            </button>
          )
        }
      />

      <div className="mb-4 grid grid-cols-4 gap-3">
        <KpiCard label="Total SKUs" value={counts.all} />
        <KpiCard label="In stock" value={counts.in_stock} />
        <KpiCard label="Soon" value={counts.soon} />
        <KpiCard label="Published" value={products.filter((p) => p.isPublished).length} />
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
        <input
          className="input max-w-xs"
          placeholder="Search name, SKU, compound…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      {loading ? (
        <div className="card p-10 text-center text-muted">Loading…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          title="No products"
          hint={writable ? 'Create the first catalog product to get started.' : 'Nothing matches your filters.'}
          action={writable && <button className="btn" onClick={() => setCreating(true)}>+ Create product</button>}
        />
      ) : (
        <div className="card overflow-hidden">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-line text-left text-[11px] uppercase tracking-wide text-faint">
                <th className="px-4 py-3">SKU</th>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Cost</th>
                <th className="px-4 py-3">Retail</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3">Published</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((p) => (
                <tr
                  key={p.id}
                  onClick={() => setEditing(p)}
                  className="cursor-pointer border-b border-line/60 hover:bg-card2"
                >
                  <td className="px-4 py-3 font-mono text-[12px] text-teal-bright">{p.canonicalSku}</td>
                  <td className="px-4 py-3 text-text">{p.name}</td>
                  <td className="px-4 py-3">{dollars(p.wholesaleCost)}</td>
                  <td className="px-4 py-3 text-success">{dollars(p.suggestedRetail)}</td>
                  <td className="px-4 py-3"><StatusPill value={p.status} /></td>
                  <td className="px-4 py-3 text-muted">{p.isPublished ? '🔒 yes' : 'draft'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

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
  const [cost, setCost] = useState((product.wholesaleCost / 100).toString());
  const [retail, setRetail] = useState((product.suggestedRetail / 100).toString());
  const [weight, setWeight] = useState(product.weight?.toString() ?? '');
  const [packaging, setPackaging] = useState(product.packagingRule ?? '');
  const [coa, setCoa] = useState(product.coaId ?? '');
  const [status, setStatus] = useState(product.status);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  async function save() {
    setErr('');
    setBusy(true);
    try {
      await api(`/api/admin/catalog/${product.id}`, {
        method: 'PATCH',
        body: {
          ...(product.isPublished ? {} : { canonical_sku: sku }),
          name,
          wholesale_cost: toCents(cost),
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

  async function changeStock(next: Product['status']) {
    setStatus(next);
    await api(`/api/admin/catalog/${product.id}/stock`, { method: 'POST', body: { status: next } });
    onSaved();
  }

  return (
    <Drawer
      open
      title={product.name}
      onClose={onClose}
      footer={
        writable && (
          <div className="flex items-center justify-between gap-2">
            {!product.isPublished ? (
              <button className="btn-ghost" onClick={publish} disabled={busy}>
                Publish
              </button>
            ) : (
              <span className="pill border-success/40 bg-success/10 text-success">🔒 published</span>
            )}
            <button className="btn" onClick={save} disabled={busy}>
              {busy ? '…' : 'Save'}
            </button>
          </div>
        )
      }
    >
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}
      <Field label="Canonical SKU">
        <input
          className="input disabled:opacity-50"
          value={sku}
          disabled={product.isPublished || !writable}
          title={product.isPublished ? 'SKU is locked once the product is published (immutable)' : ''}
          onChange={(e) => setSku(e.target.value)}
        />
        {product.isPublished && <span className="mt-1 block text-[11px] text-faint">Locked — immutable after publish.</span>}
      </Field>
      <Field label="Name">
        <input className="input" value={name} disabled={!writable} onChange={(e) => setName(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Wholesale cost ($)">
          <input className="input" value={cost} disabled={!writable} onChange={(e) => setCost(e.target.value)} />
        </Field>
        <Field label="Suggested retail ($)">
          <input className="input" value={retail} disabled={!writable} onChange={(e) => setRetail(e.target.value)} />
        </Field>
      </div>
      <Field label="Stock status">
        <select className="input" value={status} disabled={!writable} onChange={(e) => changeStock(e.target.value as Product['status'])}>
          <option value="in_stock">in_stock</option>
          <option value="soon">soon</option>
          <option value="out_of_stock">out_of_stock</option>
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Weight">
          <input className="input" value={weight} disabled={!writable} onChange={(e) => setWeight(e.target.value)} />
        </Field>
        <Field label="COA id">
          <input className="input" value={coa} disabled={!writable} onChange={(e) => setCoa(e.target.value)} />
        </Field>
      </div>
      <Field label="Packaging rule">
        <input className="input" value={packaging} disabled={!writable} onChange={(e) => setPackaging(e.target.value)} />
      </Field>
    </Drawer>
  );
}

function CreateDrawer({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [sku, setSku] = useState('');
  const [name, setName] = useState('');
  const [compound, setCompound] = useState('');
  const [cost, setCost] = useState('');
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
          wholesale_cost: toCents(cost),
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
      onClose={onClose}
      footer={
        <button className="btn w-full" onClick={create} disabled={busy || !sku || !name || !compound}>
          {busy ? '…' : 'Create (unpublished)'}
        </button>
      }
    >
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-[13px] text-danger">{err}</div>}
      <Field label="Canonical SKU">
        <input className="input" value={sku} onChange={(e) => setSku(e.target.value)} />
      </Field>
      <Field label="Name">
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Compound">
        <input className="input" value={compound} onChange={(e) => setCompound(e.target.value)} />
      </Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Wholesale cost ($)">
          <input className="input" value={cost} onChange={(e) => setCost(e.target.value)} />
        </Field>
        <Field label="Suggested retail ($)">
          <input className="input" value={retail} onChange={(e) => setRetail(e.target.value)} />
        </Field>
      </div>
      <p className="text-[11px] text-faint">SKU is editable until you publish. Publishing locks it permanently.</p>
    </Drawer>
  );
}
