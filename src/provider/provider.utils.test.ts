import { describe, test, expect } from 'bun:test';
import { buildProviderUrl } from './provider.utils';

describe('ProviderUtils', () => {
  test('buildProviderUrl returns the correct chat completion URL', () => {
    expect(buildProviderUrl('https://api.openai.com/v1', 'openai')).toBe('https://api.openai.com/v1/chat/completions');
  });

  test('buildProviderUrl handles trailing slashes in baseUrl (though it does not trim them in current implementation)', () => {
    // Current implementation: return `${baseUrl}/chat/completions`;
    // If baseUrl has trailing slash, it will have double slash.
    // This test documents current behavior.
    expect(buildProviderUrl('https://api.openai.com/v1/', 'openai')).toBe('https://api.openai.com/v1//chat/completions');
  });
});
