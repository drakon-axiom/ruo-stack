import {CoaDocuments} from './coa-documents.ts';
import {coaStorage} from './coa-storage.ts';
import {enqueueCoaWriteback} from './coa-outbox.ts';
import type { PrismaClient, CoaWritebackJob } from '@ruostack/db';
import { decryptStoreCreds, getProductIdBySku, wooRequest } from './woo.ts';
import { publicCoaUrl } from './coa-views.ts';
import { onCatalogStockChanged } from '../hooks/catalog-stock.ts';
import { guardWorkerPrisma, isWorkerBusy, withWorkerLock } from './worker-lock.ts';
export function wooCoaLines(rows:{wooLineId:string|null;lotCode:string;qty:number;url:string|null}[]){
 const groups=new Map<number,{lot_code:string;qty:number;certificate_url:string}[]>();
 for(const r of rows){if(!r.wooLineId||!/^\d+$/.test(r.wooLineId)||!Number.isSafeInteger(Number(r.wooLineId))||Number(r.wooLineId)<=0)throw new Error('Missing explicit Woo line ID; reconcile mapping before retry');const id=Number(r.wooLineId);if(!groups.has(id))groups.set(id,[]);if(r.url)groups.get(id)!.push({lot_code:r.lotCode,qty:r.qty,certificate_url:r.url});}
 return [...groups].map(([id,value])=>({id,meta_data:[{key:'_ruostack_coa_allocations',value}]}));
}
export async function performCoaWriteback(db:PrismaClient,job:CoaWritebackJob,request:typeof wooRequest=wooRequest){
 if(job.kind==='shipment'){
  const order=await db.order.findUniqueOrThrow({where:{id:job.targetId},include:{items:true,lotAllocations:{where:{state:'shipped'},include:{coaRevision:true,amendments:{orderBy:[{createdAt:'desc'},{id:'desc'}],take:1,include:{coaRevision:true}}}}}});
  if(order.source!=='woocommerce'||!order.externalOrderId)return;
  if(!/^\d+$/.test(order.externalOrderId))throw new Error('Invalid external order ID');
  const conn=await db.brandStoreConnection.findFirst({where:{brandId:order.brandId,platform:'woocommerce'}});if(!conn||!order.originStoreId||!order.originStoreUrl||conn.id!==order.originStoreId||conn.storeUrl!==order.originStoreUrl)throw new Error('Origin store identity is missing or changed; reconcile before retry');
  const creds=decryptStoreCreds(conn);
  const effective=order.lotAllocations.map(a=>a.amendments[0]?{...a,lotCode:a.amendments[0].lotCode,coaRevision:a.amendments[0].coaRevision}:a);
  if(effective.some(a=>a.coaRevision.publishedAt)&&!publicCoaUrl('test'))throw new Error('PUBLIC_API_BASE_URL is required before writing published certificates');
  let mappingError:unknown;let line_items:ReturnType<typeof wooCoaLines>=[];
  try{line_items=wooCoaLines(effective.map(a=>({wooLineId:order.items?.find(i=>i.id===a.orderItemId)?.wooLineId??a.wooLineId,lotCode:a.lotCode,qty:a.qty,url:a.coaRevision.publishedAt?publicCoaUrl(a.coaRevision.publicId):null})));}catch(e){mappingError=e;}
  if(line_items.length)await request(creds,'PUT',`/orders/${order.externalOrderId}`,{line_items});
  if(order.trackingNumber){
   await request(creds,'PUT',`/orders/${order.externalOrderId}`,{status:'completed',meta_data:[{key:'_tracking_number',value:order.trackingNumber},{key:'_tracking_provider',value:order.carrier??'Carrier'}]});
   const marker=`RUOStack shipment ${order.id}`;
   const notes=await request<{note:string}[]>(creds,'GET',`/orders/${order.externalOrderId}/notes?per_page=100`);
   if(!notes.some(n=>n.note.includes(marker)))await request(creds,'POST',`/orders/${order.externalOrderId}/notes`,{note:`${marker}: Shipped via ${order.carrier??'Carrier'}. Tracking: ${order.trackingNumber}`,customer_note:true});
  }
  if(mappingError)throw mappingError;
  return;
 }
 const product=await db.catalogProduct.findUniqueOrThrow({where:{id:job.targetId}});
 const failures:unknown[]=[];
 // Stock withdrawal gets its own complete fan-out even if certificate metadata
 // fails. The stock hook itself isolates every store.
 try{await onCatalogStockChanged(product,true,db);}catch(e){failures.push(e);}
 const url=publicCoaUrl(`products/${product.id}`);if(!url)throw new Error('PUBLIC_API_BASE_URL is required for COA links');
 const conns=await db.brandStoreConnection.findMany({where:{platform:'woocommerce',status:{in:['active','error']}}});
 for(const conn of conns){try{const creds=decryptStoreCreds(conn);const aliases=await db.productAlias.findMany({where:{productId:product.id,brandId:conn.brandId}});for(const sku of new Set([product.canonicalSku,...aliases.map(a=>a.wooSku)])){const id=await getProductIdBySku(creds,sku);if(id!==null)await request(creds,'PUT',`/products/${id}`,{meta_data:[{key:'_ruostack_coa_url',value:url}]});}}catch(e){failures.push(e);}}
 if(failures.length)throw new Error('One or more stores need another writeback attempt');
}
export async function drainCoaWritebacks(db:PrismaClient,perform=performCoaWriteback){
 const jobs=await db.coaWritebackJob.findMany({where:{status:'pending',nextAttemptAt:{lte:new Date()}},orderBy:{createdAt:'asc'},take:20});
 for(const job of jobs){try{await perform(db,job);await db.coaWritebackJob.update({where:{key:job.key},data:{status:'complete',completedAt:new Date(),lastError:null}});}catch{
 const attempts=job.attempts+1;await db.coaWritebackJob.update({where:{key:job.key},data:{attempts,status:attempts>=8?'failed':'pending',nextAttemptAt:new Date(Date.now()+Math.min(3600000,30000*2**attempts)),lastError:'Store writeback failed. Verify connection, public API URL and Woo line mappings, then retry.'}});
 }}return jobs.length;
}
export function startCoaWritebackWorker(db:PrismaClient,log:(m:string)=>void){let running=false;const tick=async()=>{if(running)return;running=true;try{await withWorkerLock('coa-writeback',async ownership=>{const guarded=guardWorkerPrisma(db,ownership);await enqueueExpiredLotUpdates(guarded);const result=await drainCoaWritebacks(guarded);await new CoaDocuments(guarded,coaStorage()).cleanupAbandonedUploads();return result;});}catch(e){if(!isWorkerBusy(e))log('COA writeback worker failed; pending jobs retained');}finally{running=false;}};const timer=setInterval(()=>void tick(),30000);timer.unref();void tick();return ()=>clearInterval(timer);}

export async function enqueueExpiredLotUpdates(db:PrismaClient){
 const lots=await db.productLot.findMany({where:{state:'released',expiresAt:{lte:new Date()},product:{lotTracking:true}},select:{id:true,productId:true,expiresAt:true}});
 for(const l of lots)await enqueueCoaWriteback(db,'product',l.productId,`expiry:${l.id}:${l.expiresAt!.toISOString()}`);
}
