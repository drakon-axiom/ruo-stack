// Admin API client. Holds the admin access/refresh tokens (option a) in
// localStorage, attaches the Bearer access token, and transparently refreshes
// on 401. The service-role key NEVER reaches this app — only the admin JWT.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3901';

const ACCESS_KEY = 'ruostack_admin_access';
const REFRESH_KEY = 'ruostack_admin_refresh';

export function getAccess(): string | null {
  return localStorage.getItem(ACCESS_KEY);
}
export function setTokens(access: string, refresh: string): void {
  localStorage.setItem(ACCESS_KEY, access);
  localStorage.setItem(REFRESH_KEY, refresh);
}
export function clearTokens(): void {
  localStorage.removeItem(ACCESS_KEY);
  localStorage.removeItem(REFRESH_KEY);
}

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

async function refresh(): Promise<boolean> {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (!refreshToken) return false;
  const res = await fetch(`${API_BASE}/auth/admin/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refresh_token: refreshToken }),
  });
  if (!res.ok) return false;
  const data = await res.json();
  setTokens(data.access_token, data.refresh_token);
  return true;
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean; retry?: boolean } = {},
): Promise<T> {
  const { method = 'GET', body, auth = true, retry = true } = opts;
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (auth) {
    const token = getAccess();
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  if (res.status === 401 && auth && retry && (await refresh())) {
    return api<T>(path, { ...opts, retry: false });
  }
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

// ── Auth flows (option a) ────────────────────────────────────────────────────
export interface LoginResult {
  mfa_enrollment_required?: boolean;
  enrollment_token?: string;
  access_token?: string;
  refresh_token?: string;
}

export async function login(email: string, password: string, totp?: string): Promise<LoginResult> {
  return api<LoginResult>('/auth/admin/login', { method: 'POST', auth: false, body: { email, password, totp } });
}

export async function mfaEnroll(enrollmentToken: string): Promise<{ secret: string; otpauth_uri: string }> {
  const res = await fetch(`${API_BASE}/auth/admin/mfa/enroll`, {
    method: 'POST',
    headers: { authorization: `Bearer ${enrollmentToken}` },
  });
  if (!res.ok) throw new ApiError(res.status, 'enroll_failed', 'Enrollment failed');
  return res.json();
}

export async function mfaVerify(enrollmentToken: string, totp: string): Promise<LoginResult> {
  const res = await fetch(`${API_BASE}/auth/admin/mfa/verify`, {
    method: 'POST',
    headers: { authorization: `Bearer ${enrollmentToken}`, 'content-type': 'application/json' },
    body: JSON.stringify({ totp }),
  });
  if (!res.ok) throw new ApiError(res.status, 'verify_failed', 'Verification failed');
  return res.json();
}

export function logout(): void {
  const refreshToken = localStorage.getItem(REFRESH_KEY);
  if (refreshToken) {
    void fetch(`${API_BASE}/auth/admin/logout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });
  }
  clearTokens();
}
