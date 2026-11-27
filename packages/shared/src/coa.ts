import { z } from 'zod';
export const COA_MAX_BYTES = 10 * 1024 * 1024;
export function classifyLegacyCoa(input: string | null | undefined): { kind: 'url' | 'reference' | 'empty'; value: string | null } {
  const value = input?.trim();
  if (!value) return { kind: 'empty', value: null };
  try {
    const url = new URL(value);
    if (value.length <= 2048 && /^https:\/\//i.test(value) && !/[\s\\]/.test(value) && url.protocol === 'https:' && !url.username && !url.password) return { kind: 'url', value };
  } catch { /* opaque legacy reference */ }
  return { kind: 'reference', value };
}
export const CoaReferenceSchema = z.string().trim().max(2048).refine(value =>
  !value || classifyLegacyCoa(value).kind === 'url' || (value.length <= 120 && !/^[a-z][a-z\d+.-]*:|[\/\\]/i.test(value)),
  'Use an HTTPS URL without credentials, or a plain COA reference (up to 120 characters)',
);
