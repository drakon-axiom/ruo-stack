import {enqueueCoaWriteback} from './coa-outbox.ts';
import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient, CoaRevision } from '@ruostack/db';
import { canView, canWrite, CoaUploadSchema, COA_MAX_BYTES, type AdminRole, type CoaUploadInput } from '@ruostack/shared';
import { BadRequest, Conflict, Forbidden, NotFound } from '../errors.ts';
import { writeAudit } from '../audit.ts';
export interface CoaActor {id:string;role:AdminRole}
export interface CoaStorage {
 signUpload(key:string):Promise<string>;
 read(key:string):Promise<{bytes:Buffer;type:string}>;
 write(key:string,bytes:Buffer):Promise<void>;
 remove(key:string):Promise<void>;
 signDownload(key:string,seconds:number):Promise<string>;
}
function authorize(actor:CoaActor,access:'view'|'write'='write') {if(!(access==='write'?canWrite:canView)(actor.role,'catalog'))throw Forbidden();}
export function coaDto(r:CoaRevision){const {id,documentId,publicId,filename,sizeBytes,lab,reportNumber,status,sha256,withdrawalReason}=r;return {id,documentId,publicId,filename,sizeBytes,lab,reportNumber,status,sha256,withdrawalReason,testDate:r.testDate.toISOString().slice(0,10),createdAt:r.createdAt.toISOString()};}
export class CoaDocuments {
 readonly db:PrismaClient;readonly storage:CoaStorage;
 constructor(db:PrismaClient,storage:CoaStorage){this.db=db;this.storage=storage;}
 async createCoaUpload(actor:CoaActor,raw:CoaUploadInput){
  authorize(actor);const input=CoaUploadSchema.parse(raw);
  const row=await this.db.$transaction(async tx=>{
   const product=await tx.catalogProduct.findUnique({where:{id:input.productId}});if(!product)throw NotFound();
   const doc=input.documentId ? await tx.coaDocument.findUnique({where:{id:input.documentId}}) : await tx.coaDocument.create({data:{productId:input.productId}});
   if(!doc || doc.productId!==input.productId)throw Conflict('coa_product','Certificate belongs to a different product');
   const revision=await tx.coaRevision.create({data:{documentId:doc.id,uploadKey:`uploads/${randomUUID()}.pdf`,filename:input.filename,sizeBytes:input.sizeBytes,lab:input.lab,reportNumber:input.reportNumber,testDate:new Date(input.testDate),uploadedBy:actor.id}});
   await writeAudit(tx,{actorType:'admin',actorId:actor.id,action:'coa.upload_created',targetType:'coa_revision',targetId:revision.id});return revision;
  });
  return {revisionId:row.id,uploadUrl:await this.storage.signUpload(row.uploadKey)};
 }
 async finalizeCoaUpload(actor:CoaActor,id:string){
  authorize(actor);const row=await this.db.coaRevision.findUnique({where:{id}});if(!row)throw NotFound();
  if(row.objectKey)return coaDto(row);
  if(row.status!=='draft')throw Conflict('coa_state','Upload is no longer active');
  const {bytes,type}=await this.storage.read(row.uploadKey);
  if(type.split(';')[0]!=='application/pdf'||bytes.length!==row.sizeBytes||bytes.length>COA_MAX_BYTES||!/^%PDF-1\.[0-9]|^%PDF-2\.0/.test(bytes.subarray(0,8).toString())||!bytes.subarray(-1024).toString().includes('%%EOF'))throw BadRequest('invalid_pdf','Upload must match the PDF type, size and signature');
  const key=`final/${randomUUID()}.pdf`;const sha256=createHash('sha256').update(bytes).digest('hex');
  await this.storage.write(key,bytes);
  let committed=false;
  try{
   const result=await this.db.$transaction(async tx=>{
    const changed=await tx.coaRevision.updateMany({where:{id,status:'draft',objectKey:null},data:{objectKey:key,sha256,status:'awaiting_review'}});
    if(changed.count!==1)throw Conflict('coa_state','Upload already finalized or abandoned; reload');
    await writeAudit(tx,{actorType:'admin',actorId:actor.id,action:'coa.finalized',targetType:'coa_revision',targetId:id,after:{sha256}});
    return tx.coaRevision.findUniqueOrThrow({where:{id}});
   });committed=true;return coaDto(result);
  }finally{
   // Do not remove on an ambiguous commit failure: a successful commit may have
   // lost its response. Check the reference before deleting the candidate key.
   if(!committed && !await this.db.coaRevision.count({where:{objectKey:key}}))await this.storage.remove(key).catch(()=>{});
  }
 }
 async transition(actor:CoaActor,id:string,from:string[],status:string,reason?:string){
  authorize(actor);
  return this.db.$transaction(async tx=>{
   const changed=await tx.coaRevision.updateMany({where:{id,status:{in:from},objectKey:{not:null}},data:{status,...(status==='reviewed'||status==='rejected'?{reviewedBy:actor.id,reviewedAt:new Date()}:{}),...(status==='published'?{publishedAt:new Date()}:{}),...(status==='withdrawn'?{withdrawalReason:reason}: {})}});
   if(changed.count!==1)throw Conflict('coa_state','Certificate is not in the required state; reload');
   const revision=await tx.coaRevision.findUniqueOrThrow({where:{id},include:{document:true}});
   if(['published','withdrawn'].includes(status))await enqueueCoaWriteback(tx,'product',revision.document.productId);
   await writeAudit(tx,{actorType:'admin',actorId:actor.id,action:`coa.${status}`,targetType:'coa_revision',targetId:id,reason});
   return coaDto(await tx.coaRevision.findUniqueOrThrow({where:{id}}));
  });
 }
 reviewCoaRevision(actor:CoaActor,id:string,decision:'approved'|'rejected'){return this.transition(actor,id,['awaiting_review'],decision==='approved'?'reviewed':'rejected');}
 publishCoaRevision(actor:CoaActor,id:string){return this.transition(actor,id,['reviewed'],'published');}
 withdrawCoaRevision(actor:CoaActor,id:string,reason:string){if(!reason.trim())throw BadRequest('reason_required','Withdrawal requires a reason');return this.transition(actor,id,['published','reviewed'],'withdrawn',reason);}
 async download(actor:CoaActor,id:string){authorize(actor,'view');const row=await this.db.coaRevision.findUnique({where:{id}});if(!row?.objectKey)throw NotFound();return this.storage.signDownload(row.objectKey,300);}
 async cleanupAbandonedUploads(){
  const now=new Date();
  const rows=await this.db.coaRevision.findMany({where:{uploadCleanedAt:null,createdAt:{lt:new Date(Date.now()-86400000)},AND:[{OR:[{nextCleanupAt:null},{nextCleanupAt:{lte:now}}]},{OR:[{status:{in:['draft','abandoned']}},{objectKey:{not:null}}]}]},orderBy:[{createdAt:'asc'},{id:'asc'}],take:100});
  let cleaned=0,failed=0;
  for(const row of rows){
   if(row.status==='draft'){const changed=await this.db.coaRevision.updateMany({where:{id:row.id,status:'draft',objectKey:null},data:{status:'abandoned'}});if(!changed.count)continue;}
   try{await this.storage.remove(row.uploadKey);await this.db.coaRevision.update({where:{id:row.id},data:{uploadCleanedAt:new Date(),nextCleanupAt:null}});cleaned++;}
   catch{failed++;await this.db.coaRevision.update({where:{id:row.id},data:{cleanupAttempts:{increment:1},nextCleanupAt:new Date(Date.now()+Math.min(86400000,60000*2**Math.min(row.cleanupAttempts,10)))}});}
  }
  return {cleaned,failed};
 }
}
