import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import type { AdminRole } from '@ruostack/shared';
import { getAccess, clearTokens } from './api.js';

interface AdminClaims {
  sub: string;
  role: AdminRole;
}

/** Decode (not verify) the admin JWT for display/UI gating. The server is the
 * real authority — these claims only drive what the UI shows. */
function decode(token: string | null): AdminClaims | null {
  if (!token) return null;
  try {
    const payload = JSON.parse(atob(token.split('.')[1] ?? ''));
    if (payload.realm !== 'admin') return null;
    return { sub: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

interface AuthCtx {
  claims: AdminClaims | null;
  refresh(): void;
  signOut(): void;
}

const Ctx = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(getAccess());
  const value = useMemo<AuthCtx>(
    () => ({
      claims: decode(token),
      refresh: () => setToken(getAccess()),
      signOut: () => {
        clearTokens();
        setToken(null);
      },
    }),
    [token],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
