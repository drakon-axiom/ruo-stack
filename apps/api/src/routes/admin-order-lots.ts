import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getClients } from '../clients.ts';
import { requireAdmin } from '../middleware/guards.ts';
import { AllocationSchema, releaseLotReservations } from '../services/lot-inventory.ts';
import { amendShippedAllocation, confirmOrderLots, getOrderLotReadiness, resolveShipmentLotException } from '../services/order-lots.ts';
export async function adminOrderLotRoutes(app:FastifyInstance){
 const {prisma}=getClients();const params=z.object({id:z.string().uuid()});
 app.get('/api/admin/orders/:id/lots',{preHandler:requireAdmin('fulfillment','view')},async req=>{
 const {id}=params.parse(req.params);const order=await prisma.order.findUniqueOrThrow({where:{id},include:{items:{include:{product:true}}}});
 const lots=await prisma.productLot.findMany({where:{productId:{in:order.items.map(i=>i.productId)}},include:{coaRevision:{select:{status:true,reportNumber:true}}},orderBy:{lotCode:'asc'}});
 return {readiness:await getOrderLotReadiness(prisma,id),status:order.status,reason:order.traceabilityReason,items:order.items.filter(i=>i.product.lotTracking).map(i=>({id:i.id,productId:i.productId,sku:i.product.canonicalSku,qty:i.qty})),lots:lots.map(l=>({id:l.id,productId:l.productId,lotCode:l.lotCode,state:l.state,available:l.onHand-l.reserved,reportNumber:l.coaRevision.reportNumber,certificateStatus:l.coaRevision.status})),allocations:await prisma.orderLotAllocation.findMany({where:{orderId:id,state:{in:['reserved','shipped']}},include:{amendments:{orderBy:{createdAt:'desc'}}}})};
 });
 app.post('/api/admin/orders/:id/lots/amend',{preHandler:requireAdmin('fulfillment','write')},async req=>{const {id}=params.parse(req.params);const b=z.object({allocationId:z.string().uuid(),lotId:z.string().uuid(),reason:z.string().trim().min(1).max(1000),key:z.string().uuid()}).parse(req.body);await prisma.$transaction(tx=>amendShippedAllocation(tx,id,b.allocationId,b.lotId,b.reason,req.admin!.adminUserId,b.key));return {ok:true};});
 for(const action of ['confirm','release','resolve'] as const)app.post(`/api/admin/orders/:id/lots/${action}`,{preHandler:requireAdmin('fulfillment','write')},async req=>{
 const {id}=params.parse(req.params);const actor=req.admin!.adminUserId;
 if(action==='release'){const {key}=z.object({key:z.string().uuid()}).parse(req.body);await prisma.$transaction(tx=>releaseLotReservations(tx,id,actor,key));}
 else {const b=z.object({key:z.string().uuid(),allocations:z.array(AllocationSchema).min(1).max(200),reason:z.string().trim().min(1).max(1000).optional()}).parse(req.body);await prisma.$transaction(tx=>action==='confirm'?confirmOrderLots(tx,id,b.allocations,actor,b.key):resolveShipmentLotException(tx,id,b.allocations,actor,b.reason??''));}
 return {ok:true};
 });
}
