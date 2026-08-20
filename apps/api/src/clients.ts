import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPrisma, type PrismaClient } from '@ruostack/db';
import { StripeAdapter } from '@ruostack/payments';
import { ConsoleEmailAdapter, ResendEmailAdapter } from '@ruostack/email';
import type { PaymentsAdapter } from '@ruostack/shared';
import type { EmailAdapter } from '@ruostack/shared';
import { loadConfig, type AppConfig } from './config.ts';

/**
 * Shared singletons. The API is the only DB consumer (Prisma via the bypassrls
 * `prisma` role). The Supabase ADMIN client (service role) is used for brand
 * Auth admin operations (createUser, deleteUser) and is SERVER-ONLY.
 */
export interface Clients {
  prisma: PrismaClient;
  supabaseAdmin: SupabaseClient; // service role — server only
  payments: PaymentsAdapter;
  email: EmailAdapter;
}

let _clients: Clients | undefined;

export function getClients(): Clients {
  if (_clients) return _clients;
  const cfg = loadConfig();

  const supabaseAdmin = createClient(cfg.SUPABASE_URL, cfg.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const payments = new StripeAdapter({
    secretKey: cfg.STRIPE_SECRET_KEY,
    webhookSecret: cfg.STRIPE_WEBHOOK_SECRET,
  });

  _clients = {
    prisma: getPrisma(),
    supabaseAdmin,
    payments,
    email: buildEmailAdapter(cfg),
  };
  return _clients;
}

/**
 * Test-only injection seam (payments-framework §3 / Task 9 — test isolation
 * from Stripe). Every route reads clients via the module-level `getClients()`
 * singleton, so the narrowest override is to replace the singleton itself
 * rather than threading a `buildApp({ payments })` param through 33 call
 * sites. Overrides merge onto the (lazily-built) real clients, so a test can
 * swap only `payments` for a `FakePaymentsAdapter` and keep the real prisma
 * client.
 *
 * Guarded on `process.env.VITEST === 'true'` — the flag Vitest itself sets on
 * every worker process, never NODE_ENV: the DB-integration baseline run
 * (`set -a && . ./.env && set +a` then `RUN_DB_TESTS=1 vitest run`) sources
 * production secrets that include `NODE_ENV=production`, and setup.ts only
 * fills in *unset* env vars — so under that real invocation `NODE_ENV` is
 * 'production' for the whole run despite it being tests. `VITEST` has no such
 * collision: nothing outside the test runner ever sets it, so it can't be
 * true in a real deploy. Throws loudly otherwise. Nothing in
 * `apps/api/src/` calls this; only `apps/api/test/**` may.
 */
export function setClientsForTest(overrides: Partial<Clients>): void {
  if (process.env.VITEST !== 'true') {
    throw new Error(
      'setClientsForTest() is test-only and must never run outside a Vitest process. ' +
        'If you are seeing this in production, something is deeply wrong — a test seam has leaked into a real deploy.',
    );
  }
  _clients = { ...getClients(), ...overrides };
}

/** Test-only: drop the singleton so the next getClients() call rebuilds it from scratch. */
export function resetClientsForTest(): void {
  if (process.env.VITEST !== 'true') {
    throw new Error('resetClientsForTest() is test-only and must never run outside a Vitest process.');
  }
  _clients = undefined;
}

/**
 * Real sender when RESEND_API_KEY is present; console adapter otherwise (dev).
 * In production a missing key means admin invites and dunning notices print to
 * stdout instead of reaching anyone — warn loudly rather than refuse to boot, so
 * an existing deployment keeps running while the key is provisioned.
 */
function buildEmailAdapter(cfg: AppConfig): EmailAdapter {
  if (cfg.RESEND_API_KEY) {
    return new ResendEmailAdapter({ apiKey: cfg.RESEND_API_KEY, from: cfg.EMAIL_FROM });
  }
  if (cfg.NODE_ENV === 'production') {
    // eslint-disable-next-line no-console
    console.warn(
      '[email] RESEND_API_KEY is not set in production — falling back to the console adapter. ' +
        'Admin invites and dunning notices will NOT be delivered.',
    );
  }
  return new ConsoleEmailAdapter();
}
