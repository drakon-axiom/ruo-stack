import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, clearTokens, getAccess, setTokens } from '../src/lib/api.ts';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type':'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve=r; }); return { promise, resolve }; }
beforeEach(async () => {
  let queue: Promise<unknown> = Promise.resolve();
  vi.stubGlobal('navigator', { locks: { request: (_name: string, run: () => Promise<unknown>) => {
    const result = queue.then(run); queue = result.catch(() => {}); return result;
  } } });
  localStorage.clear(); await setTokens('old-access','old-refresh');
});
afterEach(async () => { await clearTokens(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('admin refresh coordination', () => {
  it('shares one rotation for overlapping expired requests', async () => {
    const started=deferred<void>(); const reply=deferred<Response>(); let rotations=0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if (url.endsWith('/auth/admin/refresh')) { rotations++; started.resolve(); return reply.promise; }
      return (init?.headers as Record<string,string>).authorization === 'Bearer old-access' ? json({},401) : json({ok:true});
    }));
    const first=api('/first'); const second=api('/second'); await started.promise;
    reply.resolve(json({access_token:'new-access',refresh_token:'new-refresh'}));
    expect(await Promise.all([first,second])).toEqual([{ok:true},{ok:true}]); expect(rotations).toBe(1);
  });
  it('retries a late 401 with the already rotated access token', async () => {
    const late=deferred<Response>(); let rotations=0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if(url.endsWith('/auth/admin/refresh')) { rotations++; return json({access_token:'new-access',refresh_token:'new-refresh'}); }
      if((init?.headers as Record<string,string>).authorization === 'Bearer old-access') return url.endsWith('/late') ? late.promise : json({},401);
      return json({ok:true});
    }));
    const pending=api('/late'); await api('/fast'); late.resolve(json({},401));
    expect(await pending).toEqual({ok:true}); expect(rotations).toBe(1);
  });
  it('does not restore credentials when logout happens during refresh', async () => {
    const started=deferred<void>(); const reply=deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if(url.endsWith('/auth/admin/refresh')) { started.resolve(); return reply.promise; }
      return json({},401);
    }));
    const pending=api('/resource'); const rejected=expect(pending).rejects.toMatchObject({status:401});
    await started.promise; const clearing=clearTokens(); reply.resolve(json({access_token:'new-access',refresh_token:'new-refresh'}));
    await rejected; await clearing; expect(getAccess()).toBeNull(); expect(localStorage.getItem('ruostack_admin_refresh')).toBeNull();
  });
  it('releases the in-flight operation after a failed rotation', async () => {
    let rotations=0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if(url.endsWith('/auth/admin/refresh')) { rotations++; return rotations === 1 ? json({},401) : json({access_token:'new-access',refresh_token:'new-refresh'}); }
      return (init?.headers as Record<string,string>).authorization === 'Bearer old-access' ? json({},401) : json({ok:true});
    }));
    await expect(api('/first')).rejects.toMatchObject({status:401});
    expect(await api('/second')).toEqual({ok:true}); expect(rotations).toBe(2);
  });
  it('preserves a new login while an earlier refresh is outstanding', async () => {
    const started=deferred<void>(); const reply=deferred<Response>();
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if(url.endsWith('/auth/admin/refresh')) { started.resolve(); return reply.promise; }
      return json({},401);
    }));
    const pending=api('/resource'); const rejected=expect(pending).rejects.toMatchObject({status:401});
    await started.promise; const signingIn=setTokens('other-access','other-refresh');
    reply.resolve(json({access_token:'stale-access',refresh_token:'stale-refresh'}));
    await rejected; await signingIn;
    expect(getAccess()).toBe('other-access');
    expect(JSON.parse(localStorage.getItem('ruostack_admin_session')!).refresh).toBe('other-refresh');
  });
  it('releases a refresh flight after a network rejection', async () => {
    let rotations=0;
    vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
      if(url.endsWith('/auth/admin/refresh')) {
        if(++rotations === 1) throw new TypeError('network failed');
        return json({access_token:'new-access',refresh_token:'new-refresh'});
      }
      return (init?.headers as Record<string,string>).authorization === 'Bearer old-access' ? json({},401) : json({ok:true});
    }));
    await expect(api('/first')).rejects.toThrow('network failed');
    expect(await api('/second')).toEqual({ok:true});
    expect(rotations).toBe(2);
  });

  it('shares rotation across independent tab modules',async()=>{
    vi.resetModules(); const other=await import('../src/lib/api.ts');
    let rotations=0;
    vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>{
      if(url.endsWith('/auth/admin/refresh')) { rotations++; await Promise.resolve(); return json({access_token:'new-access',refresh_token:'new-refresh'}); }
      return (init?.headers as Record<string,string>).authorization==='Bearer old-access'?json({},401):json({ok:true});
    }));
    expect(await Promise.all([api('/first'),other.api('/second')])).toEqual([{ok:true},{ok:true}]);
    expect(rotations).toBe(1);
  });
  it('does not retry a late 401 under another tab’s new login',async()=>{
    vi.resetModules();const other=await import('../src/lib/api.ts');
    const late=deferred<Response>();const fetcher=vi.fn(()=>late.promise);vi.stubGlobal('fetch',fetcher);
    const pending=api('/old-action');const rejected=expect(pending).rejects.toMatchObject({status:401});
    await other.setTokens('other-access','other-refresh');late.resolve(json({},401));
    await rejected;expect(fetcher).toHaveBeenCalledTimes(1);expect(getAccess()).toBe('other-access');
  });
  it('requires sign-in rather than racing refresh without browser lock support',async()=>{
    vi.stubGlobal('navigator',{});
    const fetcher=vi.fn(async()=>json({},401));vi.stubGlobal('fetch',fetcher);
    await expect(api('/resource')).rejects.toMatchObject({status:401});
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('migrates legacy credentials into one shared storage record on rotation',async()=>{
    localStorage.clear();localStorage.setItem('ruostack_admin_access','old-access');localStorage.setItem('ruostack_admin_refresh','old-refresh');
    vi.stubGlobal('fetch',vi.fn(async(url:string,init?:RequestInit)=>url.endsWith('/auth/admin/refresh')?json({access_token:'new-access',refresh_token:'new-refresh'}):(init?.headers as Record<string,string>).authorization==='Bearer old-access'?json({},401):json({ok:true})));
    expect(await api('/resource')).toEqual({ok:true});
    expect(getAccess()).toBe('new-access');expect(localStorage.getItem('ruostack_admin_refresh')).toBeNull();
    expect(JSON.parse(localStorage.getItem('ruostack_admin_session')!)).toMatchObject({access:'new-access',refresh:'new-refresh'});
  });
  it('honors a queued logout from another tab after rotation',async()=>{
    vi.resetModules();const other=await import('../src/lib/api.ts');
    const started=deferred<void>(),reply=deferred<Response>();
    vi.stubGlobal('fetch',vi.fn(async(url:string)=>{if(url.endsWith('/auth/admin/refresh')){started.resolve();return reply.promise;}return json({},401);}));
    const pending=api('/resource');const rejected=expect(pending).rejects.toMatchObject({status:401});await started.promise;
    const clearing=other.clearTokens();reply.resolve(json({access_token:'new-access',refresh_token:'new-refresh'}));
    await clearing;await rejected;expect(getAccess()).toBeNull();
  });

  it('allows sign-in without secure-context-only browser APIs',async()=>{
    const getRandomValues=crypto.getRandomValues.bind(crypto);
    vi.stubGlobal('navigator',{});vi.stubGlobal('crypto',{getRandomValues});
    await setTokens('http-access','http-refresh');expect(getAccess()).toBe('http-access');
    await clearTokens();expect(getAccess()).toBeNull();
  });

  it('uses the same session snapshot for request identity and generation',async()=>{
    const original=localStorage.getItem('ruostack_admin_session')!;
    const replacement=JSON.stringify({access:'other-access',refresh:'other-refresh',generation:'other-login'});
    const getItem=Storage.prototype.getItem;let reads=0;
    vi.spyOn(Storage.prototype,'getItem').mockImplementation(function(this:Storage,key:string){
      return key==='ruostack_admin_session'?(++reads===1?original:replacement):getItem.call(this,key);
    });
    const fetcher=vi.fn(async(_url:string,init?:RequestInit)=>(init?.headers as Record<string,string>).authorization==='Bearer other-access'?json({wrongAccount:true}):json({},401));vi.stubGlobal('fetch',fetcher);
    await expect(api('/old-action',{method:'POST',body:{}})).rejects.toMatchObject({status:401});
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![1]?.headers).toMatchObject({authorization:'Bearer old-access'});
  });

});
