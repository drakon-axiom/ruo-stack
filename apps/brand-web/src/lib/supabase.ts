import { createClient } from '@supabase/supabase-js';

// Brand realm talks to Supabase Auth directly via supabase-js (login, refresh,
// logout, email confirmation, password reset). Only the ANON (public) key is
// shipped here — never the service-role key.
export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY,
);
