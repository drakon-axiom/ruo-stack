import {enqueueCoaWriteback} from './coa-outbox.ts';
import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@ruostack/db';
import { Conflict } from '../errors.ts';
import { writeAudit } from '../audit.ts';
import { eligibleLot, lockOrder, lockProducts, reserveLots, releaseLotReservations, type AllocationInput, type LotTx } from './lot-inventory.ts';
type Reader=Pick<PrismaClient,'order'|'orderLotAllocation'>;
export async function getOrderLotReadiness(tx:Reader,orderId:string){
 const o=await tx.order.findUniqueOrThrow({where:{id:orderId},include:{items:{include:{product:true}}}});
 if(o.traceabilityStatus==='exception')return 'exception';
 const terminal=['shipped','delivered'].includes(o.status);
 const rows=await tx.orderLotAllocation.findMany({where:{orderId,state:terminal?'shipped':'reserved'},include:{lot:{include:{coaRevision:true,product:true}}}});
 if(terminal)return rows.length?'ready':'untracked';
 const tracked=o.items.filter(i=>i.product.lotTracking);if(!tracked.length)return 'untracked';
 if(await tx.order.count({where:{traceabilityStatus:'exception',items:{some:{productId:{in:tracked.map(i=>i.productId)}}}}}))return 'exception';
 if(!rows.length)return 'needs_allocation';
 for(const i of tracked)if(rows.filter(r=>r.orderItemId===i.id).reduce((s,r)=>s+r.qty,0)!==i.qty)return 'needs_allocation';
 if(rows.some(r=>!eligibleLot(r.lot)||!['reviewed','published'].includes(r.lot.coaRevision.status)||r.lot.product.status!=='in_stock'||!r.lot.product.isPublished||r.lot.product.archived))return 'exception';
 return rows.every(r=>r.confirmedAt)?'ready':'needs_confirmation';
}
export async function confirmOrderLots(tx:LotTx,orderId:string,allocations:AllocationInput[],actor:string,key:string){
 const o=await lockOrder(tx,orderId);
 if(!['ready_for_fulfillment','processing'].includes(o.status))throw Conflict('not_confirmable','Only unshipped orders can be confirmed');
 await reserveLots(tx,orderId,allocations,actor,key);
 const rows=await tx.orderLotAllocation.findMany({where:{orderId,state:'reserved'}});
 for(const i of o.items.filter(i=>i.product.lotTracking))if(rows.filter(r=>r.orderItemId===i.id).reduce((n,r)=>n+r.qty,0)!==i.qty)throw Conflict('incomplete_lots','Confirm the full quantity of every tracked item');
 await tx.orderLotAllocation.updateMany({where:{orderId,state:'reserved',confirmedAt:null},data:{confirmedAt:new Date(),confirmedBy:actor}});
 if(await getOrderLotReadiness(tx,orderId)!=='ready')throw Conflict('lots_not_ready','Lots are no longer eligible');
 await tx.order.update({where:{id:orderId},data:{traceabilityStatus:'ready'}});await writeAudit(tx,{actorType:'admin',actorId:actor,action:'lots.confirmed',targetType:'order',targetId:orderId,after:{allocations}});
}
export async function consumeConfirmedOrderLots(tx:LotTx,orderId:string,shipmentKey:string,physicalShipment=false){
 const o=await lockOrder(tx,orderId);if(['shipped','delivered'].includes(o.status))return;
 if(o.status==='cancelled')throw Conflict('cancelled','Cancelled order cannot consume inventory');
 await lockProducts(tx,o.items.map(i=>i.productId));
 const rows=await tx.orderLotAllocation.findMany({where:{orderId,state:'reserved'},orderBy:{lotId:'asc'}});
 // Hold the reviewed certificate stable through the local shipment commit.
 for(const id of [...new Set(rows.map(r=>r.coaRevisionId))].sort())await tx.$queryRaw`SELECT id FROM coa_revision WHERE id=${id}::uuid FOR SHARE`;
 const readiness=await getOrderLotReadiness(tx,orderId);
 if(readiness==='untracked')return;
 if(readiness!=='ready'||(!physicalShipment&&o.blocker!=='none')){
  if(!physicalShipment)throw Conflict('lots_not_ready','Confirm eligible physical lots before shipping');
  await releaseLotReservations(tx,orderId,'system',`exception-release:${orderId}:${randomUUID()}`);
  await tx.order.update({where:{id:orderId},data:{traceabilityStatus:'exception',traceabilityReason:'Shipment reported without complete eligible warehouse lot confirmation'}});
  for(const productId of new Set(o.items.map(i=>i.productId)))await enqueueCoaWriteback(tx,'product',productId);
  await writeAudit(tx,{actorType:'system',actorId:null,action:'lots.shipment_exception',targetType:'order',targetId:orderId,after:{shipmentKey}});return;
 }
 for(const r of rows){
  await tx.productLot.update({where:{id:r.lotId},data:{onHand:{decrement:r.qty},reserved:{decrement:r.qty}}});
  await tx.orderLotAllocation.update({where:{id:r.id},data:{state:'shipped'}});
  await tx.lotMovement.create({data:{lotId:r.lotId,kind:'ship',onHandDelta:-r.qty,reservedDelta:-r.qty,orderId,reason:'Confirmed shipment',operationKey:shipmentKey}});
 }
 await tx.order.update({where:{id:orderId},data:{traceabilityStatus:'ready'}});
 for(const productId of new Set(o.items.map(i=>i.productId)))await enqueueCoaWriteback(tx,'product',productId);
}

/** Audited late warehouse evidence, only for a shipment with no prior shipped
 * assignments. Never changes an existing shipped snapshot. */
export async function resolveShipmentLotException(tx:LotTx,orderId:string,allocations:AllocationInput[],actor:string,reason:string){
 if(!reason.trim())throw Conflict('evidence_required','Record the warehouse evidence for this correction');
 const o=await lockOrder(tx,orderId);
 if(!['shipped','delivered'].includes(o.status)||o.traceabilityStatus!=='exception'||await tx.orderLotAllocation.count({where:{orderId,state:'shipped'}}))throw Conflict('not_exception','Only unresolved shipments can accept late lot evidence');
 await lockProducts(tx,o.items.map(i=>i.productId));
 const totals=new Map<string,number>();for(const a of allocations){if(!Number.isInteger(a.qty)||a.qty<=0)throw Conflict('invalid_quantity','Positive whole units required');totals.set(a.orderItemId,(totals.get(a.orderItemId)??0)+a.qty);}
 for(const i of o.items.filter(i=>i.product.lotTracking))if(totals.get(i.id)!==i.qty)throw Conflict('incomplete_evidence','Account for every tracked unit');
 for(const a of allocations){const item=o.items.find(i=>i.id===a.orderItemId);const lot=await tx.productLot.findUnique({where:{id:a.lotId}});
 if(!item?.product.lotTracking||!lot||lot.productId!==item.productId||lot.onHand-lot.reserved<a.qty)throw Conflict('invalid_evidence','Lot/product or available balance does not match; reconcile physical stock first');
 await tx.productLot.update({where:{id:lot.id},data:{onHand:{decrement:a.qty}}});
 await tx.orderLotAllocation.create({data:{orderId,orderItemId:item.id,lotId:lot.id,coaRevisionId:lot.coaRevisionId,lotCode:lot.lotCode,sku:item.product.canonicalSku,wooLineId:item.wooLineId,qty:a.qty,state:'shipped',confirmedBy:actor,confirmedAt:new Date()}});
 await tx.lotMovement.create({data:{lotId:lot.id,kind:'ship',onHandDelta:-a.qty,reservedDelta:0,orderId,actorId:actor,reason:`Late warehouse evidence: ${reason}`,operationKey:`resolve:${orderId}`}});
 }
 await tx.order.update({where:{id:orderId},data:{traceabilityStatus:'ready',traceabilityReason:`Late confirmation: ${reason}`}});
 await enqueueCoaWriteback(tx,'shipment',orderId,`late-evidence:${orderId}`);
 for(const productId of new Set(o.items.map(i=>i.productId)))await enqueueCoaWriteback(tx,'product',productId);
 await writeAudit(tx,{actorType:'admin',actorId:actor,action:'lots.exception_resolved',targetType:'order',targetId:orderId,reason,after:{allocations}});
}
