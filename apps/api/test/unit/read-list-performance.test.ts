import Fastify, { type FastifyReply, type FastifyRequest } from 'fastify';
import { ZodError } from 'zod';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { brandCustomerRoutes } from '../../src/routes/brand-customers.ts';
import { adminFulfillmentRoutes } from '../../src/routes/admin-fulfillment.ts';
const f=vi.hoisted(()=>({orders:vi.fn()}));
vi.mock('../../src/clients.ts',()=>({getClients:()=>({prisma:{order:{findMany:f.orders}}})}));
vi.mock('../../src/middleware/guards.ts',()=>({requireBrand:async(req:any)=>{req.brand={brandId:'brand-a'};},requireAdmin:()=>async()=>{}}));
let app:ReturnType<typeof Fastify>;
const row=(email:string,id='order-1')=>({id,recipientName:'Dana',recipientEmail:email,recipientPhone:null,address1:'1 Main',address2:null,city:'Austin',state:'TX',zip:'78701',country:'US',walletChargeCents:1250,status:'shipped',blocker:'none',trackingNumber:'track',exportedAt:null,createdAt:new Date('2026-08-01')});
beforeEach(async()=>{vi.resetAllMocks();app=Fastify();app.setErrorHandler((err: unknown,_req: FastifyRequest,reply: FastifyReply)=>reply.code(err instanceof ZodError?400:500).send({error:"test"}));await app.register(brandCustomerRoutes);await app.register(adminFulfillmentRoutes);});
afterEach(async()=>{await app.close();});
describe('bounded read views',()=>{
  it('returns fulfillment line counts without loading full line items',async()=>{
    f.orders.mockResolvedValue([{...row('a@test'),brand:{brandName:'Brand'},_count:{items:3}}]);
    const res=await app.inject('/api/admin/orders');
    expect(res.statusCode).toBe(200); expect(res.json().orders[0].item_count).toBe(3);
    expect(f.orders.mock.calls[0]![0].include.items).toBeUndefined();
  });
  it('summary mode preserves rollups but omits per-order history',async()=>{
    f.orders.mockResolvedValue([row('a@test'),row('a@test','order-2')]);
    const res=await app.inject('/api/brand/customers?view=summary');
    expect(res.statusCode).toBe(200);
    expect(res.json().customers[0]).toMatchObject({orders:2,spend_cents:2500,order_list:[],ship_to:{address1:'1 Main'}});
    expect(f.orders.mock.calls[0]![0].where).toEqual({brandId:'brand-a',status:{not:'cancelled'}});
  });
  it('history returns only the selected normalized customer within the scoped scan',async()=>{
    f.orders.mockResolvedValue([row(' A@test '),row('b@test','order-2')]);
    const res=await app.inject('/api/brand/customers?view=history&customer_key=a%40test');
    expect(res.json().customers).toHaveLength(1);
    expect(res.json().customers[0].order_list.map((o:any)=>o.id)).toEqual(['order-1']);
    expect(f.orders.mock.calls[0]![0].where.brandId).toBe('brand-a');
  });
  it('requires a customer key for history requests',async()=>{
    const res=await app.inject('/api/brand/customers?view=history');
    expect(res.statusCode).toBe(400); expect(f.orders).not.toHaveBeenCalled();
  });
  it('keeps legacy history and reports the scan limit accurately',async()=>{
    f.orders.mockResolvedValue(Array.from({length:5001},(_,i)=>row('a@test',`o${i}`)));
    const res=await app.inject('/api/brand/customers');
    expect(res.json().totals).toMatchObject({orders:5000,truncated:true});
    expect(res.json().customers[0].order_list).toHaveLength(5000);
  });
});
