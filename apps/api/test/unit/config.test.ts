import { describe, expect, it } from 'vitest';
import { EnvSchema } from '../../src/config.js';

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
