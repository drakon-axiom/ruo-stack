import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { getClients } from '../clients.ts';
import { NotFound, HttpError } from '../errors.ts';
import { readPublicCoa } from '../services/coa-views.ts';
import { coaStorage } from '../services/coa-storage.ts';
const escape=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const html=(body:string)=>`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Certificate of Analysis</title><main>${body}</main></html>`;
export async function publicCoaRoutes(app:FastifyInstance){
 const {prisma}=getClients();const params=z.object({publicId:z.string().uuid()});
 app.addHook('onSend',async(req,reply,payload)=>{if(req.url.startsWith('/coa/'))reply.header('cache-control','no-store').header('x-content-type-options','nosniff').header('content-security-policy',"default-src 'none'; frame-ancestors 'none'; base-uri 'none'");return payload;});
 app.get('/coa/:publicId',async(req,reply)=>{
 const {publicId}=params.parse(req.params);const doc=await readPublicCoa(prisma,publicId);
 if(req.headers.accept?.includes('application/json'))return doc;
 return reply.type('text/html').send(html(`<h1>${escape(doc.product)}</h1><p>Report ${escape(doc.reportNumber)} · ${escape(doc.lab)} · ${doc.testDate}</p><p>Status: ${doc.status}</p>${doc.status==='withdrawn'?'<p>This report has been withdrawn. Contact the supplier.</p>':`<a href="/coa/${publicId}/download">Download PDF</a>`}<p>This is a product certificate reference. An order’s actual lot assignment is shown in its order details.</p>`));
 });
 app.get('/coa/:publicId/download',async(req,reply)=>{
 const {publicId}=params.parse(req.params);const doc=await readPublicCoa(prisma,publicId);if(doc.status!=='published')throw new HttpError(410,'withdrawn','Certificate withdrawn');
 const row=await prisma.coaRevision.findUniqueOrThrow({where:{publicId}});if(!row.objectKey)throw NotFound();return reply.redirect(await coaStorage().signDownload(row.objectKey,300));
 });
 app.get('/coa/products/:publicId',async(req,reply)=>{
 const {publicId}=params.parse(req.params);const p=await prisma.catalogProduct.findFirst({where:{id:publicId,isPublished:true,archived:false}});if(!p)throw NotFound();
 const docs=await prisma.coaRevision.findMany({where:{document:{productId:p.id},status:'published'},orderBy:{createdAt:'desc'},take:100,include:{lots:{where:{state:'released',OR:[{expiresAt:null},{expiresAt:{gt:new Date()}}]},select:{lotCode:true}}}});
 return reply.type('text/html').send(html(`<h1>${escape(p.name)} — certificate references</h1><p>These reports are references. The lots shipped with an order appear on that order.</p><ul>${docs.map(d=>`<li><a href="/coa/${d.publicId}">${escape(d.reportNumber)}</a> · ${d.testDate.toISOString().slice(0,10)}${d.lots.length?` · Lots ${d.lots.map(l=>escape(l.lotCode)).join(', ')}`:''}</li>`).join('')}</ul>`));
 });
}
