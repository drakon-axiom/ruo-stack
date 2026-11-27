import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { CoaUploadSchema } from '@ruostack/shared';
import { getClients } from '../clients.ts';
import { requireAdmin } from '../middleware/guards.ts';
import { CoaDocuments, coaDto } from '../services/coa-documents.ts';
import { coaStorage } from '../services/coa-storage.ts';
export async function adminCoaRoutes(app:FastifyInstance){
 const {prisma}=getClients();const service=new CoaDocuments(prisma,coaStorage());
 const params=z.object({id:z.string().uuid()});
 app.get('/api/admin/catalog/:id/coas',{preHandler:requireAdmin('catalog','view')},async req=>{
  const {id}=params.parse(req.params);const rows=await prisma.coaRevision.findMany({where:{document:{productId:id}},orderBy:{createdAt:'desc'},take:100});return {revisions:rows.map(coaDto)};
 });
 app.post('/api/admin/coas/upload',{preHandler:requireAdmin('catalog','write')},async req=>service.createCoaUpload({id:req.admin!.adminUserId,role:req.admin!.role},CoaUploadSchema.parse(req.body)));
 for(const action of ['finalize','review','publish','withdraw','download'] as const){
  app.post(`/api/admin/coas/:id/${action}`,{preHandler:requireAdmin('catalog',action==='download'?'view':'write')},async req=>{
   const {id}=params.parse(req.params);const actor={id:req.admin!.adminUserId,role:req.admin!.role};
   if(action==='finalize')return service.finalizeCoaUpload(actor,id);
   if(action==='review')return service.reviewCoaRevision(actor,id,z.object({decision:z.enum(['approved','rejected'])}).parse(req.body).decision);
   if(action==='publish')return service.publishCoaRevision(actor,id);
   if(action==='withdraw')return service.withdrawCoaRevision(actor,id,z.object({reason:z.string().trim().min(1).max(1000)}).parse(req.body).reason);
   return {url:await service.download(actor,id)};
  });
 }
}
