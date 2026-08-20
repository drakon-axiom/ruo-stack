import { createServer, type Server } from 'node:http';
import * as http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StripeNetworkRailError } from '../stripe-network-rail.ts';

// Proves the rail installed globally by test/setup.ts (every test file gets
// it — see setup.ts) actually fires, and that it does NOT collateral-damage
// other network access. "A rail nobody has seen trigger is not a rail."
describe('stripe network rail', () => {
  it('rejects a fetch() to api.stripe.com', async () => {
    await expect(fetch('https://api.stripe.com/v1/prices')).rejects.toThrow(StripeNetworkRailError);
  });

  it('rejects a fetch() to any api.stripe.com path/method, not just this one URL', async () => {
    await expect(
      fetch('https://api.stripe.com/v1/prices/price_123', { method: 'DELETE' }),
    ).rejects.toThrow(StripeNetworkRailError);
  });

  it('rejects an https.request()-style call shaped like the Stripe SDK sends it', async () => {
    // stripe@17.7.0's NodeHttpClient (the SDK's default Node HTTP client —
    // see cjs/net/NodeHttpClient.js) calls https.request with a single
    // options object carrying `host`, not a URL string. Reproduce that shape
    // directly against the patched https.request so this test exercises the
    // exact code path the real SDK would hit, without needing the SDK
    // installed as a test dependency.
    const https = await import('node:https');
    expect(() =>
      https.request({ host: 'api.stripe.com', port: 443, path: '/v1/prices', method: 'POST', headers: {} }),
    ).toThrow(StripeNetworkRailError);
  });

  describe('does not block other network access', () => {
    let server: Server;
    let port: number;

    beforeAll(async () => {
      server = createServer((_req, res) => res.end('ok'));
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (address === null || typeof address === 'string') throw new Error('failed to bind test server');
      port = address.port;
    });

    afterAll(async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    });

    it('lets fetch() reach a non-Stripe host', async () => {
      const res = await fetch(`http://127.0.0.1:${port}/`);
      expect(await res.text()).toBe('ok');
    });

    it('lets node:http request()/get() reach a non-Stripe host', async () => {
      const body = await new Promise<string>((resolve, reject) => {
        http.get(`http://127.0.0.1:${port}/`, (res) => {
          let data = '';
          res.on('data', (chunk) => (data += chunk));
          res.on('end', () => resolve(data));
        }).on('error', reject);
      });
      expect(body).toBe('ok');
    });
  });
});
