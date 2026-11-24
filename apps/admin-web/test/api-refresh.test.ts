import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { api, clearTokens, getAccess, setTokens } from '../src/lib/api.ts';
const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'content-type':'application/json' } });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve=r; }); return { promise, resolve }; }
beforeEach(() => { localStorage.clear(); setTokens('old-access','old-refresh'); });
afterEach(() => { vi.unstubAllGlobals(); clearTokens(); });

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
    await started.promise; clearTokens(); reply.resolve(json({access_token:'new-access',refresh_token:'new-refresh'}));
    await rejected; expect(getAccess()).toBeNull(); expect(localStorage.getItem('ruostack_admin_refresh')).toBeNull();
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
});
