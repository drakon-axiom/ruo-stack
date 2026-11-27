import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { lotFixture } from '../helpers/lot-fixture.ts';
import { receiveLot, setLotState, releaseLotReservations } from '../../src/services/lot-inventory.ts';
import { confirmOrderLots, consumeConfirmedOrderLots, getOrderLotReadiness, resolveShipmentLotException } from '../../src/services/order-lots.ts';
const db=getPrisma();
describe.skipIf(process.env.RUN_DB_TESTS!=='1')('shipment lot traceability',()=>{
 afterAll(()=>db.$disconnect());
 it('keeps disabled SKUs compatible without inventing historical allocations',async()=>{const f=await lotFixture();await db.catalogProduct.update({where:{id:f.p.id},data:{lotTracking:false}});const o=await f.order(12);expect(await getOrderLotReadiness(db,o.id)).toBe('untracked');await db.$transaction(tx=>consumeConfirmedOrderLots(tx,o.id,'legacy'));expect((await db.productLot.findUniqueOrThrow({where:{id:f.lot.id}})).onHand).toBe(500);expect(await db.orderLotAllocation.count({where:{orderId:o.id}})).toBe(0);});
 it('consumes split lots exactly once and preserves immutable snapshots',async()=>{
 const f=await lotFixture();const b=await db.$transaction(tx=>receiveLot(tx,{...f.input,lotCode:'B',qty:200},'test',randomUUID()));await db.$transaction(tx=>setLotState(tx,b.id,'released','Reviewed','test'));
 const o=await f.order(12);const selections=[{orderItemId:o.items[0]!.id,lotId:f.lot.id,qty:3},{orderItemId:o.items[0]!.id,lotId:b.id,qty:9}];
 expect(await getOrderLotReadiness(db,o.id)).toBe('needs_allocation');
 await db.$transaction(tx=>confirmOrderLots(tx,o.id,selections,'test',randomUUID()));expect(await getOrderLotReadiness(db,o.id)).toBe('ready');
 const ship=()=>db.$transaction(async tx=>{await consumeConfirmedOrderLots(tx,o.id,`ship:${o.id}`);await tx.order.update({where:{id:o.id},data:{status:'shipped'}});});await ship();await ship();
 expect(await db.productLot.findUnique({where:{id:f.lot.id}})).toMatchObject({onHand:497,reserved:0});expect(await db.productLot.findUnique({where:{id:b.id}})).toMatchObject({onHand:191,reserved:0});
 const snapshots=await db.orderLotAllocation.findMany({where:{orderId:o.id,state:'shipped'}});expect(snapshots.map(s=>s.qty).sort()).toEqual([3,9]);
 await expect(db.orderLotAllocation.update({where:{id:snapshots[0]!.id},data:{qty:99}})).rejects.toThrow();
 });
 it('blocks partial/unfunded confirmation, stale selections, and recalled stock',async()=>{
 const f=await lotFixture();const o=await f.order(12);const a=[{orderItemId:o.items[0]!.id,lotId:f.lot.id,qty:12}];
 await expect(db.$transaction(tx=>confirmOrderLots(tx,o.id,[{...a[0]!,qty:3}],'test',randomUUID()))).rejects.toThrow();
 await db.order.update({where:{id:o.id},data:{blocker:'awaiting_funds'}});await expect(db.$transaction(tx=>confirmOrderLots(tx,o.id,a,'test',randomUUID()))).rejects.toThrow();
 await db.order.update({where:{id:o.id},data:{blocker:'none'}});await db.$transaction(tx=>confirmOrderLots(tx,o.id,a,'test',randomUUID()));await db.$transaction(tx=>setLotState(tx,f.lot.id,'recalled','Recall','test'));
 await expect(db.$transaction(tx=>consumeConfirmedOrderLots(tx,o.id,'ship'))).rejects.toThrow();
 await db.$transaction(tx=>consumeConfirmedOrderLots(tx,o.id,'physical',true));expect((await db.order.findUniqueOrThrow({where:{id:o.id}})).traceabilityStatus).toBe('exception');expect(await db.orderLotAllocation.count({where:{orderId:o.id,state:'shipped'}})).toBe(0);
 });
 it('serializes cancellation against shipping and keeps replacement orders unallocated',async()=>{
 const f=await lotFixture();const o=await f.order(12);await db.$transaction(tx=>confirmOrderLots(tx,o.id,[{orderItemId:o.items[0]!.id,lotId:f.lot.id,qty:12}],'test',randomUUID()));
 const results=await Promise.allSettled([db.$transaction(async tx=>{await consumeConfirmedOrderLots(tx,o.id,'race');await tx.order.update({where:{id:o.id},data:{status:'shipped'}});}),db.$transaction(async tx=>{const gate=await tx.order.updateMany({where:{id:o.id,status:'ready_for_fulfillment'},data:{status:'cancelled'}});if(!gate.count)throw new Error('shipped');await releaseLotReservations(tx,o.id,'test',randomUUID());})]);
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);const final=await db.order.findUniqueOrThrow({where:{id:o.id}});expect(await db.productLot.findUnique({where:{id:f.lot.id}})).toMatchObject({onHand:final.status==='shipped'?488:500,reserved:0});
 expect(await getOrderLotReadiness(db,(await f.order(12)).id)).toBe('needs_allocation');
 });
 it('resolves late evidence once without modifying historical assignments',async()=>{
 const f=await lotFixture();const o=await f.order(12);await db.$transaction(async tx=>{await consumeConfirmedOrderLots(tx,o.id,'physical',true);await tx.order.update({where:{id:o.id},data:{status:'shipped'}});});const a=[{orderItemId:o.items[0]!.id,lotId:f.lot.id,qty:12,coaRevisionId:f.c.id}];
 await db.$transaction(tx=>resolveShipmentLotException(tx,o.id,a,'test','Packing log 123'));await expect(db.$transaction(tx=>resolveShipmentLotException(tx,o.id,a,'test','Packing log 123'))).rejects.toThrow();expect((await db.productLot.findUniqueOrThrow({where:{id:f.lot.id}})).onHand).toBe(488);
 });
 it('releases before item replacement and rejects confirmation using deleted IDs',async()=>{
 const f=await lotFixture();const o=await f.order(2);const a=[{orderItemId:o.items[0]!.id,lotId:f.lot.id,qty:2}];await db.$transaction(tx=>confirmOrderLots(tx,o.id,a,'test',randomUUID()));
 await db.$transaction(async tx=>{await releaseLotReservations(tx,o.id,'test',randomUUID());await tx.orderItem.deleteMany({where:{orderId:o.id}});await tx.orderItem.create({data:{orderId:o.id,productId:f.p.id,qty:3,unitWholesaleCents:1}});});
 await expect(db.$transaction(tx=>confirmOrderLots(tx,o.id,a,'test',randomUUID()))).rejects.toThrow();expect((await db.productLot.findUniqueOrThrow({where:{id:f.lot.id}})).reserved).toBe(0);
 });
});
