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
  STRIPE_SECRET_KEY: 'sk_test_dummy',
  STRIPE_WEBHOOK_SECRET: 'whsec_test_dummy',
  CORS_ORIGINS: 'http://localhost:3902,http://localhost:3903',
};

for (const [k, v] of Object.entries(defaults)) {
  if (!process.env[k]) process.env[k] = v;
}
