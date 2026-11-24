import { Prisma, type PrismaClient } from '@ruostack/db';

export type CustomerSort = 'recent' | 'orders' | 'spend' | 'name';
export interface CustomerPageOptions { search: string; sort: CustomerSort; offset: number; limit: number }
export interface HistoryCursor { created_at: string; id: string }
interface RollupResult {
  customers: Array<Record<string, unknown> & { orders: number; spend_cents: number }>;
  totals: { customers: number; orders: number; spend_cents: number; truncated: boolean };
  page: { total?: number; has_more: boolean; next_cursor?: HistoryCursor | null };
}

const keyExpression = Prisma.sql`public.ruostack_customer_key(o.recipient_name, o.recipient_email, o.zip)`;
function scope(brandId: string, key?: string): Prisma.Sql {
  return Prisma.sql`o.brand_id = ${brandId}::uuid AND o.status <> 'cancelled'
    ${key === undefined ? Prisma.empty : Prisma.sql`AND md5(${keyExpression}) COLLATE "C" = md5(${key}) AND ${keyExpression} COLLATE "C" = ${key}`}`;
}

// Group/count across the entire brand (or requested customer), before paging.
// Only needed columns enter the database working set; order items/raw store payloads never do.
function summaryCtes(brandId: string, key?: string): Prisma.Sql {
  return Prisma.sql`
    keyed AS MATERIALIZED (
      SELECT ${keyExpression} COLLATE "C" AS key, o.id, o.recipient_name, o.recipient_email,
        o.city, o.state, o.country, o.wallet_charge_cents, o.status, o.blocker,
        o.exported_at, o.created_at, o.tracking_number
      FROM public."order" o WHERE ${scope(brandId, key)}
    ), grouped AS (
      SELECT key, count(*) AS orders, sum(wallet_charge_cents) AS spend_cents,
        min(created_at) AS first_order, max(created_at) AS last_order
      FROM keyed GROUP BY key
    ), latest AS (
      SELECT DISTINCT ON (key) * FROM keyed ORDER BY key, created_at DESC, id DESC
    ), summaries AS (
      SELECT g.*, l.recipient_name AS name,
        nullif(public.ruostack_js_lower(public.ruostack_js_trim(l.recipient_email)), '') AS email,
        l.city, l.state, l.country, l.status AS last_status, l.blocker AS last_blocker,
        l.exported_at AS last_exported_at
      FROM grouped g JOIN latest l USING (key)
    )`;
}
function ordering(sort: CustomerSort): Prisma.Sql {
  switch (sort) {
    case 'orders': return Prisma.sql`orders DESC, key COLLATE "C" ASC`;
    case 'spend': return Prisma.sql`spend_cents DESC, key COLLATE "C" ASC`;
    case 'name': return Prisma.sql`name COLLATE "und-x-icu" ASC, key COLLATE "C" ASC`;
    default: return Prisma.sql`last_order DESC, key COLLATE "C" ASC`;
  }
}
// Latest nonempty phone and complete address may come from older orders. Look
// them up only for the selected page, through the fixed-length identity index.
function profileJoins(brandId: string): Prisma.Sql {
  const sameCustomer = Prisma.sql`o.brand_id = ${brandId}::uuid AND o.status <> 'cancelled'
    AND md5(${keyExpression}) COLLATE "C" = md5(p.key) AND ${keyExpression} COLLATE "C" = p.key`;
  return Prisma.sql`
    LEFT JOIN LATERAL (
      SELECT o.recipient_phone AS phone FROM public."order" o
      WHERE ${sameCustomer} AND o.recipient_phone IS NOT NULL AND o.recipient_phone <> ''
      ORDER BY o.created_at DESC, o.id DESC LIMIT 1
    ) ph ON true
    LEFT JOIN LATERAL (
      SELECT jsonb_build_object('recipient_name', o.recipient_name, 'recipient_email', o.recipient_email,
        'address1', public.ruostack_js_trim(o.address1), 'address2', o.address2,
        'city', public.ruostack_js_trim(o.city), 'state', public.ruostack_js_trim(o.state),
        'zip', public.ruostack_js_trim(o.zip), 'country', coalesce(nullif(o.country, ''), 'US')) AS ship_to
      FROM public."order" o WHERE ${sameCustomer}
        AND public.ruostack_js_trim(o.address1) <> '' AND public.ruostack_js_trim(o.city) <> ''
        AND public.ruostack_js_trim(o.state) <> '' AND public.ruostack_js_trim(o.zip) <> ''
      ORDER BY o.created_at DESC, o.id DESC LIMIT 1
    ) ship ON true`;
}
const customerJson = Prisma.sql`jsonb_build_object(
  'key', p.key, 'name', p.name, 'email', p.email, 'phone', ph.phone,
  'city', p.city, 'state', p.state, 'country', p.country,
  'orders', p.orders, 'spend_cents', p.spend_cents,
  'first_order', to_char(p.first_order, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'last_order', to_char(p.last_order, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'last_status', p.last_status, 'last_blocker', p.last_blocker,
  'last_exported_at', to_char(p.last_exported_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'ship_to', ship.ship_to, 'order_list', '[]'::jsonb)`;
const totalsJson = Prisma.sql`(SELECT jsonb_build_object('customers', count(*), 'orders', coalesce(sum(orders), 0),
  'spend_cents', coalesce(sum(spend_cents), 0), 'truncated', false) FROM grouped)`;

function checked(result: RollupResult): RollupResult {
  const values = [result.totals.customers, result.totals.orders, result.totals.spend_cents,
    ...result.customers.flatMap(c => [c.orders, c.spend_cents]), ...(result.page.total === undefined ? [] : [result.page.total])];
  if (values.some(n => !Number.isSafeInteger(n))) throw new Error('Customer totals exceed supported integer precision');
  return result;
}

export async function searchCustomers(db: PrismaClient, brandId: string, options: CustomerPageOptions): Promise<RollupResult> {
  const term = Prisma.sql`public.ruostack_js_lower(${options.search.trim()})`;
  const sort = ordering(options.sort);
  const [row] = await db.$queryRaw<Array<{ result: RollupResult }>>(Prisma.sql`
    WITH ${summaryCtes(brandId)}, filtered AS (
      SELECT * FROM summaries WHERE ${term} = ''
        OR strpos(public.ruostack_js_lower(name), ${term}) > 0
        OR strpos(coalesce(email, ''), ${term}) > 0
        OR strpos(public.ruostack_js_lower(city || ' ' || state), ${term}) > 0
    ), page AS (SELECT * FROM filtered ORDER BY ${sort} LIMIT ${options.limit} OFFSET ${options.offset}),
    profiles AS (SELECT p.*, ${customerJson} AS data FROM page p ${profileJoins(brandId)})
    SELECT jsonb_build_object('customers', coalesce((SELECT jsonb_agg(data ORDER BY ${sort}) FROM profiles), '[]'::jsonb),
      'totals', ${totalsJson}, 'page', jsonb_build_object('offset', ${options.offset}, 'limit', ${options.limit},
      'total', (SELECT count(*) FROM filtered), 'has_more', (SELECT count(*) > ${options.offset + options.limit} FROM filtered))) AS result`);
  return checked(row!.result);
}

export async function customerHistory(db: PrismaClient, brandId: string, key: string, limit: number, cursor?: HistoryCursor): Promise<RollupResult> {
  const before = cursor ? Prisma.sql`AND (o.created_at, o.id) < (${cursor.created_at}::timestamptz AT TIME ZONE 'UTC', ${cursor.id}::uuid)` : Prisma.empty;
  const [row] = await db.$queryRaw<Array<{ result: RollupResult }>>(Prisma.sql`
    WITH ${summaryCtes(brandId, key)}, profiles AS (
      SELECT ${customerJson} AS data FROM summaries p ${profileJoins(brandId)}
    ), candidates AS (
      SELECT o.id, o.status, o.blocker, o.wallet_charge_cents, o.tracking_number, o.exported_at, o.created_at
      FROM public."order" o WHERE ${scope(brandId, key)} ${before}
      ORDER BY o.created_at DESC, o.id DESC LIMIT ${limit + 1}
    ), history_page AS (SELECT * FROM candidates ORDER BY created_at DESC, id DESC LIMIT ${limit}),
    history_json AS (
      SELECT coalesce(jsonb_agg(jsonb_build_object('id', id, 'status', status, 'blocker', blocker,
        'wallet_charge_cents', wallet_charge_cents, 'tracking_number', tracking_number,
        'exported_at', to_char(exported_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'created_at', to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) ORDER BY created_at DESC, id DESC), '[]'::jsonb) AS data FROM history_page
    )
    SELECT jsonb_build_object('customers', coalesce((SELECT jsonb_agg(p.data || jsonb_build_object('order_list', h.data)) FROM profiles p CROSS JOIN history_json h), '[]'::jsonb),
      'totals', ${totalsJson}, 'page', jsonb_build_object('limit', ${limit}, 'has_more', (SELECT count(*) > ${limit} FROM candidates),
        'next_cursor', CASE WHEN (SELECT count(*) > ${limit} FROM candidates) THEN
          (SELECT jsonb_build_object('id', id, 'created_at', to_char(created_at, 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) FROM history_page ORDER BY created_at ASC, id ASC LIMIT 1)
          ELSE null END)) AS result`);
  return checked(row!.result);
}
