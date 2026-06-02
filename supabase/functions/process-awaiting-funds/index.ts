// Re-process orders parked at awaiting_funds for the calling seller (e.g. after
// a wallet top-up). Idempotent: stops as soon as the wallet can't cover the
// next order. Normally invoked automatically by credit_deposit(), but exposed
// here so a seller can retry manually.
import { corsHeaders, json } from '../_shared/cors.ts';
import { adminClient, requireUser } from '../_shared/client.ts';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  try {
    const userId = await requireUser(req);
    const admin = adminClient();
    const { data, error } = await admin.rpc('process_awaiting_funds', { p_user: userId });
    if (error) throw error;
    return json({ resumed: data });
  } catch (e) {
    return json({ error: String((e as Error).message ?? e) }, 400);
  }
});
