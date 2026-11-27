import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getClients } from '../clients.ts';
import { requireAdmin } from '../middleware/guards.ts';
import { changeLotCertificate, ReceiveLotSchema, receiveLot, adjustLot, setLotState, lockProducts } from '../services/lot-inventory.ts';
import { Conflict } from '../errors.ts';
import { writeAudit } from '../audit.ts';
export async function adminLotRoutes(app:FastifyInstance){
 const {prisma}=getClients();const params=z.object({id:z.string().uuid()});
 app.get('/api/admin/catalog/:id/lots',{preHandler:requireAdmin('catalog','view')},async req=>{
 const {id}=params.parse(req.params);const [product,lots]=await Promise.all([prisma.catalogProduct.findUniqueOrThrow({where:{id}}),prisma.productLot.findMany({where:{productId:id},include:{movements:true},orderBy:{receivedAt:'desc'}})]);
 return {lotTracking:product.lotTracking,lots:lots.map(({movements,...lot})=>({...lot,available:lot.onHand-lot.reserved,received:movements.filter(m=>m.kind==='receipt').reduce((n,m)=>n+m.onHandDelta,0),shipped:-movements.filter(m=>m.kind==='ship').reduce((n,m)=>n+m.onHandDelta,0)}))};
 });
 app.post('/api/admin/lots/receive',{preHandler:requireAdmin('catalog','write')},async req=>{
 const {key,...input}=ReceiveLotSchema.extend({key:z.string().uuid()}).parse(req.body);return prisma.$transaction(tx=>receiveLot(tx,input,req.admin!.adminUserId,key));
 });
 app.post('/api/admin/lots/:id/adjust',{preHandler:requireAdmin('catalog','write')},async req=>{
 const {id}=params.parse(req.params);const b=z.object({delta:z.number().int(),reason:z.string().trim().min(1).max(1000),key:z.string().uuid()}).parse(req.body);
 await prisma.$transaction(tx=>adjustLot(tx,id,b.delta,b.reason,req.admin!.adminUserId,b.key));return {ok:true};
 });
 app.post('/api/admin/lots/:id/certificate',{preHandler:requireAdmin('catalog','write')},async req=>{const {id}=params.parse(req.params);const b=z.object({revisionId:z.string().uuid(),reason:z.string().trim().min(1).max(1000)}).parse(req.body);await prisma.$transaction(tx=>changeLotCertificate(tx,id,b.revisionId,b.reason,req.admin!.adminUserId));return {ok:true};});
 app.post('/api/admin/lots/:id/state',{preHandler:requireAdmin('catalog','write')},async req=>{
 const {id}=params.parse(req.params);const b=z.object({state:z.enum(['released','quarantined','recalled']),reason:z.string().trim().min(1).max(1000)}).parse(req.body);
 await prisma.$transaction(tx=>setLotState(tx,id,b.state,b.reason,req.admin!.adminUserId));return {ok:true};
 });
 app.post('/api/admin/catalog/:id/enable-lot-tracking',{preHandler:requireAdmin('catalog','write')},async req=>{
 const {id}=params.parse(req.params);const {reason}=z.object({reconciled:z.literal(true),reason:z.string().trim().min(1).max(1000)}).parse(req.body);
 await prisma.$transaction(async tx=>{
 await lockProducts(tx,[id]);if(!await tx.productLot.count({where:{productId:id}}))throw Conflict('opening_stock_required','Receive reconciled opening stock before enabling tracking');
 // Exported open orders may already be packed without lot records. Finish or
 // explicitly recall those from the warehouse before enabling this SKU.
 if(await tx.order.count({where:{items:{some:{productId:id}},status:{in:['ready_for_fulfillment','processing']},exportedAt:{not:null}}}))throw Conflict('exported_orders','Resolve exported open orders before enabling lot tracking');
 await tx.catalogProduct.update({where:{id},data:{lotTracking:true}});await writeAudit(tx,{actorType:'admin',actorId:req.admin!.adminUserId,action:'lot.tracking_enabled',targetType:'catalog_product',targetId:id,reason});
 });return {ok:true};
 });
}
