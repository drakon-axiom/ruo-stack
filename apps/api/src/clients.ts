import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { getPrisma, type PrismaClient } from '@ruostack/db';
import { StripeAdapter } from '@ruostack/payments';
import { ConsoleEmailAdapter } from '@ruostack/email';
import type { PaymentsAdapter } from '@ruostack/shared';
import type { EmailAdapter } from '@ruostack/shared';
import { loadConfig } from './config.js';

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
    membershipPriceId: cfg.STRIPE_MEMBERSHIP_PRICE_ID,
  });

  _clients = {
    prisma: getPrisma(),
    supabaseAdmin,
    payments,
    email: new ConsoleEmailAdapter(),
  };
  return _clients;
}
