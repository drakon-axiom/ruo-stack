import {lotFixture} from '../helpers/lot-fixture.ts';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { receiveLot, reserveLots, releaseLotReservations, adjustLot, setLotState } from '../../src/services/lot-inventory.ts';
const db=getPrisma();const actor='warehouse-test';
describe.skipIf(process.env.RUN_DB_TESTS!=='1')('lot balances',()=>{
 afterAll(()=>db.$disconnect());
 it('receives once, rejects mismatched retries, reserves and releases without changing on hand',async()=>{
 const f=await lotFixture();const key=randomUUID();const input={...f.input,lotCode:randomUUID()};
 const a=await db.$transaction(tx=>receiveLot(tx,input,actor,key));expect((await db.$transaction(tx=>receiveLot(tx,input,actor,key))).id).toBe(a.id);
 await expect(db.$transaction(tx=>receiveLot(tx,{...input,qty:501},actor,key))).rejects.toMatchObject({statusCode:409});
 const o=await f.order(12);await db.$transaction(tx=>reserveLots(tx,o.id,[{orderItemId:o.items[0]!.id,lotId:f.lot.id,qty:12}],actor,randomUUID()));
 expect(await db.productLot.findUnique({where:{id:f.lot.id}})).toMatchObject({onHand:500,reserved:12});
 await db.$transaction(tx=>releaseLotReservations(tx,o.id,actor,randomUUID()));expect(await db.productLot.findUnique({where:{id:f.lot.id}})).toMatchObject({onHand:500,reserved:0});
 });
 it('serializes competing reservations and rejects negative/overflow adjustments',async()=>{
 const f=await lotFixture();const orders=await Promise.all([f.order(300),f.order(300)]);
 const results=await Promise.allSettled(orders.map(o=>db.$transaction(tx=>reserveLots(tx,o.id,[{orderItemId:o.items[0]!.id,lotId:f.lot.id,qty:300}],actor,randomUUID()))));
 expect(results.filter(r=>r.status==='fulfilled')).toHaveLength(1);
 await expect(db.$transaction(tx=>adjustLot(tx,f.lot.id,-501,'count correction',actor,randomUUID()))).rejects.toThrow();
 await expect(db.$transaction(tx=>adjustLot(tx,f.lot.id,2147483647,'count correction',actor,randomUUID()))).rejects.toThrow();
 const sums=await db.lotMovement.aggregate({where:{lotId:f.lot.id},_sum:{onHandDelta:true,reservedDelta:true}});
 expect(sums._sum).toEqual({onHandDelta:500,reservedDelta:300});
 });
 it('blocks expired lots and leaves recalled reservations available for explicit release',async()=>{
 const f=await lotFixture();const o=await f.order(12);await db.$transaction(tx=>reserveLots(tx,o.id,[{orderItemId:o.items[0]!.id,lotId:f.lot.id,qty:12}],actor,randomUUID()));
 await db.$transaction(tx=>setLotState(tx,f.lot.id,'recalled','Recall',actor));await db.$transaction(tx=>releaseLotReservations(tx,o.id,actor,randomUUID()));
 expect((await db.productLot.findUniqueOrThrow({where:{id:f.lot.id}})).reserved).toBe(0);
 await db.productLot.update({where:{id:f.lot.id},data:{expiresAt:new Date(Date.now()-1000)}});await expect(db.$transaction(tx=>setLotState(tx,f.lot.id,'released','Release',actor))).rejects.toMatchObject({statusCode:409});
 });
 it('rejects wrong products, recalled lots and withdrawn certificates',async()=>{
 const f=await lotFixture();const g=await lotFixture();const o=await f.order(1);
 const reserve=(lotId:string)=>db.$transaction(tx=>reserveLots(tx,o.id,[{orderItemId:o.items[0]!.id,lotId,qty:1}],actor,randomUUID()));
 await expect(reserve(g.lot.id)).rejects.toThrow();
 await db.$transaction(tx=>setLotState(tx,f.lot.id,'recalled','Recall',actor));await expect(reserve(f.lot.id)).rejects.toThrow();
 await db.coaRevision.update({where:{id:g.c.id},data:{status:'withdrawn'}});
 await expect(db.$transaction(tx=>receiveLot(tx,{...g.input,lotCode:randomUUID()},actor,randomUUID()))).rejects.toThrow();
 });
});
