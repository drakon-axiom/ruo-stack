import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPrisma, type PrismaClient } from '@ruostack/db';
import { sweepLapsedSubscriptions, upsertSubscriptionState } from '../../src/services/subscription.ts';
import { randomToken } from '../../src/crypto.ts';
const db = getPrisma();
describe.skipIf(process.env.RUN_DB_TESTS !== '1')('subscription expiry races', () => {
  let brandId: string;
  beforeEach(async () => {
    brandId = (await db.brand.create({ data: { brandName: 'Expiry race', referralCode: randomToken(12) } })).id;
    await upsertSubscriptionState(db, { brandId, status: 'active', plan: 'pro', currentPeriodEnd: new Date(Date.now()-30*86400000) });
  });
  afterEach(async () => { await db.brand.delete({ where: { id: brandId } }); });
  afterAll(async () => { await db.$disconnect(); });
  it('preserves a renewal committed after the candidate scan', async () => {
    const future = new Date(Date.now()+30*86400000);
    const racing = db.$extends({ query: { subscriptionState: { async findMany({ args, query }) {
      const rows=await query(args);
      await upsertSubscriptionState(db, { brandId, status:'active', plan:'volume', currentPeriodEnd:future });
      return rows;
    } } } }) as unknown as PrismaClient;
    const result=await sweepLapsedSubscriptions(racing);
    expect(result.suspended).toBe(0);
    const sub=await db.subscriptionState.findUniqueOrThrow({where:{brandId}});
    expect(sub.status).toBe('active'); expect(sub.plan).toBe('volume'); expect(sub.currentPeriodEnd).toEqual(future);
    expect((await db.brand.findUniqueOrThrow({where:{id:brandId}})).subscriptionStatus).toBe('pro');
    expect(await db.auditLog.count({where:{targetId:brandId}})).toBe(0);
  });
  it('two sweeps expire a candidate and audit it only once', async () => {
    let arrived=0; let release!:()=>void; const barrier=new Promise<void>(r=>{release=r;});
    const racing=db.$extends({query:{subscriptionState:{async findMany({args,query}) {
      const rows=await query(args); if(++arrived===2) release(); await barrier; return rows;
    }}}}) as unknown as PrismaClient;
    const results=await Promise.all([sweepLapsedSubscriptions(racing),sweepLapsedSubscriptions(racing)]);
    expect(results.reduce((n,r)=>n+r.suspended,0)).toBe(1);
    expect(await db.auditLog.count({where:{targetId:brandId}})).toBe(1);
    expect((await db.brand.findUniqueOrThrow({where:{id:brandId}})).subscriptionStatus).toBe('none');
  });
  it('rolls back state and brand mirror when the expiry audit fails', async () => {
    const broken=db.$extends({query:{auditLog:{async create(){throw new Error('audit unavailable');}}}}) as unknown as PrismaClient;
    await expect(sweepLapsedSubscriptions(broken)).rejects.toThrow('audit unavailable');
    expect((await db.subscriptionState.findUniqueOrThrow({where:{brandId}})).status).toBe('active');
    expect((await db.brand.findUniqueOrThrow({where:{id:brandId}})).subscriptionStatus).toBe('pro');
  });
});
