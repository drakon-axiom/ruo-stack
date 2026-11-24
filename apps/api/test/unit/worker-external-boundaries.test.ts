import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShipStationRatesAdapter } from '../../src/services/rates/shipstation.ts';
import { ShipStationV2RatesAdapter } from '../../src/services/rates/shipstation-v2.ts';
import { sweepDunning } from '../../src/services/dunning.ts';
import type { PrismaClient } from '@ruostack/db';
import type { EmailAdapter } from '@ruostack/shared';
vi.mock('../../src/services/plan-registry.ts',()=>({getPlanRegistry:async()=>({pro:{name:'Pro'}})}));
afterEach(()=>vi.unstubAllGlobals());
const input={fromZip:'12345',toZip:'12345',toState:'CA',toCountry:'US',weightOz:8};
describe('worker external boundaries',()=>{
 for(const version of ['classic','v2'])it(`does not request ${version} rates after ownership is lost during carrier discovery`,async()=>{
  let owned=true;
  const fetchMock=vi.fn(async()=>{
   owned=false;
   return {ok:true,json:async()=>version==='classic'?[{code:'usps'}]:{carriers:[{carrier_id:'usps'}]}};
  });vi.stubGlobal('fetch',fetchMock);
  const checkpoint=async()=>{if(!owned)throw Error('ownership lost');};
  const adapter=version==='classic'?new ShipStationRatesAdapter({apiKey:'test',apiSecret:'test'}):new ShipStationV2RatesAdapter('test');
  await adapter.getRates(input,checkpoint).catch(()=>{});
  expect(fetchMock).toHaveBeenCalledTimes(1);
 });
 it('checks ownership again before the Supabase owner lookup',async()=>{
  let owned=true;
  const db={subscriptionState:{findMany:async()=>[{brandId:'test',plan:'pro',dunningNotifiedAt:new Date(),pastDueSince:null}]},brandMember:{findFirst:async()=>{owned=false;return {userId:'test'};}}} as unknown as PrismaClient;
  const lookup=vi.fn(async()=>({data:{user:null}}));
  await sweepDunning(db,{send:vi.fn()} as unknown as EmailAdapter,{auth:{admin:{getUserById:lookup}}},7,async()=>{if(!owned)throw Error('ownership lost');});
  expect(lookup).not.toHaveBeenCalled();
 });
});
