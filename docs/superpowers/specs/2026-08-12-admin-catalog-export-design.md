# Admin catalog export — design

Date: 2026-08-12
Status: approved, not yet implemented

## Problem

The admin catalog can be bulk-loaded from CSV (PR #63) but not bulk-read. An
operator who wants to reprice fifty SKUs has to either retype them into the
import template or click through fifty drawers. There is also no way to hand the
catalog to anyone outside the tool.

The import half already exists and constrains this work:

- `packages/shared/src/csv.ts` — pure reader and `buildCsv(header, rows)` writer.
- `packages/shared/src/catalog-import.ts` — `IMPORT_COLUMNS` (17), `FORBIDDEN_COLUMNS`,
  `dollarsToCents`, `classifyRow`, `importTemplateCsv`.
- `apps/api/src/services/catalog-import.ts` — writes one aggregate
  `catalog.imported` audit row per run.
- `apps/admin-web/src/lib/api.ts` — `apiDownload(path, filename)`: authenticated
  blob download with refresh-and-retry. Written for CSV exports and currently
  **unused**.

## Decision

A server route, not client-side CSV generation.

Client-side would be simpler and would make "what you see is what you get" true
by construction rather than by keeping two filter implementations in sync. It was
rejected for two reasons: it cannot be audited, and a bulk download of every
wholesale price is precisely what an append-only audit log is for; and it would
put cents→dollars formatting in the browser, where it can drift from the parser
that reads it back.

## Two shapes, two buttons

`FORBIDDEN_COLUMNS` blocks `status`, `is_published`, `archived`, `id` and the
timestamps from import — lifecycle state is changed from the catalog screen, never
from a file, so that an import can never appear to have changed stock. A file
containing those columns therefore **cannot be re-imported**: it is rejected with
`forbidden_column`.

That makes one export impossible to serve both needs, so there are two:

| Shape | Columns | Purpose |
|---|---|---|
| `import` | exactly the 17 `IMPORT_COLUMNS` | export → bulk-edit → re-import |
| `full` | those plus `id`, `status`, `is_published`, `archived`, `created_at`, `updated_at` | reporting, audit, handing data out |

The filename carries the shape, so the two are not confused after download:

```
ruostack-catalog-import-20260812-1642.csv
ruostack-catalog-full-20260812-1642.csv
```

The full-shape button is labelled as a snapshot and states in the UI that it
cannot be re-imported. The failure this guards against is an operator round-tripping
the wrong file and meeting `forbidden_column` with no idea why.

## Row scope

The file matches the visible table: the status tab, the search box and the archived
toggle all apply. Filtering to `out_of_stock`, exporting, repricing and re-importing
is the workflow this exists for.

The screen filters **client-side** over a list fetched with `?archived=` only, so the
SPA must send its current status and search to the export route, and the server must
apply identical semantics (case-insensitive `contains` across name, canonical SKU and
compound).

Two hand-synced filter implementations will drift. The where-clause in
`GET /api/admin/catalog` is therefore extracted into one helper that the list route
and the export route both call. This is the only change to existing behaviour.

## Interface

```
GET /api/admin/catalog/export.csv?shape=import|full&status=&search=&archived=
```

Shaped after the existing `GET /api/admin/ledger/export.csv`, which is the closest
analogue in the codebase and already sets the conventions:

- The `.csv` suffix matches `admin/ledger/export.csv` and `brand/store/provision.csv`.
  It also means the path cannot be captured by `GET /api/admin/catalog/:id`, whose
  `:id` is a UUID — no router-precedence subtlety to reason about.
- `preHandler: requireAdmin('catalog', 'view')` — same permission as reading the list.
- `shape` defaults to `import`, as the ledger route defaults its own `shape`. The
  round-trip file is the common case; the snapshot is deliberate.
- `status`, `search`, `archived` are optional and identical in meaning and validation
  to `GET /api/admin/catalog`. In particular `archived` follows the list route exactly
  — absent means `archived: false`, since archived products are retired and hidden
  unless explicitly asked for.
- 200 `text/csv; charset=utf-8` with `Content-Disposition: attachment; filename="…"`,
  set the same way the ledger route sets them.
- An empty result set returns a header-only file, not an error, matching
  `importTemplateCsv()` and `buildLedgerDetailCsv([])`.

The client calls the existing `apiDownload(path, filename)` — already used by
`Ledger.tsx` for exactly this. No new client plumbing.

## Row ceiling

`MAX_IMPORT_ROWS` is 2000. An import-shaped export of more than that produces a file
the importer will refuse.

The export emits every matching row regardless, and the UI warns when the count
exceeds `MAX_IMPORT_ROWS` that the file must be split before re-import. Silently
truncating an export is worse than a file that needs splitting: a truncated catalog
looks complete, and re-importing it would appear to succeed.

## Modules

| Unit | Responsibility | Depends on |
|---|---|---|
| `apps/api/src/services/catalog-export.ts` *(new)* | `buildCatalogExportCsv(products, shape)`, `FULL_COLUMNS`, `exportFilename(shape, at)`, and the audit write. Pure builder + thin service, as `services/ledger.ts` does. | `buildCsv`, `IMPORT_COLUMNS` |
| `apps/api/src/routes/admin-catalog.ts` | Route, validation, headers. | service |
| `apps/api/src/routes/admin-catalog.ts` *(refactor)* | Extract `catalogListWhere(q)`; list and export both call it. | — |
| `apps/admin-web/src/screens/Catalog.tsx` | Two header buttons, over-ceiling warning. | `apiDownload` |
| `packages/shared/src/audit.ts` | Add `catalogExported: 'catalog.exported'`. | — |

The CSV builder lives in the API rather than `packages/shared`, following
`buildLedgerDetailCsv` in `apps/api/src/services/ledger.ts`. `catalog-import.ts` is in
shared because the SPA needs `classifyRow` to render the import preview; nothing in the
browser needs to build an export, since the server produces the file. The builder is
still a pure function unit-tested in `apps/api/test/unit/`, exactly as the ledger
builders are.

Cents→dollars rendering must be the exact inverse of `dollarsToCents`, so an untouched
round trip is a no-op.

## Audit

One aggregate row per export — shape, row count, and the filters applied — using a new
`catalog.exported` action alongside `catalog.imported`.

This is a **deliberate departure, not a mirror of the existing pattern**: the ledger
export at `admin-ledger.ts:124` writes no audit row. A bulk read of every wholesale
price is a data-egress event over operator-owned pricing, and this system treats its
append-only audit log as a critical invariant, so the export should be recorded. The
ledger export arguably has the same gap; closing it is out of scope here but worth
raising separately rather than being silently copied.

## Testing

The load-bearing test is a **round-trip property**: export a product in import shape,
feed the row back through `classifyRow`, assert `action === 'unchanged'`. That proves
the two halves agree rather than asserting a belief about them, and it fails loudly if
a column is added to one side only.

Also:

- Full shape contains every `FORBIDDEN_COLUMNS` entry it claims to, and the import
  shape contains none of them.
- Cents→dollars is the exact inverse of `dollarsToCents` across boundary values
  (0, sub-dollar, large).
- Values needing CSV quoting — commas in `name`, quotes in `description_template`,
  the `images` array — survive `buildCsv` and parse back identically.
- Empty result yields a header-only file.
- Route: 403 without `catalog:view`; filters reach the query; the audit row is written.

## Out of scope

Background jobs, emailed exports, XLSX, scheduled exports, and per-column selection.
A synchronous CSV download is right at this size. Brand-facing export is a separate
question — this is the operator-owned master, and brands see a read projection.
