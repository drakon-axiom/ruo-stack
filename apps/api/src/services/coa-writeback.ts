import type { PrismaClient, CoaWritebackJob } from '@ruostack/db';
import { decryptStoreCreds, getProductIdBySku, wooRequest } from './woo.ts';
import { publicCoaUrl } from './coa-views.ts';
import { onCatalogStockChanged } from '../hooks/catalog-stock.ts';
import { guardWorkerPrisma, isWorkerBusy, withWorkerLock } from './worker-lock.ts';
export function wooCoaLines(rows:{wooLineId:string|null;lotCode:string;qty:number;url:string|null}[]){
 const groups=new Map<number,{lot_code:string;qty:number;certificate_url:string}[]>();
 for(const r of rows){if(!r.wooLineId||!/^\d+$/.test(r.wooLineId)||!Number.isSafeInteger(Number(r.wooLineId))||Number(r.wooLineId)<=0)throw new Error('Missing explicit Woo line ID; reconcile mapping before retry');if(!r.url)continue;const id=Number(r.wooLineId);groups.set(id,[...(groups.get(id)??[]),{lot_code:r.lotCode,qty:r.qty,certificate_url:r.url}]);}
 return [...groups].map(([id,value])=>({id,meta_data:[{key:'_ruostack_coa_allocations',value}]}));
}
export async function performCoaWriteback(db:PrismaClient,job:CoaWritebackJob,request:typeof wooRequest=wooRequest){
 if(job.kind==='shipment'){
  const order=await db.order.findUniqueOrThrow({where:{id:job.targetId},include:{lotAllocations:{where:{state:'shipped'},include:{coaRevision:true}}}});
  if(order.source!=='woocommerce'||!order.externalOrderId)return;
  if(!/^\d+$/.test(order.externalOrderId))throw new Error('Invalid external order ID');
  const conn=await db.brandStoreConnection.findFirst({where:{brandId:order.brandId,platform:'woocommerce'}});if(!conn)throw new Error('Store disconnected; reconnect before retry');
  const creds=decryptStoreCreds(conn);
  const line_items=wooCoaLines(order.lotAllocations.map(a=>({wooLineId:a.wooLineId,lotCode:a.lotCode,qty:a.qty,url:a.coaRevision.publishedAt?publicCoaUrl(a.coaRevision.publicId):null})));
  // Persist certificate metadata before transitioning to completed, which may
  // trigger the store's customer email. Retrying PUT never appends duplicate notes.
  if(line_items.length)await request(creds,'PUT',`/orders/${order.externalOrderId}`,{line_items});
  if(order.trackingNumber)await request(creds,'PUT',`/orders/${order.externalOrderId}`,{status:'completed',meta_data:[{key:'_tracking_number',value:order.trackingNumber},{key:'_tracking_provider',value:order.carrier??'Carrier'}]});
  return;
 }
 const product=await db.catalogProduct.findUniqueOrThrow({where:{id:job.targetId}});
 const url=publicCoaUrl(`products/${product.id}`);if(!url)throw new Error('PUBLIC_API_BASE_URL is required for COA links');
 const conns=await db.brandStoreConnection.findMany({where:{platform:'woocommerce',status:{in:['active','error']}}});
 for(const conn of conns){const creds=decryptStoreCreds(conn);const aliases=await db.productAlias.findMany({where:{productId:product.id,brandId:conn.brandId}});for(const sku of new Set([product.canonicalSku,...aliases.map(a=>a.wooSku)])){const id=await getProductIdBySku(creds,sku);if(id!==null)await request(creds,'PUT',`/products/${id}`,{meta_data:[{key:'_ruostack_coa_url',value:url}]});}}
 await onCatalogStockChanged(product,true,db);
}
export async function drainCoaWritebacks(db:PrismaClient,perform=performCoaWriteback){
 const jobs=await db.coaWritebackJob.findMany({where:{status:'pending',nextAttemptAt:{lte:new Date()}},orderBy:{createdAt:'asc'},take:20});
 for(const job of jobs){try{await perform(db,job);await db.coaWritebackJob.update({where:{key:job.key},data:{status:'complete',completedAt:new Date(),lastError:null}});}catch{
 const attempts=job.attempts+1;await db.coaWritebackJob.update({where:{key:job.key},data:{attempts,status:attempts>=8?'failed':'pending',nextAttemptAt:new Date(Date.now()+Math.min(3600000,30000*2**attempts)),lastError:'Store writeback failed. Verify connection, public API URL and Woo line mappings, then retry.'}});
 }}return jobs.length;
}
export function startCoaWritebackWorker(db:PrismaClient,log:(m:string)=>void){let running=false;const tick=async()=>{if(running)return;running=true;try{await withWorkerLock('coa-writeback',async ownership=>drainCoaWritebacks(guardWorkerPrisma(db,ownership)));}catch(e){if(!isWorkerBusy(e))log('COA writeback worker failed; pending jobs retained');}finally{running=false;}};const timer=setInterval(()=>void tick(),30000);timer.unref();void tick();return ()=>clearInterval(timer);}
