import { describe, test, expect, afterEach } from 'bun:test';
import { ChatService } from './chat.service';
import { AIRouterFactory } from '@/engine/routing/ai-router.factory';
import type { AIRouter } from '@/engine/routing/ai-router';
import { fakeTenant, fakeModelConfigs, createFakeChatCompletionResponse, createFakeToolCallResponse } from '@test/fixtures/chat-fixtures';

const originalFetch = globalThis.fetch;

describe('ChatService', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeFactory(client: Pick<AIRouter, 'chat' | 'chatStream'>): AIRouterFactory {
    return { create: () => client } as unknown as AIRouterFactory;
  }

  test('handles standard chat request successfully', async () => {
    const fakeRawBody = createFakeChatCompletionResponse('Mocked reply');
    const mockClient: Pick<AIRouter, 'chat' | 'chatStream'> = {
      chat: async () => ({ model: 'gpt-4o', content: 'Mocked reply', rawBody: fakeRawBody, aiProviderId: 'prov-1', aiProvider: 'openai', aiProviderUrl: 'https://api.openai.com' }),
      chatStream: async () => null,
    };
    const service = new ChatService(makeFactory(mockClient));

    const result = await service.handleChatRequest(fakeTenant, { messages: [{ role: 'user', content: 'Hello' }] }, fakeModelConfigs);
    
    expect(result).toSucceed();
    const value = result._unsafeUnwrap();
    expect(value.isStream).toBe(false);
    if (!value.isStream) {
      const payload = value.payload as typeof fakeRawBody;
      expect(value.model).toBe('gpt-4o');
      expect(payload.choices[0]!.message.content).toBe('Mocked reply');
    }
  });

  test('handles standard stream request successfully', async () => {
    const fakeBody = new ReadableStream();
    const mockClient: Pick<AIRouter, 'chat' | 'chatStream'> = {
      chat: async () => ({ model: 'gpt-4o', content: '', aiProviderId: 'prov-1', aiProvider: 'openai', aiProviderUrl: 'https://api.openai.com' }),
      chatStream: async () => ({ body: fakeBody, model: 'gpt-4o', aiProviderId: 'prov-1', aiProvider: 'openai', aiProviderUrl: 'https://api.openai.com' }),
    };
    const service = new ChatService(makeFactory(mockClient));

    const result = await service.handleChatRequest(fakeTenant, { messages: [{ role: 'user', content: 'Hello' }], stream: true }, fakeModelConfigs);
    
    expect(result).toSucceed();
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

    const result = await service.handleChatRequest(fakeTenant, { messages: [{ role: 'user', content: 'Hello' }], stream: true }, fakeModelConfigs);
    expect(result).toFailWith({ code: 'ai_unavailable' });
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
      }, fakeModelConfigs);
      expect(capturedSystemPrompt).toBe('You are a pirate.');
    });

    test('uses system message from messages array when no explicit system field and strips it', async () => {
      let capturedSystemPrompt = '';
      let capturedMessages: any[] = [];
      const mockClient: Pick<AIRouter, 'chat' | 'chatStream'> = {
        chat: async (systemPrompt, messages) => { 
          capturedSystemPrompt = systemPrompt; 
          capturedMessages = messages;
          return { model: 'gpt-4o', content: 'ok', aiProviderId: 'p', aiProvider: 'a', aiProviderUrl: 'u' }; 
        },
        chatStream: async () => null,
      };
      const service = new ChatService(makeFactory(mockClient));
      await service.handleChatRequest(fakeTenant, {
        messages: [
          { role: 'system', content: 'You are helpful.' },
          { role: 'user', content: 'hi' },
        ],
      }, fakeModelConfigs);
      expect(capturedSystemPrompt).toBe('You are helpful.');
      expect(capturedMessages).toEqual([{ role: 'user', content: 'hi' }]);
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
      }, fakeModelConfigs);
      expect(capturedSystemPrompt).toBe('');
    });
  });

  describe('tool calling pass-through', () => {
    test('forwards finish_reason tool_calls from rawBody when provider returns tool_calls', async () => {
      const fakeRawBody = createFakeToolCallResponse('call_abc', 'get_weather', '{"city":"Rome"}');
      const fakeToolCall = fakeRawBody.choices[0]!.message.tool_calls![0]!;
      const mockClient: Pick<AIRouter, 'chat' | 'chatStream'> = {
        chat: async () => ({
          model: 'gpt-4o', content: '', toolCalls: [fakeToolCall], rawBody: fakeRawBody as any,
          aiProviderId: 'p', aiProvider: 'a', aiProviderUrl: 'u',
        }),
        chatStream: async () => null,
      };
      const service = new ChatService(makeFactory(mockClient));

      const result = await service.handleChatRequest(fakeTenant, {
        messages: [{ role: 'user', content: 'What is the weather in Rome?' }],
        tools: [{ type: 'function', function: { name: 'get_weather', description: 'Get weather', parameters: {} } }],
      }, fakeModelConfigs);

      expect(result).toSucceed();
      const value = result._unsafeUnwrap();
      if (!value.isStream) {
        const payload = value.payload as typeof fakeRawBody;
        expect(payload.choices[0]!.finish_reason).toBe('tool_calls');
        expect(payload.choices[0]!.message.content).toBeNull();
        expect(payload.choices[0]!.message.tool_calls).toEqual([fakeToolCall]);
      }
    });

    test('forwards finish_reason stop from rawBody when no tool_calls', async () => {
      const fakeRawBody = { id: 'chatcmpl-3', object: 'chat.completion', created: 1, model: 'gpt-4o', choices: [{ index: 0, message: { role: 'assistant', content: 'It is sunny.', tool_calls: undefined }, finish_reason: 'stop' }] };
      const mockClient: Pick<AIRouter, 'chat' | 'chatStream'> = {
        chat: async () => ({
          model: 'gpt-4o', content: 'It is sunny.', toolCalls: undefined, rawBody: fakeRawBody,
          aiProviderId: 'p', aiProvider: 'a', aiProviderUrl: 'u',
        }),
        chatStream: async () => null,
      };
      const service = new ChatService(makeFactory(mockClient));

      const result = await service.handleChatRequest(fakeTenant, {
        messages: [{ role: 'user', content: 'What is the weather?' }],
        tools: [{ type: 'function', function: { name: 'get_weather', description: 'Get weather', parameters: {} } }],
      }, fakeModelConfigs);

      expect(result).toSucceed();
      const value = result._unsafeUnwrap();
      if (!value.isStream) {
        const payload = value.payload as typeof fakeRawBody;
        expect(payload.choices[0]!.finish_reason).toBe('stop');
        expect(payload.choices[0]!.message.content).toBe('It is sunny.');
        expect(payload.choices[0]!.message.tool_calls).toBeUndefined();
      }
    });

    test('passes sampling params (temperature, max_tokens) to the router', async () => {
      let capturedOpts: unknown;
      const mockClient: Pick<AIRouter, 'chat' | 'chatStream'> = {
        chat: async (_sys, _msgs, _ctx, opts) => {
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
      }, fakeModelConfigs);

      expect(capturedOpts).toMatchObject({ temperature: 0.2, max_tokens: 512, seed: 42 });
    });
  });
});
