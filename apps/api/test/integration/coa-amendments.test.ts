import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import {lotFixture} from '../helpers/lot-fixture.ts';
import {receiveLot,setLotState,changeLotCertificate} from '../../src/services/lot-inventory.ts';
import {confirmOrderLots,consumeConfirmedOrderLots,amendShippedAllocation} from '../../src/services/order-lots.ts';
import {readOrderCoas} from '../../src/services/coa-views.ts';
const db=getPrisma();
describe.skipIf(process.env.RUN_DB_TESTS!=='1')('immutable historical corrections',()=>{
 afterAll(()=>db.$disconnect());
 it('changes a quarantined lot current certificate without rewriting an older shipment',async()=>{
 const f=await lotFixture();const o=await f.order(3);await db.$transaction(async tx=>{await confirmOrderLots(tx,o.id,[{orderItemId:o.items[0]!.id,lotId:f.lot.id,qty:3}],'test',randomUUID());await consumeConfirmedOrderLots(tx,o.id,'ship');await tx.order.update({where:{id:o.id},data:{status:'shipped'}});});
 const r=await db.coaRevision.create({data:{documentId:f.c.documentId,uploadKey:randomUUID(),objectKey:randomUUID(),filename:'new.pdf',sizeBytes:50,lab:'Lab',reportNumber:'New',testDate:new Date(),uploadedBy:randomUUID(),status:'reviewed'}});
 await expect(db.$transaction(tx=>changeLotCertificate(tx,f.lot.id,r.id,'New report','test'))).rejects.toThrow();await db.$transaction(tx=>setLotState(tx,f.lot.id,'quarantined','Review replacement','test'));await db.$transaction(tx=>changeLotCertificate(tx,f.lot.id,r.id,'New report','test'));
 expect((await readOrderCoas(db,f.b.id,o.id)).allocations[0]!.revisionId).toBe(f.c.id);
 });
 it('appends a correction and adjusts the two balances once, preserving original evidence',async()=>{
 const f=await lotFixture();const b=await db.$transaction(tx=>receiveLot(tx,{...f.input,lotCode:'B',qty:200},'test',randomUUID()));const o=await f.order(3);
 await db.$transaction(async tx=>{await confirmOrderLots(tx,o.id,[{orderItemId:o.items[0]!.id,lotId:f.lot.id,qty:3}],'test',randomUUID());await consumeConfirmedOrderLots(tx,o.id,'ship');await tx.order.update({where:{id:o.id},data:{status:'shipped'}});});
 const original=await db.orderLotAllocation.findFirstOrThrow({where:{orderId:o.id,state:'shipped'}});const key=randomUUID();const amend=()=>db.$transaction(tx=>amendShippedAllocation(tx,o.id,original.id,b.id,'Packing record correction','test',key));await amend();await amend();
 expect((await db.productLot.findUniqueOrThrow({where:{id:f.lot.id}})).onHand).toBe(500);expect((await db.productLot.findUniqueOrThrow({where:{id:b.id}})).onHand).toBe(197);expect((await db.orderLotAllocation.findUniqueOrThrow({where:{id:original.id}})).lotId).toBe(f.lot.id);
 expect((await readOrderCoas(db,f.b.id,o.id)).allocations[0]).toMatchObject({lotCode:'B',originalLotCode:f.lot.lotCode});
 });
});
