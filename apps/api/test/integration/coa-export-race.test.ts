import {afterAll,describe,expect,it} from 'vitest';
import {getPrisma} from '@ruostack/db';
import {lotFixture} from '../helpers/lot-fixture.ts';
import {prepareShipstationExport} from '../../src/services/shipstation-export.ts';
import {enableLotTracking} from '../../src/services/lot-inventory.ts';
import {enqueueExpiredLotUpdates} from '../../src/services/coa-writeback.ts';
const db=getPrisma();
describe.skipIf(process.env.RUN_DB_TESTS!=='1')('export and stock transitions',()=>{
 afterAll(()=>db.$disconnect());
 it('rechecks tracking under the same product lock as activation',async()=>{
 const f=await lotFixture();await db.catalogProduct.update({where:{id:f.p.id},data:{lotTracking:false}});const o=await f.order(1);
 let release!:()=>void;let locked!:()=>void;const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>locked=r);
 const enabling=db.$transaction(async tx=>{await tx.$queryRaw`SELECT id FROM catalog_product WHERE id=${f.p.id}::uuid FOR UPDATE`;locked();await gate;await tx.catalogProduct.update({where:{id:f.p.id},data:{lotTracking:true}});});await ready;
 const exporting=prepareShipstationExport(db,o.id);release();await enabling;expect(await exporting).toBeNull();expect((await db.order.findUniqueOrThrow({where:{id:o.id}})).exportedAt).toBeNull();
 });
 it('queues stock reconciliation when tracking is enabled and expiry passes',async()=>{
 const f=await lotFixture();await db.catalogProduct.update({where:{id:f.p.id},data:{lotTracking:false}});const before=await db.coaWritebackJob.count({where:{kind:'product',targetId:f.p.id}});await db.$transaction(tx=>enableLotTracking(tx,f.p.id,'Count verified','test'));expect(await db.coaWritebackJob.count({where:{kind:'product',targetId:f.p.id}})).toBeGreaterThan(before);
 await db.productLot.update({where:{id:f.lot.id},data:{expiresAt:new Date(Date.now()-1000)}});await enqueueExpiredLotUpdates(db);expect(await db.coaWritebackJob.count({where:{targetId:f.p.id,key:{startsWith:'expiry:'}}})).toBe(1);await enqueueExpiredLotUpdates(db);expect(await db.coaWritebackJob.count({where:{targetId:f.p.id,key:{startsWith:'expiry:'}}})).toBe(1);
 });
});
