import type { PrismaClient } from '@ruostack/db';
import { loadConfig } from '../config.ts';
import { NotFound } from '../errors.ts';
import { getOrderLotReadiness } from './order-lots.ts';
export function publicCoaUrl(id:string){const base=loadConfig().PUBLIC_API_BASE_URL;if(!base)return null;return `${base.replace(/\/$/,'')}/coa/${id}`;}
export async function readPublicCoa(db:PrismaClient,publicId:string){
 const r=await db.coaRevision.findUnique({where:{publicId},include:{document:{include:{product:true}}}});
 if(!r||(!['published','withdrawn'].includes(r.status))||!r.publishedAt)throw NotFound();
 return {publicId:r.publicId,product:r.document.product.name,reportNumber:r.reportNumber,lab:r.lab,testDate:r.testDate.toISOString().slice(0,10),status:r.status,withdrawalReason:r.status==='withdrawn'?r.withdrawalReason:null,sha256:r.sha256};
}
export async function readOrderCoas(db:PrismaClient,brandId:string,orderId:string){
 const order=await db.order.findFirst({where:{id:orderId,brandId}});if(!order)throw NotFound();
 const shipped=['shipped','delivered'].includes(order.status);
 const rows=shipped?await db.orderLotAllocation.findMany({where:{orderId,state:'shipped'},include:{coaRevision:true},orderBy:{createdAt:'asc'}}):[];
 return {readiness:await getOrderLotReadiness(db,orderId),reason:order.traceabilityReason,allocations:rows.map(r=>({id:r.id,sku:r.sku,qty:r.qty,lotCode:r.lotCode,revisionId:r.coaRevisionId,reportNumber:r.coaRevision.reportNumber,lab:r.coaRevision.lab,testDate:r.coaRevision.testDate.toISOString().slice(0,10),status:r.coaRevision.status,url:r.coaRevision.status==='published'?publicCoaUrl(r.coaRevision.publicId):null}))};
}
