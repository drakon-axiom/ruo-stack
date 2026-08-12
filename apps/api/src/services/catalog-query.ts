import type { Prisma } from '@ruostack/db';
import { z } from 'zod';
import { CatalogStatusEnum } from '@ruostack/shared';

/**
 * The one definition of "which catalog rows".
 *
 * The catalog screen filters client-side, so an export that must match the
 * visible table has to send those filters to the server. Two hand-written
 * copies of this where-clause would drift, and the symptom would be an export
 * quietly disagreeing with the table it was taken from -- so the list route and
 * the export route both call this.
 */
export const CatalogListQuery = z.object({
  status: CatalogStatusEnum.optional(),
  search: z.string().max(120).optional(),
  // Archived products are retired: hidden unless explicitly asked for.
  archived: z.enum(['true', 'false']).optional(),
});

export type CatalogListQueryInput = z.infer<typeof CatalogListQuery>;

/**
 * Prisma's `contains` compiles to a plain `ILIKE '%term%'` and does not escape
 * `%` or `_` in the term -- both are LIKE wildcards to Postgres, and Prisma
 * gives no way to attach a custom ESCAPE clause to `contains`. So a search for
 * "10%" would match anything containing "10", and a search containing "_"
 * would match any single character in that position -- silently widening the
 * result (and therefore the export) past what the operator typed.
 *
 * Escape with a backslash, which Postgres's LIKE/ILIKE honours as the escape
 * character by default (verified against the project's Postgres instance).
 * The backslash itself must be escaped first, or escaping "%" into "\%" would
 * introduce a backslash that then got re-escaped.
 */
export function escapeLikeTerm(term: string): string {
  return term.replace(/[\\%_]/g, '\\$&');
}

export function catalogListWhere(q: CatalogListQueryInput): Prisma.CatalogProductWhereInput {
  const search = q.search ? escapeLikeTerm(q.search) : undefined;
  return {
    archived: q.archived === 'true',
    ...(q.status ? { status: q.status } : {}),
    ...(search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' } },
            { canonicalSku: { contains: search, mode: 'insensitive' } },
            { compound: { contains: search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}
