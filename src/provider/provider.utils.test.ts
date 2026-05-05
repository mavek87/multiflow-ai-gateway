import { describe, test, expect } from 'bun:test';
import { buildProviderUrl } from '@/provider/provider.utils';

const CHAT_SUFFIX = '/chat/completions';

describe('buildProviderUrl', () => {
  test('returns the correct chat completion URL', () => {
    expect(buildProviderUrl('https://api.openai.com/v1', 'openai')).toBe(`https://api.openai.com/v1${CHAT_SUFFIX}`);
  });

  test('trims trailing slash from baseUrl', () => {
    expect(buildProviderUrl('https://api.openai.com/v1/', 'openai')).toBe(`https://api.openai.com/v1${CHAT_SUFFIX}`);
  });

  test('trims multiple trailing slashes', () => {
    expect(buildProviderUrl('https://api.openai.com/v1//', 'openai')).toBe(`https://api.openai.com/v1${CHAT_SUFFIX}`);
  });

  test('works for groq provider type', () => {
    expect(buildProviderUrl('https://api.groq.com/openai/v1', 'groq')).toBe(`https://api.groq.com/openai/v1${CHAT_SUFFIX}`);
  });

  test('works for ollama provider type', () => {
    expect(buildProviderUrl('http://localhost:11434/api', 'ollama')).toBe(`http://localhost:11434/api${CHAT_SUFFIX}`);
  });
});
