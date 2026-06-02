import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Server-component / route-handler Supabase client. Reads the session from
 * cookies so RLS runs as the signed-in seller.
 */
export function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // called from a Server Component — middleware refreshes the session
          }
        },
      },
    }
  );
}
