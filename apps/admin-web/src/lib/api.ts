// Admin API client. Holds the admin access/refresh tokens (option a) in
// localStorage, attaches the Bearer access token, and transparently refreshes
// on 401. The service-role key NEVER reaches this app — only the admin JWT.
// Derive the API origin from the host that served this page (so it works from
// localhost, a LAN IP, or a Tailscale IP) unless VITE_API_BASE_URL overrides it.
const API_BASE =
  import.meta.env.VITE_API_BASE_URL || `${window.location.protocol}//${window.location.hostname}:3901`;

const ACCESS_KEY = 'ruostack_admin_access'; // legacy, migrated on rotation/login
const REFRESH_KEY = 'ruostack_admin_refresh';
const SESSION_KEY = 'ruostack_admin_session';
const LOCK_NAME = 'ruostack-admin-session';
export const TOKEN_CHANGE_EVENT = 'ruostack-admin-token-change';
interface StoredSession { access: string; refresh: string; generation: string }
let sessionEpoch = 0;
function readSession(): StoredSession | null {
  const stored = localStorage.getItem(SESSION_KEY);
  if (stored !== null) {
    try {
      const value = JSON.parse(stored) as StoredSession | null;
      return value && typeof value.access === 'string' && typeof value.refresh === 'string' && typeof value.generation === 'string' ? value : null;
    } catch { return null; }
  }
  const access = localStorage.getItem(ACCESS_KEY), refresh = localStorage.getItem(REFRESH_KEY);
  return access && refresh ? { access, refresh, generation: `legacy:${refresh}` } : null;
}
export function getAccess(): string | null { return readSession()?.access ?? null; }
async function sessionLock<T>(work: () => Promise<T>): Promise<T> {
  return navigator.locks ? await navigator.locks.request(LOCK_NAME, work) : await work();
}
function writeSession(value: StoredSession | null): void {
  // A single storage record prevents other tabs observing mixed token pairs.
  localStorage.setItem(SESSION_KEY, JSON.stringify(value));
  localStorage.removeItem(ACCESS_KEY); localStorage.removeItem(REFRESH_KEY);
  window.dispatchEvent(new Event(TOKEN_CHANGE_EVENT));
}
export async function setTokens(access: string, refresh: string): Promise<void> {
  sessionEpoch++;
  await sessionLock(async () => { writeSession({ access, refresh, generation: Array.from(crypto.getRandomValues(new Uint8Array(16)), b => b.toString(16).padStart(2, '0')).join('') }); });
}
export async function clearTokens(): Promise<void> {
  sessionEpoch++;
  await sessionLock(async () => { writeSession(null); });
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    /** The parsed error body, for responses that carry more than a message
     *  (the import's 409 hands back a freshly recomputed preview). */
    public body?: unknown,
  ) {
    super(message);
  }
}

let refreshing: { epoch: number; promise: Promise<boolean> } | undefined;
async function refresh(failedAccess: string | null, epoch: number, generation: string | undefined): Promise<boolean> {
  const unchanged = () => epoch === sessionEpoch && generation !== undefined && readSession()?.generation === generation;
  if (!unchanged()) return false;
  if (getAccess() !== failedAccess) return getAccess() !== null;
  if (refreshing?.epoch === epoch) return refreshing.promise;
  // Without origin-wide locking, require a new sign-in instead of racing tabs.
  if (!navigator.locks) return false;
  const promise = sessionLock(async () => {
    if (!unchanged()) return false;
    const session = readSession();
    if (!session) return false;
    if (session.access !== failedAccess) return true;
    const res = await fetch(`${API_BASE}/auth/admin/refresh`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: session.refresh }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return false;
    const data = await res.json();
    if (!unchanged() || readSession()?.refresh !== session.refresh) return false;
    writeSession({ access: data.access_token, refresh: data.refresh_token, generation: session.generation });
    return true;
  });
  refreshing = { epoch, promise };
  try { return await promise; }
  finally { if (refreshing?.promise === promise) refreshing = undefined; }
}

export async function api<T = unknown>(
  path: string,
  opts: { method?: string; body?: unknown; auth?: boolean; retry?: boolean } = {},
  expectedGeneration?: string,
): Promise<T> {
  const epoch = sessionEpoch;
  const session = readSession();
  if (expectedGeneration !== undefined && session?.generation !== expectedGeneration) throw new ApiError(401, 'unauthorized', 'Session changed; sign in again');
  const generation = session?.generation;
  const { method = 'GET', body, auth = true, retry = true } = opts;
  const hasBody = body !== undefined;
  const headers: Record<string, string> = {};
  // Only set the JSON content-type when a body is actually sent — Fastify rejects
  // an empty body when content-type is application/json (e.g. bodyless POSTs like publish).
  if (hasBody) headers['content-type'] = 'application/json';
  if (auth) {
    const token = session?.access;
    if (token) headers.authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: hasBody ? JSON.stringify(body) : undefined,
  });

  if (res.status === 401 && auth && retry && (await refresh(headers.authorization?.slice(7) ?? null, epoch, generation)) && readSession()?.generation === generation) {
    return api<T>(path, { ...opts, retry: false }, generation);
  }
  if (!res.ok) {
    let code = 'error';
    let message = res.statusText;
    let payload: unknown;
    try {
      const j = await res.json();
      payload = j;
      code = j.error ?? code;
      message = j.message ?? message;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(res.status, code, message, payload);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

// ── Auth flows (option a) ────────────────────────────────────────────────────
export interface LoginResult {
  mfa_enrollment_required?: boolean;
  mfa_required?: boolean;
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

export async function logout(): Promise<void> {
  sessionEpoch++;
  const refreshToken = await sessionLock(async () => {
    const token = readSession()?.refresh;
    writeSession(null);
    return token;
  });
  if (refreshToken) {
    await fetch(`${API_BASE}/auth/admin/logout`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ refresh_token: refreshToken }),
      signal: AbortSignal.timeout(15_000),
    }).catch(() => {});
  }
}

/**
 * Hand the browser a file we built locally (the import template, the import
 * error report). Same blob mechanic as `apiDownload`, without a round trip —
 * there is nothing on the server to fetch.
 */
export function downloadText(filename: string, text: string, type = 'text/csv;charset=utf-8'): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * Download an authenticated file (CSV exports). Mirrors `api()`'s auth handling
 * but keeps the response as a blob, and retries once through the refresh flow so
 * an export doesn't fail on a token that expired while the operator was reading.
 */
export async function apiDownload(path: string, filename: string, retry = true, expectedGeneration?: string): Promise<void> {
  const epoch = sessionEpoch;
  const session = readSession();
  if (expectedGeneration !== undefined && session?.generation !== expectedGeneration) throw new ApiError(401, 'unauthorized', 'Session changed; sign in again');
  const generation = session?.generation;
  const headers: Record<string, string> = {};
  const token = session?.access;
  if (token) headers.authorization = `Bearer ${token}`;

  const res = await fetch(`${API_BASE}${path}`, { headers });
  if (res.status === 401 && retry && (await refresh(headers.authorization?.slice(7) ?? null, epoch, generation)) && readSession()?.generation === generation) return apiDownload(path, filename, false, generation);
  if (!res.ok) {
    let code = 'download_failed';
    let message = 'Download failed';
    try {
      const j = await res.json();
      code = j.error ?? code;
      message = j.message ?? message;
    } catch {
      /* non-JSON */
    }
    throw new ApiError(res.status, code, message);
  }

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
