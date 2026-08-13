import { describe, expect, it } from 'vitest';
import { catalogListWhere, CatalogListQuery, escapeLikeTerm } from '../../src/services/catalog-query.ts';

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

  describe('escapeLikeTerm', () => {
    it('escapes a percent sign so it is not treated as a LIKE wildcard', () => {
      expect(escapeLikeTerm('10%')).toBe('10\\%');
    });

    it('escapes an underscore so it does not match any single character', () => {
      expect(escapeLikeTerm('a_b')).toBe('a\\_b');
    });

    it('escapes a literal backslash before it can combine with an escaped char', () => {
      expect(escapeLikeTerm('a\\b')).toBe('a\\\\b');
    });

    it('leaves a term with no special characters untouched', () => {
      expect(escapeLikeTerm('bpc')).toBe('bpc');
    });
  });

  it('escapes wildcard characters in the search term before building the OR clause', () => {
    const where = catalogListWhere({ search: '10%' });
    expect(where.OR).toEqual([
      { name: { contains: '10\\%', mode: 'insensitive' } },
      { canonicalSku: { contains: '10\\%', mode: 'insensitive' } },
      { compound: { contains: '10\\%', mode: 'insensitive' } },
    ]);
  });
});
