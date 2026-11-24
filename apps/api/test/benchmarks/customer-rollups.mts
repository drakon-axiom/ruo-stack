/** Run only against disposable PostgreSQL:
 * RUN_DB_TESTS=1 DATABASE_URL=postgresql://review@127.0.0.1:55439/postgres node apps/api/test/benchmarks/customer-rollups.mts
 * Creates and removes synthetic fixtures; refuses remote/non-test targets.
 */
import { PrismaClient } from '@ruostack/db';
import { searchCustomers, customerHistory } from '../../src/services/customer-rollups.ts';
import { randomUUID } from 'node:crypto';
const target = new URL(process.env.DATABASE_URL ?? '');
if (process.env.RUN_DB_TESTS !== '1' || target.hostname !== '127.0.0.1' || target.port !== '55439' || target.pathname !== '/postgres') {
  throw new Error('This benchmark requires the disposable local database on port 55439');
}
const db = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
let last;
db.$on('query', event => { if (event.query.includes('AS result')) last = event; });
const brand = await db.brand.create({ data: { brandName: 'Synthetic explain', referralCode: randomUUID() } });
try {
  for (let batch = 0; batch < 10; batch++) {
    await db.order.createMany({ data: Array.from({ length: 2000 }, (_, j) => ({
      brandId: brand.id, recipientName: 'Synthetic', recipientEmail: `customer-${(batch * 2000 + j) % 1000}@test.local`,
      address1: '1 Main', city: 'Austin', state: 'TX', zip: '78701', wholesaleTotalCents: 100,
      shippingTotalCents: 25, walletChargeCents: 125, createdAt: new Date(1700000000000 + batch * 2000 + j),
    })) });
  }
  await db.$executeRawUnsafe('ANALYZE public."order"');
  for (const [name, run] of [
    ['search', () => searchCustomers(db, brand.id, { search: '', sort: 'recent', offset: 0, limit: 50 })],
    ['history', () => customerHistory(db, brand.id, 'customer-10@test.local', 10)],
  ]) {
    const result = await run();
    const query = last;
    const rows = await db.$queryRawUnsafe('EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ' + query.query, ...JSON.parse(query.params));
    const plan = rows[0]['QUERY PLAN'][0];
    const indexes = [];
    function walk(node) { if (node['Index Name']) indexes.push(node['Index Name']); for (const child of node.Plans ?? []) walk(child); }
    walk(plan.Plan);
    if (!indexes.includes('order_customer_history_idx')) throw new Error(name + ' failed to use the history index');
    console.log(JSON.stringify({ name, orders: 20000, customers: 1000, returned: result.customers.length,
      execution_ms: plan['Execution Time'], indexes: [...new Set(indexes)] }));
  }
} finally { await db.brand.delete({ where: { id: brand.id } }); await db.$disconnect(); }
