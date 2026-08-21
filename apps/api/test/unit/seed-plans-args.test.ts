import { describe, expect, it } from 'vitest';
import { parsePriceIdArgs } from '../../src/scripts/seed-plans.ts';

// Pure function, no DB and no Stripe involved — parsePriceIdArgs() is the
// entire "did the CLI invocation say what the caller thinks it said" check
// for pnpm seed:plans. A bootstrap script silently misreading its arguments
// is worse than one that rejects them (Task 12), so every case here is
// either the happy path or a rejection.
describe('parsePriceIdArgs', () => {
  it('parses both flags in the accepted space-separated form', () => {
    expect(parsePriceIdArgs(['--pro', 'price_pro123', '--volume', 'price_vol456'])).toEqual({
      pro: 'price_pro123',
      volume: 'price_vol456',
    });
  });

  it('does not care about flag order', () => {
    expect(parsePriceIdArgs(['--volume', 'price_vol456', '--pro', 'price_pro123'])).toEqual({
      pro: 'price_pro123',
      volume: 'price_vol456',
    });
  });

  it('rejects a missing flag', () => {
    expect(() => parsePriceIdArgs(['--pro', 'price_pro123'])).toThrow(/Missing required argument --volume/);
  });

  it('rejects a flag with no value at all', () => {
    expect(() => parsePriceIdArgs(['--pro', 'price_pro123', '--volume'])).toThrow(/--volume requires a value/);
  });

  it('rejects a flag immediately followed by another flag instead of a value', () => {
    expect(() => parsePriceIdArgs(['--pro', '--volume', 'price_vol456'])).toThrow(/--pro requires a value/);
  });

  it('rejects a value that does not start with "price_"', () => {
    expect(() => parsePriceIdArgs(['--pro', 'prod_wrongshape', '--volume', 'price_vol456'])).toThrow(
      /does not look like a Stripe price id/,
    );
  });

  it('rejects a repeated flag rather than silently keeping only the first occurrence', () => {
    // The dangerous case: a user "correcting" a typo by pasting a second
    // --pro would, under a naive indexOf()-based parse, silently seed the
    // stale first value instead of the corrected second one.
    expect(() =>
      parsePriceIdArgs(['--pro', 'price_first', '--pro', 'price_second', '--volume', 'price_vol456']),
    ).toThrow(/--pro was passed 2 times/);
  });

  it('rejects an unrecognized flag instead of silently ignoring it', () => {
    expect(() =>
      parsePriceIdArgs(['--pro', 'price_pro123', '--volume', 'price_vol456', '--staging', 'price_extra']),
    ).toThrow(/Unrecognized argument "--staging"/);
  });

  it('rejects the "=" form with a specific message rather than reporting the flag as missing', () => {
    expect(() => parsePriceIdArgs(['--pro=price_pro123', '--volume', 'price_vol456'])).toThrow(
      /"--pro=\.\.\." is not supported/,
    );
  });

  it('every thrown error includes usage text', () => {
    expect(() => parsePriceIdArgs([])).toThrow(/Usage: pnpm seed:plans/);
  });
});
