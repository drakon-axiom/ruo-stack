import { describe, expect, it } from 'vitest';
import { buildImportErrorCsv, classifyRow, type ExistingProduct } from '@ruostack/shared';

const existing = (over: Partial<ExistingProduct> = {}): ExistingProduct => ({
  id: 'p1',
  canonicalSku: 'RUO-TEST-10MG',
  compound: 'Testolide',
  dose: '10mg',
  unit: 'vial',
  name: 'Testolide 10mg',
  descriptionTemplate: 'Stored description',
  wholesaleStarter: 1000,
  wholesalePro: 900,
  wholesaleVolume: 800,
  suggestedRetail: 2000,
  isPublished: false,
  archived: false,
  weight: 2,
  length: null,
  width: null,
  height: null,
  packagingRule: null,
  coaId: null,
  images: [],
  ...over,
});

const fullCells = {
  canonical_sku: 'RUO-NEW-10MG',
  name: 'New product',
  compound: 'Newolide',
  wholesale_starter: '10.00',
  wholesale_pro: '9.00',
  wholesale_volume: '8.00',
  suggested_retail: '20.00',
};

type ClassifyInput = Parameters<typeof classifyRow>[0];

const classify = (over: Partial<ClassifyInput> = {}) =>
  classifyRow({ row: 1, cells: fullCells, existing: null, duplicateOf: [], ...over });

describe('classifyRow — create', () => {
  it('creates when no product carries that SKU', () => {
    const r = classify();
    expect(r.action).toBe('create');
    expect(r.errors).toEqual([]);
    expect(r.product_id).toBeNull();
  });

  it('reports every set field as a change from nothing', () => {
    const r = classify();
    expect(r.changes.find((c) => c.field === 'wholesale_pro')).toEqual({
      field: 'wholesale_pro',
      from: null,
      to: 900,
    });
  });

  it('rejects a create that is missing a required column', () => {
    const { compound: _drop, ...rest } = fullCells;
    const r = classify({ cells: rest });
    expect(r.action).toBe('error');
    expect(r.errors.map((e) => e.field)).toContain('compound');
  });

  it('rejects a create whose required cell is present but blank', () => {
    const r = classify({ cells: { ...fullCells, wholesale_pro: '' } });
    expect(r.action).toBe('error');
    expect(r.errors.map((e) => e.field)).toContain('wholesale_pro');
  });
});

describe('classifyRow — update', () => {
  it('updates a product that already carries that SKU', () => {
    const r = classify({
      cells: { canonical_sku: 'RUO-TEST-10MG', wholesale_pro: '9.50' },
      existing: existing(),
    });
    expect(r.action).toBe('update');
    expect(r.product_id).toBe('p1');
    expect(r.changes).toEqual([{ field: 'wholesale_pro', from: 900, to: 950 }]);
  });

  it('does not require the create-only columns', () => {
    // A price-only sheet — sku plus one money column — is a valid import.
    const r = classify({
      cells: { canonical_sku: 'RUO-TEST-10MG', wholesale_pro: '9.50' },
      existing: existing(),
    });
    expect(r.errors).toEqual([]);
  });

  it('leaves a stored value alone when the cell is blank', () => {
    // Blank never clears. Otherwise a narrow price sheet would wipe every
    // description in the catalog.
    const r = classify({
      cells: { canonical_sku: 'RUO-TEST-10MG', description_template: '' },
      existing: existing({ descriptionTemplate: 'Stored description' }),
    });
    expect(r.action).toBe('unchanged');
    expect(r.changes).toEqual([]);
  });

  it('is unchanged when every supplied value already matches', () => {
    // Re-importing the same file must be a true no-op: no write, no audit row,
    // no bumped updatedAt.
    const r = classify({
      cells: { canonical_sku: 'RUO-TEST-10MG', name: 'Testolide 10mg', wholesale_pro: '9.00' },
      existing: existing(),
    });
    expect(r.action).toBe('unchanged');
    expect(r.changes).toEqual([]);
  });

  it('never proposes a SKU change on a published product', () => {
    // Matching BY sku means a rename is structurally impossible, which is how
    // the importer sidesteps the SKU-immutability invariant entirely.
    const r = classify({
      cells: { canonical_sku: 'ruo-test-10mg', name: 'Renamed' },
      existing: existing({ isPublished: true }),
    });
    expect(r.action).toBe('update');
    expect(r.changes.map((c) => c.field)).toEqual(['name']);
  });
});

describe('classifyRow — errors', () => {
  it('rejects a blank SKU', () => {
    const r = classify({ cells: { ...fullCells, canonical_sku: '' } });
    expect(r.action).toBe('error');
    expect(r.errors[0]?.field).toBe('canonical_sku');
  });

  it('rejects a SKU that appears more than once in the file', () => {
    // "Last wins" would silently discard data the operator typed.
    const r = classify({ row: 2, duplicateOf: [4] });
    expect(r.action).toBe('error');
    expect(r.errors[0]?.code).toBe('duplicate_sku');
    expect(r.errors[0]?.message).toContain('line 5'); // data row 4 = spreadsheet line 5
  });

  it('refuses to touch an archived product', () => {
    // Archived rows are hidden from the default catalog list, so a silent bulk
    // edit of one would be invisible.
    const r = classify({
      cells: { canonical_sku: 'RUO-TEST-10MG', wholesale_pro: '9.50' },
      existing: existing({ archived: true }),
    });
    expect(r.action).toBe('error');
    expect(r.errors[0]?.code).toBe('archived');
  });

  it('reports every bad field in the row, not just the first', () => {
    // One pass should be enough to fix the file.
    const r = classify({
      cells: { ...fullCells, name: 'x'.repeat(201), images: 'not-a-url' },
    });
    expect(r.action).toBe('error');
    expect(r.errors.map((e) => e.field).sort()).toEqual(['images', 'name']);
  });

  it('rejects a row carrying more cells than the header declares', () => {
    // Usually an unquoted comma in a description, which shifts every later
    // field by one and would write a price into coa_id.
    const r = classify({ extraCells: 2 });
    expect(r.action).toBe('error');
    expect(r.errors[0]?.code).toBe('extra_columns');
  });
});

describe('buildImportErrorCsv', () => {
  it('emits one line per error, numbered as the spreadsheet shows it', () => {
    const bad = classify({ row: 3, cells: { ...fullCells, canonical_sku: '' } });
    const csv = buildImportErrorCsv([classify(), bad]);
    const lines = csv.split('\n');
    expect(lines[0]).toBe('line,canonical_sku,field,reason');
    expect(lines).toHaveLength(2); // header + the one bad row
    expect(lines[1]).toContain('4,'); // data row 3 = spreadsheet line 4
  });
});
