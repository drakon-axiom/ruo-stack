import type {PrismaClient} from '@ruostack/db';
import {Conflict} from '../errors.ts';
import {lockOrder} from './lot-inventory.ts';
import {decryptStoreCreds,wooRequest} from './woo.ts';
import {writeAudit} from '../audit.ts';
import {enqueueCoaWriteback} from './coa-outbox.ts';
export async function reconcileStoreMapping(db:PrismaClient,orderId:string,input:{storeUrl:string;reason:string;mappings:{orderItemId:string;wooLineId:string}[]},actor:string,request:typeof wooRequest=wooRequest){
 const order=await db.order.findUniqueOrThrow({where:{id:orderId},include:{items:{include:{product:true}}}});if(order.source!=='woocommerce'||!order.externalOrderId||!/^\d+$/.test(order.externalOrderId))throw Conflict('not_store_order','Not a valid Woo order');
 const conn=await db.brandStoreConnection.findFirst({where:{brandId:order.brandId,platform:'woocommerce'}});if(!conn||conn.status==='disabled'||conn.storeUrl!==input.storeUrl)throw Conflict('store_changed','The confirmed store does not match the active brand connection');
 const remote=await request<{id:number;billing?:{email?:string};shipping?:{address_1?:string;postcode?:string};line_items:{id:number;sku:string;quantity:number}[]}>(decryptStoreCreds(conn),'GET',`/orders/${order.externalOrderId}`);
 const norm=(s:string|undefined|null)=>(s??'').trim().toLowerCase();
 const identity=order.recipientEmail?norm(order.recipientEmail)===norm(remote.billing?.email):!!order.address1&&norm(order.address1)===norm(remote.shipping?.address_1)&&norm(order.zip)===norm(remote.shipping?.postcode);
 if(String(remote.id)!==order.externalOrderId||!identity)throw Conflict('customer_mismatch','Remote order customer/address does not match; do not rebind this shipment');
 const aliases=await db.productAlias.findMany({where:{brandId:order.brandId}});const ids=new Set<string>();const totals=new Map<string,number>();
 for(const m of input.mappings){const item=order.items.find(i=>i.id===m.orderItemId);const line=remote.line_items.find(l=>String(l.id)===m.wooLineId);if(!item||!line||ids.has(item.id)||!/^\d+$/.test(m.wooLineId)||!(line.sku===item.product.canonicalSku||aliases.some(a=>a.productId===item.productId&&a.wooSku===line.sku)))throw Conflict('mapping_mismatch','Woo line identity/SKU does not match');ids.add(item.id);totals.set(m.wooLineId,(totals.get(m.wooLineId)??0)+item.qty);}
 if(ids.size!==order.items.length||[...totals].some(([id,qty])=>remote.line_items.find(l=>String(l.id)===id)?.quantity!==qty))throw Conflict('quantity_mismatch','Map every local item to the matching remote quantity');
 await db.$transaction(async tx=>{const current=await lockOrder(tx,orderId);const live=await tx.brandStoreConnection.findUnique({where:{id:conn.id}});if(!live||live.storeUrl!==conn.storeUrl||current.items.length!==order.items.length||current.items.some(i=>!order.items.some(old=>old.id===i.id&&old.qty===i.qty&&old.productId===i.productId)))throw Conflict('mapping_stale','Order or store changed during verification; reload');
 for(const m of input.mappings)await tx.orderItem.update({where:{id:m.orderItemId},data:{wooLineId:m.wooLineId}});await tx.order.update({where:{id:orderId},data:{originStoreId:conn.id,originStoreUrl:conn.storeUrl}});
 await writeAudit(tx,{actorType:'admin',actorId:actor,action:'store.order_mapping_reconciled',targetType:'order',targetId:orderId,before:{storeId:order.originStoreId,storeUrl:order.originStoreUrl},after:{storeId:conn.id,storeUrl:conn.storeUrl,mappings:input.mappings},reason:input.reason});await tx.coaWritebackJob.updateMany({where:{kind:'shipment',targetId:orderId,status:{not:'complete'}},data:{status:'pending',attempts:0,nextAttemptAt:new Date()}});await enqueueCoaWriteback(tx,'shipment',orderId);
 });
}
