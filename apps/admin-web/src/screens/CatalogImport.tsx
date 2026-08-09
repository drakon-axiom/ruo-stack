import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_ROWS,
  canWrite,
  importTemplateCsv,
  type ImportAction,
  type ImportRow,
  type ImportSummary,
} from '@ruostack/shared';
import {
  Button,
  Card,
  Dialog,
  Download,
  InlineAlert,
  KpiTile,
  PageHeader,
  Tabs,
  Upload,
} from '@ruostack/ui';
import { ApiError, api, downloadText } from '../lib/api.js';
import { useAuth } from '../lib/auth.js';
import { ImportPreviewTable } from '../components/catalog-import/ImportPreviewTable.js';
import { ImportResult, type CommitResult } from '../components/catalog-import/ImportResult.js';

/**
 * Catalog CSV import: pick → preview → confirm → result.
 *
 * A page rather than a drawer because the preview is a wide table of up to
 * MAX_IMPORT_ROWS lines with per-field diffs. Nothing is written until the
 * operator confirms, and the server re-checks the preview before it writes.
 */

interface PreviewResponse {
  summary: ImportSummary;
  ignored_columns: string[];
  rows: ImportRow[];
  digest: string;
}

type Filter = 'all' | ImportAction;

export function CatalogImport() {
  const navigate = useNavigate();
  const { claims } = useAuth();
  const writable = claims ? canWrite(claims.role, 'catalog') : false;

  const fileRef = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState('');
  const [filename, setFilename] = useState('');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [warn, setWarn] = useState('');

  const rows = useMemo(
    () => (preview ? preview.rows.filter((r) => filter === 'all' || r.action === filter) : []),
    [preview, filter],
  );
  const actionable = preview ? preview.summary.create + preview.summary.update : 0;

  function reset() {
    setCsv('');
    setFilename('');
    setPreview(null);
    setResult(null);
    setFilter('all');
    setErr('');
    setWarn('');
    if (fileRef.current) fileRef.current.value = '';
  }

  async function onPick(file: File | undefined) {
    if (!file) return;
    setErr('');
    setWarn('');
    setResult(null);
    // Tell the operator before the upload, not after.
    if (file.size > MAX_IMPORT_BYTES) {
      setErr(`That file is ${(file.size / 1_000_000).toFixed(1)} MB; the importer takes up to ${MAX_IMPORT_BYTES / 1_000_000} MB. Split it and upload the parts.`);
      if (fileRef.current) fileRef.current.value = '';
      return;
    }

    setBusy(true);
    try {
      const text = await file.text();
      const res = await api<PreviewResponse>('/api/admin/catalog/import/preview', {
        method: 'POST',
        body: { csv: text, filename: file.name },
      });
      setCsv(text);
      setFilename(file.name);
      setPreview(res);
      setFilter('all');
    } catch (e) {
      setPreview(null);
      setErr(e instanceof ApiError ? e.message : 'That file could not be read.');
    } finally {
      setBusy(false);
      // Let the operator re-pick the same file after fixing it.
      if (fileRef.current) fileRef.current.value = '';
    }
  }

  async function onCommit() {
    if (!preview) return;
    setConfirming(false);
    setBusy(true);
    setErr('');
    setWarn('');
    try {
      const res = await api<CommitResult>('/api/admin/catalog/import/commit', {
        method: 'POST',
        body: { csv, filename, digest: preview.digest },
      });
      setResult(res);
    } catch (e) {
      // The catalog moved while this was being reviewed. Swap in the freshly
      // recomputed preview and make the operator look again rather than
      // overwriting whatever changed.
      if (e instanceof ApiError && e.code === 'preview_stale') {
        const fresh = (e.body as { preview?: PreviewResponse } | undefined)?.preview;
        if (fresh) setPreview(fresh);
        setWarn('The catalog changed while you were reviewing. This is what importing would do now — check it and import again.');
      } else {
        setErr(e instanceof ApiError ? e.message : 'The import could not be completed.');
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Import products"
        subtitle="Upload a CSV to add products and update existing ones. Lines are matched to products by canonical_sku."
        breadcrumbs={[{ label: 'Catalog Manager', to: '/catalog' }, { label: 'Import' }]}
        action={
          preview && !result ? (
            <Button variant="ghost" onClick={reset}>
              Choose a different file
            </Button>
          ) : undefined
        }
      />

      {!writable && (
        <InlineAlert tone="warning">Your role can view the catalog but not change it, so importing is disabled.</InlineAlert>
      )}
      {err && <div className="mb-4"><InlineAlert tone="danger">{err}</InlineAlert></div>}
      {warn && <div className="mb-4"><InlineAlert tone="warning">{warn}</InlineAlert></div>}

      {result ? (
        <ImportResult result={result} previewRows={preview?.rows ?? []} onDone={() => navigate('/catalog')} />
      ) : preview ? (
        <>
          {preview.ignored_columns.length > 0 && (
            <div className="mb-4">
              <InlineAlert tone="warning">
                {`These columns were ignored: ${preview.ignored_columns.join(', ')}. Check for a misspelled heading before importing.`}
              </InlineAlert>
            </div>
          )}

          <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <KpiTile label="New products" value={preview.summary.create} />
            <KpiTile label="Updates" value={preview.summary.update} />
            <KpiTile label="No change" value={preview.summary.unchanged} />
            <KpiTile label="Errors" value={preview.summary.error} />
          </div>

          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <Tabs<Filter>
              active={filter}
              onChange={setFilter}
              tabs={[
                { key: 'all', label: 'All', count: preview.summary.total },
                { key: 'create', label: 'New', count: preview.summary.create },
                { key: 'update', label: 'Updates', count: preview.summary.update },
                { key: 'unchanged', label: 'No change', count: preview.summary.unchanged },
                { key: 'error', label: 'Errors', count: preview.summary.error },
              ]}
            />
            <Button disabled={!writable || busy || actionable === 0} loading={busy} onClick={() => setConfirming(true)}>
              Import {actionable} line{actionable === 1 ? '' : 's'}
            </Button>
          </div>

          <ImportPreviewTable rows={rows} empty={<span className="text-content-faint">No lines in this group.</span>} />

          <p className="mt-3 text-2xs text-content-faint">
            {`${filename} — nothing has been written yet.`}
          </p>
        </>
      ) : (
        <Card className="flex flex-col gap-4 p-5">
          <div>
            <h2 className="text-sm font-semibold">Choose a CSV file</h2>
            <p className="mt-1 text-sm text-content-muted">
              {`Up to ${MAX_IMPORT_ROWS} lines. You will see exactly what would change before anything is written.`}
            </p>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button icon={Upload} disabled={!writable || busy} loading={busy} onClick={() => fileRef.current?.click()}>
              Choose file
            </Button>
            <Button
              variant="ghost"
              icon={Download}
              onClick={() => downloadText('ruostack-catalog-template.csv', importTemplateCsv())}
            >
              Download template
            </Button>
            <input
              ref={fileRef}
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              aria-label="Product CSV file"
              onChange={(e) => void onPick(e.target.files?.[0])}
            />
          </div>

          <ul className="flex list-disc flex-col gap-1 pl-5 text-2xs text-content-faint">
            <li>Lines are matched by canonical_sku — a SKU we do not have is created, one we do have is updated.</li>
            <li>Prices are dollars, like 12.50.</li>
            <li>A blank cell leaves the stored value alone; it never clears it.</li>
            <li>New products arrive as unpublished drafts. An import never publishes anything or changes stock status.</li>
          </ul>
        </Card>
      )}

      <Dialog
        open={confirming}
        onOpenChange={setConfirming}
        title="Import these products?"
        description={
          preview
            ? `${preview.summary.create} new, ${preview.summary.update} updated${preview.summary.error > 0 ? `, ${preview.summary.error} skipped` : ''}.`
            : undefined
        }
        footer={
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirming(false)}>
              Cancel
            </Button>
            <Button loading={busy} onClick={() => void onCommit()}>
              Import
            </Button>
          </div>
        }
      >
        <p className="text-sm text-content-muted">
          New products are created as unpublished drafts and stay out of every brand catalog until you publish them.
          Existing products keep their current stock and publish state.
        </p>
      </Dialog>
    </>
  );
}
