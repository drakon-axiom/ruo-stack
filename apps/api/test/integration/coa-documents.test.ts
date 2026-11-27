import { afterAll, describe, expect, it } from 'vitest';
import { randomUUID, createHash } from 'node:crypto';
import { getPrisma } from '@ruostack/db';
import { CoaDocuments, type CoaStorage } from '../../src/services/coa-documents.ts';
const db=getPrisma();
let mime='application/pdf';
const objects=new Map<string,Buffer>();
const storage:CoaStorage={
 async signUpload(key){return `https://storage.test/${key}`;},
 async read(key){const b=objects.get(key);if(!b)throw new Error('missing');return {bytes:b,type:mime};},
 async write(key,bytes){if(objects.has(key))throw new Error('exists');objects.set(key,bytes);},
 async remove(key){objects.delete(key);},
 async signDownload(key,seconds){return `https://storage.test/${key}?expires=${seconds}`;},
};
const service=new CoaDocuments(db,storage);
const actor={id:randomUUID(),role:'operations' as const};
const pdf=Buffer.from('%PDF-1.7\n1 0 obj << /Type /Catalog >> endobj\n%%EOF\n');
async function product(){return db.catalogProduct.create({data:{canonicalSku:randomUUID(),compound:'Test',name:'COA test',wholesaleStarter:1,wholesalePro:1,wholesaleVolume:1,suggestedRetail:1}});}
async function upload(productId:string){return service.createCoaUpload(actor,{productId,filename:'report.pdf',sizeBytes:pdf.length,lab:'Lab',reportNumber:'R1',testDate:'2026-11-01'});}
describe.skipIf(process.env.RUN_DB_TESTS!=='1')('COA documents',()=>{
 afterAll(async()=>{await db.$disconnect();});
 it('checks permissions, size, and document product identity',async()=>{
  const p=await product();
  await expect(service.createCoaUpload({...actor,role:'support'},{productId:p.id,filename:'r.pdf',sizeBytes:pdf.length,lab:'Lab',reportNumber:'R',testDate:'2026-11-01'})).rejects.toMatchObject({statusCode:403});
  await expect(service.createCoaUpload(actor,{productId:p.id,filename:'r.pdf',sizeBytes:10485761,lab:'Lab',reportNumber:'R',testDate:'2026-11-01'})).rejects.toThrow();
  const u=await upload(p.id);const row=await db.coaRevision.findUniqueOrThrow({where:{id:u.revisionId}});
  const q=await product();
  await expect(service.createCoaUpload(actor,{productId:q.id,documentId:row.documentId,filename:'r.pdf',sizeBytes:pdf.length,lab:'Lab',reportNumber:'R',testDate:'2026-11-01'})).rejects.toMatchObject({statusCode:409});
 });
 it('validates actual bytes and finalizes to a server-only immutable key; retries are safe',async()=>{
  const u=await upload((await product()).id);const row=await db.coaRevision.findUniqueOrThrow({where:{id:u.revisionId}});
  await expect(service.finalizeCoaUpload(actor,row.id)).rejects.toThrow();
  objects.set(row.uploadKey,Buffer.alloc(pdf.length));
  await expect(service.finalizeCoaUpload(actor,row.id)).rejects.toMatchObject({statusCode:400});
  objects.set(row.uploadKey,pdf);
  mime='text/html';await expect(service.finalizeCoaUpload(actor,row.id)).rejects.toMatchObject({statusCode:400});mime='application/pdf';
  await service.finalizeCoaUpload(actor,row.id);
  const final=await db.coaRevision.findUniqueOrThrow({where:{id:row.id}});
  expect(final.sha256).toBe(createHash('sha256').update(pdf).digest('hex'));
  expect(final.objectKey).not.toBe(row.uploadKey);
  objects.set(row.uploadKey,Buffer.from('replayed upload'));
  await service.finalizeCoaUpload(actor,row.id);
  expect(objects.get(final.objectKey!)).toEqual(pdf);
  await expect(service.publishCoaRevision(actor,row.id)).rejects.toMatchObject({statusCode:409});
  await service.reviewCoaRevision(actor,row.id,'approved');
  await service.publishCoaRevision(actor,row.id);
  expect(await service.download(actor,row.id)).toContain('expires=300');
  await expect(db.coaRevision.update({where:{id:row.id},data:{objectKey:'tamper'}})).rejects.toThrow();
  await service.withdrawCoaRevision(actor,row.id,'Report recalled');
  expect((await db.coaRevision.findUniqueOrThrow({where:{id:row.id}})).status).toBe('withdrawn');
  await expect(service.publishCoaRevision(actor,row.id)).rejects.toMatchObject({statusCode:409});
 });
 it('does not clean up immutable objects or active uploads',async()=>{
  const u=await upload((await product()).id);const row=await db.coaRevision.findUniqueOrThrow({where:{id:u.revisionId}});objects.set(row.uploadKey,pdf);
  await service.cleanupAbandonedUploads();expect(objects.has(row.uploadKey)).toBe(true);
  await db.coaRevision.update({where:{id:row.id},data:{createdAt:new Date(Date.now()-172800000)}});
  await service.cleanupAbandonedUploads();expect(objects.has(row.uploadKey)).toBe(false);
  await expect(service.finalizeCoaUpload(actor,row.id)).rejects.toMatchObject({statusCode:409});
 });
});
