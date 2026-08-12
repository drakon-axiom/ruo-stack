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
