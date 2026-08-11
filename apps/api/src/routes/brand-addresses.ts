import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { AddressCreateSchema, AddressUpdateSchema } from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { requireBrand } from '../middleware/guards.ts';
import { NotFound } from '../errors.ts';

/**
 * Address Book — saved ship-to addresses a brand curates to auto-fill the manual
 * order form. Plain per-brand CRUD (no audit, mirroring the retail-price handler):
 * these are benign templates, snapshotted onto an order at placement time, never
 * linked to it. Every query is scoped to req.brand!.brandId.
 */
export async function brandAddressRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  type AddressRow = {
    id: string;
    label: string | null;
    recipientName: string;
    recipientEmail: string | null;
    recipientPhone: string | null;
    address1: string;
    address2: string | null;
    city: string;
    state: string;
    zip: string;
    country: string;
    createdAt: Date;
  };

  const serialize = (a: AddressRow) => ({
    id: a.id,
    label: a.label,
    recipient_name: a.recipientName,
    recipient_email: a.recipientEmail,
    recipient_phone: a.recipientPhone,
    address1: a.address1,
    address2: a.address2,
    city: a.city,
    state: a.state,
    zip: a.zip,
    country: a.country,
    created_at: a.createdAt,
  });

  // Map validated snake_case body → Prisma columns for a PATCH. Only present keys
  // are written; empty strings become null so the DB stores absence, not "".
  const toUpdateData = (b: z.infer<typeof AddressUpdateSchema>) => {
    const d: Record<string, string | null> = {};
    if (b.label !== undefined) d.label = b.label || null;
    if (b.recipient_name !== undefined) d.recipientName = b.recipient_name;
    if (b.recipient_email !== undefined) d.recipientEmail = b.recipient_email || null;
    if (b.recipient_phone !== undefined) d.recipientPhone = b.recipient_phone || null;
    if (b.address1 !== undefined) d.address1 = b.address1;
    if (b.address2 !== undefined) d.address2 = b.address2 || null;
    if (b.city !== undefined) d.city = b.city;
    if (b.state !== undefined) d.state = b.state;
    if (b.zip !== undefined) d.zip = b.zip;
    if (b.country !== undefined) d.country = b.country;
    return d;
  };

  // ── List ────────────────────────────────────────────────────────────────────
  app.get('/api/brand/addresses', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const addresses = await prisma.address.findMany({
      where: { brandId },
      orderBy: [{ label: 'asc' }, { recipientName: 'asc' }],
    });
    return { addresses: addresses.map(serialize) };
  });

  // ── Create ──────────────────────────────────────────────────────────────────
  app.post('/api/brand/addresses', { preHandler: requireBrand }, async (req, reply) => {
    const { brandId } = req.brand!;
    const body = AddressCreateSchema.parse(req.body);
    const created = await prisma.address.create({
      data: {
        brandId,
        label: body.label || null,
        recipientName: body.recipient_name,
        recipientEmail: body.recipient_email || null,
        recipientPhone: body.recipient_phone || null,
        address1: body.address1,
        address2: body.address2 || null,
        city: body.city,
        state: body.state,
        zip: body.zip,
        country: body.country,
      },
    });
    return reply.code(201).send(serialize(created));
  });

  // ── Update ──────────────────────────────────────────────────────────────────
  app.patch('/api/brand/addresses/:id', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const body = AddressUpdateSchema.parse(req.body);
    const existing = await prisma.address.findFirst({ where: { id, brandId }, select: { id: true } });
    if (!existing) throw NotFound('Address not found');
    const updated = await prisma.address.update({ where: { id }, data: toUpdateData(body) });
    return serialize(updated);
  });

  // ── Delete ──────────────────────────────────────────────────────────────────
  app.delete('/api/brand/addresses/:id', { preHandler: requireBrand }, async (req) => {
    const { brandId } = req.brand!;
    const { id } = z.object({ id: z.string().uuid() }).parse(req.params);
    const existing = await prisma.address.findFirst({ where: { id, brandId }, select: { id: true } });
    if (!existing) throw NotFound('Address not found');
    await prisma.address.delete({ where: { id } });
    return { ok: true };
  });
}
