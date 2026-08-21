import { afterEach, describe, expect, it } from 'vitest';
import { getClients, resetClientsForTest, setClientsForTest } from '../../src/clients.ts';
import { FakePaymentsAdapter } from '../FakePaymentsAdapter.ts';

// Proves the test-only injection seam (Task 9): a route calling the module
// singleton `getClients()` sees the swapped-in fake, and the guard refuses
// to run outside NODE_ENV=test.
describe('setClientsForTest', () => {
  afterEach(() => {
    resetClientsForTest();
  });

  it('overrides payments while leaving the rest of the singleton intact', () => {
    const before = getClients();
    const fake = new FakePaymentsAdapter();
    setClientsForTest({ payments: fake });

    const after = getClients();
    expect(after.payments).toBe(fake);
    expect(after.prisma).toBe(before.prisma);
    expect(after.supabaseAdmin).toBe(before.supabaseAdmin);
  });

  it('refuses to run outside a Vitest process (checked via VITEST, not NODE_ENV)', () => {
    // The real DB-integration baseline run sources a .env with
    // NODE_ENV=production, so the guard deliberately does NOT trust
    // NODE_ENV — only the VITEST flag Vitest itself sets. Flip just that off.
    const original = process.env.VITEST;
    process.env.VITEST = 'false';
    try {
      expect(() => setClientsForTest({ payments: new FakePaymentsAdapter() })).toThrow(/test-only/);
    } finally {
      process.env.VITEST = original;
    }
  });

  it('resetClientsForTest also refuses to run outside a Vitest process', () => {
    const original = process.env.VITEST;
    process.env.VITEST = 'false';
    try {
      expect(() => resetClientsForTest()).toThrow(/test-only/);
    } finally {
      process.env.VITEST = original;
    }
  });
});
