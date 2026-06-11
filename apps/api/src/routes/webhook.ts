import type { FastifyInstance } from 'fastify';
import { Prisma } from '@ruostack/db';
import { getClients } from '../clients.js';

/**
 * Stripe webhook receiver (Phase 0). Registered in its OWN encapsulated plugin
 * scope so the raw-body parser applies ONLY here — every other route keeps JSON
 * parsing. Behavior:
 *   1. Signature-verify via the PaymentsAdapter (throws → 400).
 *   2. Idempotent persist on (source, external_id) — a duplicate is a no-op.
 *   3. Normalize → no-op sink with TODO(Phase 1). NO ledger mutation.
 */
export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  const { prisma, payments } = getClients();

  // Encapsulated: keep the raw Buffer for signature verification.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => {
    done(null, body);
  });

  app.post('/api/payments/webhook', async (req, reply) => {
    const signature = req.headers['stripe-signature'];
    if (typeof signature !== 'string') {
      return reply.code(400).send({ error: 'missing_signature' });
    }
    const raw = req.body as Buffer;

    let event;
    try {
      event = payments.verifyAndParseWebhook(raw, signature);
    } catch {
      // Bad signature → reject. Do not persist.
      return reply.code(400).send({ error: 'invalid_signature' });
    }

    // Idempotent persist. Duplicate (source, external_id) → no-op success.
    try {
      await prisma.webhookEvent.create({
        data: {
          source: 'stripe',
          externalId: event.externalId,
          type: event.kind,
          payload: event as unknown as Prisma.InputJsonValue,
          status: 'received',
        },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(200).send({ received: true, idempotent: true });
      }
      throw err;
    }

    // Normalize → no-op sink. Phase 1 dispatches by event.kind to the wallet /
    // subscription ledgers. Phase 0 performs NO ledger mutation.
    // TODO(Phase 1): route event.kind → SubscriptionState / WalletLedger.
    await prisma.webhookEvent.updateMany({
      where: { source: 'stripe', externalId: event.externalId },
      data: { status: 'processed', processedAt: new Date() },
    });

    return reply.code(200).send({ received: true });
  });
}
