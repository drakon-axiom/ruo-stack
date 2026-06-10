import { createClient } from '@/lib/supabase/server';
import { AppShellClient } from './AppShellClient';

/**
 * Server wrapper for the signed-in app chrome (sidebar + top bar). Fetches the
 * brand identity, role, and wallet balance once per request and hands them to
 * the interactive client shell. Applied to every authenticated segment via that
 * segment's layout.tsx.
 */
export async function AppShell({ children }: { children: React.ReactNode }) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let brandName: string | null = null;
  let logoUrl: string | null = null;
  let role = 'seller';
  let balance = 0;
  let subscriptionActive = false;

  if (user) {
    const [{ data: profile }, { data: wallet }] = await Promise.all([
      supabase
        .from('profiles')
        .select('brand_name, logo_url, role, subscription_status, subscription_bypass')
        .single(),
      // Admins may not have a wallet row — don't throw if it's missing.
      supabase.from('wallets').select('balance').maybeSingle(),
    ]);
    brandName = profile?.brand_name ?? null;
    logoUrl = profile?.logo_url ?? null;
    role = profile?.role ?? 'seller';
    subscriptionActive =
      profile?.subscription_status === 'active' || Boolean(profile?.subscription_bypass);
    balance = Number(wallet?.balance ?? 0);
  }

  return (
    <AppShellClient
      email={user?.email ?? ''}
      brandName={brandName}
      logoUrl={logoUrl}
      role={role}
      balance={balance}
      subscriptionActive={subscriptionActive}
    >
      {children}
    </AppShellClient>
  );
}
