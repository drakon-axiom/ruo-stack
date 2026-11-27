import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getClients } from '../clients.ts';
import { requireBrand } from '../middleware/guards.ts';
import { publicCoaUrl, readOrderCoas } from '../services/coa-views.ts';
export async function brandCoaRoutes(app:FastifyInstance){
 const {prisma}=getClients();
 app.get('/api/brand/coas',{preHandler:requireBrand},async req=>{
 const q=z.object({search:z.string().max(200).default(''),offset:z.coerce.number().int().min(0).default(0),limit:z.coerce.number().int().min(1).max(100).default(25),from:z.string().date().optional(),to:z.string().date().optional()}).parse(req.query);
 const where={status:'published',document:{product:{isPublished:true,archived:false}},...(q.from||q.to?{testDate:{...(q.from?{gte:new Date(q.from)}:{}),...(q.to?{lte:new Date(q.to)}:{})}}:{}),OR:[{reportNumber:{contains:q.search,mode:'insensitive' as const}},{lab:{contains:q.search,mode:'insensitive' as const}},{document:{product:{name:{contains:q.search,mode:'insensitive' as const}}}},{lots:{some:{lotCode:{contains:q.search,mode:'insensitive' as const}}}}]};
 const [rows,total]=await Promise.all([prisma.coaRevision.findMany({where,skip:q.offset,take:q.limit,orderBy:[{createdAt:'desc'},{id:'asc'}],include:{document:{include:{product:true}},lots:{where:{state:'released',OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},select:{lotCode:true}}}}),prisma.coaRevision.count({where})]);
 return {total,certificates:rows.map(r=>({id:r.id,product:r.document.product.name,lotCodes:r.lots.map(l=>l.lotCode),reportNumber:r.reportNumber,lab:r.lab,testDate:r.testDate.toISOString().slice(0,10),status:r.status,url:publicCoaUrl(r.publicId)}))};
 });
 app.get('/api/brand/orders/:id/coas',{preHandler:requireBrand},async req=>readOrderCoas(prisma,req.brand!.brandId,z.object({id:z.string().uuid()}).parse(req.params).id));
}
