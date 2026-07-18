import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { encryptStoreCreds, decryptStoreCreds } from '../../src/services/woo.js';

// Store REST credentials must encrypt under STORE_CREDS_KEY, a secret distinct
// from MFA_ENCRYPTION_KEY, so one key's compromise can't decrypt the other.
describe('store credential encryption', () => {
  it('round-trips consumer key/secret', () => {
    const enc = encryptStoreCreds('ck_live_abc', 'cs_live_xyz');
    expect(enc.consumerKeyEnc).not.toContain('ck_live_abc');
    expect(enc.consumerSecretEnc).not.toContain('cs_live_xyz');
    const dec = decryptStoreCreds({
      storeUrl: 'https://shop.example',
      consumerKeyEnc: enc.consumerKeyEnc,
      consumerSecretEnc: enc.consumerSecretEnc,
    });
    expect(dec).toEqual({ storeUrl: 'https://shop.example', consumerKey: 'ck_live_abc', consumerSecret: 'cs_live_xyz' });
  });

  it('uses a key distinct from the MFA key', () => {
    const cfg = loadConfig();
    expect(cfg.STORE_CREDS_KEY).not.toBe(cfg.MFA_ENCRYPTION_KEY);
  });
});
