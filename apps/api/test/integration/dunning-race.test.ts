import { afterAll, describe, expect, it, vi } from 'vitest';
import { getPrisma, type PrismaClient } from '@ruostack/db';
import { sweepDunning } from '../../src/services/dunning.ts';
import { upsertSubscriptionState } from '../../src/services/subscription.ts';
import type { EmailAdapter } from '@ruostack/shared';
vi.mock('../../src/services/plan-registry.ts', () => ({ getPlanRegistry: async () => ({ pro: { name: 'Pro' } }) }));
const db = getPrisma();
const ids: string[] = [];
describe.skipIf(process.env.RUN_DB_TESTS !== '1')('dunning renewal race', () => {
 afterAll(async () => {
  await db.subscriptionState.deleteMany({where:{brandId:{in:ids}}});
  await db.brand.deleteMany({where:{id:{in:ids}}});
  await db.$disconnect();
 });
 it('expires overdue state with its mirror and audit together', async () => {
  const brand=await db.brand.create({data:{brandName:'Dunning expiry',referralCode:crypto.randomUUID()}});ids.push(brand.id);
  await upsertSubscriptionState(db,{brandId:brand.id,plan:'pro',status:'past_due'});
  await db.subscriptionState.update({where:{brandId:brand.id},data:{pastDueSince:new Date(Date.now()-20*86400000)}});
  await sweepDunning(db,{send:vi.fn()} as unknown as EmailAdapter,{auth:{admin:{getUserById:async()=>({data:{user:null}})}}},7);
  expect(await db.subscriptionState.findUnique({where:{brandId:brand.id}})).toMatchObject({status:'expired',plan:'pro'});
  expect(await db.brand.findUnique({where:{id:brand.id}})).toMatchObject({subscriptionStatus:'none'});
  expect(await db.auditLog.count({where:{targetId:brand.id,after:{path:['reason'],equals:'dunning_grace_expired'}}})).toBe(1);
 });
 it('does not expire or stamp a subscription renewed after candidate selection', async () => {
  const brand = await db.brand.create({data:{brandName:'Dunning race',referralCode:crypto.randomUUID()}}); ids.push(brand.id);
  await upsertSubscriptionState(db,{brandId:brand.id,plan:'pro',status:'past_due'});
  await db.subscriptionState.update({where:{brandId:brand.id},data:{pastDueSince:new Date(Date.now()-20*86400000)}});
  const wrapped=db.$extends({query:{subscriptionState:{findMany:async({args,query})=>{
   const rows=await query(args);
   await upsertSubscriptionState(db,{brandId:brand.id,status:'active',plan:'pro',currentPeriodEnd:new Date(Date.now()+30*86400000)});
   return rows;
  }}}}) as unknown as PrismaClient;
  const send=vi.fn();
  await sweepDunning(wrapped,{send} as unknown as EmailAdapter,{auth:{admin:{getUserById:async()=>({data:{user:null}})}}},7);
  expect(await db.subscriptionState.findUnique({where:{brandId:brand.id}})).toMatchObject({status:'active',dunningNotifiedAt:null});
  expect(await db.brand.findUnique({where:{id:brand.id}})).toMatchObject({subscriptionStatus:'pro'});
  expect(await db.auditLog.count({where:{targetId:brand.id,after:{path:['reason'],equals:'dunning_grace_expired'}}})).toBe(0);
 });
});
