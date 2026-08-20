import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from './auth.js';
import { api } from './api.js';
import { WelcomeTour } from '../components/WelcomeTour.js';

interface OnboardingCtx {
  /** Reopen the tour without touching server state (Account → Replay). */
  replay(): void;
}

const Ctx = createContext<OnboardingCtx | null>(null);

interface MeOnboarding {
  profile: { full_name: string; onboarding_completed_at: string | null };
}

/**
 * Decides whether the first-run welcome tour is on screen.
 *
 * Mounted at the ROOT (main.tsx), not inside Protected: Protected is
 * instantiated per-route, so it remounts on every navigation and a provider
 * living there would refetch /api/brand/me and re-evaluate the modal each time
 * the user changed screens. Here it fetches once per session.
 */
export function OnboardingProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [checked, setChecked] = useState(false);

  // Only signed-in users inside the app shell. A signed-in user who navigates
  // back to /login would otherwise get a welcome modal over the login form.
  const eligible = Boolean(session) && pathname.startsWith('/app');

  useEffect(() => {
    if (!eligible || checked) return;
    let cancelled = false;
    void api<MeOnboarding>('/api/brand/me')
      .then((me) => {
        if (cancelled) return;
        setFirstName(me.profile.full_name.trim().split(/\s+/)[0] ?? '');
        if (!me.profile.onboarding_completed_at) setOpen(true);
        setChecked(true);
      })
      .catch(() => {
        // A failed /me read must never wedge the app. Treat it as "already
        // onboarded" and stop asking — the tour is a nicety, not a gate.
        if (!cancelled) setChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [eligible, checked]);

  // Forget what we learned whenever the signed-in identity changes, not just on
  // sign-out. Login (screens/Auth.tsx) never redirects an already-signed-in
  // visitor away from /login, and supabase-js's signInWithPassword on top of an
  // existing session emits SIGNED_IN with a *new* session — it never passes
  // through SIGNED_OUT. So a user who lands back on /login while still signed in
  // (back button, stale tab, typed URL) and signs in as someone else swaps
  // session.user.id directly from A to B, with no falsy session in between. The
  // old `if (!session)` guard missed that swap: `checked` and `firstName` would
  // stay A's. Keying the dependency on the user id (rather than the session
  // object) and resetting unconditionally whenever this effect re-runs handles
  // both sign-out (id -> undefined) and an A -> B swap (id_A -> id_B), and, as a
  // side benefit, no longer re-runs on a same-user token refresh (a new session
  // object, same id) the way depending on `session` did.
  useEffect(() => {
    setChecked(false);
    setOpen(false);
    setFirstName('');
  }, [session?.user.id]);

  const dismiss = useCallback(
    (finished: boolean) => {
      // Close first, persist second, and never await: the user should not wait on
      // a network round-trip to dismiss an explainer. A failed write costs them one
      // extra viewing, which is strictly better than a modal that will not close.
      setOpen(false);
      void api('/api/brand/onboarding/complete', { method: 'POST' }).catch(() => undefined);
      // Slide 5 tells the user their checklist lives on Overview, so finishing
      // takes them there. Someone who hit Skip asked to be left alone, and
      // yanking them to another screen is not that.
      if (finished) navigate('/app/overview');
    },
    [navigate],
  );

  const replay = useCallback(() => setOpen(true), []);

  return (
    <Ctx.Provider value={{ replay }}>
      {children}
      {eligible && <WelcomeTour open={open} firstName={firstName} onDismiss={dismiss} />}
    </Ctx.Provider>
  );
}

export function useOnboarding(): OnboardingCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useOnboarding outside OnboardingProvider');
  return ctx;
}
