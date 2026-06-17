import { supabase } from './supabase.js';

// Brand API client. The Bearer token is the Supabase access token (carrying the
// realm:'brand' + brand_id claims injected by custom_access_token_hook). Signup
// is the one unauthenticated call (it creates the auth user + brand atomically).
// Derive the API origin from the host that served this page (so it works from
// localhost, a LAN IP, or a Tailscale IP) unless VITE_API_BASE_URL overrides it.
const API_BASE =
  import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:3901`;

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
  const hasBody = body !== undefined;
  const headers: Record<string, string> = {};
  // Only set the JSON content-type when a body is actually sent — Fastify rejects
  // an empty body when content-type is application/json (e.g. bodyless POSTs).
  if (hasBody) headers['content-type'] = 'application/json';
  if (auth) {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
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

/** Authenticated file download → triggers a browser save of the response body. */
export async function apiDownload(path: string, filename: string): Promise<void> {
  const headers: Record<string, string> = {};
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (!res.ok) throw new ApiError(res.status, 'download_failed', 'Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
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
