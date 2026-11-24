import Fastify from 'fastify';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getPrisma } from '@ruostack/db';
import { brandCustomerRoutes } from '../../src/routes/brand-customers.ts';
import { setClientsForTest, resetClientsForTest } from '../../src/clients.ts';
import { customerKey, foldCustomers } from '../../src/services/customers.ts';
const scope=vi.hoisted(()=>({brandId:''}));
vi.mock('../../src/middleware/guards.ts',()=>({requireBrand:async(req:any)=>{req.brand={brandId:scope.brandId};}}));
const db=getPrisma();
describe.skipIf(process.env.RUN_DB_TESTS!=='1')('lifetime customer database rollups',()=>{
 let app:ReturnType<typeof Fastify>; let other:string;
 beforeEach(async()=>{
  scope.brandId=(await db.brand.create({data:{brandName:'Rollup',referralCode:randomUUID()}})).id;
  other=(await db.brand.create({data:{brandName:'Other',referralCode:randomUUID()}})).id;
  setClientsForTest({prisma:db}); app=Fastify(); await app.register(brandCustomerRoutes);
 });
 afterEach(async()=>{await app.close();resetClientsForTest();await db.brand.deleteMany({where:{id:{in:[scope.brandId,other]}}});});
 afterAll(async()=>{await db.$disconnect();});
 const order=(over:Record<string,unknown>={})=>({brandId:scope.brandId,recipientName:'Dana',recipientEmail:'dana@test',recipientPhone:null,address1:'1 Main',address2:null,city:'Austin',state:'TX',zip:'78701',country:'US',wholesaleTotalCents:100,shippingTotalCents:25,walletChargeCents:125,createdAt:new Date('2026-01-01'),...over});
 const search=(payload:unknown={})=>app.inject({method:'POST',url:'/api/brand/customers/search',payload});
 const history=(payload:unknown)=>app.inject({method:'POST',url:'/api/brand/customers/history/page',payload});
 it('includes customers and totals older than the former 5000-order cap',async()=>{
  await db.order.createMany({data:Array.from({length:5100},(_,i)=>order({createdAt:new Date(Date.UTC(2026,0,2)+i*1000)})) as any});
  await db.order.create({data:order({recipientEmail:'old@test',recipientName:'Old customer',createdAt:new Date('2020-01-01')}) as any});
  const res=await search();expect(res.statusCode).toBe(200);
  expect(res.json().totals).toEqual({customers:2,orders:5101,spend_cents:637625,truncated:false});
  expect(res.json().customers.map((c:any)=>c.key)).toContain('old@test');
  const old=(await history({customer_key:'old@test'})).json();expect(old.customers[0].orders).toBe(1);expect(old.customers[0].order_list).toHaveLength(1);expect(old.page.has_more).toBe(false);
  const whale=(await history({customer_key:'dana@test',limit:100})).json();expect(whale.customers[0].orders).toBe(5100);expect(whale.customers[0].order_list).toHaveLength(100);expect(whale.page.has_more).toBe(true);
  const finalPage=(await history({customer_key:'dana@test',limit:100,cursor:{created_at:'2026-01-02T00:00:01.000Z',id:'00000000-0000-4000-8000-000000000000'}})).json();
  expect(finalPage.customers[0].order_list).toHaveLength(1);expect(finalPage.page.next_cursor).toBeNull();
 });
 it('matches JS grouping and summary fallback including Unicode and blank email',async()=>{
  for(const [i,name] of ['\t İΟΣ\u00a0','\ufeff İΟΣ\u2029','Other','Other'].entries())
   await db.order.create({data:order({recipientName:name,recipientEmail:i<2?'\u2003 İΟΣ@TEST\ufeff':null,recipientPhone:i===0?'555':null,address1:i===1?'\t ': '1 Main',createdAt:new Date(Date.UTC(2026,0,1+i))}) as any});
  const rows=await db.order.findMany({where:{brandId:scope.brandId},orderBy:[{createdAt:'desc'},{id:'desc'}]});
  const expected=JSON.parse(JSON.stringify(foldCustomers(rows,{includeHistory:false})));
  const res=await search(); expect(res.statusCode).toBe(200);expect(res.json().customers).toEqual(expected);
 });
 it('scopes summary and history to the brand and excludes cancelled orders',async()=>{
  await db.order.createMany({data:[order(),order({brandId:other,walletChargeCents:900}),order({status:'cancelled'})] as any});
  const res=await search();expect(res.statusCode).toBe(200);expect(res.json().totals.orders).toBe(1);
  const detail=await history({customer_key:'dana@test',brand_id:other});expect(detail.statusCode).toBe(200);
  expect(detail.json().customers[0].orders).toBe(1);expect(detail.json().customers[0].order_list).toHaveLength(1);
 });
 it('searches and sorts before paging and keeps lifetime totals on empty pages',async()=>{
  await db.order.createMany({data:[order({recipientName:'Alpha'}),order({recipientName:'Beta',recipientEmail:'beta@test',walletChargeCents:500}),order({recipientName:'Gamma',recipientEmail:'gamma@test'})] as any});
  const res=await search({sort:'spend',limit:1,offset:1});expect(res.statusCode).toBe(200);
  expect(res.json().page).toEqual({offset:1,limit:1,total:3,has_more:true});expect(res.json().totals.orders).toBe(3);
  const filtered=await search({search:'BETA'});expect(filtered.json().page.total).toBe(1);expect(filtered.json().customers[0].name).toBe('Beta');
  const empty=await search({search:'not present'});expect(empty.json().customers).toEqual([]);expect(empty.json().totals.orders).toBe(3);
 });
 it('pages history without duplicate same-date rows and preserves lifetime details',async()=>{
  await db.order.createMany({data:Array.from({length:5},()=>order()) as any});
  const first=await history({customer_key:'dana@test',limit:2});expect(first.statusCode).toBe(200);
  const a=first.json();expect(a.customers[0].orders).toBe(5);expect(a.page.has_more).toBe(true);
  const second=(await history({customer_key:'dana@test',limit:2,cursor:a.page.next_cursor})).json();
  const third=(await history({customer_key:'dana@test',limit:2,cursor:second.page.next_cursor})).json();
  const ids=[...a.customers[0].order_list,...second.customers[0].order_list,...third.customers[0].order_list].map((o:any)=>o.id);
  expect(new Set(ids).size).toBe(5);expect(third.page.has_more).toBe(false);
 });
 it('handles empty brands and keys longer than a B-tree text entry',async()=>{
  expect((await search()).json().totals).toEqual({customers:0,orders:0,spend_cents:0,truncated:false});
  const key='x'.repeat(8000)+'@test';await db.order.create({data:order({recipientEmail:key}) as any});
  const res=await history({customer_key:key});expect(res.statusCode).toBe(200);expect(res.json().customers[0].key).toBe(key);
  expect((await history({customer_key:'missing'})).json().customers).toEqual([]);
 });
 it('SQL normalization agrees with JavaScript trim and root lowercase',async()=>{
  const samples=[' İΟΣ ','\ufeff\tA\u2003','\u0085A\u0085','ẞ','İ','ΟΣ','\u2028\u2029','name:TEST|1'];
  for(const email of samples){
   const [row]=await db.$queryRaw<Array<{key:string}>>`SELECT public.ruostack_customer_key(' Name ',${email},'123') AS key`;
   expect(row!.key).toBe(customerKey({recipientName:' Name ',recipientEmail:email,zip:'123'}));
  }
 });
 it('uses deterministic customer paging for tied dates and treats search as literal text',async()=>{
  await db.order.createMany({data:[order(),order({recipientEmail:'other@test'}),order({recipientEmail:'wild@test',recipientName:"100% O'Reilly"})] as any});
  const first=(await search({limit:1})).json();
  const second=(await search({limit:1,offset:1})).json();
  expect(first.customers[0].key).not.toBe(second.customers[0].key);
  expect((await search({search:'%'})).json().page.total).toBe(1);
  expect((await search({search:"' OR true --"})).json().page.total).toBe(0);
 });
 it('continues history correctly if a newer order arrives between pages',async()=>{
  await db.order.createMany({data:Array.from({length:3},()=>order()) as any});
  const first=(await history({customer_key:'dana@test',limit:2})).json();
  await db.order.create({data:order({createdAt:new Date('2026-09-01'),address1:'New address'}) as any});
  const next=(await history({customer_key:'dana@test',limit:2,cursor:first.page.next_cursor})).json();
  expect(next.customers[0].orders).toBe(4);expect(next.customers[0].ship_to.address1).toBe('New address');
  expect(next.customers[0].order_list).toHaveLength(1);
  expect(first.customers[0].order_list.map((o:any)=>o.id)).not.toContain(next.customers[0].order_list[0].id);
 });

 it('does not split newer Unicode case pairs and can search their uppercase orders',async()=>{
  await db.order.createMany({data:[order({recipientEmail:'Ɤ@test',recipientName:'Ɤ'}),order({recipientEmail:'ɤ@test',recipientName:'Ɤ'})] as any});
  const result=(await search({search:'ɤ'})).json();expect(result.customers).toHaveLength(1);expect(result.customers[0].orders).toBe(2);
 });
 it('matches JavaScript lowercase across all cased codepoints and sigma contexts',async()=>{
  const cased=/\p{Cased}/u; const ignored=/\p{Case_Ignorable}/u; const samples=[];
  for(let cp=1;cp<=0x10ffff;cp++){if(cp>=0xd800&&cp<=0xdfff)continue;const text=String.fromCodePoint(cp);if(cased.test(text))samples.push(text,text+'Σ','AΣ'+text);else if(ignored.test(text))samples.push(text+'Σ','AΣ'+text,'AΣ'+text+'B');}
  samples.push('ꟋΣ','ᲉΣ','AΣ\u0345','\u0345Σ','ΣꟋ','AΣꟋ','İΣ','ΟΣ','AΣ\u200d','AΣ\u200dB');
  const rows=await db.$queryRaw<Array<{value:string;normalized:string}>>`SELECT value, public.ruostack_customer_key('',value,'') AS normalized FROM unnest(${samples}::text[]) value`;
  expect(rows.map(r=>[r.value,r.normalized]).filter(([value,normalized])=>normalized!==value!.trim().toLowerCase())).toEqual([]);
 });

});
