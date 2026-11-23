import { createServer, type Server } from 'node:http';
import { createRequire } from 'node:module';
import type { LookupFunction } from 'node:net';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { wooRequest } from '../../src/services/woo.ts';
import { publicFetch, closePublicHttp } from '../../src/services/public-http.ts';

const dns = vi.hoisted(() => ({ lookup: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns.lookup }));
// Real HTTP fixture, but no external socket is ever opened. The connector double
// uses the lookup actually supplied by the production Agent, captures its result,
// then substitutes our fixture for the validated destination.
const net = createRequire(import.meta.url)('node:net') as typeof import('node:net');
let server: Server;
let port: number;
let requests: string[];
let destinations: string[];
let hostHeaders: string[];
beforeAll(async () => {
  server = createServer((req, res) => {
    requests.push(req.url!);
    hostHeaders.push(req.headers.host!);
    res.setHeader('connection', 'close');
    if (req.url?.includes('redirect')) { res.writeHead(302, { location: 'http://169.254.169.254/' }); res.end(); }
    else if (req.url?.includes('missing')) { res.writeHead(404); res.end('private upstream details'); }
    else if (req.url?.includes('empty')) { res.writeHead(204); res.end(); }
    else { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}'); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as import('node:net').AddressInfo).port;
});
beforeEach(() => {
  requests = []; destinations = []; hostHeaders = [];
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Unprotected fetch must not be used'));
  dns.lookup.mockReset().mockResolvedValue([{ address: '8.8.8.8', family: 4 }]);
  vi.spyOn(net, 'connect').mockImplementation(((options: { host: string; lookup?: LookupFunction }) => {
    const socket = new net.Socket();
    queueMicrotask(() => {
      if (!options.lookup) { socket.destroy(new Error('No connection-bound lookup')); return; }
      options.lookup(options.host, { all: true }, (err, addresses) => {
        if (socket.destroyed) return;
        if (err) { socket.destroy(err); return; }
        const address = typeof addresses === 'string' ? addresses : addresses[0]!.address;
        destinations.push(address);
        socket.connect(port, '127.0.0.1');
      });
    });
    return socket;
  }) as unknown as typeof net.connect);
});
afterEach(async () => { await closePublicHttp(); vi.restoreAllMocks(); });
afterAll(async () => { await new Promise<void>(resolve => server.close(() => resolve())); });

const creds = { storeUrl: 'http://store.example.test', consumerKey: 'ck_test', consumerSecret: 'cs_test' };
describe('connection-bound public HTTP', () => {
  it('connects to the validated result without a second DNS lookup and preserves Host', async () => {
    dns.lookup.mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValue([{ address: '127.0.0.1', family: 4 }]);
    expect(await wooRequest(creds, 'GET', '/products')).toEqual({ ok: true });
    expect(destinations).toEqual(['8.8.8.8']);
    expect(hostHeaders).toEqual(['store.example.test']);
    expect(dns.lookup).toHaveBeenCalledTimes(1);
    // A fresh socket must validate again rather than reusing stale DNS approval.
    await closePublicHttp();
    await expect(wooRequest(creds, 'GET', '/products')).rejects.toThrow();
    expect(requests).toEqual(['/wp-json/wc/v3/products']);
  });
  it.each([
    [{ address: '127.0.0.1', family: 4 }],
    [{ address: '8.8.8.8', family: 4 }, { address: '::ffff:7f00:1', family: 6 }],
    [],
  ])('rejects denied or mixed DNS answers before connecting (%j)', async (...answers) => {
    dns.lookup.mockResolvedValue(answers);
    await expect(wooRequest(creds, 'GET', '/products')).rejects.toThrow();
    expect(destinations).toEqual([]);
    expect(requests).toEqual([]);
  });
  it('does not follow redirects to internal services', async () => {
    await expect(wooRequest(creds, 'GET', '/redirect')).rejects.toThrow('302');
    expect(requests).toEqual(['/wp-json/wc/v3/redirect']);
  });
  it('does not leak upstream bodies on errors and handles empty responses', async () => {
    await expect(wooRequest(creds, 'GET', '/missing')).rejects.toThrow('Woo GET /missing → 404');
    expect(await wooRequest(creds, 'DELETE', '/empty')).toBeUndefined();
  });
  it('preserves TLS hostname verification and supplies validated lookup to TLS', async () => {
    const tls = createRequire(import.meta.url)('node:tls') as typeof import('node:tls');
    let captured: import('node:tls').ConnectionOptions | undefined;
    vi.spyOn(tls, 'connect').mockImplementation(((options: import('node:tls').ConnectionOptions) => {
      captured = options;
      const socket = new net.Socket();
      queueMicrotask(() => socket.destroy(new Error('TLS fixture stopped before network')));
      return socket;
    }) as unknown as typeof tls.connect);
    await expect(publicFetch(new URL('https://secure.example.test/'), {})).rejects.toThrow();
    expect(captured?.host).toBe('secure.example.test');
    expect(captured?.servername).toBe('secure.example.test');
    expect(captured?.rejectUnauthorized).not.toBe(false);
    expect(captured?.lookup).toBeTypeOf('function');
  });
  it('aborts a stalled DNS lookup before any connection', async () => {
    dns.lookup.mockImplementation(() => new Promise(() => {}));
    await expect(publicFetch(new URL('http://slow.example.test/'), { signal: AbortSignal.timeout(30) })).rejects.toThrow();
    expect(destinations).toEqual([]);
  });
  it('rejects private IP literals even though sockets bypass DNS for them', async () => {
    await expect(publicFetch(new URL('http://[::ffff:7f00:1]/'), {})).rejects.toThrow();
    expect(destinations).toEqual([]);
  });
});
