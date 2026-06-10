import { AppShell } from '@/components/app-shell/AppShell';
import { createClient } from '@/lib/supabase/server';
import { redirect } from 'next/navigation';

export const dynamic = 'force-dynamic';

/**
 * Admin area gate. Middleware already guarantees a signed-in user on /admin/*;
 * here we enforce the admin role once for every admin page (RLS is still the
 * real boundary — this just controls the UI). Non-admins get a 403 inside the
 * shell rather than a redirect, so they keep their nav.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect('/login?next=/admin');

  const { data: profile } = await supabase
    .from('profiles')
    .select('role')
    .eq('user_id', user.id)
    .single();

  if (profile?.role !== 'admin') {
    return (
      <AppShell>
        <main className="mx-auto max-w-2xl px-6 py-24 text-center">
          <p className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            403
          </p>
          <h1 className="mt-2 text-2xl font-bold">Admins only</h1>
          <p className="mt-2 text-muted-foreground">
            Your account doesn’t have access to the admin area.
          </p>
        </main>
      </AppShell>
    );
  }

  return <AppShell>{children}</AppShell>;
}
