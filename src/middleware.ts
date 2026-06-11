import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

/**
 * Refreshes the Supabase session on every request, gates the app behind auth,
 * and keeps the seller and admin portals separate: admins are bounced off
 * seller routes to /admin, sellers off /admin to /dashboard. RLS is the real
 * security boundary; this is UX routing + token refresh.
 */

// Seller-only app areas. Admins are not sellers and have no business here.
const SELLER_PREFIXES = ['/dashboard', '/onboarding', '/checkout', '/catalog'];
const ADMIN_PREFIX = '/admin';
export async function middleware(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const onAdmin = path.startsWith(ADMIN_PREFIX);
  const onSeller = SELLER_PREFIXES.some((p) => path.startsWith(p));
  const needsAuth = onAdmin || onSeller;

  if (needsAuth && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('next', path);
    return NextResponse.redirect(url);
  }

  // Keep the two portals disjoint by role.
  if (needsAuth && user) {
    const { data: profile } = await supabase
      .from('profiles')
      .select('role')
      .eq('user_id', user.id)
      .single();
    const isAdmin = profile?.role === 'admin';

    if (isAdmin && onSeller) {
      const url = request.nextUrl.clone();
      url.pathname = '/admin';
      url.search = '';
      return NextResponse.redirect(url);
    }
    if (!isAdmin && onAdmin) {
      const url = request.nextUrl.clone();
      url.pathname = '/dashboard';
      url.search = '';
      return NextResponse.redirect(url);
    }
  }

  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
