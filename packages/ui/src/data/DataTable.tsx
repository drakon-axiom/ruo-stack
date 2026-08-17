import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '../lib/cn.js';
import { Card } from '../primitives/Card.js';
import { Checkbox } from '../primitives/Checkbox.js';
import { SkeletonRows } from '../primitives/Skeleton.js';
import { useMediaQuery } from '../hooks/useMediaQuery.js';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => ReactNode;
  /** Drives the mobile card layout: `primary` becomes the card title, `meta`
   *  the subtitle, everything else a label/value row. Defaults to secondary. */
  priority?: 'primary' | 'secondary' | 'meta';
  align?: 'left' | 'right';
  mono?: boolean;
  /** Scroll mode only — keeps a column from collapsing when the table is wider
   *  than the viewport. */
  minWidth?: number;
}

export interface DataTableProps<T> {
  columns: Column<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  /** Visually hidden, but required — it is the table's accessible name. */
  caption: string;
  /** Mobile rendering. `cards` stacks each row; `scroll` keeps the real table
   *  behind a horizontal scroller with a pinned first column. */
  mode?: 'cards' | 'scroll';
  loading?: boolean;
  empty?: ReactNode;
  onRowClick?: (row: T) => void;
  /** Adds a leading checkbox column (and per-card checkboxes on mobile). */
  selectable?: boolean;
  /** Controlled selection, keyed by `rowKey`. */
  selectedKeys?: ReadonlySet<string>;
  onSelectionChange?: (keys: Set<string>) => void;
  /** Accessible name for a row's checkbox. Defaults to the row key, which is
   *  unique but rarely meaningful — pass something human where you can. */
  selectionLabel?: (row: T) => string;
}

const cellClass = <T,>(c: Column<T>) =>
  cn('px-4 py-3', c.align === 'right' && 'text-right', c.mono && 'font-mono tabular-nums');

/** Stop a checkbox click from also triggering the row's own click/keyboard
 *  handler — rows open the edit drawer, which would make selection unusable. */
const swallow = {
  onClick: (e: { stopPropagation: () => void }) => e.stopPropagation(),
  onKeyDown: (e: { stopPropagation: () => void }) => e.stopPropagation(),
};

export function DataTable<T>({
  columns,
  rows,
  rowKey,
  caption,
  mode = 'cards',
  loading = false,
  empty,
  onRowClick,
  selectable = false,
  selectedKeys,
  onSelectionChange,
  selectionLabel,
}: DataTableProps<T>) {
  const isDesktop = useMediaQuery('(min-width: 768px)');

  const selected = selectedKeys ?? new Set<string>();
  const isSelected = (row: T) => selected.has(rowKey(row));
  const labelFor = (row: T) => selectionLabel?.(row) ?? `Select ${rowKey(row)}`;

  function toggleRow(row: T) {
    const next = new Set(selected);
    const key = rowKey(row);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    onSelectionChange?.(next);
  }

  // "All" means every row currently rendered — not every row that exists behind
  // a filter or page. Clearing wins when everything visible is already checked.
  const allSelected = rows.length > 0 && rows.every(isSelected);
  const someSelected = !allSelected && rows.some(isSelected);

  function toggleAll() {
    onSelectionChange?.(allSelected ? new Set() : new Set(rows.map(rowKey)));
  }

  if (loading) {
    return (
      <Card>
        <SkeletonRows count={5} />
      </Card>
    );
  }
  if (rows.length === 0) return <>{empty ?? null}</>;

  // ---- Mobile card mode ----------------------------------------------------
  if (!isDesktop && mode === 'cards') {
    const primary = columns.find((c) => c.priority === 'primary') ?? columns[0]!;
    const meta = columns.filter((c) => c.priority === 'meta');
    const rest = columns.filter((c) => c !== primary && c.priority !== 'meta');

    return (
      <div className="space-y-2">
        {rows.map((row) => (
          <Card
            key={rowKey(row)}
            {...(onRowClick && {
              role: 'button',
              tabIndex: 0,
              onClick: () => onRowClick(row),
              onKeyDown: (e: KeyboardEvent) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  onRowClick(row);
                }
              },
            })}
            className={cn('p-4', onRowClick && 'cursor-pointer')}
          >
            <div className="flex items-start gap-3">
              {selectable && (
                <span className="pt-0.5" {...swallow}>
                  <Checkbox
                    checked={isSelected(row)}
                    onCheckedChange={() => toggleRow(row)}
                    label={labelFor(row)}
                    hideLabel
                  />
                </span>
              )}
              <div className="min-w-0 flex-1 text-base font-semibold text-content">{primary.cell(row)}</div>
            </div>

            {meta.length > 0 && (
              <div className="mt-0.5 text-xs text-content-muted">
                {meta.map((c) => (
                  <span key={c.key} className="mr-2">
                    {c.cell(row)}
                  </span>
                ))}
              </div>
            )}

            <dl className="mt-3 space-y-1.5">
              {rest.map((c) => (
                <div key={c.key} className="flex items-center justify-between gap-3">
                  <dt className="text-2xs uppercase tracking-[0.1em] text-content-faint">{c.header}</dt>
                  <dd className={cn('text-sm text-content', c.mono && 'font-mono tabular-nums')}>
                    {c.cell(row)}
                  </dd>
                </div>
              ))}
            </dl>
          </Card>
        ))}
      </div>
    );
  }

  // ---- Table mode (desktop, and mobile when mode="scroll") -----------------
  return (
    <Card className={cn('overflow-hidden', !isDesktop && 'overflow-x-auto')}>
      <table className="w-full border-collapse text-sm">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr className="border-b border-line text-left">
            {selectable && (
              <th scope="col" className="w-px px-4 py-3">
                <Checkbox
                  checked={allSelected}
                  indeterminate={someSelected}
                  onCheckedChange={toggleAll}
                  label="Select all"
                  hideLabel
                />
              </th>
            )}
            {columns.map((c, i) => (
              <th
                key={c.key}
                scope="col"
                style={c.minWidth ? { minWidth: c.minWidth } : undefined}
                className={cn(
                  'px-4 py-3 text-2xs uppercase tracking-[0.1em] text-content-faint',
                  c.align === 'right' && 'text-right',
                  // Pin the identity column while the rest scrolls sideways. The
                  // checkbox column is deliberately NOT the pinned one — the SKU
                  // is what an operator needs to keep in view while scrolling.
                  !isDesktop && i === 0 && 'sticky left-0 bg-surface-2',
                )}
              >
                {c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              {...(onRowClick && {
                tabIndex: 0,
                onClick: () => onRowClick(row),
                onKeyDown: (e: KeyboardEvent) => {
                  if (e.key === 'Enter') onRowClick(row);
                },
              })}
              className={cn(
                'border-b border-line-subtle transition-colors duration-fast last:border-0',
                onRowClick && 'cursor-pointer hover:bg-surface-3',
                isSelected(row) && 'bg-accent/[0.06]',
              )}
            >
              {selectable && (
                <td className="w-px px-4 py-3" {...swallow}>
                  <Checkbox
                    checked={isSelected(row)}
                    onCheckedChange={() => toggleRow(row)}
                    label={labelFor(row)}
                    hideLabel
                  />
                </td>
              )}
              {columns.map((c, i) => (
                <td
                  key={c.key}
                  className={cn(cellClass(c), !isDesktop && i === 0 && 'sticky left-0 bg-surface-1')}
                >
                  {c.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
