import { describe, test, expect, beforeAll } from 'bun:test';

beforeAll(() => {
  process.env['ENCRYPTION_KEY'] = 'a'.repeat(64);
});

// Import after env is set
const { encrypt, decrypt } = await import('./crypto');

describe('encrypt / decrypt', () => {
  test('round-trip returns original plaintext', () => {
    const plain = 'sk-or-v1-supersecretkey';
    expect(decrypt(encrypt(plain))).toBe(plain);
  });

  test('produces different ciphertext each call (random IV)', () => {
    const plain = 'same-input';
    expect(encrypt(plain)).not.toBe(encrypt(plain));
  });

  test('decrypting tampered data throws', () => {
    const encoded = encrypt('hello');
    const buf = Buffer.from(encoded, 'base64');
    const idx = 20;
    buf[idx] = (buf[idx]! ^ 0xff);
    expect(() => decrypt(buf.toString('base64'))).toThrow();
  });
});
