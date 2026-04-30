import { describe, test, expect, afterEach, spyOn } from 'bun:test';
import { HttpProviderClient } from './http-provider-client';
import { mockSseResponse, mockJsonResponse, mockFetch } from '@test/test-setup';
import { createFakeToolCallResponse } from '@test/fixtures/chat-fixtures';
import type { ModelConfig } from './http-provider-client.types';

function createTestClient(config: ModelConfig, firstTokenTimeoutMs = 30000, providerRequestTimeoutMs = 30000) {
  return new HttpProviderClient(config, firstTokenTimeoutMs, providerRequestTimeoutMs);
}

function mockChatResponse(content: string) {
  return mockJsonResponse({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
}

function mockToolCallResponse(id: string, name: string, args: string) {
  return mockJsonResponse(createFakeToolCallResponse(id, name, args));
}

const SYSTEM = 'You are a helpful assistant.';

describe('HttpProviderClient - OpenAI-compat response parsing', () => {
  let undoFetch: () => void;

  afterEach(() => undoFetch());

  test('call() returns content from JSON response', async () => {
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => mockChatResponse('Hello world'));
    const result = await client.call(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.content).toBe('Hello world');
  });

  test('call() returns tool_calls from JSON response', async () => {
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => mockToolCallResponse('call_123', 'get_weather', '{"city":"London"}'));
    const result = await client.call(SYSTEM, [{ role: 'user', content: 'weather?' }], {
      tools: [{ type: 'function', function: { name: 'get_weather', description: '', parameters: {} } }]
    });
    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.toolCalls).toHaveLength(1);
      expect(result.value.toolCalls?.[0]?.function.name).toBe('get_weather');
    }
  });

  test('call() strips <think> tags from response', async () => {
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => mockChatResponse('<think>internal reasoning</think>actual answer'));
    const result = await client.call(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.content).toBe('actual answer');
  });

  test('call() returns hard failure on HTTP 500', async () => {
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => new Response('', { status: 500 }));
    const result = await client.call(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('hard');
  });

  test('includes Authorization header when apiKey is set', async () => {
    let capturedHeaders: Record<string, string> = {};
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model', apiKey: 'sk-test-key' });
    undoFetch = mockFetch((_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(new Headers(init.headers as Record<string, string>).entries());
      return mockChatResponse('ok');
    });
    await client.call(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(capturedHeaders['authorization']).toBe('Bearer sk-test-key');
  });

  test('call() clears the timeout on success', async () => {
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => mockChatResponse('Hello'));
    const spy = spyOn(globalThis, 'clearTimeout');
    await client.call(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('call() clears the timeout on HTTP error', async () => {
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => new Response('', { status: 500 }));
    const spy = spyOn(globalThis, 'clearTimeout');
    await client.call(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('call() aborts after providerRequestTimeoutMs on a hanging JSON request', async () => {
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model' }, 30000, 100);
    const originalFetch = globalThis.fetch;
    globalThis.fetch = ((_url: string, init?: RequestInit) =>
      new Promise((_, reject) => {
        (init?.signal as AbortSignal)?.addEventListener('abort', () => {
          const e = new Error('AbortError'); e.name = 'AbortError'; reject(e);
        });
      })
    ) as unknown as typeof fetch;
    undoFetch = () => { globalThis.fetch = originalFetch; };
    const start = Date.now();
    const result = await client.call(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(Date.now() - start).toBeLessThan(500);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('soft');
  });

});

describe('HttpProviderClient - callStream()', () => {
  let undoFetch: () => void;

  afterEach(() => undoFetch());

  test('callStream() clears the timeout on success', async () => {
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => mockSseResponse('hi'));
    const spy = spyOn(globalThis, 'clearTimeout');
    await client.callStream(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('callStream() clears the timeout on HTTP error', async () => {
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => new Response('', { status: 500 }));
    const spy = spyOn(globalThis, 'clearTimeout');
    await client.callStream(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('callStream() clears the timeout on content-type mismatch', async () => {
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const spy = spyOn(globalThis, 'clearTimeout');
    await client.callStream(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  test('returns ok with body on HTTP 200', async () => {
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => mockSseResponse('hi'));
    const result = await client.callStream(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.body).toBeDefined();
  });

  test('returns hard failure on HTTP 500', async () => {
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => new Response('', { status: 500 }));
    const result = await client.callStream(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('hard');
  });

  test('sends stream:true in the request body', async () => {
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model' });
    let capturedBody: Record<string, unknown> = {};
    undoFetch = mockFetch((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return mockSseResponse('');
    });
    await client.callStream(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(capturedBody['stream']).toBe(true);
  });

  test('returns hard failure if upstream does not return text/event-stream', async () => {
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => new Response('{"choices":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const result = await client.callStream(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('hard');
  });

  test('prepends system message to the request', async () => {
    const client = createTestClient({ url: 'http://fake/v1', model: 'test-model' });
    let capturedMessages: Array<{ role: string; content: string }> = [];
    undoFetch = mockFetch((_url: string, init: RequestInit) => {
      capturedMessages = (JSON.parse(init.body as string) as { messages: Array<{ role: string; content: string }> }).messages;
      return mockSseResponse('');
    });
    await client.callStream('my system prompt', [{ role: 'user', content: 'hello' }]);
    expect(capturedMessages[0]).toEqual({ role: 'system', content: 'my system prompt' });
    expect(capturedMessages[1]).toEqual({ role: 'user', content: 'hello' });
  });
});
