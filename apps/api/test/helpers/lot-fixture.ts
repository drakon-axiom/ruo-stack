import { randomUUID } from 'node:crypto';
import { getPrisma } from '@ruostack/db';
import {receiveLot,setLotState} from '../../src/services/lot-inventory.ts';
const db=getPrisma();const actor='warehouse-test';
export async function lotFixture(){
 const p=await db.catalogProduct.create({data:{canonicalSku:randomUUID(),compound:'X',name:'Lot test',wholesaleStarter:1,wholesalePro:1,wholesaleVolume:1,suggestedRetail:1,isPublished:true,status:'in_stock',lotTracking:true}});
 const d=await db.coaDocument.create({data:{productId:p.id}});
 const c=await db.coaRevision.create({data:{documentId:d.id,uploadKey:randomUUID(),objectKey:randomUUID(),filename:'coa.pdf',sizeBytes:50,sha256:'test',lab:'Test',reportNumber:'Test',testDate:new Date(),uploadedBy:randomUUID(),status:'reviewed'}});
 const b=await db.brand.create({data:{brandName:'Lots',referralCode:randomUUID()}});
 async function order(qty:number){return db.order.create({data:{brandId:b.id,recipientName:'Test',address1:'1 Main',city:'Austin',state:'TX',zip:'78701',wholesaleTotalCents:0,shippingTotalCents:0,walletChargeCents:0,items:{create:{productId:p.id,qty,unitWholesaleCents:1}}},include:{items:true}});}
 const input={productId:p.id,lotCode:randomUUID(),coaRevisionId:c.id,qty:500};
 const lot=await db.$transaction(tx=>receiveLot(tx,input,actor,randomUUID()));await db.$transaction(tx=>setLotState(tx,lot.id,'released','Reviewed for release',actor));
 return {p,c,b,lot,input,order};
}
