import { Badge, DataTable, type BadgeTone, type Column } from '@ruostack/ui';
import type { FieldChange, ImportAction, ImportColumn, ImportRow } from '@ruostack/shared';

/**
 * What the import WOULD do, line by line. Money is formatted here rather than
 * on the server: the API speaks storage units (cents) everywhere else too.
 */

const MONEY: readonly ImportColumn[] = ['wholesale_starter', 'wholesale_pro', 'wholesale_volume', 'suggested_retail'];

const ACTION_TONE: Record<ImportAction, BadgeTone> = {
  create: 'accent',
  update: 'warning',
  unchanged: 'success',
  error: 'danger',
};

const ACTION_LABEL: Record<ImportAction, string> = {
  create: 'New',
  update: 'Update',
  unchanged: 'No change',
  error: 'Error',
};

/** How many field diffs to show before collapsing, so a 2000-line table stays scannable. */
const MAX_CHANGES = 4;

function formatValue(field: ImportColumn, v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (Array.isArray(v)) return v.length === 0 ? '—' : `${v.length} image${v.length === 1 ? '' : 's'}`;
  if (MONEY.includes(field)) return `$${(Number(v) / 100).toFixed(2)}`;
  const s = String(v);
  return s.length > 60 ? `${s.slice(0, 57)}…` : s;
}

function ChangeLine({ change, isCreate }: { change: FieldChange; isCreate: boolean }) {
  return (
    <div className="flex flex-wrap items-baseline gap-1">
      <span className="text-2xs text-content-faint">{change.field}</span>
      {!isCreate && (
        <>
          <span className="text-content-faint line-through">{formatValue(change.field, change.from)}</span>
          <span aria-hidden className="text-content-faint">
            →
          </span>
        </>
      )}
      <span>{formatValue(change.field, change.to)}</span>
    </div>
  );
}

const COLUMNS: Column<ImportRow>[] = [
  {
    key: 'line',
    header: 'Line',
    mono: true,
    minWidth: 64,
    // +1 because the header occupies line 1 of the operator's spreadsheet.
    cell: (r) => <span className="text-content-faint">{r.row + 1}</span>,
  },
  {
    key: 'action',
    header: 'Action',
    minWidth: 110,
    cell: (r) => <Badge tone={ACTION_TONE[r.action]}>{ACTION_LABEL[r.action]}</Badge>,
  },
  {
    key: 'sku',
    header: 'SKU',
    priority: 'primary',
    mono: true,
    minWidth: 170,
    cell: (r) => <span className="text-accent-hover">{r.canonical_sku || '—'}</span>,
  },
  { key: 'name', header: 'Name', minWidth: 180, cell: (r) => r.name ?? '—' },
  {
    key: 'detail',
    header: 'Changes',
    minWidth: 300,
    cell: (r) => {
      if (r.action === 'error') {
        return (
          <div className="flex flex-col gap-0.5 text-danger">
            {r.errors.map((e, i) => (
              <div key={i}>
                {e.field ? <span className="text-2xs text-content-faint">{e.field}: </span> : null}
                {e.message}
              </div>
            ))}
          </div>
        );
      }
      if (r.changes.length === 0) return <span className="text-content-faint">Already matches</span>;
      const shown = r.changes.slice(0, MAX_CHANGES);
      return (
        <div className="flex flex-col gap-0.5">
          {shown.map((c) => (
            <ChangeLine key={c.field} change={c} isCreate={r.action === 'create'} />
          ))}
          {r.changes.length > shown.length && (
            <span className="text-2xs text-content-faint">+{r.changes.length - shown.length} more</span>
          )}
        </div>
      );
    },
  },
];

export function ImportPreviewTable({ rows, empty }: { rows: ImportRow[]; empty?: React.ReactNode }) {
  return (
    <DataTable
      caption="Every line in the uploaded file and what importing it would do"
      mode="scroll"
      columns={COLUMNS}
      rows={rows}
      rowKey={(r) => String(r.row)}
      empty={empty}
    />
  );
}
