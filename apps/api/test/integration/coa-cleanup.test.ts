import {randomUUID} from 'node:crypto';
import {afterAll,describe,expect,it} from 'vitest';
import {getPrisma} from '@ruostack/db';
import {lotFixture} from '../helpers/lot-fixture.ts';
import {CoaDocuments,type CoaStorage} from '../../src/services/coa-documents.ts';
const db=getPrisma();
describe.skipIf(process.env.RUN_DB_TESTS!=='1')('retryable staging cleanup',()=>{
 afterAll(()=>db.$disconnect());
 it('drains more than one batch and retries deletion after abandonment',async()=>{
 const f=await lotFixture();const prefix=randomUUID();await db.coaRevision.createMany({data:Array.from({length:201},(_,i)=>({documentId:f.c.documentId,uploadKey:`${prefix}/${i}`,filename:'old.pdf',sizeBytes:50,lab:'Lab',reportNumber:'Old',testDate:new Date(),uploadedBy:randomUUID(),createdAt:new Date('2020-01-01')}))});
 const deleted=new Set<string>();let fail=true;const storage={remove:async(key:string)=>{if(fail){fail=false;throw new Error('offline');}deleted.add(key);}} as CoaStorage;
 const scoped=db.$extends({query:{coaRevision:{findMany:({args,query})=>query({...args,where:{AND:[args.where??{},{uploadKey:{startsWith:prefix}}]}})}}}) as unknown as typeof db;
 const service=new CoaDocuments(scoped,storage);await service.cleanupAbandonedUploads();await db.coaRevision.updateMany({where:{uploadKey:{startsWith:prefix}},data:{nextCleanupAt:null}});await service.cleanupAbandonedUploads();await service.cleanupAbandonedUploads();
 expect(await db.coaRevision.count({where:{uploadKey:{startsWith:prefix},uploadCleanedAt:{not:null}}})).toBe(201);expect([...deleted].filter(k=>k.startsWith(prefix))).toHaveLength(201);
 });
});
