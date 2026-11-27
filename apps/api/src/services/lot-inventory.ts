import { createHash } from 'node:crypto';
import type { Prisma, ProductLot } from '@ruostack/db';
import { z } from 'zod';
import { Conflict, NotFound } from '../errors.ts';
import { writeAudit } from '../audit.ts';
export type LotTx=Prisma.TransactionClient;
export const Quantity=z.number().int().positive().max(2147483647);
export const ReceiveLotSchema=z.object({productId:z.string().uuid(),lotCode:z.string().trim().min(1).max(120),coaRevisionId:z.string().uuid(),qty:Quantity,expiresAt:z.string().datetime().optional()});
export const AllocationSchema=z.object({orderItemId:z.string().uuid(),lotId:z.string().uuid(),qty:Quantity});
export type AllocationInput=z.infer<typeof AllocationSchema>;
export async function lockOrder(tx:LotTx,id:string){await tx.$queryRaw`SELECT id FROM "order" WHERE id=${id}::uuid FOR UPDATE`;return tx.order.findUniqueOrThrow({where:{id},include:{items:{include:{product:true}}}});}
export async function lockProducts(tx:LotTx,ids:string[]){for(const id of [...new Set(ids)].sort())await tx.$queryRaw`SELECT id FROM catalog_product WHERE id=${id}::uuid FOR UPDATE`;}
async function operation(tx:LotTx,key:string,input:unknown){
 z.string().min(1).max(200).parse(key);const fingerprint=createHash('sha256').update(JSON.stringify(input)).digest('hex');
 await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lot:${key}`},0))::text`;
 const prior=await tx.lotOperation.findUnique({where:{key}});if(prior&&prior.fingerprint!==fingerprint)throw Conflict('idempotency_conflict','Key was already used for a different inventory operation');return {prior,fingerprint};
}
async function saveOperation(tx:LotTx,key:string,fingerprint:string,resultId?:string){await tx.lotOperation.create({data:{key,fingerprint,resultId}});}
async function approvedRevision(tx:LotTx,id:string,productId:string){
 await tx.$queryRaw`SELECT id FROM coa_revision WHERE id=${id}::uuid FOR SHARE`;
 const r=await tx.coaRevision.findUnique({where:{id},include:{document:true}});
 if(!r||r.document.productId!==productId||!['reviewed','published'].includes(r.status)||!r.objectKey)throw Conflict('coa_not_approved','Lot requires a reviewed certificate for the same product');
}
export async function receiveLot(tx:LotTx,raw:z.infer<typeof ReceiveLotSchema>,actor:string,key:string){
 const input=ReceiveLotSchema.parse(raw);const op=await operation(tx,key,{kind:'receive',...input});if(op.prior)return tx.productLot.findUniqueOrThrow({where:{id:op.prior.resultId!}});
 await lockProducts(tx,[input.productId]);await approvedRevision(tx,input.coaRevisionId,input.productId);
 const lot=await tx.productLot.create({data:{productId:input.productId,lotCode:input.lotCode,coaRevisionId:input.coaRevisionId,onHand:input.qty,expiresAt:input.expiresAt?new Date(input.expiresAt):null}});
 await tx.lotMovement.create({data:{lotId:lot.id,kind:'receipt',onHandDelta:input.qty,reservedDelta:0,actorId:actor,reason:'Opening receipt',operationKey:key}});await saveOperation(tx,key,op.fingerprint,lot.id);return lot;
}
export async function adjustLot(tx:LotTx,id:string,delta:number,reason:string,actor:string,key:string){
 z.number().int().min(-2147483647).max(2147483647).refine(n=>n!==0).parse(delta);z.string().trim().min(1).max(1000).parse(reason);
 const op=await operation(tx,key,{kind:'adjust',id,delta,reason});if(op.prior)return;
 const found=await tx.productLot.findUnique({where:{id}});if(!found)throw NotFound();await lockProducts(tx,[found.productId]);
 const lot=await tx.productLot.findUniqueOrThrow({where:{id}});const next=lot.onHand+delta;
 if(next<lot.reserved||next>2147483647)throw Conflict('inventory_balance','Adjustment exceeds the available balance');
 await tx.productLot.update({where:{id},data:{onHand:next}});await tx.lotMovement.create({data:{lotId:id,kind:'adjustment',onHandDelta:delta,reservedDelta:0,actorId:actor,reason,operationKey:key}});await saveOperation(tx,key,op.fingerprint,id);
}
export async function setLotState(tx:LotTx,id:string,state:'released'|'quarantined'|'recalled',reason:string,actor:string){
 z.enum(['released','quarantined','recalled']).parse(state);z.string().trim().min(1).max(1000).parse(reason);
 const lot=await tx.productLot.findUnique({where:{id}});if(!lot)throw NotFound();await lockProducts(tx,[lot.productId]);
 if(state==='released'){await approvedRevision(tx,lot.coaRevisionId,lot.productId);if(lot.expiresAt&&lot.expiresAt<=new Date())throw Conflict('lot_expired','Expired lot cannot be released');}
 await tx.productLot.update({where:{id},data:{state}});await writeAudit(tx,{actorType:'admin',actorId:actor,action:'lot.state_changed',targetType:'product_lot',targetId:id,after:{state},reason});
}
export function eligibleLot(lot:ProductLot){return lot.state==='released'&&(!lot.expiresAt||lot.expiresAt>new Date());}
export async function reserveLots(tx:LotTx,orderId:string,raw:AllocationInput[],actor:string,key:string){
 const allocations=z.array(AllocationSchema).min(1).max(200).parse(raw).sort((a,b)=>a.orderItemId.localeCompare(b.orderItemId)||a.lotId.localeCompare(b.lotId));
 let order=await lockOrder(tx,orderId);
 const op=await operation(tx,key,{kind:'reserve',orderId,allocations});if(op.prior)return;
 if(!['ready_for_fulfillment','processing'].includes(order.status)||order.blocker!=='none')throw Conflict('order_not_released','Resolve order blockers before allocating lots');
 await lockProducts(tx,order.items.map(i=>i.productId));
 order=await lockOrder(tx,orderId);
 if(await tx.orderLotAllocation.count({where:{orderId,state:'reserved'}}))throw Conflict('already_allocated','Release previous reservations before allocating');
 const seen=new Set<string>();const totals=new Map<string,number>();
 for(const a of allocations){const pair=`${a.orderItemId}:${a.lotId}`;if(seen.has(pair))throw Conflict('duplicate_allocation','Combine quantities for the same item and lot');seen.add(pair);totals.set(a.orderItemId,(totals.get(a.orderItemId)??0)+a.qty);}
 for(const a of allocations){
  const item=order.items.find(i=>i.id===a.orderItemId);const lot=await tx.productLot.findUnique({where:{id:a.lotId}});
  if(!item||!lot||lot.productId!==item.productId||!item.product.lotTracking||!item.product.isPublished||item.product.archived||item.product.status!=='in_stock'||!eligibleLot(lot)||totals.get(item.id)!>item.qty)throw Conflict('invalid_allocation','Lot is not eligible for this order item');
  await approvedRevision(tx,lot.coaRevisionId,item.productId);
  if(lot.onHand-lot.reserved<a.qty)throw Conflict('insufficient_stock','Not enough available lot stock');
  await tx.productLot.update({where:{id:lot.id},data:{reserved:{increment:a.qty}}});
  await tx.orderLotAllocation.create({data:{orderId,orderItemId:item.id,lotId:lot.id,coaRevisionId:lot.coaRevisionId,lotCode:lot.lotCode,sku:item.product.canonicalSku,wooLineId:item.wooLineId,qty:a.qty}});
  await tx.lotMovement.create({data:{lotId:lot.id,kind:'reserve',onHandDelta:0,reservedDelta:a.qty,orderId,actorId:actor,reason:'Order allocation',operationKey:key}});
 }
 await tx.order.update({where:{id:orderId},data:{traceabilityStatus:'needs_confirmation'}});await saveOperation(tx,key,op.fingerprint,orderId);
}
export async function releaseLotReservations(tx:LotTx,orderId:string,actor:string,key:string){
 const order=await lockOrder(tx,orderId);
 const op=await operation(tx,key,{kind:'release',orderId});if(op.prior)return;
 const rows=await tx.orderLotAllocation.findMany({where:{orderId,state:'reserved'},include:{lot:true},orderBy:{lotId:'asc'}});
 await lockProducts(tx,rows.map(r=>r.lot.productId));
 for(const r of rows){await tx.productLot.update({where:{id:r.lotId},data:{reserved:{decrement:r.qty}}});await tx.orderLotAllocation.update({where:{id:r.id},data:{state:'released'}});await tx.lotMovement.create({data:{lotId:r.lotId,kind:'release',onHandDelta:0,reservedDelta:-r.qty,orderId,actorId:actor,reason:'Order reservation released',operationKey:key}});}
 if(!['shipped','delivered'].includes(order.status))await tx.order.update({where:{id:orderId},data:{traceabilityStatus:order.items.some(i=>i.product.lotTracking)?'needs_allocation':'untracked'}});
 await saveOperation(tx,key,op.fingerprint,orderId);
}
export async function availableProductUnits(tx:Pick<LotTx,'productLot'>,productId:string){
 const rows=await tx.productLot.findMany({where:{productId,state:'released',OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}],coaRevision:{status:{in:['reviewed','published']}}}});return rows.reduce((sum,l)=>sum+l.onHand-l.reserved,0);
}
