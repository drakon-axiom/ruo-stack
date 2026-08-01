import { describe, expect, it } from 'vitest';
import { classifyProduct, isActionAllowed, type ClassifyInput } from '@ruostack/shared';

/**
 * Pre-flight classification (fulfillment plan §3). Every branch, because this is
 * what stands between "seed the brand's store" and "overwrite the brand's work".
 */
const SKU = 'RUO-TIRZ-10MG';

const input = (over: Partial<ClassifyInput> = {}): ClassifyInput => ({
  canonicalSku: SKU,
  record: null,
  recordedProduct: null,
  productWithCanonicalSku: null,
  ...over,
});

describe('classifyProduct — NEW', () => {
  it('is New when we have no record and the SKU is free', () => {
    const c = classifyProduct(input());
    expect(c.state).toBe('new');
    expect(c.defaultAction).toBe('create');
    expect(c.wooProductId).toBeNull();
  });

  it('is New again when the product we created was deleted from the store', () => {
    const c = classifyProduct(input({ record: { wooProductId: 7, provisionedSku: SKU }, recordedProduct: null }));
    expect(c.state).toBe('new');
    expect(c.defaultAction).toBe('create');
    expect(c.note).toMatch(/no longer in your store/i);
  });
});

describe('classifyProduct — MANAGED', () => {
  it('is Managed when our recorded product still carries the canonical SKU', () => {
    const c = classifyProduct(
      input({ record: { wooProductId: 7, provisionedSku: SKU }, recordedProduct: { wooProductId: 7, sku: SKU } }),
    );
    expect(c.state).toBe('managed');
    expect(c.defaultAction).toBe('update');
    expect(c.wooProductId).toBe(7);
  });
});

describe('classifyProduct — DRIFTED', () => {
  const drifted = input({
    record: { wooProductId: 7, provisionedSku: SKU },
    recordedProduct: { wooProductId: 7, sku: 'BRAND-OWN-SKU' },
  });

  it('is Drifted when the SKU changed on our product', () => {
    const c = classifyProduct(drifted);
    expect(c.state).toBe('drifted');
    expect(c.storeSku).toBe('BRAND-OWN-SKU');
  });

  it('defaults to no write — drift is resolved by an explicit choice', () => {
    expect(classifyProduct(drifted).defaultAction).toBe('skip');
  });

  it('offers restore + re-alias when the canonical SKU is free', () => {
    expect(classifyProduct(drifted).allowedActions).toEqual(['restore_sku', 'realias', 'skip']);
  });

  it('withdraws restore when another product has taken the canonical SKU', () => {
    // Woo enforces unique SKUs, so restoring into an occupied SKU would only error.
    const c = classifyProduct({ ...drifted, productWithCanonicalSku: { wooProductId: 99, sku: SKU } });
    expect(c.allowedActions).toEqual(['realias', 'skip']);
    expect(c.note).toMatch(/cannot be restored/i);
  });

  it('still offers restore when the "other" product is itself', () => {
    // Defensive: a store that echoes the same product for both lookups must not
    // be read as a collision with itself.
    const c = classifyProduct({ ...drifted, productWithCanonicalSku: { wooProductId: 7, sku: SKU } });
    expect(c.allowedActions).toContain('restore_sku');
  });
});

describe('classifyProduct — CONFLICT', () => {
  it('is Conflict when the SKU exists on a product we never created', () => {
    const c = classifyProduct(input({ productWithCanonicalSku: { wooProductId: 42, sku: SKU } }));
    expect(c.state).toBe('conflict');
    expect(c.wooProductId).toBe(42);
  });

  it('defaults to SKIP and never offers an overwrite', () => {
    const c = classifyProduct(input({ productWithCanonicalSku: { wooProductId: 42, sku: SKU } }));
    expect(c.defaultAction).toBe('skip');
    expect(c.allowedActions).toEqual(['skip', 'adopt']);
    expect(c.allowedActions).not.toContain('update');
    expect(c.allowedActions).not.toContain('create');
  });

  it('is Conflict — not New — when ours was deleted and something else took the SKU', () => {
    const c = classifyProduct(
      input({
        record: { wooProductId: 7, provisionedSku: SKU },
        recordedProduct: null,
        productWithCanonicalSku: { wooProductId: 42, sku: SKU },
      }),
    );
    expect(c.state).toBe('conflict');
    expect(c.defaultAction).toBe('skip');
  });
});

describe('isActionAllowed — the server-side gate', () => {
  it('permits exactly the actions each state offers', () => {
    expect(isActionAllowed('new', 'create')).toBe(true);
    expect(isActionAllowed('managed', 'update')).toBe(true);
    expect(isActionAllowed('drifted', 'realias')).toBe(true);
    expect(isActionAllowed('conflict', 'adopt')).toBe(true);
    expect(isActionAllowed('new', 'skip')).toBe(true);
  });

  it('refuses the dangerous cross-overs', () => {
    // The whole point: a Conflict can never be updated or created over.
    expect(isActionAllowed('conflict', 'update')).toBe(false);
    expect(isActionAllowed('conflict', 'create')).toBe(false);
    expect(isActionAllowed('conflict', 'restore_sku')).toBe(false);
    expect(isActionAllowed('new', 'adopt')).toBe(false);
    expect(isActionAllowed('managed', 'adopt')).toBe(false);
  });
});

describe('no auto-suffixing, ever', () => {
  it('never proposes a modified SKU as a way out of a conflict', () => {
    // Suffixing (…-10MG-2) would silently break deterministic order matching.
    // The only exits are skip and adopt.
    const c = classifyProduct(input({ productWithCanonicalSku: { wooProductId: 42, sku: SKU } }));
    expect(JSON.stringify(c)).not.toMatch(/-2\b/);
    expect(c.allowedActions.every((a) => a === 'skip' || a === 'adopt')).toBe(true);
  });
});
