import { createClient, SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

/** Service-role client — bypasses RLS. Server-trusted contexts only. */
export function adminClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } }
  );
}

/**
 * Resolve the calling user from the request's Authorization bearer token.
 * Returns the user id or throws — use this to attribute actions to a seller
 * even though the function itself runs with the service role.
 */
export async function requireUser(req: Request): Promise<string> {
  const authHeader = req.headers.get('Authorization');
  if (!authHeader) throw new Error('missing Authorization header');

  const client = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } }
  );
  const {
    data: { user },
    error,
  } = await client.auth.getUser();
  if (error || !user) throw new Error('invalid or expired session');
  return user.id;
}

/** Throw unless the calling user has profiles.role = 'admin'. */
export async function requireAdmin(req: Request): Promise<string> {
  const userId = await requireUser(req);
  const admin = adminClient();
  const { data } = await admin
    .from('profiles')
    .select('role')
    .eq('user_id', userId)
    .single();
  if (data?.role !== 'admin') throw new Error('admin only');
  return userId;
}
