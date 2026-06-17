import { describe, expect, it } from 'vitest';
import { decryptSecret, encryptSecret, hashPassword, hashToken, verifyPassword } from '../../src/crypto.js';

const KEY = Buffer.alloc(32, 9).toString('base64');

describe('crypto helpers', () => {
  it('AES-256-GCM round-trips the MFA secret', () => {
    const plaintext = 'JBSWY3DPEHPK3PXP';
    const enc = encryptSecret(plaintext, KEY);
    expect(enc).not.toContain(plaintext);
    expect(decryptSecret(enc, KEY)).toBe(plaintext);
  });

  it('fails to decrypt with a tampered ciphertext (auth tag)', () => {
    const enc = encryptSecret('secret', KEY);
    const tampered = enc.slice(0, -2) + (enc.endsWith('A') ? 'B' : 'A');
    expect(() => decryptSecret(tampered, KEY)).toThrow();
  });

  it('bcrypt verifies the right password and rejects the wrong one', async () => {
    const hash = await hashPassword('correct horse');
    expect(await verifyPassword('correct horse', hash)).toBe(true);
    expect(await verifyPassword('wrong', hash)).toBe(false);
  });

  it('token hashing is deterministic and non-reversible-looking', () => {
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abc')).not.toBe('abc');
  });
});
