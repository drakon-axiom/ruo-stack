import { describe, expect, it } from 'vitest';
import { EnvSchema, parseTrustProxy } from '../../src/config.js';

// Critical invariant #6: the app refuses to start if a required secret is absent.
describe('env validation', () => {
  it('rejects an empty environment (refuse to start)', () => {
    expect(EnvSchema.safeParse({}).success).toBe(false);
  });

  it('rejects a too-short admin secret', () => {
    const env = fullEnv();
    env.JWT_ADMIN_SECRET = 'short';
    expect(EnvSchema.safeParse(env).success).toBe(false);
  });

  it('rejects an MFA key that is not 32 bytes', () => {
    const env = fullEnv();
    env.MFA_ENCRYPTION_KEY = Buffer.alloc(16).toString('base64');
    expect(EnvSchema.safeParse(env).success).toBe(false);
  });

  it('rejects a store-creds key that is not 32 bytes', () => {
    const env = fullEnv();
    env.STORE_CREDS_KEY = Buffer.alloc(16).toString('base64');
    expect(EnvSchema.safeParse(env).success).toBe(false);
  });

  it('accepts a complete environment', () => {
    expect(EnvSchema.safeParse(fullEnv()).success).toBe(true);
  });

  it('defaults TRUST_PROXY to a single hop', () => {
    const parsed = EnvSchema.safeParse(fullEnv());
    expect(parsed.success && parsed.data.TRUST_PROXY).toBe('1');
  });
});

// req.ip must never be client-spoofable: TRUST_PROXY is a hop count or an
// IP/CIDR list, never the trust-all `true`.
describe('parseTrustProxy', () => {
  it('reads a bare integer as a hop count (number)', () => {
    expect(parseTrustProxy('1')).toBe(1);
    expect(parseTrustProxy(' 2 ')).toBe(2);
    expect(parseTrustProxy('0')).toBe(0);
  });

  it('passes an IP/CIDR list through as a string', () => {
    expect(parseTrustProxy('10.0.0.0/8')).toBe('10.0.0.0/8');
    expect(parseTrustProxy('127.0.0.1,10.0.0.0/8')).toBe('127.0.0.1,10.0.0.0/8');
  });

  it('never yields the trust-all boolean', () => {
    for (const v of ['1', '2', '10.0.0.0/8', 'loopback']) {
      expect(typeof parseTrustProxy(v) === 'boolean').toBe(false);
    }
  });
});

function fullEnv(): Record<string, string> {
  return {
    DATABASE_URL: 'postgresql://x:y@localhost:6543/postgres?pgbouncer=true',
    DIRECT_URL: 'postgresql://x:y@localhost:5432/postgres',
    SUPABASE_URL: 'https://test.supabase.co',
    SUPABASE_SERVICE_ROLE_KEY: 'k',
    SUPABASE_ANON_KEY: 'k',
    JWT_ADMIN_SECRET: 'a'.repeat(40),
    MFA_ENCRYPTION_KEY: Buffer.alloc(32).toString('base64'),
    STORE_CREDS_KEY: Buffer.alloc(32, 1).toString('base64'),
    STRIPE_SECRET_KEY: 'sk_test_x',
    STRIPE_WEBHOOK_SECRET: 'whsec_x',
  };
}
