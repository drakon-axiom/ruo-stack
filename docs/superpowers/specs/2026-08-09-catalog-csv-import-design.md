# CSV product import for the admin Catalog

## Context

Products can only be entered one at a time today, through the Create drawer in
`apps/admin-web/src/screens/Catalog.tsx`. Loading or repricing a real catalog means
hand-typing every SKU. This adds a CSV importer to the admin portal that upserts on
`canonical_sku` — create the product if that SKU is absent, update it if present.

The catalog is operator-owned and `CatalogProduct` is flat (no variants), with
`canonicalSku` as its only unique key, so SKU is the natural match key. Because the
importer matches *by* SKU it can never rename one, which sidesteps the SKU-immutability
invariant at `apps/api/src/routes/admin-catalog.ts:118-132` entirely.

Decisions locked with the user:

- **CSV file only.** Picked in the browser, read with `file.text()`, POSTed as text in a
  JSON body — the same "read client-side, send JSON" shape as the logo upload in
  `apps/api/src/routes/brand-branding.ts`. No multipart plugin, no XLSX, no new dependency.
- **Dry-run preview, then explicit commit.** Mirrors the existing preflight → commit idiom
  in `apps/api/src/routes/brand-store.ts` + `services/store-preflight.ts`.
- **Partial update.** Only columns present in the header *and* non-empty are written. A
  blank cell never clears a stored value. A price-only sheet (sku + three wholesale
  columns) is a valid import.
- **Prices in dollars** (`12.50`) → integer cents. More than 2 decimals, or anything
  non-numeric, is a row error — never a silent round.
- **The importer never publishes.** New rows are created unpublished at the schema default
  (`is_published false`, `status soon`); existing rows keep their publish state. No
  `status`/`is_published` column is accepted at all — supplying one is a hard file error,
  not a silent drop, so an operator can never believe stock changed when it didn't.
- **Row-level failure isolation.** Valid rows commit; bad rows are reported with their line
  number and reason and are downloadable as an errors CSV to fix and re-upload. Re-upload
  is safe — matching by SKU makes the whole thing idempotent.

No Prisma migration, no role-matrix change (reuses the existing `catalog` surface,
write access = `super_admin` + `operations`), no new npm dependency.

---

## CSV contract

Required on create, optional on update: `name`, `compound`, `wholesale_starter`,
`wholesale_pro`, `wholesale_volume`, `suggested_retail`.
`canonical_sku` is required on every row — it's the match key.
Optional anywhere: `dose`, `unit`, `description_template`, `weight`, `length`, `width`,
`height`, `packaging_rule`, `coa_id`, `images` (pipe-separated URLs — a comma would force
every image cell to be quoted).

Header normalization: strip BOM → trim → unquote → lowercase → `[\s-]+` → `_`. So
`"Canonical SKU"`, `canonical-sku`, `CANONICAL_SKU` all resolve. Plus exactly three
aliases: `sku`, `product_name`, `description`. Nothing more — `price`/`cost`/`msrp` are
ambiguous across four money columns, and a **Download template** button (built from the
same constant the parser validates against, so it can't drift) removes the need to guess.

Unknown columns are ignored but returned as `ignored_columns` and shown as a warning, so
a typo like `wholesale_prro` is visible rather than silent.

---

## Approach

### Pure core in `packages/shared` (unit-testable, no DB, no Prisma)

**`packages/shared/src/csv.ts`** — a hand-rolled RFC-4180-subset parser, ~55 lines:
`parseCsv(text) → { header, rows }`, `CsvParseError` (carries the line number),
`detectDelimiter`, and a shared `csvCell`/`buildCsv`. Hand-rolled rather than adding
`papaparse`: `packages/shared` depends only on `zod` today and is imported by both web
apps, the input is a ≤2 MB admin-authenticated file, and the repo already hand-rolls CSV
*output* in `apps/api/src/services/store-provision.ts:88` and `services/ledger.ts:113` —
this is the symmetric half. Correctness comes from a dedicated unit test file (a
15-test parser beats an untested dependency here). Must handle: BOM, quoted fields with
embedded commas/newlines/`""`, `\r\n` and lone `\r`, ragged rows, unterminated quote → error.

**`packages/shared/src/catalog-import.ts`** — the column contract and all classification:

```ts
IMPORT_COLUMNS, FORBIDDEN_COLUMNS, MAX_IMPORT_ROWS = 2000, MAX_IMPORT_BYTES = 2_000_000
type ImportAction = 'create' | 'update' | 'unchanged' | 'error'
interface FieldChange { field: string; from: unknown | null; to: unknown }
interface ImportRow { row; canonical_sku; name; action; product_id; changes; errors }

mapHeaders(header)          // → index map + ignored[], or a typed file-level failure
dollarsToCents(raw)         // "12.50" → 1250; "" is ABSENT, not 0
classifyRow({ row, cells, existing, duplicateOf })   // pure; caller does the lookup
buildImportErrorCsv(rows)   // client-side download
importTemplateCsv()         // header row only
```

`classifyRow` order: blank SKU → duplicate-in-file → per-cell coercion (collect *all*
field errors so one pass fixes the file) → archived → create (validate against
`CatalogCreateSchema`) or diff-vs-existing → `unchanged` when `changes` is empty. This
follows `packages/shared/src/provisioning.ts` (pure classifier, I/O hoisted to the caller)
and `dto.ts`'s `isStoreSellable`/`catalogDeleteBlocker`.

`FieldChange` carries snake_case names and storage units (cents); the UI formats dollars,
same split as everywhere else in the codebase.

### API — `apps/api`

**`src/services/catalog-import.ts`** — the impure half.
`buildPreview` = parse → `mapHeaders` → case-insensitive duplicate index → one
`findMany({ where: { canonicalSku: { in: skus } } })` **without an `archived` filter** →
`classifyRow` per row. Plus `previewDigest(rows)` and `commitImport(...)`.

**`src/routes/admin-catalog-import.ts`** — new file (not appended to the 372-line
`admin-catalog.ts`); registered in `src/app.ts` right after `adminCatalogRoutes`.

| route | notes |
|---|---|
| `POST /api/admin/catalog/import/preview` | `requireAdmin('catalog','write')`, per-route `bodyLimit: 5_242_880` (global is 1 MB at `app.ts:43`; JSON-escaping a 2 MB CSV can approach 4 MB). Body `{ csv, filename? }`. Writes nothing. Returns `{ summary, ignored_columns, rows, digest }`. |
| `POST /api/admin/catalog/import/commit` | Same guard and limit. Body `{ csv, filename?, digest }`. |

Preview is gated on `write`, not `view` — it's step 1 of a write flow, so the UI has one
permission check and support/finance never land on a half-usable screen.

**Commit does not trust the preview.** It re-runs `buildPreview` from the raw CSV against
fresh DB state and compares digests. A mismatch → `409 preview_stale` **with the fresh
preview in the body**, so the UI can re-render and require a second confirm. The digest
covers `from` values, so it catches someone editing a price in the drawer mid-review, not
just a swapped file. This is the direct analogue of `store-preflight.ts` re-classifying
before acting.

Write strategy: actionable rows in chunks of 50, each chunk one `prisma.$transaction`
holding the product writes *and* their audit rows. A chunk that throws (realistically
`P2002` on a concurrent create) is retried row-by-row; rows that still fail become
`result: 'error'` and everything else in the chunk lands. `unchanged` and `error` rows are
never written. Creates pass **no `status` and no `isPublished`** — Prisma's schema defaults
do the work, so "never publishes" is enforced by omission.

Also extract the snake→camel field map from `admin-catalog.ts:135-157` into
`src/services/catalog-fields.ts` so both the drawer PATCH and the importer share one map.

### Audit — both levels

Add `catalogImported: 'catalog.imported'` to `packages/shared/src/audit.ts`.

- **Per product**, inside the chunk transaction: `catalog.created` / `catalog.updated` with
  before/after snapshots in the exact shape `admin-catalog.ts:161-170` already writes, each
  carrying `reason: 'csv_import'` (`writeAudit` already supports `reason` —
  `apps/api/src/audit.ts:25`) so an import-driven change is distinguishable from a drawer edit.
- **One aggregate row**: `catalog.imported`, `targetType: 'catalog_import'`, `after` holding
  filename + tallies + up to 100 affected SKUs.

Both, not just the aggregate: the query an operator actually runs is "why did this SKU's
Pro price change on the 4th?", which hits `audit_log` by `(targetType, targetId)`. An
aggregate-only row makes every bulk price change invisible on the product's own timeline.
The provisioning precedent doesn't apply there — its per-item record is the
`ProductProvisioning` row. Volume is bounded by the 2000-row cap.

### Admin UI — `apps/admin-web`

A **new route**, not a drawer: `Drawer` is `max-w-md` and `Dialog` is `max-w-lg`, and the
preview is a wide table of up to 2000 rows with per-field diffs. `Catalog.tsx` gains only
an "Import CSV" ghost button in the existing `PageHeader` action row beside "+ Create
product" (`Catalog.tsx:129-140`), gated on the existing `writable`.

| file | role |
|---|---|
| `src/screens/CatalogImport.tsx` (new) | step state machine, file pick, `api()` calls, KPI tiles, action bar |
| `src/components/catalog-import/ImportPreviewTable.tsx` (new) | `Column<ImportRow>[]`, action badge, diff cell |
| `src/components/catalog-import/ImportResult.tsx` (new) | post-commit results + errors-CSV download |
| `src/App.tsx` | `<Route path="/catalog/import" …>` inside `<Protected>` |
| `src/screens/Catalog.tsx` | +1 button, +`useNavigate` |

Flow: **pick** (hidden `<input type="file" accept=".csv,text/csv">` + `Button icon={Upload}`,
client-side size pre-check, plus a Download-template button and a short note that prices are
dollars, blanks never clear, imports never publish) → **preview** (four `KpiTile`s, `Tabs`
filtered by action reusing the `Catalog.tsx:151-160` pattern, `DataTable mode="scroll"` with
line number rendered as `row + 1` to match Excel, `Badge` per action, diffs as
`field: from → to` with money through the existing `dollars()` helper) → **confirm**
(`Dialog` summarizing counts and stating new products arrive unpublished) → **result**.

Errors: file-level ones as `InlineAlert tone="danger"` from `ApiError.message` (the uniform
`{error, message}` envelope at `app.ts:65`); row-level ones in the table; the errors CSV
built client-side from `buildImportErrorCsv` → Blob → object URL, the same mechanic as
`apiDownload` in `src/lib/api.ts:141-149` — no extra route, no server-side state between
preview and commit.

`packages/ui/src/icons.ts` gains `Upload` and `Download` (screens must not import
`lucide-react` directly). No new UI component. Do **not** introduce `toast()` — `Toaster`
is exported but mounted in neither app; stay with the inline error pattern every admin
screen uses. Semantic tokens only, so `check-legacy-classes.mjs` and `check-contrast.mjs`
stay green.

---

## Edge cases

| case | behaviour |
|---|---|
| Duplicate SKU within one file | **Every** row with that SKU errors, naming the other lines; nothing written for it. Case-insensitive, since Postgres would happily create two products that look identical. "Last wins" would silently discard typed data. |
| SKU matches an **archived** product | Row error: "restore it from the catalog first." Archived rows are hidden from the default admin list, so a silent bulk edit would be invisible — hence the lookup deliberately does not filter `archived`. |
| SKU matches a **published** product | Update allowed on every writable field. `canonical_sku`, `status`, `is_published`, `archived` are never touched. |
| Nothing differs | `unchanged` — no write, no audit, no bumped `updatedAt`. Re-importing the same file is a true no-op. |
| Blank cell in a present column | Dropped from the patch. Never clears. |
| `status` / `is_published` / `archived` / `id` column present | `400 forbidden_column`, nothing written. |
| Unknown columns | Ignored, listed in `ignored_columns`, shown as a warning. |
| Empty or BOM-only file | `400 empty_file`. |
| Header-only file | `200`, all counts 0 — a valid empty import, not a malformed file. |
| Semicolon/tab delimited | `400 bad_delimiter` naming the detected one. Never auto-switches — that's a silent reinterpretation of the operator's file. |
| Ragged row, too few cells | Missing trailing cells treated as empty. |
| Ragged row, too many cells | Row error — the usual cause is an unquoted comma in a description, which would otherwise write a price into `coa_id`. |
| `12.505`, `abc`, `-1`, `1,234.00` | Row error. Accepted: `12`, `12.5`, `12.50`, `0`, `$12.50`, surrounding whitespace. |
| >2000 rows / >2 MB | `400 too_many_rows` / `400 too_large`, with a client-side pre-check. |
| Concurrent create of the same SKU mid-commit | `P2002` → that row errors as `sku_taken`; the rest of the chunk still lands. |

---

## Implementation sequence

**Phase A — pure core, green before anything else is written**
1. `packages/shared/src/csv.ts`
2. `apps/api/test/unit/csv-parse.test.ts`
3. `packages/shared/src/catalog-import.ts`
4. Export both from `packages/shared/src/index.ts`
5. `apps/api/test/unit/catalog-import-{headers,cents,classify}.test.ts`

**Phase B — API**
6. `catalogImported` in `packages/shared/src/audit.ts`
7. Extract `CATALOG_FIELD_MAP` → `apps/api/src/services/catalog-fields.ts`, point
   `admin-catalog.ts` at it (behaviour-free move — run the catalog integration tests
   immediately, before layering the importer on top)
8. `apps/api/src/services/catalog-import.ts`
9. `apps/api/src/routes/admin-catalog-import.ts` + register in `src/app.ts`
10. `apps/api/test/integration/catalog-import.test.ts`

**Phase C — UI**
11. `Upload` + `Download` in `packages/ui/src/icons.ts` (land before the screen, or it won't typecheck)
12. `ImportPreviewTable.tsx`, `ImportResult.tsx`, `CatalogImport.tsx`
13. Route in `App.tsx`, button in `Catalog.tsx`

Also write the design doc to `docs/superpowers/specs/2026-08-09-catalog-csv-import-design.md`
and commit it at the start of implementation (the brainstorming workflow calls for it;
plan mode blocks writing it now).

---

## Verification

**Unit** (`pnpm --filter @ruostack/api test` — no DB needed):
- parser: quoting, embedded commas/newlines/`""`, CRLF + lone `\r`, BOM, ragged rows,
  unterminated quote, header-only, empty
- `mapHeaders`: normalization variants, the three aliases, forbidden → error, two headers
  colliding → error, no SKU column → error, unknowns → `ignored`
- `dollarsToCents`: the accept list, the reject list, and — the single most important
  assertion — `""` is *absent*, not `0` (the difference between "leave the price alone"
  and "make it free")
- `classifyRow`: one case per action, plus blank-never-clears, archived → error,
  published update never includes `canonical_sku`, required fields enforced on create but
  not on update, duplicate → error, two bad fields in one row → both reported

**Integration** (`RUN_DB_TESTS=1 pnpm --filter @ruostack/api test`), new
`test/integration/catalog-import.test.ts` using the same `seedAdmin` / `buildApp` /
`app.inject` scaffolding as `catalog-crud.test.ts`:
1. mixed file classifies into create/update/unchanged/error correctly
2. committed creates have `isPublished === false` and `status === 'soon'` — the never-publishes invariant
3. updating a *published* product's `wholesalePro` leaves `isPublished` and `status` untouched
4. blank `description_template` cell leaves the stored value intact
5. one bad row + two good rows → the two good rows land, the bad one reports its line
6. duplicate SKU across two rows → both error, neither product exists afterwards
7. SKU matching an archived product → error, archived row byte-identical afterwards
8. `status` column → `400 forbidden_column`, nothing written
9. `support` role → `403` on both routes
10. audit: one `catalog.imported` row **plus** a per-product row with `reason === 'csv_import'`
11. mutate a product between preview and commit → `409 preview_stale`, nothing written,
    fresh preview in the body (assert this round-trip before wiring the UI, or every
    commit will 409)
12. 2001 rows → `too_many_rows`; oversize body → `too_large`; semicolon file →
    `bad_delimiter`; header-only → `200` with zero counts

**Gates:** `pnpm -r typecheck`, `node scripts/check-legacy-classes.mjs`,
`node scripts/check-contrast.mjs`.

**Manual, end to end:** run the API and admin-web, sign in as `operations`, go to
Catalog → Import CSV. Download the template, fill three rows, import → confirm the preview
shows 3 creates, commit, confirm the products appear in the catalog list as unpublished
drafts. Re-upload the same file → all 3 classify as `unchanged`, and nothing is written.
Edit one price in the sheet, re-upload → 1 update with a single field diff. Add a row with
`12.505` and a duplicate SKU → both flagged with line numbers, the good rows still import,
and the errors CSV downloads.

`apps/admin-web` has no test harness and this plan does not stand one up — all the logic
that can be wrong lives in the pure `packages/shared` functions, which are covered above.
