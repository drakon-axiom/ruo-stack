import { z } from 'zod';

/** A saved ship-to address in the brand's Address Book. Field shape mirrors the
 * order recipient so it auto-fills the manual order form directly. */
export const AddressCreateSchema = z.object({
  label: z.string().max(80).optional().or(z.literal('')),
  recipient_name: z.string().min(1).max(120),
  recipient_email: z.string().email().optional().or(z.literal('')),
  recipient_phone: z.string().max(40).optional().or(z.literal('')),
  address1: z.string().min(1).max(200),
  address2: z.string().max(200).optional().or(z.literal('')),
  city: z.string().min(1).max(120),
  state: z.string().min(1).max(60),
  zip: z.string().min(1).max(20),
  country: z.string().min(2).max(2).default('US'),
});
export type AddressCreate = z.infer<typeof AddressCreateSchema>;

/** Edit an existing saved address. All fields optional; at least one required. */
export const AddressUpdateSchema = AddressCreateSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  { message: 'No changes provided' },
);
export type AddressUpdate = z.infer<typeof AddressUpdateSchema>;
