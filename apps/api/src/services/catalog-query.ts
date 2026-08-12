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

export function catalogListWhere(q: CatalogListQueryInput): Prisma.CatalogProductWhereInput {
  return {
    archived: q.archived === 'true',
    ...(q.status ? { status: q.status } : {}),
    ...(q.search
      ? {
          OR: [
            { name: { contains: q.search, mode: 'insensitive' } },
            { canonicalSku: { contains: q.search, mode: 'insensitive' } },
            { compound: { contains: q.search, mode: 'insensitive' } },
          ],
        }
      : {}),
  };
}
