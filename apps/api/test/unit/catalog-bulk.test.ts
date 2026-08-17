import { describe, expect, it } from 'vitest';
import { CATALOG_BULK_ACTIONS, CATALOG_BULK_MAX, CatalogBulkSchema } from '@ruostack/shared';

const ID = '11111111-1111-4111-8111-111111111111';
const ids = (n: number) =>
  Array.from({ length: n }, (_, i) => `1111111${(i % 10).toString()}-1111-4111-8111-111111111111`);

describe('CatalogBulkSchema', () => {
  it('accepts a lifecycle action over a list of ids', () => {
    expect(CatalogBulkSchema.safeParse({ ids: [ID], action: 'publish' }).success).toBe(true);
  });

  it('covers every lifecycle action the single-item routes expose', () => {
    expect([...CATALOG_BULK_ACTIONS].sort()).toEqual(
      ['archive', 'publish', 'set_stock', 'unarchive', 'unpublish'].sort(),
    );
  });

  it('rejects an empty selection', () => {
    expect(CatalogBulkSchema.safeParse({ ids: [], action: 'publish' }).success).toBe(false);
  });

  // Bounded so one request cannot fan the store push out across the whole catalog.
  it('rejects more ids than the batch cap', () => {
    expect(CatalogBulkSchema.safeParse({ ids: ids(CATALOG_BULK_MAX), action: 'publish' }).success).toBe(true);
    expect(CatalogBulkSchema.safeParse({ ids: ids(CATALOG_BULK_MAX + 1), action: 'publish' }).success).toBe(false);
  });

  it('rejects ids that are not uuids', () => {
    expect(CatalogBulkSchema.safeParse({ ids: ['nope'], action: 'publish' }).success).toBe(false);
  });

  it('requires a status for set_stock', () => {
    expect(CatalogBulkSchema.safeParse({ ids: [ID], action: 'set_stock' }).success).toBe(false);
    expect(
      CatalogBulkSchema.safeParse({ ids: [ID], action: 'set_stock', status: 'in_stock' }).success,
    ).toBe(true);
  });

  // Same hazard the CSV import guards against with FORBIDDEN_COLUMNS: a caller
  // must never be able to send a status alongside an action that ignores it and
  // walk away believing stock changed.
  it('rejects a status sent with an action that would ignore it', () => {
    expect(
      CatalogBulkSchema.safeParse({ ids: [ID], action: 'publish', status: 'in_stock' }).success,
    ).toBe(false);
  });

  it('rejects a status that is not a catalog status', () => {
    expect(
      CatalogBulkSchema.safeParse({ ids: [ID], action: 'set_stock', status: 'sold_out' }).success,
    ).toBe(false);
  });
});
