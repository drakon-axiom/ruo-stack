import {randomUUID} from 'node:crypto';
import {afterAll,describe,expect,it,vi} from 'vitest';
import {getPrisma} from '@ruostack/db';
import {lotFixture} from '../helpers/lot-fixture.ts';
import {reconcileStoreMapping} from '../../src/services/store-mapping.ts';
import {encryptStoreCreds} from '../../src/services/woo.ts';
const db=getPrisma();
describe.skipIf(process.env.RUN_DB_TESTS!=='1')('store origin reconciliation',()=>{afterAll(()=>db.$disconnect());it('verifies remote customer identity and line quantities before rebinding a legacy order',async()=>{
 const f=await lotFixture();const o=await f.order(3);await db.order.update({where:{id:o.id},data:{source:'woocommerce',externalOrderId:'52',recipientEmail:'owner@test.local'}});const conn=await db.brandStoreConnection.create({data:{brandId:f.b.id,storeUrl:'https://store.test',...encryptStoreCreds('ck','cs'),webhookSecret:'test'}});
 const input={storeUrl:conn.storeUrl,reason:'Warehouse order reconciliation',mappings:[{orderItemId:o.items[0]!.id,wooLineId:'72'}]};const request=vi.fn().mockResolvedValue({id:52,billing:{email:'wrong@test.local'},line_items:[{id:72,sku:f.p.canonicalSku,quantity:3}]});await expect(reconcileStoreMapping(db,o.id,input,randomUUID(),request)).rejects.toMatchObject({statusCode:409});expect((await db.order.findUniqueOrThrow({where:{id:o.id}})).originStoreId).toBeNull();
 request.mockResolvedValue({id:52,billing:{email:'owner@test.local'},line_items:[{id:72,sku:f.p.canonicalSku,quantity:3}]});await reconcileStoreMapping(db,o.id,input,randomUUID(),request);expect((await db.order.findUniqueOrThrow({where:{id:o.id}})).originStoreId).toBe(conn.id);expect((await db.orderItem.findUniqueOrThrow({where:{id:o.items[0]!.id}})).wooLineId).toBe('72');
});});
