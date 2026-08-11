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
