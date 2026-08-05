import { describe, expect, it } from 'vitest';
import { assertPublicHttpUrl, isPrivateAddress } from '../../src/services/ssrf-guard.js';

describe('isPrivateAddress', () => {
  it('flags private / loopback / link-local / reserved ranges', () => {
    for (const ip of ['10.0.0.5', '127.0.0.1', '169.254.169.254', '172.16.0.1', '172.31.255.1', '192.168.1.1', '100.64.0.1', '0.0.0.0', '224.0.0.1', '::1', 'fe80::1', 'fd00::1', '::ffff:10.0.0.1']) {
      expect(isPrivateAddress(ip), ip).toBe(true);
    }
  });

  it('allows public addresses', () => {
    for (const ip of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '2606:4700:4700::1111']) {
      expect(isPrivateAddress(ip), ip).toBe(false);
    }
  });

  it('denies anything that is not a valid IP', () => {
    expect(isPrivateAddress('not-an-ip')).toBe(true);
  });
});

describe('assertPublicHttpUrl', () => {
  it('rejects non-http(s) schemes', async () => {
    await expect(assertPublicHttpUrl('ftp://example.com')).rejects.toThrow();
    await expect(assertPublicHttpUrl('file:///etc/passwd')).rejects.toThrow();
  });

  it('rejects private / loopback IP literals and localhost', async () => {
    await expect(assertPublicHttpUrl('http://169.254.169.254/latest/meta-data/')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://127.0.0.1:3901/')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://10.0.0.5/wp-json')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://localhost/')).rejects.toThrow();
    await expect(assertPublicHttpUrl('http://[::1]/')).rejects.toThrow();
  });

  it('accepts a public IP literal (no DNS lookup needed)', async () => {
    await expect(assertPublicHttpUrl('https://8.8.8.8/wp-json/wc/v3/orders')).resolves.toBeUndefined();
  });
});
