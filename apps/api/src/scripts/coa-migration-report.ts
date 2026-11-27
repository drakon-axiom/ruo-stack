import { getClients } from '../clients.ts';
import { classifyLegacyCoa } from '@ruostack/shared';
// Read-only: never fetches legacy URLs or infers opening stock/history.
const {prisma}=getClients();
try{
 const products=await prisma.catalogProduct.findMany({select:{id:true,canonicalSku:true,coaId:true,lotTracking:true,coaDocuments:{select:{revisions:{select:{status:true}}}},lots:{select:{onHand:true,reserved:true,state:true}}},orderBy:{canonicalSku:'asc'}});
 const rows=products.map(p=>({productId:p.id,sku:p.canonicalSku,legacyKind:classifyLegacyCoa(p.coaId).kind,reviewedDocuments:p.coaDocuments.flatMap(d=>d.revisions).filter(r=>['reviewed','published'].includes(r.status)).length,lots:p.lots.length,onHand:p.lots.reduce((s,l)=>s+l.onHand,0),reserved:p.lots.reduce((s,l)=>s+l.reserved,0),tracking:p.lotTracking,needsOpeningReconciliation:!p.lots.length}));
 console.log(JSON.stringify({generatedAt:new Date().toISOString(),products:rows,counts:{products:rows.length,trackingEnabled:rows.filter(r=>r.tracking).length,missingReviewedDocuments:rows.filter(r=>!r.reviewedDocuments).length,withoutOpeningLots:rows.filter(r=>r.needsOpeningReconciliation).length},untrackedShippedOrders:await prisma.order.count({where:{status:{in:['shipped','delivered']},lotAllocations:{none:{state:'shipped'}}}}),traceabilityExceptions:await prisma.order.count({where:{traceabilityStatus:'exception'}}),failedWritebacks:await prisma.coaWritebackJob.count({where:{status:'failed'}})},null,2));
}finally{await prisma.$disconnect();}
