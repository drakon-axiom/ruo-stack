import { afterAll, describe, expect, it } from 'vitest';
import { spawn } from 'node:child_process';
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
  // Separate test session in another database must survive this fixture.
  const otherUrl=new URL(connectionString);otherUrl.pathname='/template1';
  const other=new Client({connectionString:otherUrl.toString()});other.on('error',()=>{});await other.connect();
  await other.query('SELECT pg_advisory_lock(2,3)');
  const started=gate(),finish=gate();let guarded;
  const result=withWorkerLock('rate-quotes',async ctx=>{
   guarded=guardWorkerPrisma(db,ctx);started.release();await finish.promise;
   await guarded.brand.count();
  },{connectionString,heartbeatMs:20});
  const rejected=expect(result).rejects.toThrow(/ownership|lock/i);
  await started.promise;
  try{
   const owners=await admin.query("SELECT l.pid FROM pg_locks l JOIN pg_stat_activity a ON a.pid=l.pid WHERE l.locktype='advisory' AND l.classid=2 AND l.objid=3 AND l.objsubid=2 AND l.granted AND l.database=(SELECT oid FROM pg_database WHERE datname=current_database()) AND a.application_name='ruostack-worker-rate-quotes'");
   expect(owners.rowCount).toBe(1);
   await admin.query('SELECT pg_terminate_backend($1)',[owners.rows[0].pid]);
   finish.release();await rejected;
   expect((await other.query('SELECT 1 AS alive')).rows[0].alive).toBe(1);
   expect(await withWorkerLock('rate-quotes',async()=>9,{connectionString})).toBe(9);
  }finally{finish.release();await admin.end();await other.end();}
 });
 it('shares production reconciliation and cleanup entry-point locks',async()=>{
  await withWorkerLock('reconciliation',async()=>{
   await expect(runReconciliation(db,{} as PaymentsAdapter)).rejects.toMatchObject({statusCode:409,code:'worker_busy'});
  },{connectionString});
  await withWorkerLock('rate-quotes',async()=>{
   await expect(runRateQuoteCleanup(db)).rejects.toMatchObject({statusCode:409,code:'worker_busy'});
  },{connectionString});
 });
 it('treats cron cleanup contention as a successful skip',async()=>{
  await withWorkerLock('rate-quotes',async()=>{
   const result=await new Promise<{code:number|null;output:string}>((resolve,reject)=>{
    const child=spawn(process.execPath,['--import','tsx','src/scripts/cleanup-rate-quotes.ts'],{env:process.env});let output='';
    child.stdout.on('data',d=>{output+=d;});child.stderr.on('data',d=>{output+=d;});
    child.on('error',reject);child.on('close',code=>resolve({code,output}));
   });
   expect(result.code).toBe(0);expect(result.output).toContain('already running');
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
