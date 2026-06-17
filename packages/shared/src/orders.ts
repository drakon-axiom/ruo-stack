import { z } from 'zod';

export const OrderItemInputSchema = z.object({
  product_id: z.string().uuid(),
  qty: z.number().int().min(1).max(999),
});

export const OrderCreateSchema = z.object({
  items: z.array(OrderItemInputSchema).min(1).max(50),
  recipient_name: z.string().min(1).max(120),
  recipient_email: z.string().email().optional().or(z.literal('')),
  recipient_phone: z.string().max(40).optional(),
  address1: z.string().min(1).max(200),
  address2: z.string().max(200).optional(),
  city: z.string().min(1).max(120),
  state: z.string().min(1).max(60),
  zip: z.string().min(1).max(20),
  country: z.string().min(2).max(2).default('US'),
  service_code: z.string().max(60).optional(), // chosen live-rate service (Pro/Volume)
});
export type OrderCreate = z.infer<typeof OrderCreateSchema>;

/** Rate preview for the order drawer (items + destination → shipping options). */
export const OrderQuoteSchema = z.object({
  items: z.array(OrderItemInputSchema).min(1).max(50),
  zip: z.string().min(1).max(20),
  state: z.string().min(1).max(60),
});
export type OrderQuote = z.infer<typeof OrderQuoteSchema>;

/** Admin ship action. tracking_number is optional — when a ShipStation label is
 * bought, tracking comes from the carrier; provide it only for manual fulfillment. */
export const OrderShipSchema = z.object({
  tracking_number: z.string().max(80).optional(),
  carrier: z.string().max(40).optional(),
});

/** Pre-ship order edit (brand or admin): add/remove items, update recipient,
 * change shipping service. All fields optional; an omitted field is unchanged,
 * but `items` (when present) REPLACES the line items. Re-prices + re-reserves. */
export const OrderEditSchema = z
  .object({
    items: z.array(OrderItemInputSchema).min(1).max(50).optional(),
    recipient_name: z.string().min(1).max(120).optional(),
    recipient_email: z.string().email().or(z.literal('')).optional(),
    recipient_phone: z.string().max(40).optional(),
    address1: z.string().min(1).max(200).optional(),
    address2: z.string().max(200).optional(),
    city: z.string().min(1).max(120).optional(),
    state: z.string().min(1).max(60).optional(),
    zip: z.string().min(1).max(20).optional(),
    country: z.string().min(2).max(2).optional(),
    service_code: z.string().max(60).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No changes provided' });
export type OrderEdit = z.infer<typeof OrderEditSchema>;

/**
 * ShipStation custom-store status string we emit in the export XML. The operator
 * maps each of these to a ShipStation status in the Custom Store connection form
 * (Paid → awaiting shipment, On-Hold, Shipped, Cancelled).
 */
export function shipstationStatus(o: { status: string; blocker: string }): 'paid' | 'shipped' | 'cancelled' | 'on_hold' {
  if (o.status === 'cancelled') return 'cancelled';
  if (o.status === 'shipped' || o.status === 'delivered') return 'shipped';
  if (o.blocker === 'awaiting_funds') return 'on_hold';
  return 'paid';
}

/** Derived fulfillment state powering the status icon in brand + admin order lists. */
export type FulfillmentState = 'awaiting_funds' | 'ready' | 'exported' | 'shipped' | 'delivered' | 'cancelled';

export function fulfillmentState(o: {
  status: string;
  blocker: string;
  exported_at?: string | null;
}): FulfillmentState {
  if (o.status === 'cancelled') return 'cancelled';
  if (o.status === 'delivered') return 'delivered';
  if (o.status === 'shipped') return 'shipped';
  if (o.blocker === 'awaiting_funds') return 'awaiting_funds';
  if (o.exported_at) return 'exported';
  return 'ready';
}

export const FULFILLMENT_META: Record<FulfillmentState, { label: string; icon: string; tone: string }> = {
  awaiting_funds: { label: 'Awaiting funds', icon: '⚠', tone: 'amber' },
  ready: { label: 'Ready', icon: '🕒', tone: 'slate' },
  exported: { label: 'At ShipStation', icon: '📦', tone: 'teal' },
  shipped: { label: 'Shipped', icon: '🚚', tone: 'teal' },
  delivered: { label: 'Delivered', icon: '✓', tone: 'success' },
  cancelled: { label: 'Cancelled', icon: '✕', tone: 'muted' },
};
