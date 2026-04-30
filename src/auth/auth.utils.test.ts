import { describe, test, expect } from 'bun:test';
import { generateApiKey, hashApiKey } from './auth.utils';

describe('generateApiKey', () => {
  test('starts with gw_ prefix', () => {
    expect(generateApiKey()).toMatch(/^gw_/);
  });

  test('generates unique keys', () => {
    const keys = new Set(Array.from({ length: 100 }, generateApiKey));
    expect(keys.size).toBe(100);
  });

  test('has sufficient length', () => {
    expect(generateApiKey().length).toBeGreaterThan(40);
  });
});

describe('hashApiKey', () => {
  test('returns 64-char hex string', () => {
    expect(hashApiKey('gw_test')).toMatch(/^[a-f0-9]{64}$/);
  });

  test('same input produces same hash', () => {
    const key = generateApiKey();
    expect(hashApiKey(key)).toBe(hashApiKey(key));
  });

  test('different inputs produce different hashes', () => {
    expect(hashApiKey('gw_aaa')).not.toBe(hashApiKey('gw_bbb'));
  });
});

