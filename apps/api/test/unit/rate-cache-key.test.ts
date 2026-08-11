import { describe, expect, it } from 'vitest';
import type { RateQuoteInput } from '@ruostack/shared';
import { cacheKey } from '../../src/services/rate-cache.ts';

const base: RateQuoteInput = {
  fromZip: '90001', toZip: '10001', toState: 'NY', toCountry: 'US',
  weightOz: 9, lengthIn: 6, widthIn: 4, heightIn: 2, residential: true,
};

// The rate cache is shared across brands, so the key must separate any two
// parcels that could rate differently — otherwise the second is served the
// first's rates.
describe('rate cache key', () => {
  it('is identical for identical inputs', () => {
    expect(cacheKey(base)).toBe(cacheKey({ ...base }));
  });

  it('differs when dimensions differ (the 9oz-small vs 16oz-large collision)', () => {
    const smallBox = { ...base, weightOz: 9, lengthIn: 6, widthIn: 4, heightIn: 2 };
    const largeBox = { ...base, weightOz: 16, lengthIn: 12, widthIn: 9, heightIn: 6 };
    expect(cacheKey(smallBox)).not.toBe(cacheKey(largeBox));
  });

  it('differs on weight, destination, and residential/commercial', () => {
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, weightOz: 10 }));
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, toZip: '10002' }));
    expect(cacheKey(base)).not.toBe(cacheKey({ ...base, residential: false }));
  });

  it('treats sub-ounce differences within the same rounded oz as one key', () => {
    // Both round to 9 oz — the value actually sent to the carrier — so they share.
    expect(cacheKey({ ...base, weightOz: 8.6 })).toBe(cacheKey({ ...base, weightOz: 9.4 }));
  });
});
