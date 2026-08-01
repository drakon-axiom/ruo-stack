import { Prisma, type PrismaClient } from '@ruostack/db';

/**
 * Brand Notifications inbox — the read side of Announcements (architecture §1.3).
 *
 * The feed is DERIVED, never fanned out: there is no per-brand notification row,
 * so publishing writes one row, a brand created today still sees the platform's
 * live broadcasts, and there is no scheduler to run. Read receipts are per USER
 * (brand staff each track their own inbox); absence of a row means unread.
 *
 * `visibleTo` below is the SQL-side twin of `isAnnouncementVisible`
 * (@ruostack/shared) and of the RLS policy in migration 022. All three encode
 * one rule; the predicate lives in JS for the admin preview, and here as a
 * Prisma filter so the database does the filtering rather than the API pulling
 * every announcement on every poll. If one changes, change all three.
 */
export function visibleTo(brandId: string, now: Date): Prisma.AnnouncementWhereInput {
  return {
    status: 'published',
    AND: [
      { OR: [{ publishAt: null }, { publishAt: { lte: now } }] },
      { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
      // `segment` deliberately matches nothing until segment targeting exists —
      // failing closed, so a half-built feature can't broadcast to everyone.
      { OR: [{ audience: 'all_brands' }, { audience: 'single_brand', brandId }] },
    ],
  };
}

export interface FeedItem {
  id: string;
  type: string;
  title: string;
  body: string;
  published_at: Date;
  read_at: Date | null;
}

export async function getFeed(
  prisma: PrismaClient,
  brandId: string,
  userId: string,
  opts: { unreadOnly?: boolean; limit?: number; now?: Date } = {},
): Promise<FeedItem[]> {
  const now = opts.now ?? new Date();
  const rows = await prisma.announcement.findMany({
    where: {
      ...visibleTo(brandId, now),
      ...(opts.unreadOnly ? { reads: { none: { userId } } } : {}),
    },
    include: { reads: { where: { userId }, select: { readAt: true } } },
    // Newest first by the moment it became visible, not by authoring time — a
    // broadcast scheduled last week for today belongs at the top.
    orderBy: [{ publishAt: 'desc' }, { createdAt: 'desc' }],
    take: opts.limit ?? 50,
  });

  return rows.map((a) => ({
    id: a.id,
    type: a.type,
    title: a.title,
    body: a.body,
    published_at: a.publishAt ?? a.createdAt,
    read_at: a.reads[0]?.readAt ?? null,
  }));
}

export async function getUnreadCount(
  prisma: PrismaClient,
  brandId: string,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  return prisma.announcement.count({
    where: { ...visibleTo(brandId, now), reads: { none: { userId } } },
  });
}

/**
 * Mark one read. Returns null when the announcement isn't visible to this brand
 * — the caller 404s, so a guessed id can't confirm another brand's message
 * exists. Idempotent: re-reading keeps the ORIGINAL read_at.
 */
export async function markRead(
  prisma: PrismaClient,
  brandId: string,
  userId: string,
  announcementId: string,
  now: Date = new Date(),
): Promise<Date | null> {
  const visible = await prisma.announcement.findFirst({
    where: { id: announcementId, ...visibleTo(brandId, now) },
    select: { id: true },
  });
  if (!visible) return null;

  const read = await prisma.announcementRead.upsert({
    where: { announcementId_userId: { announcementId, userId } },
    create: { announcementId, userId },
    update: {},
  });
  return read.readAt;
}

export async function markAllRead(
  prisma: PrismaClient,
  brandId: string,
  userId: string,
  now: Date = new Date(),
): Promise<number> {
  const unread = await prisma.announcement.findMany({
    where: { ...visibleTo(brandId, now), reads: { none: { userId } } },
    select: { id: true },
  });
  if (unread.length === 0) return 0;

  // skipDuplicates covers the race where another tab marked one read between
  // this SELECT and the INSERT.
  const result = await prisma.announcementRead.createMany({
    data: unread.map((a) => ({ announcementId: a.id, userId })),
    skipDuplicates: true,
  });
  return result.count;
}
