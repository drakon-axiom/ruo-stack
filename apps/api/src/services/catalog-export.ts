import { buildCsv, IMPORT_COLUMNS } from '@ruostack/shared';

/**
 * Catalog CSV export.
 *
 * Two shapes, because one file cannot serve both needs. FORBIDDEN_COLUMNS keeps
 * status/is_published/archived out of imports -- lifecycle state is changed from
 * the catalog screen, never from a file -- so a snapshot containing them is
 * rejected by the importer. `import` shape therefore emits exactly
 * IMPORT_COLUMNS and feeds straight back in; `full` adds the lifecycle and
 * identity columns and is read-only by construction.
 *
 * Pure: no prisma, no fastify. The service layer queries; this maps.
 */
export type ExportShape = 'import' | 'full';

/** Import columns plus the ones the importer refuses. Order is stable so files diff cleanly. */
export const FULL_COLUMNS = [
  ...IMPORT_COLUMNS,
  'id',
  'status',
  'is_published',
  'archived',
  'created_at',
  'updated_at',
] as const;

/** The stored product, as the exporter needs to see it. */
export interface ExportableProduct {
  id: string;
  canonicalSku: string;
  name: string;
  compound: string;
  dose: string | null;
  unit: string | null;
  descriptionTemplate: string | null;
  wholesaleStarter: number;
  wholesalePro: number;
  wholesaleVolume: number;
  suggestedRetail: number;
  weight: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  packagingRule: string | null;
  coaId: string | null;
  images: string[];
  status: string;
  isPublished: boolean;
  archived: boolean;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Cents to plain dollars. MUST be the exact inverse of `dollarsToCents`, or an
 * untouched round trip would report an edit on every money column. Two decimals
 * always, no `$`, no thousands separators -- exactly what the parser accepts.
 */
export function centsToDollars(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Empty string, never the text "null" -- the importer reads '' as "leave alone". */
function text(v: string | null): string {
  return v ?? '';
}

function num(v: number | null): string {
  return v === null ? '' : String(v);
}

function importCells(p: ExportableProduct): string[] {
  return [
    p.canonicalSku,
    p.name,
    p.compound,
    text(p.dose),
    text(p.unit),
    text(p.descriptionTemplate),
    centsToDollars(p.wholesaleStarter),
    centsToDollars(p.wholesalePro),
    centsToDollars(p.wholesaleVolume),
    centsToDollars(p.suggestedRetail),
    num(p.weight),
    num(p.length),
    num(p.width),
    num(p.height),
    text(p.packagingRule),
    text(p.coaId),
    // Pipe-separated, matching the importer's `urls` parser.
    p.images.join('|'),
  ];
}

export function buildCatalogExportCsv(products: ExportableProduct[], shape: ExportShape): string {
  const header = shape === 'full' ? [...FULL_COLUMNS] : [...IMPORT_COLUMNS];
  const rows = products.map((p) =>
    shape === 'full'
      ? [
          ...importCells(p),
          p.id,
          p.status,
          String(p.isPublished),
          String(p.archived),
          p.createdAt.toISOString(),
          p.updatedAt.toISOString(),
        ]
      : importCells(p),
  );
  return buildCsv(header, rows);
}

/** Shape is in the name so the round-trippable file and the snapshot never get mixed up. */
export function exportFilename(shape: ExportShape, at: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp =
    `${at.getUTCFullYear()}${p(at.getUTCMonth() + 1)}${p(at.getUTCDate())}` +
    `-${p(at.getUTCHours())}${p(at.getUTCMinutes())}`;
  return `ruostack-catalog-${shape}-${stamp}.csv`;
}
