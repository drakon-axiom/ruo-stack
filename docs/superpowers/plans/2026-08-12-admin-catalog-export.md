# Admin Catalog Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let an admin download the catalog as CSV — in a shape that feeds straight back into the existing importer, or as a full snapshot for reporting.

**Architecture:** A server route `GET /api/admin/catalog/export.csv`, shaped after the existing `GET /api/admin/ledger/export.csv`. A pure CSV builder in `apps/api/src/services/`, a shared where-clause helper so the list and export routes cannot drift, one aggregate audit row per export, and two buttons in `Catalog.tsx` calling the already-present `apiDownload`.

**Tech Stack:** TypeScript (ESM, run from source under Node type-stripping), Fastify, Prisma, zod, vitest, React + Vite.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-12-admin-catalog-export-design.md`.
- Relative imports use **`.ts` extensions** (`from './foo.ts'`). This repo runs from TypeScript source; `.js` specifiers do not resolve.
- **No parameter properties, enums or namespaces** anywhere in `apps/api` — `erasableSyntaxOnly` is on and Node strips types at load. Use explicit fields.
- `IMPORT_COLUMNS` has exactly 17 entries, in this order: `canonical_sku, name, compound, dose, unit, description_template, wholesale_starter, wholesale_pro, wholesale_volume, suggested_retail, weight, length, width, height, packaging_rule, coa_id, images`.
- `MAX_IMPORT_ROWS = 2000`.
- Money is stored in **cents** (`Int`) and rendered in CSV as **plain dollars with two decimals**, no `$`, no thousands separators — the inverse of `dollarsToCents`.
- `images` is a `string[]`, serialised **pipe-separated** (`a|b`), matching the importer's `urls` parser.
- Never emit `status`, `is_published`, `archived`, `id`, `updated_by`, `created_at` or `updated_at` in the **import** shape — they are in `FORBIDDEN_COLUMNS` and would make the file unimportable.
- Run commands from `/apps/prod/ruo-stack`.

---

## File Structure

| File | Responsibility |
|---|---|
| `apps/api/src/services/catalog-export.ts` *(create)* | Pure: `centsToDollars`, `FULL_COLUMNS`, `buildCatalogExportCsv`, `exportFilename`. No I/O. |
| `apps/api/test/unit/catalog-export.test.ts` *(create)* | Unit tests for the builder, including the round-trip property. |
| `apps/api/src/services/catalog-query.ts` *(create)* | `CatalogListQuery` zod schema + `catalogListWhere(q)`. The single filter definition. |
| `apps/api/test/unit/catalog-query.test.ts` *(create)* | Unit tests for the where-builder. |
| `apps/api/src/routes/admin-catalog.ts` *(modify)* | Use `catalogListWhere` in the list route; add the export route. |
| `packages/shared/src/audit.ts` *(modify)* | Add `catalogExported`. |
| `apps/admin-web/src/screens/Catalog.tsx` *(modify)* | Two export buttons + over-ceiling warning. |

---

### Task 1: Pure CSV builder

**Files:**
- Create: `apps/api/src/services/catalog-export.ts`
- Test: `apps/api/test/unit/catalog-export.test.ts`

**Interfaces:**
- Consumes: `buildCsv`, `parseCsv`, `IMPORT_COLUMNS`, `dollarsToCents`, `classifyRow`, `type ImportColumn`, `type ExistingProduct` — all from `@ruostack/shared`.
- Produces:
  - `type ExportShape = 'import' | 'full'`
  - `centsToDollars(cents: number): string`
  - `FULL_COLUMNS: readonly string[]`
  - `interface ExportableProduct` (field list below)
  - `buildCatalogExportCsv(products: ExportableProduct[], shape: ExportShape): string`
  - `exportFilename(shape: ExportShape, at: Date): string`

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/unit/catalog-export.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { classifyRow, dollarsToCents, IMPORT_COLUMNS, parseCsv, type ExistingProduct, type ImportColumn } from '@ruostack/shared';
import {
  buildCatalogExportCsv,
  centsToDollars,
  exportFilename,
  FULL_COLUMNS,
  type ExportableProduct,
} from '../../src/services/catalog-export.ts';

const product: ExportableProduct = {
  id: '11111111-1111-4111-8111-111111111111',
  canonicalSku: 'BPC-157-5MG',
  name: 'BPC-157 5mg',
  compound: 'BPC-157',
  dose: '5',
  unit: 'mg',
  descriptionTemplate: 'Research peptide, 5mg vial',
  wholesaleStarter: 1250,
  wholesalePro: 1100,
  wholesaleVolume: 950,
  suggestedRetail: 2999,
  weight: 0.05,
  length: 3,
  width: 2,
  height: 1,
  packagingRule: 'vial-box',
  coaId: 'COA-123',
  images: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'],
  status: 'in_stock',
  isPublished: true,
  archived: false,
  createdAt: new Date('2026-07-01T10:00:00Z'),
  updatedAt: new Date('2026-07-02T11:30:00Z'),
};

/** The stored product as classifyRow needs to see it. */
const existing: ExistingProduct = {
  id: product.id,
  canonicalSku: product.canonicalSku,
  compound: product.compound,
  dose: product.dose,
  unit: product.unit,
  name: product.name,
  descriptionTemplate: product.descriptionTemplate,
  wholesaleStarter: product.wholesaleStarter,
  wholesalePro: product.wholesalePro,
  wholesaleVolume: product.wholesaleVolume,
  suggestedRetail: product.suggestedRetail,
  isPublished: product.isPublished,
  archived: product.archived,
  weight: product.weight,
  length: product.length,
  width: product.width,
  height: product.height,
  packagingRule: product.packagingRule,
  coaId: product.coaId,
  images: product.images,
};

function cellsFrom(csv: string): Partial<Record<ImportColumn, string>> {
  const { header, rows } = parseCsv(csv);
  const cells: Partial<Record<ImportColumn, string>> = {};
  header.forEach((h, i) => {
    cells[h as ImportColumn] = rows[0]?.[i] ?? '';
  });
  return cells;
}

describe('centsToDollars', () => {
  // Must be the exact inverse of dollarsToCents or an untouched round trip
  // would show as an edit on every money column.
  it.each([0, 5, 99, 100, 1250, 2999, 100_000_00])('round-trips %i cents', (cents) => {
    const rendered = centsToDollars(cents);
    expect(dollarsToCents(rendered)).toEqual({ cents });
  });

  it('always emits two decimal places', () => {
    expect(centsToDollars(1200)).toBe('12.00');
    expect(centsToDollars(5)).toBe('0.05');
  });
});

describe('buildCatalogExportCsv — import shape', () => {
  it('emits exactly IMPORT_COLUMNS, in order', () => {
    const { header } = parseCsv(buildCatalogExportCsv([product], 'import'));
    expect(header).toEqual([...IMPORT_COLUMNS]);
  });

  it('emits no forbidden column', () => {
    const { header } = parseCsv(buildCatalogExportCsv([product], 'import'));
    for (const banned of ['status', 'is_published', 'archived', 'id', 'created_at', 'updated_at']) {
      expect(header).not.toContain(banned);
    }
  });

  // THE LOAD-BEARING TEST. Proves the two halves agree, rather than asserting
  // a belief that they do. Fails loudly if a column is added to one side only.
  it('round-trips: an untouched export re-imports as unchanged', () => {
    const csv = buildCatalogExportCsv([product], 'import');
    const row = classifyRow({ row: 1, cells: cellsFrom(csv), existing, duplicateOf: [] });
    expect(row.action).toBe('unchanged');
    expect(row.errors ?? []).toEqual([]);
  });

  it('serialises images pipe-separated so the urls parser reads them back', () => {
    const csv = buildCatalogExportCsv([product], 'import');
    expect(csv).toContain('https://cdn.example.com/a.png|https://cdn.example.com/b.png');
  });

  it('renders empty strings for null optional fields, not the text "null"', () => {
    const bare: ExportableProduct = { ...product, dose: null, unit: null, descriptionTemplate: null, weight: null, length: null, width: null, height: null, packagingRule: null, coaId: null, images: [] };
    const { rows } = parseCsv(buildCatalogExportCsv([bare], 'import'));
    expect(rows[0]).not.toContain('null');
    expect(rows[0]?.[IMPORT_COLUMNS.indexOf('dose')]).toBe('');
  });

  it('quotes a value containing a comma so it cannot shift the columns', () => {
    const csv = buildCatalogExportCsv([{ ...product, name: 'BPC-157, 5mg' }], 'import');
    expect(csv).toContain('"BPC-157, 5mg"');
    const { rows } = parseCsv(csv);
    expect(rows[0]?.[IMPORT_COLUMNS.indexOf('name')]).toBe('BPC-157, 5mg');
  });

  it('emits a header even with no products, so an empty filter still yields a valid file', () => {
    expect(parseCsv(buildCatalogExportCsv([], 'import')).header).toEqual([...IMPORT_COLUMNS]);
    expect(parseCsv(buildCatalogExportCsv([], 'import')).rows).toEqual([]);
  });
});

describe('buildCatalogExportCsv — full shape', () => {
  it('adds lifecycle and identity columns after the import ones', () => {
    const { header } = parseCsv(buildCatalogExportCsv([product], 'full'));
    expect(header).toEqual([...FULL_COLUMNS]);
    expect(header.slice(0, IMPORT_COLUMNS.length)).toEqual([...IMPORT_COLUMNS]);
    for (const extra of ['id', 'status', 'is_published', 'archived', 'created_at', 'updated_at']) {
      expect(header).toContain(extra);
    }
  });

  it('renders booleans and timestamps in stable, parseable forms', () => {
    const { header, rows } = parseCsv(buildCatalogExportCsv([product], 'full'));
    const at = (c: string) => rows[0]?.[header.indexOf(c)];
    expect(at('is_published')).toBe('true');
    expect(at('archived')).toBe('false');
    expect(at('status')).toBe('in_stock');
    expect(at('created_at')).toBe('2026-07-01T10:00:00.000Z');
  });
});

describe('exportFilename', () => {
  it('carries the shape so the two files are never confused after download', () => {
    const at = new Date('2026-08-12T16:42:00Z');
    expect(exportFilename('import', at)).toBe('ruostack-catalog-import-20260812-1642.csv');
    expect(exportFilename('full', at)).toBe('ruostack-catalog-full-20260812-1642.csv');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ruostack/api exec vitest run test/unit/catalog-export.test.ts`
Expected: FAIL — cannot resolve `../../src/services/catalog-export.ts`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/services/catalog-export.ts`:

```ts
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
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ruostack/api exec vitest run test/unit/catalog-export.test.ts`
Expected: PASS, all tests green.

If the round-trip test fails, read which field `classifyRow` reported as changed — that names the column whose rendering disagrees with the parser. Do not "fix" it by loosening the assertion.

- [ ] **Step 5: Commit**

```bash
git add apps/api/src/services/catalog-export.ts apps/api/test/unit/catalog-export.test.ts
git commit -m "Add the pure catalog export CSV builder"
```

---

### Task 2: Single filter definition

**Files:**
- Create: `apps/api/src/services/catalog-query.ts`
- Create: `apps/api/test/unit/catalog-query.test.ts`
- Modify: `apps/api/src/routes/admin-catalog.ts:27-53` (the list route)

**Interfaces:**
- Consumes: `CatalogStatusEnum` from `@ruostack/shared` (defined in `packages/shared/src/dto.ts:55` as `z.enum(['in_stock','soon','out_of_stock'])`).
- Produces:
  - `CatalogListQuery` — zod schema with `status?`, `search?`, `archived?`
  - `type CatalogListQueryInput = z.infer<typeof CatalogListQuery>`
  - `catalogListWhere(q: CatalogListQueryInput): Prisma.CatalogProductWhereInput`

Why: the export must return exactly the rows on screen, so the screen's status and search filters reach the server. Two hand-written copies of that where-clause will drift; this makes drift impossible.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/unit/catalog-query.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { catalogListWhere, CatalogListQuery } from '../../src/services/catalog-query.ts';

describe('catalogListWhere', () => {
  it('hides archived products unless explicitly asked for', () => {
    expect(catalogListWhere({}).archived).toBe(false);
    expect(catalogListWhere({ archived: 'false' }).archived).toBe(false);
    expect(catalogListWhere({ archived: 'true' }).archived).toBe(true);
  });

  it('omits the status clause entirely when no status is given', () => {
    expect(catalogListWhere({})).not.toHaveProperty('status');
    expect(catalogListWhere({ status: 'in_stock' }).status).toBe('in_stock');
  });

  it('searches name, canonical SKU and compound, case-insensitively', () => {
    const where = catalogListWhere({ search: 'bpc' });
    expect(where.OR).toEqual([
      { name: { contains: 'bpc', mode: 'insensitive' } },
      { canonicalSku: { contains: 'bpc', mode: 'insensitive' } },
      { compound: { contains: 'bpc', mode: 'insensitive' } },
    ]);
  });

  it('omits the search clause when the term is absent', () => {
    expect(catalogListWhere({})).not.toHaveProperty('OR');
  });

  it('accepts the query shape the screen sends', () => {
    const parsed = CatalogListQuery.parse({ status: 'soon', search: 'x', archived: 'true' });
    expect(parsed).toEqual({ status: 'soon', search: 'x', archived: 'true' });
  });

  it('rejects an over-long search term', () => {
    expect(() => CatalogListQuery.parse({ search: 'x'.repeat(121) })).toThrow();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ruostack/api exec vitest run test/unit/catalog-query.test.ts`
Expected: FAIL — cannot resolve `../../src/services/catalog-query.ts`.

- [ ] **Step 3: Write the implementation**

Create `apps/api/src/services/catalog-query.ts`:

```ts
import type { Prisma } from '@ruostack/db';
import { z } from 'zod';
import { CatalogStatusEnum } from '@ruostack/shared';

/**
 * The one definition of "which catalog rows".
 *
 * The catalog screen filters client-side, so an export that must match the
 * visible table has to send those filters to the server. Two hand-written
 * copies of this where-clause would drift, and the symptom would be an export
 * quietly disagreeing with the table it was taken from -- so the list route and
 * the export route both call this.
 */
export const CatalogListQuery = z.object({
  status: CatalogStatusEnum.optional(),
  search: z.string().max(120).optional(),
  // Archived products are retired: hidden unless explicitly asked for.
  archived: z.enum(['true', 'false']).optional(),
});

export type CatalogListQueryInput = z.infer<typeof CatalogListQuery>;

export function catalogListWhere(q: CatalogListQueryInput): Prisma.CatalogProductWhereInput {
  return {
    archived: q.archived === 'true',
    ...(q.status ? { status: q.status } : {}),
    ...(q.search
      ? {
          OR: [
            { name: { contains: q.search, mode: 'insensitive' } },
            { canonicalSku: { contains: q.search, mode: 'insensitive' } },
            { compound: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ruostack/api exec vitest run test/unit/catalog-query.test.ts`
Expected: PASS.

- [ ] **Step 5: Point the list route at the helper**

In `apps/api/src/routes/admin-catalog.ts`, replace the body of the list route's query parsing and `where` with the helper. The route becomes:

```ts
  app.get('/api/admin/catalog', { preHandler: requireAdmin('catalog', 'view') }, async (req) => {
    const q = CatalogListQuery.parse(req.query);
    const products = await prisma.catalogProduct.findMany({
      where: catalogListWhere(q),
      orderBy: { createdAt: 'desc' },
    });
    return { products };
  });
```

Add to the imports at the top of the file:

```ts
import { catalogListWhere, CatalogListQuery } from '../services/catalog-query.ts';
```

Remove the now-unused inline zod object. Leave every other route in the file untouched.

- [ ] **Step 6: Verify nothing regressed**

Run: `pnpm --filter @ruostack/api exec vitest run && pnpm typecheck`
Expected: all suites PASS, typecheck clean. The list route's behaviour is unchanged by construction — the helper is a verbatim extraction.

- [ ] **Step 6: Commit**

```bash
git add apps/api/src/services/catalog-query.ts apps/api/test/unit/catalog-query.test.ts apps/api/src/routes/admin-catalog.ts
git commit -m "Extract the catalog filter into one definition shared by list and export"
```

---

### Task 3: The export route

**Files:**
- Modify: `packages/shared/src/audit.ts` (add one action)
- Modify: `apps/api/src/routes/admin-catalog.ts` (add the route)
- Test: `apps/api/test/unit/catalog-export.test.ts` (extend)

**Interfaces:**
- Consumes: `buildCatalogExportCsv`, `exportFilename`, `type ExportShape` (Task 1); `catalogListWhere`, `CatalogListQuery` (Task 2); `writeAudit` from `../audit.ts`; `AUDIT_ACTIONS` from `@ruostack/shared`; `requireAdmin` from `../middleware/guards.ts`.
- Produces: `GET /api/admin/catalog/export.csv`.

- [ ] **Step 1: Write the failing test**

Append to `apps/api/test/unit/catalog-export.test.ts`:

```ts
import { AUDIT_ACTIONS } from '@ruostack/shared';

describe('export audit action', () => {
  // A bulk read of every wholesale price is a data-egress event, and this
  // system treats its append-only audit log as a critical invariant. Note the
  // ledger export writes no audit row -- that is a gap there, not a precedent.
  it('has a distinct action from the import', () => {
    expect(AUDIT_ACTIONS.catalogExported).toBe('catalog.exported');
    expect(AUDIT_ACTIONS.catalogExported).not.toBe(AUDIT_ACTIONS.catalogImported);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm --filter @ruostack/api exec vitest run test/unit/catalog-export.test.ts`
Expected: FAIL — `AUDIT_ACTIONS.catalogExported` is undefined.

- [ ] **Step 3: Add the audit action**

In `packages/shared/src/audit.ts`, directly below the `catalogImported` line:

```ts
  catalogExported: 'catalog.exported', // one aggregate row per CSV export run
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `pnpm --filter @ruostack/api exec vitest run test/unit/catalog-export.test.ts`
Expected: PASS.

- [ ] **Step 5: Add the route**

In `apps/api/src/routes/admin-catalog.ts`, add these imports at the top:

```ts
import { buildCatalogExportCsv, exportFilename } from '../services/catalog-export.ts';
import { writeAudit } from '../audit.ts';
import { AUDIT_ACTIONS } from '@ruostack/shared';
```

(If `writeAudit` or `AUDIT_ACTIONS` is already imported in this file, do not duplicate the import — add the missing symbol to the existing one.)

Add the route immediately **after** the list route and **before** `GET /api/admin/catalog/:id`:

```ts
  /**
   * Catalog as CSV. Shaped after GET /api/admin/ledger/export.csv, including the
   * `.csv` suffix -- which also keeps this path away from `/:id` below, whose
   * param is a UUID.
   *
   * `shape=import` emits exactly IMPORT_COLUMNS and feeds straight back into the
   * importer. `shape=full` adds lifecycle and identity columns and is therefore
   * NOT re-importable: FORBIDDEN_COLUMNS rejects it on the way back in, by design.
   *
   * Rows match the visible table -- same filters as the list route, via the same
   * helper -- because the workflow this exists for is: filter, export, edit the
   * prices, re-import.
   */
  app.get('/api/admin/catalog/export.csv', { preHandler: requireAdmin('catalog', 'view') }, async (req, reply) => {
    const q = CatalogListQuery.extend({ shape: z.enum(['import', 'full']).default('import') }).parse(req.query);
    const products = await prisma.catalogProduct.findMany({
      where: catalogListWhere(q),
      orderBy: { createdAt: 'desc' },
    });

    const csv = buildCatalogExportCsv(products, q.shape);
    const name = exportFilename(q.shape, new Date());

    // One aggregate row per run, mirroring catalog.imported: who exported what,
    // in which shape, and under which filters.
    await writeAudit(prisma, {
      actorType: 'admin',
      actorId: req.admin!.adminUserId,
      action: AUDIT_ACTIONS.catalogExported,
      targetType: 'catalog_export',
      after: {
        shape: q.shape,
        rows: products.length,
        filters: { status: q.status ?? null, search: q.search ?? null, archived: q.archived === 'true' },
      },
      ip: req.ip,
    });

    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${name}"`)
      .send(csv);
  });
```

- [ ] **Step 6: Verify it compiles and nothing regressed**

Run: `pnpm typecheck && pnpm --filter @ruostack/api exec vitest run`
Expected: typecheck clean, all suites PASS.

- [ ] **Step 7: Verify by hand against the running dev API**

The dev API runs under `tsx watch` on port 3901 and will have reloaded. Obtain an admin access token by logging in, then:

```bash
curl -sS -D- -o /tmp/export.csv \
  -H "authorization: Bearer $TOKEN" \
  'http://127.0.0.1:3901/api/admin/catalog/export.csv?shape=import' | head -5
head -1 /tmp/export.csv
```

Expected: `200`, `content-type: text/csv; charset=utf-8`, a `content-disposition` naming `ruostack-catalog-import-...csv`, and a first line equal to the 17 import columns. Also confirm a row landed in the audit log:

```bash
psql "$(sed -n 's/^DATABASE_URL="\(.*\)"$/\1/p' .env | sed 's/?pgbouncer=true//')" \
  -tAc "select action, after->>'shape', after->>'rows' from audit_log where action='catalog.exported' order by created_at desc limit 1"
```

Expected: one row, `catalog.exported`.

- [ ] **Step 8: Commit**

```bash
git add packages/shared/src/audit.ts apps/api/src/routes/admin-catalog.ts apps/api/test/unit/catalog-export.test.ts
git commit -m "Add the admin catalog export route"
```

---

### Task 4: Route integration tests

**Files:**
- Create: `apps/api/test/integration/catalog-export.test.ts`

**Interfaces:**
- Consumes: the route from Task 3; `buildApp` from `../../src/app.ts`; `signAdminAccessToken` from `../../src/auth/admin-jwt.ts`; `hashPassword`, `hashToken`, `randomToken` from `../../src/crypto.ts`.
- Produces: nothing consumed by later tasks.

These cover what a unit test cannot: permission enforcement, that filters actually reach the query, and that the audit row is written. They self-skip unless `RUN_DB_TESTS=1`, matching every other integration suite; CI runs them with that set.

- [ ] **Step 1: Write the failing test**

Create `apps/api/test/integration/catalog-export.test.ts`:

```ts
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { getPrisma, type AdminRole } from '@ruostack/db';
import { IMPORT_COLUMNS, parseCsv } from '@ruostack/shared';
import { buildApp } from '../../src/app.ts';
import { signAdminAccessToken } from '../../src/auth/admin-jwt.ts';
import { hashPassword, hashToken, randomToken } from '../../src/crypto.ts';

// Catalog CSV export: permissions, filter pass-through, audit. Self-skips
// unless RUN_DB_TESTS=1.
const RUN = process.env.RUN_DB_TESTS === '1';
const prisma = getPrisma();

async function seedAdmin(role: AdminRole) {
  const admin = await prisma.adminUser.create({
    data: {
      email: `${randomToken(6)}@test.local`,
      fullName: 'Export Admin',
      role,
      passwordHash: await hashPassword('x'),
      status: 'active',
      mfaEnabled: true,
    },
  });
  const session = await prisma.adminSession.create({
    data: { adminUserId: admin.id, refreshTokenHash: hashToken(randomToken(32)), expiresAt: new Date(Date.now() + 3_600_000) },
  });
  return { admin, token: signAdminAccessToken({ sub: admin.id, role, sid: session.id }) };
}

describe.skipIf(!RUN)('catalog export (DB integration)', () => {
  let app: FastifyInstance;
  let token: string;
  let adminIds: string[] = [];
  const created: string[] = [];
  const tag = randomToken(6).toUpperCase();

  beforeAll(async () => {
    app = await buildApp();
    await app.ready();
    const ops = await seedAdmin('operations');
    token = ops.token;
    adminIds = [ops.admin.id];

    for (const [i, status] of (['in_stock', 'soon'] as const).entries()) {
      const p = await prisma.catalogProduct.create({
        data: {
          canonicalSku: `RUO-EX${tag}-${i}`,
          compound: `EX${tag}`,
          name: `Export Test ${i}`,
          wholesaleStarter: 1000,
          wholesalePro: 900,
          wholesaleVolume: 800,
          suggestedRetail: 5000,
          status,
        },
      });
      created.push(p.id);
    }
  });

  afterAll(async () => {
    await prisma.auditLog.deleteMany({ where: { actorId: { in: adminIds } } }).catch(() => undefined);
    await prisma.catalogProduct.deleteMany({ where: { id: { in: created } } }).catch(() => undefined);
    await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } }).catch(() => undefined);
    await app.close();
    await prisma.$disconnect();
  });

  function get(url: string, bearer = token) {
    return app.inject({ method: 'GET', url, headers: { authorization: `Bearer ${bearer}` } });
  }

  it('refuses an unauthenticated request', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/admin/catalog/export.csv' });
    expect(res.statusCode).toBe(401);
  });

  it('serves CSV with an attachment filename carrying the shape', async () => {
    const res = await get('/api/admin/catalog/export.csv?shape=import');
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.headers['content-disposition']).toContain('ruostack-catalog-import-');
    expect(parseCsv(res.body).header).toEqual([...IMPORT_COLUMNS]);
  });

  it('defaults to the import shape when none is given', async () => {
    const res = await get('/api/admin/catalog/export.csv');
    expect(parseCsv(res.body).header).toEqual([...IMPORT_COLUMNS]);
  });

  it('passes the status filter through to the query', async () => {
    const all = await get(`/api/admin/catalog/export.csv?search=EX${tag}`);
    const oneStatus = await get(`/api/admin/catalog/export.csv?search=EX${tag}&status=in_stock`);
    expect(parseCsv(all.body).rows.length).toBe(2);
    expect(parseCsv(oneStatus.body).rows.length).toBe(1);
  });

  it('excludes archived products unless asked, matching the list route', async () => {
    await prisma.catalogProduct.update({ where: { id: created[0]! }, data: { archived: true } });
    const normal = await get(`/api/admin/catalog/export.csv?search=EX${tag}`);
    const archived = await get(`/api/admin/catalog/export.csv?search=EX${tag}&archived=true`);
    expect(parseCsv(normal.body).rows.length).toBe(1);
    expect(parseCsv(archived.body).rows.length).toBe(1);
    await prisma.catalogProduct.update({ where: { id: created[0]! }, data: { archived: false } });
  });

  it('emits a header-only file when nothing matches', async () => {
    const res = await get('/api/admin/catalog/export.csv?search=NOSUCHPRODUCTXYZ');
    expect(res.statusCode).toBe(200);
    expect(parseCsv(res.body).rows).toEqual([]);
    expect(parseCsv(res.body).header).toEqual([...IMPORT_COLUMNS]);
  });

  it('writes one audit row per export, recording shape, count and filters', async () => {
    await get(`/api/admin/catalog/export.csv?shape=full&search=EX${tag}&status=soon`);
    const row = await prisma.auditLog.findFirst({
      where: { action: 'catalog.exported', actorId: adminIds[0] },
      orderBy: { createdAt: 'desc' },
    });
    expect(row).not.toBeNull();
    const after = row!.after as Record<string, unknown>;
    expect(after.shape).toBe('full');
    expect(after.rows).toBe(1);
    expect((after.filters as Record<string, unknown>).status).toBe('soon');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `RUN_DB_TESTS=1 pnpm --filter @ruostack/api exec vitest run test/integration/catalog-export.test.ts`
Expected: FAIL — the suite runs against the dev database and the route or audit assertions fail if Task 3 was not completed correctly.

If it reports the whole suite as skipped, `RUN_DB_TESTS=1` did not reach vitest — check the command.

- [ ] **Step 3: Make it pass**

No new implementation should be needed; Task 3 already built the route. If a test fails, fix the route, not the test — each assertion here is a spec requirement.

Run: `RUN_DB_TESTS=1 pnpm --filter @ruostack/api exec vitest run test/integration/catalog-export.test.ts`
Expected: PASS.

- [ ] **Step 4: Confirm it self-skips in the normal run**

Run: `pnpm --filter @ruostack/api exec vitest run test/integration/catalog-export.test.ts`
Expected: reported as skipped, exit 0. Every other integration suite behaves this way.

- [ ] **Step 5: Commit**

```bash
git add apps/api/test/integration/catalog-export.test.ts
git commit -m "Add integration tests for the catalog export route"
```

---

### Task 5: The two buttons

**Files:**
- Modify: `apps/admin-web/src/screens/Catalog.tsx`

**Interfaces:**
- Consumes: `GET /api/admin/catalog/export.csv?shape=&status=&search=&archived=` (Task 3); `apiDownload` from `../lib/api.js`; `MAX_IMPORT_ROWS` from `@ruostack/shared`; `Download` and `InlineAlert` from `@ruostack/ui`.
- Produces: no new exports.

Note the SPA's own imports use `.js` specifiers (`../lib/api.js`) — that is the existing convention in `apps/admin-web`; follow the surrounding file, do not switch it to `.ts`.

- [ ] **Step 1: Add the imports**

In `apps/admin-web/src/screens/Catalog.tsx`, add `Download` and `InlineAlert` to the existing `@ruostack/ui` import, add `MAX_IMPORT_ROWS` to the `@ruostack/shared` import (create one if the file has none), and add `apiDownload` to the existing `../lib/api.js` import.

- [ ] **Step 2: Add the query builder and handler**

Inside the `Catalog` component, after the existing `filtered` definition:

```tsx
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
    ).catch(() => setErr('Export failed'));
  }
```

If the component has no `setErr`/`err` state, add `const [err, setErr] = useState('');` alongside the other `useState` calls and render it with `{err && <InlineAlert tone="danger">{err}</InlineAlert>}` above the table.

- [ ] **Step 3: Add the buttons**

In the `PageHeader` `action` div, immediately before the existing "Import CSV" button:

```tsx
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
```

Both are outside the `writable &&` guard: exporting needs only `catalog:view`, which anyone on this screen already has.

The `title` on the snapshot button is load-bearing, not decoration: the mistake operators will actually make is round-tripping the snapshot and meeting `forbidden_column` with no idea why, so the one-way nature has to be visible at the point of use.

- [ ] **Step 4: Add the over-ceiling warning**

Immediately above the table, render:

```tsx
      {filtered.length > MAX_IMPORT_ROWS && (
        <InlineAlert tone="warning">
          This selection has {filtered.length} products. The importer accepts {MAX_IMPORT_ROWS} rows
          per file, so an exported CSV will need splitting before it can be re-imported. Narrow the
          filter to export a smaller set.
        </InlineAlert>
      )}
```

The export still emits every matching row — truncating would produce a file that looks complete and re-imports "successfully" while silently dropping products.

- [ ] **Step 5: Verify**

Run: `pnpm typecheck && pnpm --filter @ruostack/admin-web build`
Expected: typecheck clean, build succeeds.

Then in the browser against dev: filter the catalog to one status, click **Export CSV**, and confirm the downloaded file contains only the visible rows and its header is the 17 import columns. Click **Export snapshot** and confirm the header additionally has `status`, `is_published`, `archived`, `id`, `created_at`, `updated_at`.

- [ ] **Step 6: Commit**

```bash
git add apps/admin-web/src/screens/Catalog.tsx
git commit -m "Add catalog export buttons to the admin catalog screen"
```

---

### Task 6: Close the loop end to end

**Files:** none — verification only.

- [ ] **Step 1: Full suite**

Run: `pnpm typecheck && pnpm -r test && pnpm test:scripts`
Expected: all PASS. Unit count should be 6 higher than before Task 1 at minimum.

- [ ] **Step 2: Prove the round trip against a real database**

Against dev, with an admin token: export in `import` shape, then upload the identical file through the existing import preview at `/catalog/import`.

Expected: every row classified **unchanged**, zero creates, zero updates, zero errors. If any row shows as an update, the rendering of that field disagrees with the parser — fix the builder, not the test.

- [ ] **Step 3: Confirm the snapshot is rejected on re-import**

Upload the `full`-shape file to the same import screen.

Expected: rejected with `forbidden_column`, naming `status`, `is_published` and `archived`. This is the designed behaviour — confirm the error message is legible, since this is the mistake operators will actually make.

- [ ] **Step 4: Commit any fixes and push**

```bash
git push origin main
```

---

## Notes for the implementer

- **Do not add a row cap to the export.** It was considered and rejected: a truncated export looks complete. The UI warns instead.
- **Do not move the CSV builder into `packages/shared`.** It lives in `apps/api/src/services/` to match `buildLedgerDetailCsv`. `catalog-import.ts` is in shared only because the SPA needs `classifyRow` for the preview; nothing in the browser builds an export.
- **If the round-trip test fails after a schema change**, that is the test doing its job — a column was added to the importer or the model without the exporter learning about it.
