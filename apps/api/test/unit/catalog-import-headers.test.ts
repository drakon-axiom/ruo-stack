import { describe, expect, it } from 'vitest';
import { importTemplateCsv, mapHeaders, normalizeHeader, parseCsv } from '@ruostack/shared';

/**
 * The header contract for the catalog CSV importer. Getting this wrong is the
 * difference between "42 products updated" and 42 products silently untouched,
 * so every normalization and every rejection is pinned here.
 */
describe('normalizeHeader', () => {
  it('accepts the shapes a spreadsheet actually produces', () => {
    for (const raw of ['canonical_sku', 'Canonical SKU', 'canonical-sku', 'CANONICAL_SKU', '  Canonical  Sku  ', '"canonical_sku"']) {
      expect(normalizeHeader(raw)).toBe('canonical_sku');
    }
  });
});

describe('mapHeaders', () => {
  it('indexes the canonical columns by position', () => {
    const r = mapHeaders(['canonical_sku', 'name', 'wholesale_pro']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.index).toEqual({ canonical_sku: 0, name: 1, wholesale_pro: 2 });
    expect(r.ignored).toEqual([]);
  });

  it('resolves the three supported aliases', () => {
    const r = mapHeaders(['sku', 'product_name', 'description']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.index).toEqual({ canonical_sku: 0, name: 1, description_template: 2 });
  });

  it('does not guess at an ambiguous money header', () => {
    // "price" could mean any of four money columns. Guessing would mis-file a
    // number into the wrong tier; the Download-template button is the fix.
    const r = mapHeaders(['canonical_sku', 'price']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.index.wholesale_pro).toBeUndefined();
    expect(r.ignored).toEqual(['price']);
  });

  it('reports unknown columns in file order instead of hiding them', () => {
    // A typo like wholesale_prro must be visible, or the operator believes a
    // price was imported when it was dropped.
    const r = mapHeaders(['canonical_sku', 'notes', 'wholesale_prro']);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ignored).toEqual(['notes', 'wholesale_prro']);
  });

  it.each(['status', 'is_published', 'published', 'archived', 'id', 'updated_by'])(
    'rejects the whole file when it carries a %s column',
    (col) => {
      // Silently dropping a deliberately-filled status column would let an
      // operator read "42 updated" and believe stock changed. Hard failure.
      const r = mapHeaders(['canonical_sku', col]);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.code).toBe('forbidden_column');
      expect(r.message).toContain(col);
    },
  );

  it('rejects two headers that normalize to the same column', () => {
    const r = mapHeaders(['canonical_sku', 'Canonical SKU']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('duplicate_column');
  });

  it('rejects a file with no SKU column at all', () => {
    const r = mapHeaders(['name', 'compound']);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe('missing_sku_column');
  });
});

describe('importTemplateCsv', () => {
  it('emits a header row the importer accepts', () => {
    // The template and the parser read from one constant, so they cannot drift.
    const { header, rows } = parseCsv(importTemplateCsv());
    expect(rows).toEqual([]);
    const r = mapHeaders(header);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.ignored).toEqual([]);
    expect(r.index.canonical_sku).toBe(0);
  });
});
