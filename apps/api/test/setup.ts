import { installStripeNetworkRail } from './stripe-network-rail.ts';

// Test env defaults. Real secrets only matter for the DB-integration tests,
// which self-skip unless RUN_DB_TESTS=1 and real connection strings are present.
const defaults: Record<string, string> = {
  NODE_ENV: 'test',
  DATABASE_URL: process.env.DATABASE_URL ?? 'postgresql://x:y@localhost:6543/postgres?pgbouncer=true',
  DIRECT_URL: process.env.DIRECT_URL ?? 'postgresql://x:y@localhost:5432/postgres',
  SUPABASE_URL: 'https://test.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'test-service-role',
  SUPABASE_ANON_KEY: 'test-anon',
  JWT_ADMIN_SECRET: 'test-admin-secret-at-least-32-characters-long-xx',
  MFA_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  STORE_CREDS_KEY: Buffer.alloc(32, 11).toString('base64'),
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_dummy',
  CORS_ORIGINS: 'http://localhost:3902,http://localhost:3903',
};

for (const [k, v] of Object.entries(defaults)) {
  if (!process.env[k]) process.env[k] = v;
}

// The hard network rail (Task 9): throws on any outbound request to
// api.stripe.com, over both `fetch` and the Stripe SDK's own node:http(s)
// client. Installed unconditionally for every test file — see
// stripe-network-rail.ts for exactly what this does and does not cover. Does
// NOT touch other hosts (e.g. the Supabase pooler DB-integration tests talk
// to), which is proven in test/unit/stripe-network-rail.test.ts.
installStripeNetworkRail();
