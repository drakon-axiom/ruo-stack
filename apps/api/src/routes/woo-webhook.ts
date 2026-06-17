import type { FastifyInstance } from 'fastify';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { Prisma } from '@ruostack/db';
import { getClients } from '../clients.js';
import { importWooOrder, type WooOrder } from '../services/store-intake.js';

/**
 * WooCommerce webhook receiver (inbound order intake). Own encapsulated scope so
 * the raw-body parser applies ONLY here — the HMAC must be computed over the exact
 * bytes WooCommerce signed. Mirrors the Stripe receiver: verify signature →
 * persist WebhookEvent idempotently → import the order → mark processed (a non-2xx
 * makes WooCommerce retry). The connection id in the path scopes the brand + the
 * per-connection HMAC secret.
 */
export async function wooWebhookRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  // Raw bytes for HMAC. WooCommerce sends application/json; override the inherited
  // JSON parser explicitly (a '*' catch-all alone wouldn't win over it), and keep
  // '*' for any other content-type WooCommerce might use.
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));
  app.addContentTypeParser('*', { parseAs: 'buffer' }, (_req, body, done) => done(null, body));

  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  app.post('/api/woo/webhook/:connectionId', async (req, reply) => {
    const { connectionId } = req.params as { connectionId: string };
    if (!UUID_RE.test(connectionId)) return reply.code(404).send('unknown connection');
    const conn = await prisma.brandStoreConnection.findUnique({ where: { id: connectionId } });
    if (!conn) return reply.code(404).send('unknown connection');

    const raw = req.body as Buffer;
    const topic = (req.headers['x-wc-webhook-topic'] as string | undefined) ?? '';
    const sig = req.headers['x-wc-webhook-signature'] as string | undefined;

    // WooCommerce sends an unsigned "ping" when the webhook is first created — ack
    // it so the webhook activates. Unsigned posts never reach order processing.
    if (!sig) return reply.code(200).send('ok');

    const expected = createHmac('sha256', conn.webhookSecret).update(raw).digest('base64');
    if (!safeEqual(sig, expected)) return reply.code(401).send('bad signature');

    if (!topic.startsWith('order.')) return reply.code(200).send('ignored');

    let woo: WooOrder;
    try {
      woo = JSON.parse(raw.toString('utf8')) as WooOrder;
    } catch {
      return reply.code(200).send('bad json');
    }
    if (!woo?.id) return reply.code(200).send('no order id');

    // Idempotent delivery dedupe (WooCommerce retries on non-2xx).
    const externalId = `${connectionId}:${woo.id}:${topic}`;
    try {
      await prisma.webhookEvent.create({
        data: { source: 'woocommerce', externalId, type: topic, payload: woo as unknown as Prisma.InputJsonValue, status: 'received' },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        const existing = await prisma.webhookEvent.findUnique({
          where: { source_externalId: { source: 'woocommerce', externalId } },
        });
        if (existing?.status === 'processed') return reply.code(200).send('ok');
        // received/failed but not processed — fall through and retry.
      } else {
        throw err;
      }
    }

    try {
      await importWooOrder(prisma, conn, woo);
    } catch (err) {
      await prisma.webhookEvent.updateMany({ where: { source: 'woocommerce', externalId }, data: { status: 'failed', attempts: { increment: 1 } } });
      req.log.error({ err }, 'woo order intake failed');
      return reply.code(500).send('intake failed');
    }

    await prisma.webhookEvent.updateMany({
      where: { source: 'woocommerce', externalId },
      data: { status: 'processed', processedAt: new Date(), attempts: { increment: 1 } },
    });
    return reply.code(200).send('ok');
  });
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
