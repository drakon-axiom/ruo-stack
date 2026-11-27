import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { buildApp } from '../../src/app.ts';
import { signAdminAccessToken } from '../../src/auth/admin-jwt.ts';
import { lotFixture } from '../helpers/lot-fixture.ts';
const db=getPrisma();
describe.skipIf(process.env.RUN_DB_TESTS!=='1')('COA route and Data API boundaries',()=>{
 afterAll(()=>db.$disconnect());
 it('requires admin authentication and catalog write permission',async()=>{
 const app=await buildApp();try{
 expect((await app.inject({method:'POST',url:'/api/admin/coas/upload',payload:{}})).statusCode).toBe(401);
 const admin=await db.adminUser.create({data:{email:`${randomUUID()}@test.local`,fullName:'Support',role:'support',status:'active',passwordHash:'test'}});
 const session=await db.adminSession.create({data:{adminUserId:admin.id,familyId:randomUUID(),refreshTokenHash:randomUUID(),expiresAt:new Date(Date.now()+60000)}});const token=signAdminAccessToken({sub:admin.id,role:'support',sid:session.id});
 expect((await app.inject({method:'POST',url:'/api/admin/coas/upload',headers:{authorization:`Bearer ${token}`},payload:{}})).statusCode).toBe(403);
 const f=await lotFixture();expect((await app.inject({url:`/coa/${f.c.publicId}`})).statusCode).toBe(404);
 await db.coaRevision.update({where:{id:f.c.id},data:{status:'published',publishedAt:new Date()}});const response=await app.inject({url:`/coa/${f.c.publicId}`,headers:{accept:'application/json'}});expect(response.statusCode).toBe(200);expect(response.headers['cache-control']).toBe('no-store');expect(response.json()).not.toHaveProperty('objectKey');
 await db.coaRevision.update({where:{id:f.c.id},data:{status:'withdrawn'}});expect((await app.inject({url:`/coa/${f.c.publicId}/download`})).statusCode).toBe(410);
 }finally{await app.close();}
 });
 it('denies anonymous direct access to certificate and inventory tables',async()=>{
 for(const table of ['coa_document','coa_revision','product_lot','lot_movement','order_lot_allocation','coa_writeback_job'])await expect(db.$transaction(async tx=>{await tx.$executeRawUnsafe('SET LOCAL ROLE anon');await tx.$queryRawUnsafe(`SELECT * FROM public.${table} LIMIT 1`);})).rejects.toThrow(/permission denied/);
 });
});
