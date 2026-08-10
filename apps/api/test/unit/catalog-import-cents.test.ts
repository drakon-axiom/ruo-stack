import { describe, expect, it } from 'vitest';
import { dollarsToCents } from '@ruostack/shared';

/** CSV prices are dollars; the catalog stores integer cents. */
describe('dollarsToCents', () => {
  it.each([
    ['12.50', 1250],
    ['12.5', 1250],
    ['12', 1200],
    ['0', 0],
    ['0.05', 5],
    ['$12.50', 1250],
    ['  12.50  ', 1250],
    ['.5', 50],
  ])('reads %s as %d cents', (raw, cents) => {
    expect(dollarsToCents(raw)).toEqual({ cents });
  });

  it('treats a blank cell as absent, not as zero', () => {
    // THE assertion in this file. "absent" means leave the stored price alone;
    // zero would mean give the product away for free. A blank cell in a
    // price-only sheet must never reprice anything.
    expect(dollarsToCents('')).toEqual({ cents: null });
    expect(dollarsToCents('   ')).toEqual({ cents: null });
  });

  it.each(['12.505', '12.5.0', 'abc', '-1', '1e3', '12,50', '1,234.00', '$', '12 50'])(
    'rejects %s rather than guessing',
    (raw) => {
      const r = dollarsToCents(raw);
      expect('error' in r).toBe(true);
    },
  );

  it('never silently rounds a third decimal place', () => {
    // Rounding 12.505 to 1250 or 1251 both quietly misprice the product.
    const r = dollarsToCents('12.505');
    expect(r).not.toHaveProperty('cents');
    expect('error' in r && r.error).toMatch(/cent/i);
  });
});
