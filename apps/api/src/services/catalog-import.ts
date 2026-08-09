import { createHash } from 'node:crypto';
import type { Prisma, PrismaClient } from '@ruostack/db';
import {
  AUDIT_ACTIONS,
  MAX_IMPORT_ROWS,
  classifyRow,
  detectDelimiter,
  mapHeaders,
  parseCsv,
  summarize,
  type ExistingProduct,
  type ImportColumn,
  type ImportRow,
  type ImportSummary,
} from '@ruostack/shared';
import { writeAudit } from '../audit.js';
import { BadRequest } from '../errors.js';

/**
 * CSV catalog import (docs/superpowers/specs/2026-08-09-catalog-csv-import-design.md).
 *
 * Preview is READ-ONLY: it classifies every line against the catalog and
 * returns what *would* happen. Commit re-runs the whole preview against fresh
 * state and refuses to write unless the result still matches the digest the
 * operator approved — the catalog can change between the two, and a stale
 * "update 900 → 950" must not become a blind overwrite of someone else's edit.
 * Same reasoning as store-preflight.ts, one layer up.
 */

/** Fields the classifier diffs against — never `status`, `isPublished` or `archived`. */
const EXISTING_SELECT = {
  id: true,
  canonicalSku: true,
  compound: true,
  dose: true,
  unit: true,
  name: true,
  descriptionTemplate: true,
  wholesaleStarter: true,
  wholesalePro: true,
  wholesaleVolume: true,
  suggestedRetail: true,
  isPublished: true,
  archived: true,
  weight: true,
  length: true,
  width: true,
  height: true,
  packagingRule: true,
  coaId: true,
  images: true,
} as const;

/** ImportColumn → Prisma field. The classifier already carries this mapping. */
const PRISMA_FIELD: Record<ImportColumn, keyof ExistingProduct> = {
  canonical_sku: 'canonicalSku',
  name: 'name',
  compound: 'compound',
  dose: 'dose',
  unit: 'unit',
  description_template: 'descriptionTemplate',
  wholesale_starter: 'wholesaleStarter',
  wholesale_pro: 'wholesalePro',
  wholesale_volume: 'wholesaleVolume',
  suggested_retail: 'suggestedRetail',
  weight: 'weight',
  length: 'length',
  width: 'width',
  height: 'height',
  packaging_rule: 'packagingRule',
  coa_id: 'coaId',
  images: 'images',
};

export interface PreviewResult {
  summary: ImportSummary;
  ignored_columns: string[];
  rows: ImportRow[];
  digest: string;
}

/** Classify a CSV against the catalog. Writes nothing. Throws BadRequest on a file-level problem. */
export async function buildPreview(prisma: PrismaClient, csv: string): Promise<PreviewResult> {
  const parsed = parseCsvOrThrow(csv);
  if (parsed.header.length === 0) {
    throw BadRequest('empty_file', 'That file has no content. Start from the template and add one line per product.');
  }

  const headers = mapHeaders(parsed.header);
  if (!headers.ok) {
    // A single-column header line usually means the file is not comma-separated.
    // Say which delimiter it actually uses rather than silently reinterpreting it.
    if (headers.code === 'missing_sku_column' && parsed.header.length === 1) {
      const found = detectDelimiter(parsed.header[0] ?? '');
      if (found !== null && found !== ',') {
        const label = found === ';' ? 'semicolon' : 'tab';
        throw BadRequest('bad_delimiter', `This file is ${label}-separated. Re-export it with commas and upload again.`);
      }
    }
    throw BadRequest(headers.code, headers.message);
  }

  if (parsed.rows.length > MAX_IMPORT_ROWS) {
    throw BadRequest(
      'too_many_rows',
      `That file has ${parsed.rows.length} lines; the importer takes ${MAX_IMPORT_ROWS} at a time. Split it and upload the parts.`,
    );
  }

  const skuAt = headers.index.canonical_sku!;
  const width = parsed.header.length;

  // Which data rows share a SKU? Case-insensitive: Postgres would happily hold
  // two products whose SKUs differ only by case, and they'd look identical.
  const byKey = new Map<string, number[]>();
  parsed.rows.forEach((cells, i) => {
    const key = (cells[skuAt] ?? '').trim().toLowerCase();
    if (key === '') return;
    byKey.set(key, [...(byKey.get(key) ?? []), i + 1]);
  });

  const skus = parsed.rows.map((cells) => (cells[skuAt] ?? '').trim()).filter((s) => s !== '');
  // Deliberately unfiltered on `archived`: an archived SKU must be REFUSED, not
  // treated as absent and silently re-created alongside the retired product.
  const found = await prisma.catalogProduct.findMany({
    where: { canonicalSku: { in: skus } },
    select: EXISTING_SELECT,
  });
  const existingBySku = new Map(found.map((p) => [p.canonicalSku.toLowerCase(), p as ExistingProduct]));

  const rows = parsed.rows.map((cells, i) => {
    const row = i + 1;
    const rawSku = (cells[skuAt] ?? '').trim();
    const key = rawSku.toLowerCase();
    return classifyRow({
      row,
      cells: cellsFor(headers.index, cells),
      existing: existingBySku.get(key) ?? null,
      duplicateOf: (byKey.get(key) ?? []).filter((r) => r !== row),
      extraCells: Math.max(0, cells.length - width),
    });
  });

  return { summary: summarize(rows), ignored_columns: headers.ignored, rows, digest: previewDigest(rows) };
}

function cellsFor(index: Partial<Record<ImportColumn, number>>, cells: string[]): Partial<Record<ImportColumn, string>> {
  const out: Partial<Record<ImportColumn, string>> = {};
  for (const [col, at] of Object.entries(index) as [ImportColumn, number][]) {
    // A short row leaves trailing cells undefined; that reads as blank, which
    // means "absent", not "clear this field".
    out[col] = cells[at] ?? '';
  }
  return out;
}

function parseCsvOrThrow(csv: string): { header: string[]; rows: string[][] } {
  try {
    return parseCsv(csv);
  } catch (e) {
    throw BadRequest('bad_csv', e instanceof Error ? e.message : 'That file could not be read as CSV.');
  }
}

/**
 * Fingerprints exactly what the operator approved: which line, which SKU, which
 * action, and every from → to. Including `from` is what catches a price edited
 * in the drawer mid-review; re-parsing the file catches a swapped upload.
 */
export function previewDigest(rows: ImportRow[]): string {
  const shape = rows.map((r) => [
    r.row,
    r.canonical_sku,
    r.action,
    r.changes.map((c) => `${c.field}:${JSON.stringify(c.from)}>${JSON.stringify(c.to)}`).sort(),
  ]);
  return `sha256:${createHash('sha256').update(JSON.stringify(shape)).digest('hex')}`;
}

export type CommitOutcome = 'created' | 'updated' | 'unchanged' | 'error';

export interface CommitRowResult {
  row: number;
  canonical_sku: string;
  result: CommitOutcome;
  product_id: string | null;
  message?: string;
}

export interface CommitResult {
  summary: { created: number; updated: number; unchanged: number; errors: number };
  results: CommitRowResult[];
}

const CHUNK = 50;

/**
 * Write the actionable rows. Chunked rather than one big transaction: row-level
 * failure isolation is the point, and a 2000-row transaction would hold locks
 * for the whole run. A chunk that fails is retried row by row so one bad row
 * cannot take its 49 neighbours down with it.
 */
export async function commitImport(
  prisma: PrismaClient,
  rows: ImportRow[],
  ctx: { adminUserId: string; ip: string; filename?: string },
): Promise<CommitResult> {
  const results: CommitRowResult[] = rows
    .filter((r) => r.action === 'unchanged' || r.action === 'error')
    .map((r) => ({
      row: r.row,
      canonical_sku: r.canonical_sku,
      result: r.action === 'unchanged' ? 'unchanged' : 'error',
      product_id: r.product_id,
      ...(r.action === 'error' ? { message: r.errors.map((e) => e.message).join(' ') } : {}),
    }));

  const actionable = rows.filter((r) => r.action === 'create' || r.action === 'update');
  for (let i = 0; i < actionable.length; i += CHUNK) {
    const chunk = actionable.slice(i, i + CHUNK);
    try {
      const done = await prisma.$transaction(async (tx) => {
        const out: CommitRowResult[] = [];
        for (const r of chunk) out.push(await writeRow(tx, r, ctx));
        return out;
      });
      results.push(...done);
    } catch {
      // Retry individually so the rest of the chunk still lands.
      for (const r of chunk) {
        try {
          results.push(await prisma.$transaction(async (tx) => writeRow(tx, r, ctx)));
        } catch (e) {
          results.push({
            row: r.row,
            canonical_sku: r.canonical_sku,
            result: 'error',
            product_id: null,
            message: writeErrorMessage(e, r.canonical_sku),
          });
        }
      }
    }
  }

  results.sort((a, b) => a.row - b.row);
  const summary = {
    created: results.filter((r) => r.result === 'created').length,
    updated: results.filter((r) => r.result === 'updated').length,
    unchanged: results.filter((r) => r.result === 'unchanged').length,
    errors: results.filter((r) => r.result === 'error').length,
  };

  // One aggregate row on top of the per-product ones, so "who ran an import,
  // when, from which file, and how big" is answerable in a single query.
  const touched = results.filter((r) => r.result === 'created' || r.result === 'updated');
  await writeAudit(prisma, {
    actorType: 'admin',
    actorId: ctx.adminUserId,
    action: AUDIT_ACTIONS.catalogImported,
    targetType: 'catalog_import',
    after: {
      filename: ctx.filename ?? null,
      total: rows.length,
      ...summary,
      skus: touched.slice(0, 100).map((r) => r.canonical_sku),
      skus_truncated: touched.length > 100,
    },
    ip: ctx.ip,
  });

  return { summary, results };
}

type Tx = Prisma.TransactionClient;

async function writeRow(tx: Tx, r: ImportRow, ctx: { adminUserId: string; ip: string }): Promise<CommitRowResult> {
  const data: Record<string, unknown> = { updatedBy: ctx.adminUserId };
  for (const c of r.changes) {
    if (c.field === 'canonical_sku') continue; // set explicitly on create, never on update
    data[PRISMA_FIELD[c.field]] = c.to;
  }

  if (r.action === 'create') {
    // No `status`, no `isPublished`: the schema defaults (soon / false) are what
    // make "an import never publishes" true by construction rather than by a
    // value someone could later edit into the payload.
    const p = await tx.catalogProduct.create({
      data: { ...data, canonicalSku: r.canonical_sku } as Prisma.CatalogProductUncheckedCreateInput,
    });
    await writeAudit(tx, {
      actorType: 'admin',
      actorId: ctx.adminUserId,
      action: AUDIT_ACTIONS.catalogCreated,
      targetType: 'catalog_product',
      targetId: p.id,
      after: snapshot(p),
      reason: 'csv_import',
      ip: ctx.ip,
    });
    return { row: r.row, canonical_sku: r.canonical_sku, result: 'created', product_id: p.id };
  }

  const before = await tx.catalogProduct.findUniqueOrThrow({ where: { id: r.product_id! } });
  const p = await tx.catalogProduct.update({ where: { id: r.product_id! }, data });
  await writeAudit(tx, {
    actorType: 'admin',
    actorId: ctx.adminUserId,
    action: AUDIT_ACTIONS.catalogUpdated,
    targetType: 'catalog_product',
    targetId: p.id,
    before: snapshot(before),
    after: snapshot(p),
    reason: 'csv_import',
    ip: ctx.ip,
  });
  return { row: r.row, canonical_sku: r.canonical_sku, result: 'updated', product_id: p.id };
}

function writeErrorMessage(e: unknown, sku: string): string {
  const code = (e as { code?: string }).code;
  if (code === 'P2002') return `'${sku}' was created by someone else while this import was running.`;
  return e instanceof Error ? e.message : 'This line could not be written.';
}

function snapshot(p: {
  canonicalSku: string;
  name: string;
  wholesaleStarter: number;
  wholesalePro: number;
  wholesaleVolume: number;
  suggestedRetail: number;
  status: string;
  isPublished: boolean;
}) {
  return {
    canonical_sku: p.canonicalSku,
    name: p.name,
    wholesale_starter: p.wholesaleStarter,
    wholesale_pro: p.wholesalePro,
    wholesale_volume: p.wholesaleVolume,
    suggested_retail: p.suggestedRetail,
    status: p.status,
    is_published: p.isPublished,
  };
}
