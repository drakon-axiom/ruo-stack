import { createClient } from '@supabase/supabase-js';

/**
 * SERVICE-ROLE client. Bypasses RLS — use ONLY in trusted server contexts
 * (route handlers / cron), NEVER in a Client Component. Money-moving writes
 * should still go through the SECURITY DEFINER RPCs (credit_wallet, etc.)
 * rather than raw table writes, so the ledger invariant holds.
 */
export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } }
  );
}
