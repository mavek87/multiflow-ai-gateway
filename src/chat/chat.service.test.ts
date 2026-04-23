import { describe, test, expect, afterEach } from 'bun:test';
import { ChatService } from './chat.service';
import { RoutingAIClientFactory } from '@/engine/routing/routing-client-factory';
import type { Tenant } from '@/tenant/tenant.types';
import type { AIClient, ModelConfig } from '@/engine/types';

const fakeTenant = { id: 'tenant-1', name: 'Test' } as Tenant;
const fakeConfigs: ModelConfig[] = [{ url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o', apiKey: 'sk-fake' }];

const originalFetch = globalThis.fetch;

describe('ChatService', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeFactory(client: AIClient): RoutingAIClientFactory {
    return { create: () => client } as unknown as RoutingAIClientFactory;
  }

  test('handles standard chat request successfully', async () => {
    const mockClient: AIClient = {
      chat: async () => ({ model: 'gpt-4o', content: 'Mocked reply', aiProvider: 'openai', aiProviderUrl: 'https://api.openai.com' }),
    };
    const service = new ChatService(makeFactory(mockClient));

    const result = await service.handleChatRequest(fakeTenant, { messages: [{ role: 'user', content: 'Hello' }] }, fakeConfigs);
    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.isStream).toBe(false);
    if (!value.isStream) {
      expect(value.model).toBe('gpt-4o');
      expect(value.payload.choices[0]!.message.content).toBe('Mocked reply');
    }
  });

  test('handles standard stream request successfully', async () => {
    const fakeBody = new ReadableStream();
    const mockClient: AIClient = {
      chat: async () => ({ model: 'gpt-4o', content: '', aiProvider: 'openai', aiProviderUrl: 'https://api.openai.com' }),
      callStream: async () => ({ body: fakeBody, model: 'gpt-4o', aiProvider: 'openai', aiProviderUrl: 'https://api.openai.com' }),
    };
    const service = new ChatService(makeFactory(mockClient));

    const result = await service.handleChatRequest(fakeTenant, { messages: [{ role: 'user', content: 'Hello' }], stream: true }, fakeConfigs);
    expect(result.isOk()).toBe(true);
    const value = result._unsafeUnwrap();
    expect(value.isStream).toBe(true);
    if (value.isStream) {
      expect(value.payload).toBe(fakeBody);
    }
  });

  test('returns ai_unavailable error if stream returns null', async () => {
    const mockClient: AIClient = {
      chat: async () => ({ model: 'gpt-4o', content: '', aiProvider: 'openai', aiProviderUrl: 'https://api.openai.com' }),
      callStream: async () => null,
    };
    const service = new ChatService(makeFactory(mockClient));

    const result = await service.handleChatRequest(fakeTenant, { messages: [{ role: 'user', content: 'Hello' }], stream: true }, fakeConfigs);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ code: 'ai_unavailable' });
  });
});
