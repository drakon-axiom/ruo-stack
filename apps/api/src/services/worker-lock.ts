import { Client } from 'pg';
import type { PrismaClient } from '@ruostack/db';
import { Conflict } from '../errors.ts';

// Namespace 3 is reserved for workers (wallet, ledger, membership use 0–2).
const jobs = { reconciliation: 1, 'rate-quotes': 2, 'subscription-lapse': 3, dunning: 4, 'coa-writeback': 5 } as const;
export interface WorkerOwnership {
  signal: AbortSignal;
  assertOwned(): Promise<void>;
}
export function isWorkerBusy(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'worker_busy';
}

/** Dedicated session only: never put a session lock on Prisma's pooled connection. */
export async function withWorkerLock<T>(
  job: keyof typeof jobs,
  work: (ownership: WorkerOwnership) => Promise<T>,
  options: { connectionString?: string; heartbeatMs?: number } = {},
): Promise<T> {
  const connectionString = options.connectionString ?? process.env.DIRECT_URL;
  if (!connectionString) throw new Error('Worker lock requires DIRECT_URL with session pooling');
  const url = new URL(connectionString);
  if (url.port === '6543' || url.searchParams.get('pgbouncer') === 'true') {
    throw new Error('Worker lock requires a session connection, not transaction pooling');
  }
  const client = new Client({ connectionString, application_name: `ruostack-worker-${job}`,
    connectionTimeoutMillis: 5000, query_timeout: 5000, keepAlive: true, keepAliveInitialDelayMillis: 5000 });
  const controller = new AbortController();
  const lost = () => controller.abort(new Error('Worker lock ownership lost'));
  client.on('error', lost);
  client.on('end', lost);
  let locked = false;
  let timer: ReturnType<typeof setInterval> | undefined;
  let checking: Promise<void> | undefined;
  const assertOwned = (): Promise<void> => {
    if (controller.signal.aborted) return Promise.reject(controller.signal.reason);
    if (!checking) {
      checking = (async () => {
        try {
          const result = await client.query<{ owned: boolean }>(
            "SELECT EXISTS(SELECT 1 FROM pg_locks WHERE locktype='advisory' AND pid=pg_backend_pid() AND classid=$1::oid AND objid=3 AND objsubid=2 AND granted) AS owned", [jobs[job]]);
          if (!result.rows[0]?.owned) lost();
        } catch { lost(); }
        controller.signal.throwIfAborted();
      })().finally(() => { checking = undefined; });
    }
    return checking;
  };
  try {
    await client.connect();
    const result = await client.query<{ acquired: boolean }>('SELECT pg_try_advisory_lock($1::int, 3) AS acquired', [jobs[job]]);
    locked = result.rows[0]?.acquired === true;
    if (!locked) throw Conflict('worker_busy', 'This job is already running');
    timer = setInterval(() => { void assertOwned().catch(() => {}); }, options.heartbeatMs ?? 5000);
    timer.unref();
    const resultValue = await work({ signal: controller.signal, assertOwned });
    await assertOwned();
    return resultValue;
  } finally {
    clearInterval(timer);
    await checking?.catch(() => {});
    if (locked && !controller.signal.aborted) {
      await client.query('SELECT pg_advisory_unlock($1::int, 3)', [jobs[job]]).catch(() => {});
    }
    await client.end().catch(() => {});
  }
}

/** Check before each new query, including queries inside interactive transactions.
 * Already dispatched provider/DB operations cannot be retracted on connection loss.
 */
export function guardWorkerPrisma(prisma: PrismaClient, ownership: WorkerOwnership): PrismaClient {
  return prisma.$extends({ query: { $allOperations: async ({ args, query }) => {
    await ownership.assertOwned();
    const result = await query(args);
    ownership.signal.throwIfAborted();
    return result;
  } } }) as unknown as PrismaClient;
}
