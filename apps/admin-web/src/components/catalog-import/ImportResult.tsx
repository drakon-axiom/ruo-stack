import { Button, Card, Download, KpiTile } from '@ruostack/ui';
import { buildImportErrorCsv, type ImportRow } from '@ruostack/shared';
import { downloadText } from '../../lib/api.js';

export interface CommitRowResult {
  row: number;
  canonical_sku: string;
  result: 'created' | 'updated' | 'unchanged' | 'error';
  product_id: string | null;
  message?: string;
}

export interface CommitResult {
  summary: { created: number; updated: number; unchanged: number; errors: number };
  results: CommitRowResult[];
}

/**
 * What the import actually did. Rejected lines are listed with the number the
 * operator's spreadsheet shows, and downloadable as a CSV they can fix and
 * re-upload — matching by SKU makes a re-upload safely idempotent.
 */
export function ImportResult({
  result,
  previewRows,
  onDone,
}: {
  result: CommitResult;
  previewRows: ImportRow[];
  onDone: () => void;
}) {
  const failed = result.results.filter((r) => r.result === 'error');

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <KpiTile label="Created" value={result.summary.created} />
        <KpiTile label="Updated" value={result.summary.updated} />
        <KpiTile label="Unchanged" value={result.summary.unchanged} />
        <KpiTile label="Skipped" value={result.summary.errors} />
      </div>

      {result.summary.created > 0 && (
        <Card className="p-4 text-sm text-content-muted">
          New products were created as unpublished drafts. They stay out of every brand catalog until you publish them.
        </Card>
      )}

      {failed.length > 0 && (
        <Card className="p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">Lines that were not imported</h2>
            <Button
              variant="ghost"
              icon={Download}
              onClick={() => downloadText('catalog-import-errors.csv', buildImportErrorCsv(previewRows))}
            >
              Download as CSV
            </Button>
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {failed.map((r) => (
              <li key={r.row} className="flex flex-wrap gap-2">
                <span className="font-mono text-content-faint">line {r.row + 1}</span>
                <span className="font-mono">{r.canonical_sku || '—'}</span>
                <span className="text-danger">{r.message}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="flex gap-2">
        <Button onClick={onDone}>Back to catalog</Button>
      </div>
    </div>
  );
}
