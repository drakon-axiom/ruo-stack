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
});
export type OrderCreate = z.infer<typeof OrderCreateSchema>;

/** Admin ship action. */
export const OrderShipSchema = z.object({
  tracking_number: z.string().min(1).max(80),
  carrier: z.string().min(1).max(40).default('USPS'),
});
