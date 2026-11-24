import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma, type PrismaClient } from '@ruostack/db';
import { brandMemberRoutes } from '../../src/routes/brand-members.ts';
import { resetClientsForTest, setClientsForTest } from '../../src/clients.ts';
vi.mock('../../src/auth/brand-token.ts', () => ({ verifyBrandToken: async (token: string) => JSON.parse(token) }));
const db = getPrisma();
describe.skipIf(process.env.RUN_DB_TESTS !== '1')('brand owner concurrency', () => {
  let brandId: string;
  let a: string;
  let b: string;
  let app: ReturnType<typeof Fastify>;
  beforeEach(async () => {
    a=randomUUID(); b=randomUUID();
    brandId=(await db.brand.create({data:{brandName:'Owner races', referralCode:randomUUID()}})).id;
    for(const id of [a,b]) {
      await db.userProfile.create({data:{id,fullName:'Owner'}});
      await db.brandMember.create({data:{brandId,userId:id,role:'owner',status:'active'}});
    }
  });
  afterEach(async () => {
    await app?.close(); resetClientsForTest();
    await db.brand.delete({where:{id:brandId}});
    await db.userProfile.deleteMany({where:{id:{in:[a,b]}}});
  });
  afterAll(async () => {await db.$disconnect();});
  async function build(client: PrismaClient=db) {setClientsForTest({prisma:client}); app=Fastify(); await app.register(brandMemberRoutes);}
  const change = (actor:string,target:string,method:'PATCH'|'DELETE'='PATCH') => app.inject({method,url:`/api/brand/members/${target}`,headers:{authorization:`Bearer ${JSON.stringify({realm:'brand',brandId,userId:actor})}`},...(method==='PATCH'?{payload:{role:'staff'}}:{})});
  function simultaneousGuards() {
    let arrived=0; let release!:()=>void; const barrier=new Promise<void>(r=>{release=r;});
    return db.$extends({query:{brandMember:{async findUnique({args,query}) {
      const result=await query(args);
      if(args.select?.status && args.select?.role) {if(++arrived===2) release(); await barrier;}
      return result;
    }}}}) as unknown as PrismaClient;
  }
  it.each(['demote','remove'] as const)('preserves an active owner when owners concurrently %s',async kind=>{
    await build(simultaneousGuards());
    const results=await Promise.all(kind==='demote'?[change(a,a),change(b,b)]:[change(a,b,'DELETE'),change(b,a,'DELETE')]);
    expect(results.filter(r=>r.statusCode===200)).toHaveLength(1);
    expect(await db.brandMember.count({where:{brandId,role:'owner',status:'active'}})).toBe(1);
  });
  it('rechecks an actor demoted after the request guard read',async()=>{
    let changed=false;
    const client=db.$extends({query:{brandMember:{async findUnique({args,query}) {
      const result=await query(args);
      if(args.select?.status && !changed) {
        changed=true;
        await db.brandMember.update({where:{brandId_userId:{brandId,userId:a}},data:{role:'staff'}});
      }
      return result;
    }}}}) as unknown as PrismaClient;
    await build(client);
    expect((await change(a,b)).statusCode).toBe(403);
    expect((await db.brandMember.findUniqueOrThrow({where:{brandId_userId:{brandId,userId:b}}})).role).toBe('owner');
  });
  it('allows demoting a suspended owner without treating them as active',async()=>{
    await db.brandMember.update({where:{brandId_userId:{brandId,userId:b}},data:{status:'suspended'}});
    await build(); expect((await change(a,b)).statusCode).toBe(200);
  });
  it('refuses demotion of the last active owner',async()=>{
    await db.brandMember.update({where:{brandId_userId:{brandId,userId:b}},data:{role:'staff'}});
    await build(); expect((await change(a,a)).statusCode).toBe(400);
  });
  it('rolls back a role change if audit insertion fails',async()=>{
    const client=db.$extends({query:{auditLog:{async create(){throw new Error('audit unavailable');}}}}) as unknown as PrismaClient;
    await build(client); expect((await change(a,b)).statusCode).toBe(500);
    expect((await db.brandMember.findUniqueOrThrow({where:{brandId_userId:{brandId,userId:b}}})).role).toBe('owner');
  });
});
