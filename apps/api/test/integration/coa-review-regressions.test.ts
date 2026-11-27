import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import {getPrisma} from '@ruostack/db';
import {lotFixture} from '../helpers/lot-fixture.ts';
import {consumeConfirmedOrderLots,resolveShipmentLotException,confirmOrderLots} from '../../src/services/order-lots.ts';
import {readPublicCoa,readOrderCoas} from '../../src/services/coa-views.ts';
import {performCoaWriteback,wooCoaLines} from '../../src/services/coa-writeback.ts';
import {encryptStoreCreds} from '../../src/services/woo.ts';
import {enqueueCoaWriteback} from '../../src/services/coa-outbox.ts';
import {applyOrderEdit} from '../../src/services/order-edit.ts';
const db=getPrisma();process.env.PUBLIC_API_BASE_URL='https://backend.test';
describe.skipIf(process.env.RUN_DB_TESTS!=='1')('final COA review regressions',()=>{
 afterAll(()=>db.$disconnect());
 it('refuses to write an old shipment into a different current store',async()=>{
 const f=await lotFixture();const o=await f.order(1);await db.order.update({where:{id:o.id},data:{source:'woocommerce',externalOrderId:'52',trackingNumber:'PRIVATE',status:'shipped',originStoreId:randomUUID(),originStoreUrl:'https://old-store.test'}});
 await db.brandStoreConnection.create({data:{brandId:f.b.id,storeUrl:'https://new-store.test',...encryptStoreCreds('ck_test','cs_test'),webhookSecret:'test'}});await enqueueCoaWriteback(db,'shipment',o.id,`review:${o.id}`);const job=await db.coaWritebackJob.findUniqueOrThrow({where:{key:`review:${o.id}`}});const request=vi.fn().mockResolvedValue({});await expect(performCoaWriteback(db,job,request)).rejects.toThrow(/origin|store/i);expect(request).not.toHaveBeenCalled();
 });
 it('requires explicit certificate evidence for late assignments',async()=>{
 const f=await lotFixture();const o=await f.order(1);await db.$transaction(async tx=>{await consumeConfirmedOrderLots(tx,o.id,'physical',true);await tx.order.update({where:{id:o.id},data:{status:'shipped'}});});
 await expect(db.$transaction(tx=>resolveShipmentLotException(tx,o.id,[{orderItemId:o.items[0]!.id,lotId:f.lot.id,qty:1}],'test','Packing log'))).rejects.toThrow(/revision|certificate/i);
 });
 it('sends empty replacement metadata when corrected certificate is private',()=>{expect(wooCoaLines([{wooLineId:'72',lotCode:'B',qty:3,url:null}])).toEqual([{id:72,meta_data:[{key:'_ruostack_coa_allocations',value:[]}]}]);});
 it('does not publish internal withdrawal notes',async()=>{const f=await lotFixture();await db.coaRevision.update({where:{id:f.c.id},data:{status:'withdrawn',publishedAt:new Date(),withdrawalReason:'Customer Jane order 52'}});expect(JSON.stringify(await readPublicCoa(db,f.c.publicId))).not.toContain('Customer Jane');});
 it('lets the receiving brand download its reviewed private shipped certificate',async()=>{const f=await lotFixture();const o=await f.order(1);await db.$transaction(async tx=>{await confirmOrderLots(tx,o.id,[{orderItemId:o.items[0]!.id,lotId:f.lot.id,qty:1}],'test',randomUUID());await consumeConfirmedOrderLots(tx,o.id,'ship');await tx.order.update({where:{id:o.id},data:{status:'shipped'}});});expect((await readOrderCoas(db,f.b.id,o.id)).allocations[0]).toHaveProperty('downloadPath');});
 it('replaces an existing manual line product without retaining false source identity',async()=>{const f=await lotFixture();const g=await lotFixture();const o=await f.order(1);const changed=await applyOrderEdit(db,o,{items:[{order_item_id:o.items[0]!.id,product_id:g.p.id,qty:1}]},{type:'admin',id:randomUUID()});expect(changed.items[0]!.productId).toBe(g.p.id);expect(changed.items[0]!.wooLineId).toBeNull();});
 it('keeps exception scope fixed when another SKU is enabled later',async()=>{const f=await lotFixture();const g=await lotFixture();await db.catalogProduct.update({where:{id:g.p.id},data:{lotTracking:false}});const o=await f.order(1);await db.orderItem.create({data:{orderId:o.id,productId:g.p.id,qty:2,unitWholesaleCents:1}});await db.$transaction(async tx=>{await consumeConfirmedOrderLots(tx,o.id,'physical',true);await tx.order.update({where:{id:o.id},data:{status:'shipped'}});});expect(await db.orderTraceabilityItem.findMany({where:{orderId:o.id}})).toMatchObject([{productId:f.p.id,qty:1}]);await db.catalogProduct.update({where:{id:g.p.id},data:{lotTracking:true}});await db.$transaction(tx=>resolveShipmentLotException(tx,o.id,[{orderItemId:o.items[0]!.id,lotId:f.lot.id,qty:1,coaRevisionId:f.c.id}],'test','Original packing record'));expect((await db.productLot.findUniqueOrThrow({where:{id:g.lot.id}})).onHand).toBe(500);});
});
