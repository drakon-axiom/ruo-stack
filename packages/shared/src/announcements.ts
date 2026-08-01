import { z } from 'zod';

/**
 * Announcements (architecture §1.1 / §1.3) — operator broadcasts that surface in
 * the brand Notifications inbox.
 *
 * The inbox is DERIVED, not fanned out: there is no per-brand notification row.
 * Visibility is computed from (audience, status, publishAt, expiresAt) at read
 * time, which means no scheduler, no backfill for new brands, and one row per
 * broadcast. `isAnnouncementVisible` below is the single definition of that rule
 * — the RLS policy in migration 022 encodes the same predicate in SQL.
 */
export const ANNOUNCEMENT_AUDIENCES = ['all_brands', 'segment', 'single_brand'] as const;
export type AnnouncementAudience = (typeof ANNOUNCEMENT_AUDIENCES)[number];

export const ANNOUNCEMENT_TYPES = ['announcement', 'restock', 'maintenance'] as const;
export type AnnouncementType = (typeof ANNOUNCEMENT_TYPES)[number];

/**
 * Author intent. NOTE — the architecture doc lists `draft | scheduled |
 * published`; "scheduled" is omitted deliberately because it is fully derivable
 * from `publishAt > now`, and storing it too would need a worker to reconcile
 * the two. The admin UI shows a derived "Scheduled" chip instead.
 */
export const ANNOUNCEMENT_STATUSES = ['draft', 'published', 'archived'] as const;
export type AnnouncementStatus = (typeof ANNOUNCEMENT_STATUSES)[number];

const TYPE_LABEL: Record<AnnouncementType, string> = {
  announcement: 'Announcement',
  restock: 'Restock',
  maintenance: 'Maintenance',
};
export const announcementTypeLabel = (t: AnnouncementType): string => TYPE_LABEL[t];

export interface AnnouncementVisibility {
  audience: AnnouncementAudience;
  brandId: string | null;
  status: AnnouncementStatus;
  publishAt: Date | string | null;
  expiresAt: Date | string | null;
}

const toDate = (v: Date | string | null): Date | null => (v == null ? null : v instanceof Date ? v : new Date(v));

/**
 * Is this announcement visible to `brandId` right now? The one rule the API, the
 * admin preview and the RLS policy all agree on.
 *
 * `segment` is reserved and never matches until segment targeting is defined —
 * failing CLOSED, so a half-built segment feature can't broadcast to everyone.
 */
export function isAnnouncementVisible(
  a: AnnouncementVisibility,
  brandId: string,
  now: Date = new Date(),
): boolean {
  if (a.status !== 'published') return false;

  const publishAt = toDate(a.publishAt);
  if (publishAt && publishAt > now) return false; // scheduled for later

  const expiresAt = toDate(a.expiresAt);
  if (expiresAt && expiresAt <= now) return false; // expired

  if (a.audience === 'all_brands') return true;
  if (a.audience === 'single_brand') return a.brandId === brandId;
  return false; // `segment` — reserved, matches nothing yet
}

/** Derived display state for the admin list — never persisted. */
export function announcementDisplayState(
  a: Pick<AnnouncementVisibility, 'status' | 'publishAt' | 'expiresAt'>,
  now: Date = new Date(),
): 'draft' | 'scheduled' | 'live' | 'expired' | 'archived' {
  if (a.status === 'draft') return 'draft';
  if (a.status === 'archived') return 'archived';
  const publishAt = toDate(a.publishAt);
  if (publishAt && publishAt > now) return 'scheduled';
  const expiresAt = toDate(a.expiresAt);
  if (expiresAt && expiresAt <= now) return 'expired';
  return 'live';
}

const isoDate = z.union([z.string().datetime({ offset: true }), z.string().datetime()]).nullish();

/**
 * Audience and brand_id must agree — mirrored by a CHECK constraint in the DB so
 * an inconsistent row can't be written even outside this schema.
 */
const audienceRefinement = <T extends { audience?: AnnouncementAudience; brand_id?: string | null }>(
  data: T,
  ctx: z.RefinementCtx,
): void => {
  if (data.audience === 'single_brand' && !data.brand_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['brand_id'], message: 'brand_id is required when audience is single_brand' });
  }
  if (data.audience && data.audience !== 'single_brand' && data.brand_id) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['brand_id'], message: 'brand_id is only valid when audience is single_brand' });
  }
  if (data.audience === 'segment') {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['audience'], message: 'segment targeting is not implemented yet' });
  }
};

export const AnnouncementCreateSchema = z
  .object({
    audience: z.enum(ANNOUNCEMENT_AUDIENCES).default('all_brands'),
    brand_id: z.string().uuid().nullish(),
    type: z.enum(ANNOUNCEMENT_TYPES).default('announcement'),
    title: z.string().min(1).max(200),
    body: z.string().min(1).max(10_000),
    publish_at: isoDate,
    expires_at: isoDate,
  })
  .superRefine(audienceRefinement);
export type AnnouncementCreate = z.infer<typeof AnnouncementCreateSchema>;

export const AnnouncementUpdateSchema = z
  .object({
    audience: z.enum(ANNOUNCEMENT_AUDIENCES).optional(),
    brand_id: z.string().uuid().nullish(),
    type: z.enum(ANNOUNCEMENT_TYPES).optional(),
    title: z.string().min(1).max(200).optional(),
    body: z.string().min(1).max(10_000).optional(),
    publish_at: isoDate,
    expires_at: isoDate,
    status: z.enum(ANNOUNCEMENT_STATUSES).optional(),
  })
  .superRefine(audienceRefinement);
export type AnnouncementUpdate = z.infer<typeof AnnouncementUpdateSchema>;
