import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { timingSafeEqual } from 'node:crypto';
import { Prisma } from '@ruostack/db';
import { z } from 'zod';
import { AUDIT_ACTIONS, shipstationStatus } from '@ruostack/shared';
import { getClients } from '../clients.js';
import { loadConfig } from '../config.js';
import { writeAudit } from '../audit.js';
import { captureOrder, getWalletSummary } from '../services/wallet.js';
import { onOrderShipped } from '../hooks/order-shipped.js';

/**
 * ShipStation Custom Store endpoint (fulfillment). A single Web Endpoint that
 * ShipStation polls — we never push to ShipStation:
 *   • GET  ?action=export   → XML <Orders> modified in [start_date,end_date].
 *   • POST ?action=shipnotify → tracking comes back when a label is created;
 *     we capture the wallet, mark shipped, and fire the WooCommerce writeback seam.
 * Auth is HTTP Basic with SHIPSTATION_STORE_USER/PASS (set in ShipStation's
 * Custom Store connection form). Reachability requires a PUBLIC URL in prod; in
 * dev we exercise it by simulating ShipStation's calls locally.
 *
 * Status mapping (configure these strings in the connection form): paid →
 * Awaiting Shipment, on_hold → On-Hold, shipped → Shipped, cancelled → Cancelled.
 */

const PAGE_SIZE = 100;

export async function shipstationCustomStoreRoutes(app: FastifyInstance): Promise<void> {
  const { prisma } = getClients();

  // ShipStation POSTs an XML <ShipNotice> body; accept any content-type as raw
  // text so Fastify doesn't 415 (the essentials also arrive as query params).
  app.addContentTypeParser('*', { parseAs: 'string' }, (_req, body, done) => done(null, body));

  // ── HTTP Basic auth (constant-time) ────────────────────────────────────────
  function requireStoreAuth(req: FastifyRequest, reply: FastifyReply): boolean {
    const cfg = loadConfig();
    if (!cfg.SHIPSTATION_STORE_USER || !cfg.SHIPSTATION_STORE_PASS) {
      reply.code(503).send('custom store not configured');
      return false;
    }
    const header = req.headers.authorization ?? '';
    const [scheme, encoded] = header.split(' ');
    if (scheme !== 'Basic' || !encoded) {
      reply.header('WWW-Authenticate', 'Basic realm="ruostack"').code(401).send('unauthorized');
      return false;
    }
    const [user, pass] = Buffer.from(encoded, 'base64').toString('utf8').split(':');
    const ok = safeEqual(user ?? '', cfg.SHIPSTATION_STORE_USER) && safeEqual(pass ?? '', cfg.SHIPSTATION_STORE_PASS);
    if (!ok) {
      reply.header('WWW-Authenticate', 'Basic realm="ruostack"').code(401).send('unauthorized');
      return false;
    }
    return true;
  }

  // ── GET: order export ──────────────────────────────────────────────────────
  app.get('/api/shipstation/custom-store', async (req, reply) => {
    if (!requireStoreAuth(req, reply)) return reply;
    const q = z
      .object({
        action: z.string().optional(),
        start_date: z.string().optional(),
        end_date: z.string().optional(),
        page: z.coerce.number().int().min(1).default(1),
      })
      .parse(req.query);

    // shipnotify is also documented as same-endpoint; route a stray GET shipnotify too.
    if (q.action === 'shipnotify') return handleShipnotify(req, reply);

    const start = parseSsDate(q.start_date) ?? new Date(0);
    const end = parseSsDate(q.end_date) ?? new Date(Date.now() + 86_400_000);

    // Fail closed: never export an order still blocked on a missing address,
    // missing customer info, or an unmapped SKU — ShipStation would treat it as
    // fulfillable and the warehouse would ship it incomplete/unaddressable.
    // (awaiting_funds still exports, as on_hold; terminal shipped/cancelled
    // orders still export so ShipStation can sync their final state.)
    const where: Prisma.OrderWhereInput = {
      updatedAt: { gte: start, lte: end },
      NOT: {
        blocker: { in: ['needs_address', 'needs_customer_info', 'needs_mapping'] },
        status: { notIn: ['shipped', 'delivered', 'cancelled'] },
      },
    };
    const total = await prisma.order.count({ where });
    const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const orders = await prisma.order.findMany({
      where,
      orderBy: { updatedAt: 'asc' },
      skip: (q.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { brand: { select: { brandName: true } }, items: { include: { product: true } } },
    });

    const xml = `<?xml version="1.0" encoding="utf-8"?>\n<Orders pages="${pages}">\n${orders
      .map(buildOrderXml)
      .join('\n')}\n</Orders>\n`;

    // Stamp exportedAt on first export of fulfillable (paid) orders → powers the
    // "At ShipStation" indicator. (Don't mark on_hold/cancelled/already-shipped.)
    const firstSeen = orders
      .filter((o) => !o.exportedAt && shipstationStatus(o) === 'paid')
      .map((o) => o.id);
    if (firstSeen.length > 0) {
      const now = new Date();
      await prisma.order.updateMany({ where: { id: { in: firstSeen } }, data: { exportedAt: now } });
      for (const id of firstSeen) {
        await writeAudit(prisma, {
          actorType: 'system',
          actorId: null,
          action: AUDIT_ACTIONS.orderExported,
          targetType: 'order',
          targetId: id,
          ip: req.ip,
        });
      }
    }

    return reply.header('content-type', 'application/xml; charset=utf-8').send(xml);
  });

  // ── POST: shipment notification ────────────────────────────────────────────
  app.post('/api/shipstation/custom-store', async (req, reply) => {
    if (!requireStoreAuth(req, reply)) return reply;
    return handleShipnotify(req, reply);
  });

  async function handleShipnotify(req: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> {
    const q = z
      .object({
        order_number: z.string().min(1),
        carrier: z.string().optional(),
        service: z.string().optional(),
        tracking_number: z.string().optional(),
      })
      .parse(req.query);

    // The XML body carries richer detail (ShippingCost, display Carrier). Read it
    // best-effort; query params remain the source of truth for the essentials.
    const rawBody = typeof req.body === 'string' ? req.body : '';
    const bodyTracking = tag(rawBody, 'TrackingNumber');
    const bodyCarrier = tag(rawBody, 'Carrier');
    const bodyService = tag(rawBody, 'Service');
    const shippingCost = tag(rawBody, 'ShippingCost');

    const trackingNumber = q.tracking_number || bodyTracking || '';
    const carrier = bodyCarrier || q.carrier || 'USPS';
    const service = q.service || bodyService || null;
    const labelCostCents = shippingCost ? Math.round(parseFloat(shippingCost) * 100) : null;

    const order = await prisma.order.findUnique({ where: { id: q.order_number } });
    if (!order) {
      // Non-2xx tells ShipStation it failed (it will retry); the order id is unknown to us.
      return reply.code(404).send('order not found');
    }
    if (order.status === 'cancelled') return reply.code(409).send('order cancelled');

    // Already shipped → idempotent success (refresh tracking if newer).
    if (order.status === 'shipped' || order.status === 'delivered') {
      if (trackingNumber && trackingNumber !== order.trackingNumber) {
        await prisma.order.update({ where: { id: order.id }, data: { trackingNumber, carrier } });
      }
      return reply.code(200).send('ok');
    }

    // Capture the wallet if funds allow. The label is already bought in ShipStation
    // (real postage), so we ALWAYS record the shipment + tracking; if the wallet
    // can't cover it, we ship anyway and flag awaiting_funds for collections.
    const { available } = await getWalletSummary(prisma, order.brandId);
    const reservedSelf = order.blocker === 'none' ? order.walletChargeCents : 0;
    const fundsOk = available + reservedSelf >= order.walletChargeCents;
    if (fundsOk) await captureOrder(prisma, order);

    const shipped = await prisma.$transaction(async (tx) => {
      const o = await tx.order.update({
        where: { id: order.id },
        data: {
          status: 'shipped',
          blocker: fundsOk ? 'none' : 'awaiting_funds',
          trackingNumber,
          carrier,
          ...(service ? { shippingServiceCode: order.shippingServiceCode ?? service } : {}),
          ...(labelCostCents !== null ? { labelCostCents } : {}),
          shippedAt: new Date(),
        },
      });
      await writeAudit(tx, {
        actorType: 'system',
        actorId: null,
        action: AUDIT_ACTIONS.orderShipped,
        targetType: 'order',
        targetId: order.id,
        after: {
          source: 'shipstation_shipnotify',
          tracking_number: trackingNumber,
          carrier,
          captured: fundsOk,
          captured_cents: fundsOk ? o.walletChargeCents : 0,
          label_cost_cents: labelCostCents,
        },
        ip: req.ip,
      });
      return o;
    });

    await onOrderShipped(shipped); // WooCommerce/Wix tracking writeback seam
    return reply.code(200).send('ok');
  }
}

// ── XML helpers ───────────────────────────────────────────────────────────────

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/** ShipStation date format: MM/dd/yyyy HH:mm in UTC. */
function fmtDate(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getUTCMonth() + 1)}/${p(d.getUTCDate())}/${d.getUTCFullYear()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/** Parse ShipStation's MM/dd/yyyy HH:mm (UTC) window bounds. */
function parseSsDate(s?: string): Date | null {
  if (!s) return null;
  const m = s.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})/);
  if (!m) return null;
  return new Date(Date.UTC(+m[3]!, +m[1]! - 1, +m[2]!, +m[4]!, +m[5]!));
}

const esc = (v: unknown): string =>
  String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** CDATA-wrap free text; split any literal "]]>" so it can't terminate the section. */
const cdata = (v: unknown): string => `<![CDATA[${String(v ?? '').replace(/]]>/g, ']]]]><![CDATA[>')}]]>`;

const money = (cents: number): string => (cents / 100).toFixed(2);

/** Extract the inner text of the first <Tag>…</Tag> in an XML string (CDATA-aware). */
function tag(xml: string, name: string): string | null {
  const m = xml.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, 'i'));
  if (!m) return null;
  const inner = m[1]!.trim();
  const cd = inner.match(/^<!\[CDATA\[([\s\S]*?)\]\]>$/);
  return (cd ? cd[1]! : inner).trim() || null;
}

type ExportOrder = {
  id: string;
  status: string;
  blocker: string;
  createdAt: Date;
  updatedAt: Date;
  recipientName: string;
  recipientEmail: string | null;
  recipientPhone: string | null;
  address1: string;
  address2: string | null;
  city: string;
  state: string;
  zip: string;
  country: string;
  walletChargeCents: number;
  shippingTotalCents: number;
  shippingServiceCode: string | null;
  shippingCarrier: string | null;
  boxLengthIn: number | null;
  boxWidthIn: number | null;
  boxHeightIn: number | null;
  brand: { brandName: string };
  items: { qty: number; unitWholesaleCents: number; product: { canonicalSku: string; name: string; weight: number | null } }[];
};

function buildOrderXml(o: ExportOrder): string {
  const customerCode = o.recipientEmail || `brand:${o.brand.brandName}`;
  // Locked package dimensions (rules engine) so ShipStation rates/labels the box we chose.
  const dimensions =
    o.boxLengthIn != null && o.boxWidthIn != null && o.boxHeightIn != null
      ? `\n    <Dimensions>\n      <DimensionUnits>Inch</DimensionUnits>\n      <Length>${esc(o.boxLengthIn)}</Length>\n      <Width>${esc(o.boxWidthIn)}</Width>\n      <Height>${esc(o.boxHeightIn)}</Height>\n    </Dimensions>`
      : '';
  const items = o.items
    .map(
      (it) => `      <Item>
        <SKU>${cdata(it.product.canonicalSku)}</SKU>
        <Name>${cdata(it.product.name)}</Name>
        <Quantity>${it.qty}</Quantity>
        <UnitPrice>${money(it.unitWholesaleCents)}</UnitPrice>${
        it.product.weight != null
          ? `\n        <Weight>${esc(it.product.weight)}</Weight>\n        <WeightUnits>Ounces</WeightUnits>`
          : ''
      }
      </Item>`,
    )
    .join('\n');

  return `  <Order>
    <OrderID>${cdata(o.id)}</OrderID>
    <OrderNumber>${cdata(o.id)}</OrderNumber>
    <OrderDate>${fmtDate(o.createdAt)}</OrderDate>
    <OrderStatus>${cdata(shipstationStatus(o))}</OrderStatus>
    <LastModified>${fmtDate(o.updatedAt)}</LastModified>
    <ShippingMethod>${cdata(o.shippingServiceCode ?? o.shippingCarrier ?? '')}</ShippingMethod>${dimensions}
    <OrderTotal>${money(o.walletChargeCents)}</OrderTotal>
    <TaxAmount>0.00</TaxAmount>
    <ShippingAmount>${money(o.shippingTotalCents)}</ShippingAmount>
    <InternalNotes>${cdata(`Brand: ${o.brand.brandName}`)}</InternalNotes>
    <CustomField1>${cdata(o.brand.brandName)}</CustomField1>
    <Customer>
      <CustomerCode>${cdata(customerCode.slice(0, 50))}</CustomerCode>
      <BillTo>
        <Name>${cdata(o.recipientName)}</Name>
        <Email>${cdata(o.recipientEmail ?? '')}</Email>
      </BillTo>
      <ShipTo>
        <Name>${cdata(o.recipientName)}</Name>
        <Address1>${cdata(o.address1)}</Address1>
        <Address2>${cdata(o.address2 ?? '')}</Address2>
        <City>${cdata(o.city)}</City>
        <State>${cdata(o.state)}</State>
        <PostalCode>${cdata(o.zip)}</PostalCode>
        <Country>${cdata(o.country)}</Country>
        <Phone>${cdata(o.recipientPhone ?? '')}</Phone>
      </ShipTo>
    </Customer>
    <Items>
${items}
    </Items>
  </Order>`;
}
