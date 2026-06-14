import { z } from 'zod';

/** Flat shipping rate (cents) used until the live-rate engine lands (Phase 2). */
export const SHIPPING_FLAT_CENTS = 1295;

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
