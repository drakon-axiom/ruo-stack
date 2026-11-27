import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { lotFixture } from '../helpers/lot-fixture.ts';
import { enqueueCoaWriteback } from '../../src/services/coa-outbox.ts';
import { drainCoaWritebacks, performCoaWriteback } from '../../src/services/coa-writeback.ts';
import {applyOrderEdit} from '../../src/services/order-edit.ts';
import { encryptStoreCreds } from '../../src/services/woo.ts';
process.env.PUBLIC_API_BASE_URL='https://backend.test';
const db=getPrisma();
describe.skipIf(process.env.RUN_DB_TESTS!=='1')('durable COA writeback',()=>{
 afterAll(()=>db.$disconnect());
 it('retains failed work, retries, and never duplicates an idempotency key',async()=>{
 const id=randomUUID();const key=`test:${id}`;await enqueueCoaWriteback(db,'shipment',id,key);await enqueueCoaWriteback(db,'shipment',id,key);
 expect(await db.coaWritebackJob.count({where:{key}})).toBe(1);
 // Limit the worker fixture to this job while retaining real persisted updates.
 const workerDb={...db,coaWritebackJob:{findMany:async()=>[await db.coaWritebackJob.findUniqueOrThrow({where:{key}})],update:db.coaWritebackJob.update.bind(db.coaWritebackJob)}} as typeof db;
 await drainCoaWritebacks(workerDb,async()=>{throw new Error('store down');});expect(await db.coaWritebackJob.findUnique({where:{key}})).toMatchObject({status:'pending',attempts:1});
 await db.coaWritebackJob.update({where:{key},data:{attempts:7}});await drainCoaWritebacks(workerDb,async()=>{throw new Error('still down');});expect((await db.coaWritebackJob.findUniqueOrThrow({where:{key}})).status).toBe('failed');
 await drainCoaWritebacks(workerDb,async()=>{});expect((await db.coaWritebackJob.findUniqueOrThrow({where:{key}})).status).toBe('complete');
 });
 it('preserves duplicate SKU line identity through order edits',async()=>{
 const f=await lotFixture();const o=await f.order(3);await db.order.update({where:{id:o.id},data:{source:'woocommerce'}});await db.orderItem.update({where:{id:o.items[0]!.id},data:{wooLineId:'72'}});await db.orderItem.create({data:{orderId:o.id,productId:f.p.id,qty:9,unitWholesaleCents:1,wooLineId:'71'}});
 const original=await db.order.findUniqueOrThrow({where:{id:o.id},include:{items:true}});const updated=await applyOrderEdit(db,original,{items:original.items.map(i=>({product_id:i.productId,qty:i.qty,order_item_id:i.id}))},{type:'admin',id:randomUUID()});expect(updated.items.map(i=>i.wooLineId).sort()).toEqual(['71','72']);
 });
 it('updates line certificates before marking a Woo order completed',async()=>{
 process.env.PUBLIC_API_BASE_URL='https://backend.test';
 const f=await lotFixture();const o=await f.order(3);
 await db.coaRevision.update({where:{id:f.c.id},data:{publishedAt:new Date(),status:'published'}});
 await db.orderLotAllocation.create({data:{orderId:o.id,orderItemId:o.items[0]!.id,lotId:f.lot.id,coaRevisionId:f.c.id,lotCode:f.lot.lotCode,sku:f.p.canonicalSku,wooLineId:'72',qty:3,state:'shipped'}});await db.order.update({where:{id:o.id},data:{source:'woocommerce',externalOrderId:'52',status:'shipped',trackingNumber:'TRACK'}});
 await db.brandStoreConnection.create({data:{brandId:f.b.id,storeUrl:'https://store.test',...encryptStoreCreds('ck_test','cs_test'),webhookSecret:'test'}});
 await enqueueCoaWriteback(db,'shipment',o.id,`test:${o.id}`);const job=await db.coaWritebackJob.findUniqueOrThrow({where:{key:`test:${o.id}`}});
 const request=vi.fn().mockResolvedValue({});await performCoaWriteback(db,job,request);expect(request.mock.calls[0]![3]).toMatchObject({line_items:[{id:72}]});expect(request.mock.calls[1]![3]).toMatchObject({status:'completed'});expect(request.mock.calls.some(c=>c[2].includes('/notes'))).toBe(false);
 });
});
