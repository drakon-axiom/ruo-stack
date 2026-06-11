import { supabase } from './supabase.js';

// Brand API client. The Bearer token is the Supabase access token (carrying the
// realm:'brand' + brand_id claims injected by custom_access_token_hook). Signup
// is the one unauthenticated call (it creates the auth user + brand atomically).
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3901';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true } = opts;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    let code = 'error';
    let message = res.statusText;
    try {
      const j = await res.json();
      code = j.error ?? code;
      message = j.message ?? message;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(res.status, code, message);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

/** Signup: API creates auth.users + Brand atomically, then we sign in. */
export async function signupBrand(input: {
  full_name: string;
  email: string;
  password: string;
  brand_name: string;
  ref?: string;
}): Promise<void> {
  await api('/api/brand/signup', { method: 'POST', auth: false, body: input });
}
