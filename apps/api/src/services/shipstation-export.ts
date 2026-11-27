import type {PrismaClient} from '@ruostack/db';
import {lockOrder,lockProducts} from './lot-inventory.ts';
import {getOrderLotReadiness} from './order-lots.ts';
import {writeAudit} from '../audit.ts';
/** Readiness, items and export stamp share order/product/revision locks. */
export async function prepareShipstationExport(db:PrismaClient,id:string){return db.$transaction(async tx=>{
 const initial=await lockOrder(tx,id);await lockProducts(tx,initial.items.map(i=>i.productId));
 const refs=await tx.orderLotAllocation.findMany({where:{orderId:id,state:'reserved'},select:{coaRevisionId:true}});for(const rid of [...new Set(refs.map(r=>r.coaRevisionId))].sort())await tx.$queryRaw`SELECT id FROM coa_revision WHERE id=${rid}::uuid FOR SHARE`;
 const order=await tx.order.findUniqueOrThrow({where:{id},include:{brand:{select:{brandName:true}},items:{include:{product:true}}}});
 const terminal=['shipped','delivered','cancelled'].includes(order.status);
 if(!terminal){if(['needs_address','needs_customer_info','needs_mapping'].includes(order.blocker))return null;const readiness=await getOrderLotReadiness(tx,id);if(!['untracked','ready'].includes(readiness))return null;}
 if(!terminal&&order.blocker==='none'&&!order.exportedAt){await tx.order.update({where:{id},data:{exportedAt:new Date()}});await writeAudit(tx,{actorType:'system',actorId:null,action:'order.exported',targetType:'order',targetId:id});}
 return order;
});}
