import {reconcileStoreMapping} from '../services/store-mapping.ts';
import {lotImpact,lotExceptions} from '../services/lot-impact.ts';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getClients } from '../clients.ts';
import { requireAdmin } from '../middleware/guards.ts';
import { AllocationSchema, releaseLotReservations } from '../services/lot-inventory.ts';
import { amendShippedAllocation, confirmOrderLots, getOrderLotReadiness, resolveShipmentLotException } from '../services/order-lots.ts';
export async function adminOrderLotRoutes(app:FastifyInstance){
 const {prisma}=getClients();const params=z.object({id:z.string().uuid()});
 const page=z.object({offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(25)});
 app.get('/api/admin/lots/:id/orders',{preHandler:requireAdmin('fulfillment','view')},async req=>{const {id}=params.parse(req.params);const q=page.parse(req.query);return lotImpact(prisma,id,q.offset,q.limit);});
 app.get('/api/admin/lot-exceptions',{preHandler:requireAdmin('fulfillment','view')},async req=>{const q=page.parse(req.query);return lotExceptions(prisma,q.offset,q.limit);});
 app.get('/api/admin/orders/:id/store-mapping',{preHandler:requireAdmin('fulfillment','view')},async req=>{const {id}=params.parse(req.params);const order=await prisma.order.findUniqueOrThrow({where:{id},include:{items:{include:{product:true}}}});const conn=await prisma.brandStoreConnection.findFirst({where:{brandId:order.brandId,platform:'woocommerce'},select:{storeUrl:true}});return {storeUrl:conn?.storeUrl??null,originStoreUrl:order.originStoreUrl,externalOrderId:order.externalOrderId,items:order.items.map(i=>({id:i.id,sku:i.product.canonicalSku,qty:i.qty,wooLineId:i.wooLineId}))};});
 app.post('/api/admin/orders/:id/store-mapping',{preHandler:requireAdmin('fulfillment','write')},async req=>{const {id}=params.parse(req.params);const b=z.object({confirmOrigin:z.literal(true),storeUrl:z.string().url(),reason:z.string().trim().min(1).max(1000),mappings:z.array(z.object({orderItemId:z.string().uuid(),wooLineId:z.string().regex(/^\d+$/)})).min(1).max(100)}).parse(req.body);await reconcileStoreMapping(prisma,id,b,req.admin!.adminUserId);return {ok:true};});
 app.get('/api/admin/orders/:id/lots',{preHandler:requireAdmin('fulfillment','view')},async req=>{
 const {id}=params.parse(req.params);const order=await prisma.order.findUniqueOrThrow({where:{id},include:{traceabilityItems:true,items:{include:{product:true}}}});
 const lots=await prisma.productLot.findMany({where:{productId:{in:order.items.map(i=>i.productId)}},include:{coaRevision:{select:{status:true,reportNumber:true}}},orderBy:{lotCode:'asc'}});
 const certificates=await prisma.coaRevision.findMany({where:{document:{productId:{in:order.items.map(i=>i.productId)}},status:{in:['reviewed','published','withdrawn']},objectKey:{not:null}},include:{document:{select:{productId:true}}},orderBy:{createdAt:'desc'},take:500});
 return {certificates:certificates.map(c=>({id:c.id,productId:c.document.productId,reportNumber:c.reportNumber,testDate:c.testDate.toISOString().slice(0,10),status:c.status})),readiness:await getOrderLotReadiness(prisma,id),status:order.status,reason:order.traceabilityReason,items:order.items.filter(i=>order.traceabilityStatus==='exception'?order.traceabilityItems.some(t=>t.orderItemId===i.id):i.product.lotTracking).map(i=>({id:i.id,productId:i.productId,sku:i.product.canonicalSku,qty:i.qty})),lots:lots.map(l=>({id:l.id,productId:l.productId,lotCode:l.lotCode,state:l.state,available:l.onHand-l.reserved,reportNumber:l.coaRevision.reportNumber,certificateStatus:l.coaRevision.status})),allocations:await prisma.orderLotAllocation.findMany({where:{orderId:id,state:{in:['reserved','shipped']}},include:{amendments:{orderBy:{createdAt:'desc'}}}})};
 });
 app.post('/api/admin/orders/:id/lots/amend',{preHandler:requireAdmin('fulfillment','write')},async req=>{const {id}=params.parse(req.params);const b=z.object({allocationId:z.string().uuid(),lotId:z.string().uuid(),coaRevisionId:z.string().uuid(),reason:z.string().trim().min(1).max(1000),key:z.string().uuid()}).parse(req.body);await prisma.$transaction(tx=>amendShippedAllocation(tx,id,b.allocationId,b.lotId,b.reason,req.admin!.adminUserId,b.key,b.coaRevisionId));return {ok:true};});
 for(const action of ['confirm','release','resolve'] as const)app.post(`/api/admin/orders/:id/lots/${action}`,{preHandler:requireAdmin('fulfillment','write')},async req=>{
 const {id}=params.parse(req.params);const actor=req.admin!.adminUserId;
 if(action==='release'){const {key}=z.object({key:z.string().uuid()}).parse(req.body);await prisma.$transaction(tx=>releaseLotReservations(tx,id,actor,key));}
 else {const b=z.object({key:z.string().uuid(),allocations:z.array(AllocationSchema).min(1).max(200),reason:z.string().trim().min(1).max(1000).optional()}).parse(req.body);await prisma.$transaction(tx=>action==='confirm'?confirmOrderLots(tx,id,b.allocations,actor,b.key):resolveShipmentLotException(tx,id,b.allocations,actor,b.reason??''));}
 return {ok:true};
 });
}
