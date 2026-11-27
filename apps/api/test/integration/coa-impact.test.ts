import {afterAll,describe,expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {getPrisma} from '@ruostack/db';
import {buildApp} from '../../src/app.ts';
import {signAdminAccessToken} from '../../src/auth/admin-jwt.ts';
import {lotFixture} from '../helpers/lot-fixture.ts';
import {confirmOrderLots,consumeConfirmedOrderLots} from '../../src/services/order-lots.ts';
const db=getPrisma();
describe.skipIf(process.env.RUN_DB_TESTS!=='1')('recall and old exception discovery',()=>{afterAll(()=>db.$disconnect());it('pages affected shipments and exceptions independently of the latest fulfillment list',async()=>{
 const app=await buildApp();try{const f=await lotFixture();const o=await f.order(1);await db.$transaction(async tx=>{await confirmOrderLots(tx,o.id,[{orderItemId:o.items[0]!.id,lotId:f.lot.id,qty:1}],'test',randomUUID());await consumeConfirmedOrderLots(tx,o.id,'ship');await tx.order.update({where:{id:o.id},data:{status:'shipped'}});});
 const admin=await db.adminUser.create({data:{email:`${randomUUID()}@test.local`,fullName:'Ops',role:'operations',passwordHash:'test',status:'active'}});const session=await db.adminSession.create({data:{adminUserId:admin.id,familyId:randomUUID(),refreshTokenHash:randomUUID(),expiresAt:new Date(Date.now()+60000)}});const headers={authorization:`Bearer ${signAdminAccessToken({sub:admin.id,role:'operations',sid:session.id})}`};
 const impact=await app.inject({url:`/api/admin/lots/${f.lot.id}/orders?limit=1`,headers});expect(impact.statusCode).toBe(200);expect(impact.json().rows[0].orderId).toBe(o.id);
 const exceptions=await app.inject({url:'/api/admin/lot-exceptions?limit=1',headers});expect(exceptions.statusCode).toBe(200);expect(exceptions.json()).toHaveProperty('total');
 }finally{await app.close();}
});});
