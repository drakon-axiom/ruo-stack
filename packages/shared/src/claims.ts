import { z } from 'zod';

/** Claims (§11): post-ship remedy path — no customer refunds once an order ships. */
export const CLAIM_TYPES = ['lost', 'damaged', 'missing_item', 'item_not_received', 'wrong_item'] as const;
export type ClaimType = (typeof CLAIM_TYPES)[number];

export const CLAIM_STATUSES = ['open', 'investigating', 'carrier_filed', 'resolved'] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const CLAIM_RESOLUTIONS = ['reshipped', 'credited', 'denied'] as const;
export type ClaimResolution = (typeof CLAIM_RESOLUTIONS)[number];

/** Days to resolve a claim (SLA timer in the admin queue). */
export const CLAIM_SLA_DAYS = 5;
/** A lost claim can only be opened after this many days without delivery. */
export const LOST_NO_MOVEMENT_DAYS = 10;
/** Window (days from delivery/ship) to report damaged / missing / wrong / not-received. */
export const CLAIM_WINDOW_DAYS = 5;

const CLAIM_TYPE_LABEL: Record<ClaimType, string> = {
  lost: 'Lost in transit',
  damaged: 'Arrived damaged',
  missing_item: 'Missing item',
  item_not_received: 'Not received (shows delivered)',
  wrong_item: 'Wrong item',
};
export const claimTypeLabel = (t: ClaimType): string => CLAIM_TYPE_LABEL[t];

export interface ClaimOrderInfo {
  status: string; // order status
  shippedAt: Date | string | null;
  deliveredAt: Date | string | null;
}

const toDate = (v: Date | string | null): Date | null => (v == null ? null : v instanceof Date ? v : new Date(v));
const daysBetween = (a: Date, b: Date) => (a.getTime() - b.getTime()) / 86_400_000;

/** Is a claim of this type eligible for this order right now? */
export function claimEligibility(type: ClaimType, order: ClaimOrderInfo, now: Date = new Date()): { eligible: boolean; reason?: string } {
  if (order.status !== 'shipped' && order.status !== 'delivered') {
    return { eligible: false, reason: 'Claims can only be filed once an order has shipped.' };
  }
  const shippedAt = toDate(order.shippedAt);
  const deliveredAt = toDate(order.deliveredAt);

  if (type === 'lost') {
    if (deliveredAt) return { eligible: false, reason: 'Tracking shows delivered — file a "not received" claim instead.' };
    if (!shippedAt || daysBetween(now, shippedAt) < LOST_NO_MOVEMENT_DAYS) {
      return { eligible: false, reason: `Lost claims can be opened after ${LOST_NO_MOVEMENT_DAYS} days without delivery.` };
    }
    return { eligible: true };
  }

  // damaged / missing_item / item_not_received / wrong_item — within the window of
  // delivery (or ship date if not yet marked delivered).
  const ref = deliveredAt ?? shippedAt;
  if (!ref) return { eligible: false, reason: 'No ship/delivery date on the order yet.' };
  if (daysBetween(now, ref) > CLAIM_WINDOW_DAYS) {
    return { eligible: false, reason: `This claim type must be reported within ${CLAIM_WINDOW_DAYS} days.` };
  }
  return { eligible: true };
}

export const ClaimOpenSchema = z.object({
  type: z.enum(CLAIM_TYPES),
  description: z.string().max(2000).optional(),
  photos: z.array(z.string().url()).max(10).default([]),
});
export type ClaimOpen = z.infer<typeof ClaimOpenSchema>;

export const ClaimResolveSchema = z.object({
  resolution: z.enum(CLAIM_RESOLUTIONS),
  reason: z.string().min(1).max(1000),
  amount_cents: z.number().int().min(0).max(10_000_000).optional(), // required for `credited`
  comp: z.boolean().optional(), // reship: platform-comped ($0) vs charged to the brand wallet
});
