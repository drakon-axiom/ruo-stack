import { useEffect, useMemo, useState } from 'react';
import { ANNOUNCEMENT_TYPES, announcementTypeLabel, canWrite, type AnnouncementType } from '@ruostack/shared';
import { api, ApiError } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { Button, DataTable, Drawer, EmptyState, Field, Input, KpiTile, PageHeader, Tabs, buttonClass, cardClass, inputClass, labelClass, pillClass, type Column } from '@ruostack/ui';

interface Announcement {
  id: string;
  audience: 'all_brands' | 'segment' | 'single_brand';
  brand_id: string | null;
  brand_name: string | null;
  type: AnnouncementType;
  title: string;
  body: string;
  publish_at: string | null;
  expires_at: string | null;
  status: 'draft' | 'published' | 'archived';
  display_state: 'draft' | 'scheduled' | 'live' | 'expired' | 'archived';
  created_at: string;
}
interface Brand { id: string; brand_name: string }

type Tab = 'all' | 'draft' | 'scheduled' | 'live' | 'expired' | 'archived';

const STATE_STYLE: Record<Announcement['display_state'], string> = {
  draft: 'border-line bg-surface-3 text-content-muted',
  scheduled: 'border-warning/40 bg-warning/10 text-warning',
  live: 'border-success/40 bg-success/10 text-success',
  expired: 'border-line bg-surface-3 text-content-faint',
  archived: 'border-line bg-surface-3 text-content-faint',
};

const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleString() : '—');
/** `datetime-local` wants `YYYY-MM-DDTHH:mm` in LOCAL time, not an ISO-Z string. */
const toLocalInput = (iso: string | null) => {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

export function Announcements() {
  const { claims } = useAuth();
  const writable = claims ? canWrite(claims.role, 'announcements') : false;
  const [rows, setRows] = useState<Announcement[]>([]);
  const [brands, setBrands] = useState<Brand[]>([]);
  const [tab, setTab] = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<Announcement | 'new' | null>(null);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  function load() {
    api<{ announcements: Announcement[] }>('/api/admin/announcements')
      .then((r) => { setRows(r.announcements); setLoading(false); })
      .catch((e) => { setErr(e instanceof ApiError ? e.message : 'Could not load announcements'); setLoading(false); });
  }
  useEffect(() => {
    load();
    api<{ brands: Brand[] }>('/api/admin/brands').then((r) => setBrands(r.brands)).catch(() => undefined);
  }, []);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of rows) c[r.display_state] = (c[r.display_state] ?? 0) + 1;
    return c;
  }, [rows]);

  const visible = rows.filter(
    (r) =>
      (tab === 'all' || r.display_state === tab) &&
      (!search || r.title.toLowerCase().includes(search.toLowerCase()) || r.body.toLowerCase().includes(search.toLowerCase())),
  );

  async function setStatus(a: Announcement, status: 'published' | 'archived' | 'draft') {
    setErr('');
    try {
      await api(`/api/admin/announcements/${a.id}`, { method: 'PATCH', body: { status } });
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Update failed');
    }
  }

  async function remove(a: Announcement) {
    setErr('');
    try {
      await api(`/api/admin/announcements/${a.id}`, { method: 'DELETE' });
      load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Delete failed');
    }
  }

  const columns: Column<Announcement>[] = [
    {
      key: 'title',
      header: 'Title',
      priority: 'primary',
      minWidth: 220,
      cell: (a) => (
        <div>
          <button
            className="text-left font-medium text-content transition-colors duration-fast hover:text-accent"
            onClick={() => setEditing(a)}
          >
            {a.title}
          </button>
          <div className="mt-0.5 line-clamp-1 text-xs text-content-muted">{a.body}</div>
        </div>
      ),
    },
    {
      key: 'audience',
      header: 'Audience',
      minWidth: 130,
      cell: (a) => (a.audience === 'all_brands' ? 'All brands' : (a.brand_name ?? 'One brand')),
    },
    { key: 'type', header: 'Type', minWidth: 120, cell: (a) => announcementTypeLabel(a.type) },
    {
      key: 'state',
      header: 'State',
      minWidth: 110,
      cell: (a) => <span className={pillClass(STATE_STYLE[a.display_state])}>{a.display_state}</span>,
    },
    { key: 'publish', header: 'Publish', minWidth: 140, cell: (a) => fmt(a.publish_at) },
    { key: 'expires', header: 'Expires', minWidth: 140, cell: (a) => fmt(a.expires_at) },
    {
      key: 'actions',
      header: 'Actions',
      align: 'right',
      minWidth: 190,
      cell: (a) =>
        writable ? (
          <div className="flex justify-end gap-2">
            {a.status === 'draft' && (
              <Button variant="ghost" size="sm" onClick={() => setStatus(a, 'published')}>
                Publish
              </Button>
            )}
            {a.status === 'published' && (
              <Button variant="ghost" size="sm" onClick={() => setStatus(a, 'archived')}>
                Archive
              </Button>
            )}
            {a.status === 'archived' && (
              <Button variant="ghost" size="sm" onClick={() => setStatus(a, 'published')}>
                Restore
              </Button>
            )}
            {a.status === 'draft' && (
              <Button variant="danger" size="sm" onClick={() => remove(a)}>
                Delete
              </Button>
            )}
          </div>
        ) : null,
    },
  ];

  return (
    <>
      <PageHeader
        title="Announcements"
        subtitle="Broadcasts that appear in every brand's Notifications inbox."
        action={writable ? <button className={buttonClass('primary', 'md')} onClick={() => setEditing('new')}>Compose</button> : undefined}
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4">
        <KpiTile label="Live now" value={counts.live ?? 0} />
        <KpiTile label="Scheduled" value={counts.scheduled ?? 0} />
        <KpiTile label="Drafts" value={counts.draft ?? 0} />
        <KpiTile label="Total" value={rows.length} />
      </div>

      {err && <div className="mb-4 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Tabs<Tab>
          active={tab}
          onChange={setTab}
          tabs={[
            { key: 'all', label: 'All', count: rows.length },
            { key: 'live', label: 'Live', count: counts.live ?? 0 },
            { key: 'scheduled', label: 'Scheduled', count: counts.scheduled ?? 0 },
            { key: 'draft', label: 'Draft', count: counts.draft ?? 0 },
            { key: 'expired', label: 'Expired', count: counts.expired ?? 0 },
            { key: 'archived', label: 'Archived', count: counts.archived ?? 0 },
          ]}
        />
        <Input className="max-w-xs" placeholder="Search title or body…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {loading ? (
        <div className={cardClass('p-10 text-center text-content-muted')}>Loading…</div>
      ) : visible.length === 0 ? (
        <EmptyState
          title={rows.length === 0 ? 'No announcements yet' : 'Nothing matches that filter'}
          hint={rows.length === 0 ? 'Compose one to broadcast it to every brand’s inbox.' : undefined}
        />
      ) : (
        <DataTable
          caption="Announcements and their publication state"
          mode="scroll"
          columns={columns}
          rows={visible}
          rowKey={(a) => a.id}
        />
      )}

      {editing && (
        <Compose
          existing={editing === 'new' ? null : editing}
          brands={brands}
          onClose={() => setEditing(null)}
          onSaved={() => { setEditing(null); load(); }}
        />
      )}
    </>
  );
}

function Compose({
  existing,
  brands,
  onClose,
  onSaved,
}: {
  existing: Announcement | null;
  brands: Brand[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [audience, setAudience] = useState<'all_brands' | 'single_brand'>(
    existing?.audience === 'single_brand' ? 'single_brand' : 'all_brands',
  );
  const [brandId, setBrandId] = useState(existing?.brand_id ?? '');
  const [type, setType] = useState<AnnouncementType>(existing?.type ?? 'announcement');
  const [title, setTitle] = useState(existing?.title ?? '');
  const [body, setBody] = useState(existing?.body ?? '');
  const [publishAt, setPublishAt] = useState(toLocalInput(existing?.publish_at ?? null));
  const [expiresAt, setExpiresAt] = useState(toLocalInput(existing?.expires_at ?? null));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  async function save(publish: boolean) {
    setErr('');
    setBusy(true);
    const payload = {
      audience,
      brand_id: audience === 'single_brand' ? brandId : null,
      type,
      title,
      body,
      publish_at: publishAt ? new Date(publishAt).toISOString() : null,
      expires_at: expiresAt ? new Date(expiresAt).toISOString() : null,
    };
    try {
      if (existing) {
        await api(`/api/admin/announcements/${existing.id}`, {
          method: 'PATCH',
          body: publish ? { ...payload, status: 'published' } : payload,
        });
      } else {
        const created = await api<{ id: string }>('/api/admin/announcements', { method: 'POST', body: payload });
        // Create always lands as a draft; publishing is a deliberate second call.
        if (publish) await api(`/api/admin/announcements/${created.id}`, { method: 'PATCH', body: { status: 'published' } });
      }
      onSaved();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Save failed');
      setBusy(false);
    }
  }

  const scheduled = publishAt && new Date(publishAt) > new Date();

  return (
    <Drawer
      open
      title={existing ? 'Edit announcement' : 'Compose announcement'}
      onOpenChange={(o) => { if (!o) onClose(); }}
      footer={
        <div className="flex gap-2">
          <button className={buttonClass('ghost', 'md', 'flex-1')} onClick={() => save(false)} disabled={busy || !title || !body}>
            {busy ? '…' : 'Save draft'}
          </button>
          <button className={buttonClass('primary', 'md', 'flex-1')} onClick={() => save(true)} disabled={busy || !title || !body || (audience === 'single_brand' && !brandId)}>
            {busy ? '…' : scheduled ? 'Schedule' : 'Publish now'}
          </button>
        </div>
      }
    >
      {err && <div className="mb-3 rounded-lg border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}

      <Field label="Audience">
        <select className={inputClass()} value={audience} onChange={(e) => setAudience(e.target.value as 'all_brands' | 'single_brand')}>
          <option value="all_brands">All brands</option>
          <option value="single_brand">A single brand</option>
        </select>
      </Field>

      {audience === 'single_brand' && (
        <Field label="Brand">
          <select className={inputClass()} value={brandId} onChange={(e) => setBrandId(e.target.value)}>
            <option value="">Select a brand…</option>
            {brands.map((b) => <option key={b.id} value={b.id}>{b.brand_name}</option>)}
          </select>
        </Field>
      )}

      <Field label="Type">
        <select className={inputClass()} value={type} onChange={(e) => setType(e.target.value as AnnouncementType)}>
          {ANNOUNCEMENT_TYPES.map((t) => <option key={t} value={t}>{announcementTypeLabel(t)}</option>)}
        </select>
      </Field>

      <Field label="Title"><Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} /></Field>
      <Field label="Body"><textarea className={inputClass('min-h-[120px]')} value={body} onChange={(e) => setBody(e.target.value)} maxLength={10000} /></Field>

      <div className="grid grid-cols-2 gap-3">
        <Field label="Publish at (blank = now)">
          <Input type="datetime-local" value={publishAt} onChange={(e) => setPublishAt(e.target.value)} />
        </Field>
        <Field label="Expires at (blank = never)">
          <Input type="datetime-local" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
        </Field>
      </div>

      {/* §1.3: "preview as it appears in the brand Notifications inbox" */}
      <div className="mt-4">
        <div className={labelClass('mb-1.5')}>Preview — as the brand sees it</div>
        <div className="rounded-xl border border-line bg-canvas p-3">
          <div className="flex items-start gap-2.5">
            <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-accent/15 text-sm">
              {type === 'restock' ? '📦' : type === 'maintenance' ? '🛠' : '📣'}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold text-content">{title || 'Untitled announcement'}</div>
              <div className="mt-0.5 whitespace-pre-wrap text-xs text-content-muted">{body || 'Body text appears here.'}</div>
              <div className="mt-1 text-2xs text-content-faint">
                {scheduled ? `Scheduled for ${new Date(publishAt).toLocaleString()}` : 'Just now'}
              </div>
            </div>
          </div>
        </div>
      </div>
    </Drawer>
  );
}
