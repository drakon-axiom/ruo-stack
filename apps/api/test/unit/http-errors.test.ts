import { afterEach, describe, expect, it } from 'vitest';
import { buildApp } from '../../src/app.ts';
let app: Awaited<ReturnType<typeof buildApp>>;
afterEach(async () => { await app?.close(); });
describe('HTTP error mapping', () => {
  it('returns 415 for unsupported form content without entering authentication', async () => {
    app=await buildApp();
    const res=await app.inject({method:'POST',url:'/auth/admin/mfa/enroll',headers:{'content-type':'application/x-www-form-urlencoded'},payload:'x=y'});
    expect(res.statusCode).toBe(415);
    expect(res.json()).toEqual({error:'unsupported_media_type',message:'Unsupported Media Type'});
  });
  it('returns 413 for a body above the configured limit', async () => {
    app=await buildApp();
    const res=await app.inject({method:'POST',url:'/auth/admin/login',headers:{'content-type':'application/json'},payload:JSON.stringify({x:'x'.repeat(1_048_576)})});
    expect(res.statusCode).toBe(413);
    expect(res.json().error).toBe('payload_too_large');
  });
  it('preserves rate-limit status and headers without exposing error internals',async()=>{
    app=await buildApp();
    app.get('/test-rate',async(_req,reply)=>{reply.header('retry-after','10');throw Object.assign(new Error('private diagnostic'),{statusCode:429});});
    const res=await app.inject('/test-rate');
    expect(res.statusCode).toBe(429); expect(res.headers['retry-after']).toBe('10');
    expect(res.json()).toEqual({error:'too_many_requests',message:'Too Many Requests'});
  });
  it('enforces the real plugin threshold per client and preserves Retry-After',async()=>{
    app=await buildApp();
    let calls=0;
    app.get('/test-real-limit',{config:{rateLimit:{max:2,timeWindow:'1 minute'}}},async()=>{calls++;return {ok:true};});
    for(let n=0;n<2;n++)expect((await app.inject({url:'/test-real-limit',remoteAddress:'192.0.2.1'})).statusCode).toBe(200);
    const blocked=await app.inject({url:'/test-real-limit',remoteAddress:'192.0.2.1'});
    expect(blocked.statusCode).toBe(429);
    expect(blocked.json()).toEqual({error:'too_many_requests',message:'Too Many Requests'});
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    expect(calls).toBe(2);
    expect((await app.inject({url:'/test-real-limit',remoteAddress:'192.0.2.2'})).statusCode).toBe(200);
  });
  it('sanitizes unknown errors and invalid status codes',async()=>{
    app=await buildApp();
    app.get('/test-error',async()=>{throw Object.assign(new Error('private diagnostic'),{statusCode:200});});
    const res=await app.inject('/test-error');
    expect(res.statusCode).toBe(500); expect(res.json()).toEqual({error:'internal_error'});
  });
});
