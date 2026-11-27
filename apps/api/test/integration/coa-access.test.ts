import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { lotFixture } from '../helpers/lot-fixture.ts';
import { readOrderCoas, readPublicCoa } from '../../src/services/coa-views.ts';
import { confirmOrderLots, consumeConfirmedOrderLots } from '../../src/services/order-lots.ts';
const db=getPrisma();
describe.skipIf(process.env.RUN_DB_TESTS!=='1')('certificate access',()=>{
 afterAll(()=>db.$disconnect());
 it('does not expose private/draft documents and marks withdrawn published documents',async()=>{
 const f=await lotFixture();await expect(readPublicCoa(db,f.c.publicId)).rejects.toMatchObject({statusCode:404});
 await db.coaRevision.update({where:{id:f.c.id},data:{status:'published',publishedAt:new Date()}});
 const doc=await readPublicCoa(db,f.c.publicId);expect(doc.reportNumber).toBe('Test');expect(doc).not.toHaveProperty('objectKey');expect(doc).not.toHaveProperty('uploadedBy');
 await db.coaRevision.update({where:{id:f.c.id},data:{status:'withdrawn',withdrawalReason:'Recall'}});expect((await readPublicCoa(db,f.c.publicId)).status).toBe('withdrawn');
 });
 it('scopes order records to the tenant and preserves the shipped revision',async()=>{
 const f=await lotFixture();const o=await f.order(3);await expect(readOrderCoas(db,randomUUID(),o.id)).rejects.toMatchObject({statusCode:404});
 expect((await readOrderCoas(db,f.b.id,o.id)).allocations).toEqual([]);
 await db.$transaction(async tx=>{await confirmOrderLots(tx,o.id,[{orderItemId:o.items[0]!.id,lotId:f.lot.id,qty:3}],'test',randomUUID());await consumeConfirmedOrderLots(tx,o.id,'ship');await tx.order.update({where:{id:o.id},data:{status:'shipped'}});});
 const result=await readOrderCoas(db,f.b.id,o.id);expect(result.allocations[0]).toMatchObject({qty:3,revisionId:f.c.id,lotCode:f.lot.lotCode});
 await db.coaRevision.update({where:{id:f.c.id},data:{status:'withdrawn'}});expect((await readOrderCoas(db,f.b.id,o.id)).allocations[0]).toMatchObject({revisionId:f.c.id,status:'withdrawn',url:null});
 const legacy=await f.order(1);await db.order.update({where:{id:legacy.id},data:{status:'shipped'}});expect((await readOrderCoas(db,f.b.id,legacy.id)).readiness).toBe('untracked');
 });
});
