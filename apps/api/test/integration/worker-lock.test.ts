import { afterAll, describe, expect, it } from 'vitest';
import { Client } from 'pg';
import { getPrisma } from '@ruostack/db';
import { runReconciliation } from '../../src/services/reconciliation.ts';
import { runRateQuoteCleanup } from '../../src/services/rate-quote.ts';
import type { PaymentsAdapter } from '@ruostack/shared';
import { withWorkerLock, guardWorkerPrisma } from '../../src/services/worker-lock.ts';
const connectionString=process.env.DIRECT_URL!;
const db=getPrisma();
function gate(){let release!:()=>void;return {promise:new Promise<void>(r=>{release=r;}),release:()=>release()};}
describe.skipIf(process.env.RUN_DB_TESTS!=='1')('cross-process worker locks',()=>{
 afterAll(async()=>{await db.$disconnect();});
 it('allows only one independent session for a job and releases after completion',async()=>{
  const started=gate(),finish=gate();let secondRan=false;
  const first=withWorkerLock('reconciliation',async()=>{started.release();await finish.promise;return 1;},{connectionString});
  await started.promise;
  try{await expect(withWorkerLock('reconciliation',async()=>{secondRan=true;},{connectionString})).rejects.toMatchObject({statusCode:409,code:'worker_busy'});expect(secondRan).toBe(false);}
  finally{finish.release();await first;}
  expect(await withWorkerLock('reconciliation',async()=>2,{connectionString})).toBe(2);
 });
 it('allows unrelated jobs concurrently and releases after callback failure',async()=>{
  const started=gate(),finish=gate();
  const first=withWorkerLock('reconciliation',async()=>{started.release();await finish.promise;},{connectionString});await started.promise;
  try{expect(await withWorkerLock('rate-quotes',async()=>7,{connectionString})).toBe(7);}finally{finish.release();await first;}
  await expect(withWorkerLock('reconciliation',async()=>{throw new Error('failed task');},{connectionString})).rejects.toThrow('failed task');
  expect(await withWorkerLock('reconciliation',async()=>8,{connectionString})).toBe(8);
 });
 it('aborts and prevents later database work after the lock backend is terminated',async()=>{
  const admin=new Client({connectionString});await admin.connect();
  const started=gate(),finish=gate();let guarded;
  const result=withWorkerLock('rate-quotes',async ctx=>{
   guarded=guardWorkerPrisma(db,ctx);started.release();await finish.promise;
   await guarded.brand.count();
  },{connectionString,heartbeatMs:20});
  const rejected=expect(result).rejects.toThrow(/ownership|lock/i);
  await started.promise;
  try{
   const response=await admin.query("SELECT pg_terminate_backend(pid) FROM pg_locks WHERE locktype='advisory' AND classid=2 AND objid=3 AND objsubid=2 AND granted");
   expect(response.rowCount).toBe(1);
   finish.release();await rejected;
   expect(await withWorkerLock('rate-quotes',async()=>9,{connectionString})).toBe(9);
  }finally{finish.release();await admin.end();}
 });
 it('shares production reconciliation and cleanup entry-point locks',async()=>{
  await withWorkerLock('reconciliation',async()=>{
   await expect(runReconciliation(db,{} as PaymentsAdapter)).rejects.toMatchObject({statusCode:409,code:'worker_busy'});
  },{connectionString});
  await withWorkerLock('rate-quotes',async()=>{
   await expect(runRateQuoteCleanup(db)).rejects.toMatchObject({statusCode:409,code:'worker_busy'});
  },{connectionString});
 });
 it('guards raw queries and transaction queries and rolls back on ownership loss',async()=>{
  const controller=new AbortController();let checks=0;
  const guarded=guardWorkerPrisma(db,{signal:controller.signal,assertOwned:async()=>{checks++;controller.signal.throwIfAborted();}});
  await guarded.$queryRaw`SELECT 1`;
  expect(checks).toBe(1);
  const id=crypto.randomUUID();
  await expect(guarded.$transaction(async tx=>{
   await tx.brand.create({data:{id,brandName:'Rollback',referralCode:id}});
   controller.abort(new Error('ownership lost'));
   await tx.brand.count();
  })).rejects.toThrow('ownership lost');
  expect(checks).toBe(3);
  expect(await db.brand.findUnique({where:{id}})).toBeNull();
 });
 it('rejects transaction pooling without running work',async()=>{
  let ran=false;
  await expect(withWorkerLock('rate-quotes',async()=>{ran=true;},{connectionString:'postgresql://unused@localhost:6543/postgres'})).rejects.toThrow(/session|transaction/i);
  expect(ran).toBe(false);
 });
});
