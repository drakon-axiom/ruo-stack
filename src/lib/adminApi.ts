'use client';

import { createClient } from '@/lib/supabase/client';

/**
 * Thin client-side wrapper around the `admin-api` edge function. The user's
 * session JWT rides along automatically; the function re-checks admin on every
 * action and writes an audit-log row. Surfaces the function's `{ error }` body
 * (not just the opaque HTTP error) so callers can show a useful message.
 */
export async function adminApi<T = unknown>(
  action: string,
  payload?: Record<string, unknown>
): Promise<T> {
  const supabase = createClient();
  const { data, error } = await supabase.functions.invoke('admin-api', {
    body: { action, payload },
  });

  if (error) {
    // FunctionsHttpError carries the response; pull the JSON body for the real message.
    let message = error.message;
    try {
      const body = await (error as { context?: Response }).context?.json();
      if (body?.error) message = body.error;
    } catch {
      /* non-JSON body — fall back to the generic message */
    }
    throw new Error(message);
  }
  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error(String((data as { error: unknown }).error));
  }
  return data as T;
}
