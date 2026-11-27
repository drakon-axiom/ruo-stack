import {beforeEach,expect,it,vi} from 'vitest';
const f=vi.hoisted(()=>({stock:vi.fn(),lookup:vi.fn()}));
vi.mock('../../src/hooks/catalog-stock.ts',()=>({onCatalogStockChanged:f.stock}));
vi.mock('../../src/services/woo.ts',()=>({getProductIdBySku:f.lookup,decryptStoreCreds:(c:any)=>({storeUrl:c.storeUrl}),wooRequest:vi.fn()}));
import {performCoaWriteback} from '../../src/services/coa-writeback.ts';
process.env.PUBLIC_API_BASE_URL='https://backend.test';
beforeEach(()=>{vi.clearAllMocks();f.stock.mockResolvedValue(undefined);f.lookup.mockResolvedValue(1);});
it('withdraws stock even if metadata fails on one store and continues healthy stores',async()=>{
 const db={catalogProduct:{findUniqueOrThrow:async()=>({id:'p',canonicalSku:'SKU'})},brandStoreConnection:{findMany:async()=>[{id:'a',storeUrl:'https://down.test'},{id:'b',storeUrl:'https://healthy.test'}]},productAlias:{findMany:async()=>[]}};
 const request=vi.fn().mockImplementation(async(c)=>{if(c.storeUrl.includes('down'))throw new Error('down');return {};});
 await expect(performCoaWriteback(db as any,{kind:'product',targetId:'p'} as any,request)).rejects.toThrow();expect(f.stock).toHaveBeenCalled();expect(request.mock.calls.some(c=>c[0].storeUrl.includes('healthy'))).toBe(true);
});
it('restores a customer-visible tracking note once across retries',async()=>{
 const order={id:'o',source:'woocommerce',externalOrderId:'52',originStoreId:'c',originStoreUrl:'https://store.test',brandId:'b',trackingNumber:'TRACK',carrier:'USPS',lotAllocations:[]};const db={order:{findUniqueOrThrow:async()=>order},brandStoreConnection:{findFirst:async()=>({id:'c',storeUrl:'https://store.test'})}};
 const notes:any[]=[];const request=vi.fn().mockImplementation(async(_c,method,path,body)=>{if(method==='GET'&&path.includes('/notes'))return notes;if(method==='POST'){notes.push({note:body.note});}return {};});
 await performCoaWriteback(db as any,{kind:'shipment',targetId:'o'} as any,request);await performCoaWriteback(db as any,{kind:'shipment',targetId:'o'} as any,request);expect(notes).toHaveLength(1);expect(notes[0].note).toContain('TRACK');
});
