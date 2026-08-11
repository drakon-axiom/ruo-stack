import { buildCsv } from './csv.ts';

/**
 * The catalog CSV import contract, and all of its classification logic.
 *
 * Pure by design — no Prisma, no I/O. The caller parses the file, looks up the
 * existing products, and feeds one row at a time to `classifyRow`, exactly as
 * `provisioning.ts` hoists I/O out of `classifyProduct`. That is what makes the
 * rules that actually matter (blank never clears, dollars never silently round,
 * an import never publishes) testable without a database.
 *
 * Row numbering: `row` is the 1-based DATA row. Everything an operator reads —
 * error messages, the errors CSV, the preview table — shows `row + 1`, because
 * the header occupies line 1 of their spreadsheet.
 */

export const IMPORT_COLUMNS = [
  'canonical_sku',
  'name',
  'compound',
  'dose',
  'unit',
  'description_template',
  'wholesale_starter',
  'wholesale_pro',
  'wholesale_volume',
  'suggested_retail',
  'weight',
  'length',
  'width',
  'height',
  'packaging_rule',
  'coa_id',
  'images',
] as const;

export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/**
 * Columns the importer refuses to accept. Stock, publish and archive state are
 * lifecycle decisions made deliberately from the catalog screen — an import
 * that silently dropped a filled-in `status` column would let an operator read
 * "42 updated" and believe stock changed.
 */
export const FORBIDDEN_COLUMNS = [
  'status',
  'is_published',
  'published',
  'archived',
  'id',
  'updated_by',
  'created_at',
  'updated_at',
] as const;

/** Required to CREATE a product. Absent on update, so a price-only sheet works. */
export const REQUIRED_ON_CREATE: readonly ImportColumn[] = [
  'name',
  'compound',
  'wholesale_starter',
  'wholesale_pro',
  'wholesale_volume',
  'suggested_retail',
];

export const MAX_IMPORT_ROWS = 2000;
export const MAX_IMPORT_BYTES = 2_000_000;

/**
 * Deliberately tiny. `price`/`cost`/`msrp` are ambiguous across four money
 * columns, and guessing would file a number into the wrong tier; the
 * Download-template button is the answer to "what are the column names?".
 */
const HEADER_ALIASES: Record<string, ImportColumn> = {
  sku: 'canonical_sku',
  product_name: 'name',
  description: 'description_template',
};

type ColumnKind = 'string' | 'money' | 'number' | 'urls';

interface ColumnSpec {
  kind: ColumnKind;
  max?: number;
  /** The matching field on the stored product, for diffing. */
  existing: keyof ExistingProduct;
}

const COLUMN_SPEC: Record<ImportColumn, ColumnSpec> = {
  canonical_sku: { kind: 'string', max: 64, existing: 'canonicalSku' },
  name: { kind: 'string', max: 200, existing: 'name' },
  compound: { kind: 'string', max: 120, existing: 'compound' },
  dose: { kind: 'string', max: 60, existing: 'dose' },
  unit: { kind: 'string', max: 30, existing: 'unit' },
  description_template: { kind: 'string', max: 5000, existing: 'descriptionTemplate' },
  wholesale_starter: { kind: 'money', existing: 'wholesaleStarter' },
  wholesale_pro: { kind: 'money', existing: 'wholesalePro' },
  wholesale_volume: { kind: 'money', existing: 'wholesaleVolume' },
  suggested_retail: { kind: 'money', existing: 'suggestedRetail' },
  weight: { kind: 'number', existing: 'weight' },
  length: { kind: 'number', existing: 'length' },
  width: { kind: 'number', existing: 'width' },
  height: { kind: 'number', existing: 'height' },
  packaging_rule: { kind: 'string', max: 200, existing: 'packagingRule' },
  coa_id: { kind: 'string', max: 120, existing: 'coaId' },
  images: { kind: 'urls', existing: 'images' },
};

/** The stored product, as the classifier needs to see it. */
export interface ExistingProduct {
  id: string;
  canonicalSku: string;
  compound: string;
  dose: string | null;
  unit: string | null;
  name: string;
  descriptionTemplate: string | null;
  wholesaleStarter: number;
  wholesalePro: number;
  wholesaleVolume: number;
  suggestedRetail: number;
  isPublished: boolean;
  archived: boolean;
  weight: number | null;
  length: number | null;
  width: number | null;
  height: number | null;
  packagingRule: string | null;
  coaId: string | null;
  images: string[];
}

export type ImportAction = 'create' | 'update' | 'unchanged' | 'error';

export interface FieldChange {
  field: ImportColumn;
  /** Stored value, in storage units (cents for money). null on a create. */
  from: unknown;
  to: unknown;
}

export interface RowError {
  field: ImportColumn | null;
  code: string;
  message: string;
}

export interface ImportRow {
  row: number;
  canonical_sku: string;
  name: string | null;
  action: ImportAction;
  product_id: string | null;
  changes: FieldChange[];
  errors: RowError[];
}

export interface ImportSummary {
  total: number;
  create: number;
  update: number;
  unchanged: number;
  error: number;
}

// ── Headers ───────────────────────────────────────────────────────────────────

/** `"Canonical SKU"`, `canonical-sku`, `CANONICAL_SKU` all land on `canonical_sku`. */
export function normalizeHeader(raw: string): string {
  return raw
    .replace(/^﻿/, '')
    .trim()
    .replace(/^"(.*)"$/s, '$1')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^_+|_+$/g, '');
}

export type HeaderMapping =
  | { ok: true; index: Partial<Record<ImportColumn, number>>; ignored: string[] }
  | { ok: false; code: 'forbidden_column' | 'duplicate_column' | 'missing_sku_column'; message: string };

export function mapHeaders(header: string[]): HeaderMapping {
  const index: Partial<Record<ImportColumn, number>> = {};
  const ignored: string[] = [];
  const forbidden: string[] = [];
  const duplicated: string[] = [];

  header.forEach((raw, i) => {
    const key = normalizeHeader(raw);
    if (!key) return;
    if ((FORBIDDEN_COLUMNS as readonly string[]).includes(key)) {
      forbidden.push(raw.trim());
      return;
    }
    const col: ImportColumn | null =
      HEADER_ALIASES[key] ?? ((IMPORT_COLUMNS as readonly string[]).includes(key) ? (key as ImportColumn) : null);
    if (col === null) {
      ignored.push(raw.trim());
      return;
    }
    if (index[col] !== undefined) {
      duplicated.push(raw.trim());
      return;
    }
    index[col] = i;
  });

  if (forbidden.length > 0) {
    return {
      ok: false,
      code: 'forbidden_column',
      message: `This file has ${forbidden.length === 1 ? 'a column' : 'columns'} the importer will not accept: ${forbidden.join(', ')}. Stock, publish and archive state are changed from the catalog screen, never from an import. Remove ${forbidden.length === 1 ? 'it' : 'them'} and upload again.`,
    };
  }
  if (duplicated.length > 0) {
    return {
      ok: false,
      code: 'duplicate_column',
      message: `Two columns mean the same thing: ${duplicated.join(', ')}. Keep one of each and upload again.`,
    };
  }
  if (index.canonical_sku === undefined) {
    return {
      ok: false,
      code: 'missing_sku_column',
      message: 'No canonical_sku column. That column is how each line is matched to a product, so it is required.',
    };
  }
  return { ok: true, index, ignored };
}

/** The header-only file the Download-template button hands the operator. */
export function importTemplateCsv(): string {
  return buildCsv([...IMPORT_COLUMNS], []);
}

// ── Cells ─────────────────────────────────────────────────────────────────────

/**
 * "12.50" → 1250. A blank cell is ABSENT (`cents: null`), never zero — that is
 * the difference between "leave the price alone" and "give it away". Anything
 * with a third decimal place is an error, never a silent round.
 */
export function dollarsToCents(raw: string): { cents: number | null } | { error: string } {
  const trimmed = raw.trim();
  if (trimmed === '') return { cents: null };

  const s = (trimmed.startsWith('$') ? trimmed.slice(1) : trimmed).trim();
  if (!/^(\d+(\.\d*)?|\.\d+)$/.test(s)) {
    return { error: `'${trimmed}' is not a price. Use plain dollars such as 12.50 — no thousands separators.` };
  }
  const [whole = '', frac = ''] = s.split('.');
  if (frac.length > 2) {
    return { error: `'${trimmed}' has more than two decimal places, so it is not a whole number of cents.` };
  }
  return { cents: Number(whole || '0') * 100 + Number((frac + '00').slice(0, 2)) };
}

function coerce(col: ImportColumn, raw: string): { value: unknown } | { error: RowError } {
  const spec = COLUMN_SPEC[col];
  const v = raw.trim();

  switch (spec.kind) {
    case 'money': {
      const r = dollarsToCents(v);
      if ('error' in r) return { error: { field: col, code: 'bad_price', message: r.error } };
      return { value: r.cents };
    }
    case 'number': {
      if (!/^\d+(\.\d+)?$/.test(v)) {
        return { error: { field: col, code: 'bad_number', message: `'${v}' is not a number.` } };
      }
      return { value: Number(v) };
    }
    case 'urls': {
      const urls = v.split('|').map((u) => u.trim()).filter((u) => u !== '');
      for (const u of urls) {
        if (!isHttpUrl(u)) {
          return { error: { field: col, code: 'bad_url', message: `'${u}' is not a valid http(s) URL. Separate multiple images with |.` } };
        }
      }
      return { value: urls };
    }
    default: {
      if (spec.max !== undefined && v.length > spec.max) {
        return { error: { field: col, code: 'too_long', message: `This value is ${v.length} characters; the limit is ${spec.max}.` } };
      }
      return { value: v };
    }
  }
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}

// ── Classification ────────────────────────────────────────────────────────────

export interface ImportClassifyInput {
  /** 1-based data row. The operator sees `row + 1`. */
  row: number;
  /** Only the columns the header actually declared. */
  cells: Partial<Record<ImportColumn, string>>;
  /** Matched by canonical_sku, INCLUDING archived products. */
  existing: ExistingProduct | null;
  /** Other data rows carrying the same SKU. */
  duplicateOf: number[];
  /** How many cells beyond the header width this line carried. */
  extraCells?: number;
}

export function classifyRow(input: ImportClassifyInput): ImportRow {
  const { row, cells, existing, duplicateOf, extraCells = 0 } = input;
  const sku = (cells.canonical_sku ?? '').trim();
  const base = {
    row,
    canonical_sku: sku,
    name: (cells.name ?? '').trim() || existing?.name || null,
    product_id: existing?.id ?? null,
  };
  const fail = (errors: RowError[]): ImportRow => ({ ...base, action: 'error', changes: [], errors });

  // A line wider than its header is almost always an unquoted comma inside a
  // description, which shifts every later field by one — accepting it would
  // write a price into coa_id.
  if (extraCells > 0) {
    return fail([
      {
        field: null,
        code: 'extra_columns',
        message: `This line has ${extraCells} more value${extraCells === 1 ? '' : 's'} than the header declares. Check for an unquoted comma inside a value.`,
      },
    ]);
  }

  if (sku === '') {
    return fail([{ field: 'canonical_sku', code: 'required', message: 'Every line needs a canonical_sku — it is how the line is matched to a product.' }]);
  }
  if (sku.length > 64) {
    return fail([{ field: 'canonical_sku', code: 'too_long', message: `This SKU is ${sku.length} characters; the limit is 64.` }]);
  }
  if (duplicateOf.length > 0) {
    const lines = duplicateOf.map((r) => `line ${r + 1}`).join(', ');
    return fail([
      {
        field: 'canonical_sku',
        code: 'duplicate_sku',
        message: `'${sku}' also appears on ${lines}. Merge them into one line — importing both would silently discard one of them.`,
      },
    ]);
  }

  // Coerce every supplied cell, collecting ALL field errors so one pass through
  // the file is enough to fix it.
  const patch = new Map<ImportColumn, unknown>();
  const errors: RowError[] = [];
  for (const col of IMPORT_COLUMNS) {
    if (col === 'canonical_sku') continue; // the match key, never a change
    const raw = cells[col];
    if (raw === undefined) continue; // column not in the header
    if (raw.trim() === '') continue; // blank NEVER clears a stored value
    const r = coerce(col, raw);
    if ('error' in r) errors.push(r.error);
    else patch.set(col, r.value);
  }
  if (errors.length > 0) return fail(errors);

  if (existing?.archived) {
    return fail([
      {
        field: null,
        code: 'archived',
        message: `'${sku}' is archived. Restore it from the catalog before importing changes to it.`,
      },
    ]);
  }

  if (!existing) {
    const missing = REQUIRED_ON_CREATE.filter((c) => !patch.has(c));
    if (missing.length > 0) {
      return fail(
        missing.map((c) => ({
          field: c,
          code: 'required',
          message: `'${sku}' is a new product, so ${c} is required.`,
        })),
      );
    }
    return {
      ...base,
      action: 'create',
      changes: [
        { field: 'canonical_sku', from: null, to: sku },
        ...[...patch].map(([field, to]) => ({ field, from: null, to })),
      ],
      errors: [],
    };
  }

  const changes: FieldChange[] = [];
  for (const [field, to] of patch) {
    const from = existing[COLUMN_SPEC[field].existing];
    if (!sameValue(from, to)) changes.push({ field, from, to });
  }
  return { ...base, action: changes.length === 0 ? 'unchanged' : 'update', changes, errors: [] };
}

function sameValue(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => v === b[i]);
  }
  return a === b;
}

export function summarize(rows: ImportRow[]): ImportSummary {
  return {
    total: rows.length,
    create: rows.filter((r) => r.action === 'create').length,
    update: rows.filter((r) => r.action === 'update').length,
    unchanged: rows.filter((r) => r.action === 'unchanged').length,
    error: rows.filter((r) => r.action === 'error').length,
  };
}

/** One line per error, numbered the way the operator's spreadsheet numbers it. */
export function buildImportErrorCsv(rows: ImportRow[]): string {
  const out: unknown[][] = [];
  for (const r of rows) {
    for (const e of r.errors) out.push([r.row + 1, r.canonical_sku, e.field ?? '', e.message]);
  }
  return buildCsv(['line', 'canonical_sku', 'field', 'reason'], out);
}
