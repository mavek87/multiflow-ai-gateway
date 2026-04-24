import { describe, test, expect, beforeAll } from 'bun:test';
import { CryptoService } from './crypto';

const TEST_KEY = 'a'.repeat(64);

describe('CryptoService', () => {
  let cryptoService: CryptoService;

  beforeAll(() => {
    cryptoService = new CryptoService(TEST_KEY);
  });

  test('round-trip returns original plaintext', () => {
    const plain = 'sk-or-v1-supersecretkey';
    expect(cryptoService.decrypt(cryptoService.encrypt(plain))).toBe(plain);
  });

  test('produces different ciphertext each call (random IV)', () => {
    const plain = 'same-input';
    expect(cryptoService.encrypt(plain)).not.toBe(cryptoService.encrypt(plain));
  });

  test('decrypting tampered data throws', () => {
    const encoded = cryptoService.encrypt('hello');
    const buf = Buffer.from(encoded, 'base64');
    const idx = 20;
    buf[idx] = (buf[idx]! ^ 0xff);
    expect(() => cryptoService.decrypt(buf.toString('base64'))).toThrow();
  });
});
