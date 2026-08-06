import { describe, expect, it } from 'vitest';
import { WalletAdjustSchema } from '@ruostack/shared';

// A manual wallet adjustment is an audited but irreversible ledger write — it
// must be bounded like every other money field.
describe('WalletAdjustSchema', () => {
  it('accepts a bounded positive or negative adjustment', () => {
    expect(WalletAdjustSchema.safeParse({ amount_cents: 5000, reason: 'goodwill' }).success).toBe(true);
    expect(WalletAdjustSchema.safeParse({ amount_cents: -5000, reason: 'correction' }).success).toBe(true);
  });

  it('rejects zero', () => {
    expect(WalletAdjustSchema.safeParse({ amount_cents: 0, reason: 'x' }).success).toBe(false);
  });

  it('rejects an out-of-range (trillion-cent) adjustment', () => {
    expect(WalletAdjustSchema.safeParse({ amount_cents: 1_000_000_000_000, reason: 'x' }).success).toBe(false);
    expect(WalletAdjustSchema.safeParse({ amount_cents: -1_000_000_000_000, reason: 'x' }).success).toBe(false);
  });

  it('requires a reason', () => {
    expect(WalletAdjustSchema.safeParse({ amount_cents: 100, reason: '' }).success).toBe(false);
  });
});
