import { describe, test, expect, afterEach } from 'bun:test';
import { ChatService } from './chat.service';
import { AIRouterFactory } from '@/engine/routing/ai-router.factory';
import type { Tenant } from '@/tenant/tenant.types';
import type { ModelConfig } from '@/engine/client/client.types';
import type { AIRouter } from '@/engine/routing/ai-router';

const fakeTenant = { id: 'tenant-1', name: 'Test' } as Tenant;
const fakeConfigs: ModelConfig[] = [{ url: 'https://api.openai.com/v1/chat/completions', model: 'gpt-4o', apiKey: 'sk-fake' }];

const originalFetch = globalThis.fetch;

describe('ChatService', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeFactory(client: Pick<AIRouter, 'chat' | 'chatStream'>): AIRouterFactory {
    return { create: () => client } as unknown as AIRouterFactory;
  }

  test('handles standard chat request successfully', async () => {
    const mockClient: Pick<AIRouter, 'chat' | 'chatStream'> = {
      chat: async () => ({ model: 'gpt-4o', content: 'Mocked reply', aiProviderId: 'prov-1', aiProvider: 'openai', aiProviderUrl: 'https://api.openai.com' }),
      chatStream: async () => null,
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
    const mockClient: Pick<AIRouter, 'chat' | 'chatStream'> = {
      chat: async () => ({ model: 'gpt-4o', content: '', aiProviderId: 'prov-1', aiProvider: 'openai', aiProviderUrl: 'https://api.openai.com' }),
      chatStream: async () => ({ body: fakeBody, model: 'gpt-4o', aiProviderId: 'prov-1', aiProvider: 'openai', aiProviderUrl: 'https://api.openai.com' }),
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
    const mockClient: Pick<AIRouter, 'chat' | 'chatStream'> = {
      chat: async () => ({ model: 'gpt-4o', content: '', aiProviderId: 'prov-1', aiProvider: 'openai', aiProviderUrl: 'https://api.openai.com' }),
      chatStream: async () => null,
    };
    const service = new ChatService(makeFactory(mockClient));

    const result = await service.handleChatRequest(fakeTenant, { messages: [{ role: 'user', content: 'Hello' }], stream: true }, fakeConfigs);
    expect(result.isErr()).toBe(true);
    expect(result._unsafeUnwrapErr()).toEqual({ code: 'ai_unavailable' });
  });

  describe('system prompt resolution', () => {
    test('uses explicit system field when provided', async () => {
      let capturedSystemPrompt = '';
      const mockClient: Pick<AIRouter, 'chat' | 'chatStream'> = {
        chat: async (systemPrompt) => { capturedSystemPrompt = systemPrompt; return { model: 'gpt-4o', content: 'ok', aiProviderId: 'p', aiProvider: 'a', aiProviderUrl: 'u' }; },
        chatStream: async () => null,
      };
      const service = new ChatService(makeFactory(mockClient));
      await service.handleChatRequest(fakeTenant, {
        messages: [{ role: 'user', content: 'hi' }],
        system: 'You are a pirate.',
      }, fakeConfigs);
      expect(capturedSystemPrompt).toBe('You are a pirate.');
    });

    test('uses system message from messages array when no explicit system field', async () => {
      let capturedSystemPrompt = '';
      const mockClient: Pick<AIRouter, 'chat' | 'chatStream'> = {
        chat: async (systemPrompt) => { capturedSystemPrompt = systemPrompt; return { model: 'gpt-4o', content: 'ok', aiProviderId: 'p', aiProvider: 'a', aiProviderUrl: 'u' }; },
        chatStream: async () => null,
      };
      const service = new ChatService(makeFactory(mockClient));
      await service.handleChatRequest(fakeTenant, {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'hi' },
        ],
      }, fakeConfigs);
      expect(capturedSystemPrompt).toBe('You are helpful.');
    });

    test('uses empty string when no system field and no system message', async () => {
      let capturedSystemPrompt = 'UNCHANGED';
      const mockClient: Pick<AIRouter, 'chat' | 'chatStream'> = {
        chat: async (systemPrompt) => { capturedSystemPrompt = systemPrompt; return { model: 'gpt-4o', content: 'ok', aiProviderId: 'p', aiProvider: 'a', aiProviderUrl: 'u' }; },
        chatStream: async () => null,
      };
      const service = new ChatService(makeFactory(mockClient));
      await service.handleChatRequest(fakeTenant, {
        messages: [{ role: 'user', content: 'hi' }],
      }, fakeConfigs);
      expect(capturedSystemPrompt).toBe('');
    });
  });

  describe('tool calling pass-through', () => {
    const fakeToolCall = {
      id: 'call_abc',
      type: 'function' as const,
      function: { name: 'get_weather', arguments: '{"city":"Rome"}' },
    };

    test('sets finish_reason to tool_calls and content to null when provider returns tool_calls', async () => {
      const mockClient: Pick<AIRouter, 'chat' | 'chatStream'> = {
        chat: async () => ({
          model: 'gpt-4o', content: '', toolCalls: [fakeToolCall],
          aiProviderId: 'p', aiProvider: 'a', aiProviderUrl: 'u',
        }),
        chatStream: async () => null,
      };
      const service = new ChatService(makeFactory(mockClient));

      const result = await service.handleChatRequest(fakeTenant, {
        messages: [{ role: 'user', content: 'What is the weather in Rome?' }],
        tools: [{ type: 'function', function: { name: 'get_weather', description: 'Get weather', parameters: {} } }],
      }, fakeConfigs);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      if (!value.isStream) {
        expect(value.payload.choices[0]!.finish_reason).toBe('tool_calls');
        expect(value.payload.choices[0]!.message.content).toBeNull();
        expect(value.payload.choices[0]!.message.tool_calls).toEqual([fakeToolCall]);
      }
    });

    test('sets finish_reason to stop and preserves content when no tool_calls', async () => {
      const mockClient: Pick<AIRouter, 'chat' | 'chatStream'> = {
        chat: async () => ({
          model: 'gpt-4o', content: 'It is sunny.', toolCalls: undefined,
          aiProviderId: 'p', aiProvider: 'a', aiProviderUrl: 'u',
        }),
        chatStream: async () => null,
      };
      const service = new ChatService(makeFactory(mockClient));

      const result = await service.handleChatRequest(fakeTenant, {
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [{ type: 'function', function: { name: 'get_weather', description: 'Get weather', parameters: {} } }],
      }, fakeConfigs);

      expect(result.isOk()).toBe(true);
      const value = result._unsafeUnwrap();
      if (!value.isStream) {
        expect(value.payload.choices[0]!.finish_reason).toBe('stop');
        expect(value.payload.choices[0]!.message.content).toBe('It is sunny.');
        expect(value.payload.choices[0]!.message.tool_calls).toBeUndefined();
      }
    });

    test('passes sampling params (temperature, max_tokens) to the router', async () => {
      let capturedOpts: unknown;
      const mockClient: Pick<AIRouter, 'chat' | 'chatStream'> = {
        chat: async (_sys, _msgs, _ctx, _tools, _dispatcher, opts) => {
          capturedOpts = opts;
          return { model: 'gpt-4o', content: 'ok', aiProviderId: 'p', aiProvider: 'a', aiProviderUrl: 'u' };
        },
        chatStream: async () => null,
      };
      const service = new ChatService(makeFactory(mockClient));

      await service.handleChatRequest(fakeTenant, {
        messages: [{ role: 'user', content: 'hi' }],
        temperature: 0.2,
        max_tokens: 512,
        seed: 42,
      }, fakeConfigs);

      expect(capturedOpts).toMatchObject({ temperature: 0.2, max_tokens: 512, seed: 42 });
    });
  });
});
