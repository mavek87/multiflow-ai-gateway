import { describe, test, expect, afterEach } from 'bun:test';
import { HttpProviderClient } from './http-provider-client';
import { mockSseResponse, mockFetch } from '@test/test-setup';

const SYSTEM = 'You are a helpful assistant.';

describe('HttpProviderClient - OpenAI-compat response parsing', () => {
  let undoFetch: () => void;

  afterEach(() => undoFetch());

  test('chat() returns content from SSE stream', async () => {
    const client = new HttpProviderClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => mockSseResponse(['Hello', ' world']));
    const result = await client.chat(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.content).toBe('Hello world');
  });

  test('chat() strips <think> tags from streamed response', async () => {
    const client = new HttpProviderClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => mockSseResponse(['<think>internal reasoning</think>', 'actual answer']));
    const result = await client.chat(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.content).toBe('actual answer');
  });

  test('chat() returns hard failure on HTTP 500', async () => {
    const client = new HttpProviderClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => new Response('', { status: 500 }));
    const result = await client.chat(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('hard');
  });

  test('includes Authorization header when apiKey is set', async () => {
    let capturedHeaders: Record<string, string> = {};
    const client = new HttpProviderClient({ url: 'http://fake/v1', model: 'test-model', apiKey: 'sk-test-key' });
    undoFetch = mockFetch((_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(new Headers(init.headers as Record<string, string>).entries());
      return mockSseResponse('ok');
    });
    await client.chat(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(capturedHeaders['authorization']).toBe('Bearer sk-test-key');
  });
});

describe('HttpProviderClient - chatStream()', () => {
  let undoFetch: () => void;

  afterEach(() => undoFetch());

  test('returns ok with body on HTTP 200', async () => {
    const client = new HttpProviderClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => mockSseResponse('hi'));
    const result = await client.chatStream(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(result.isOk()).toBe(true);
    if (result.isOk()) expect(result.value.body).toBeDefined();
  });

  test('returns hard failure on HTTP 500', async () => {
    const client = new HttpProviderClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => new Response('', { status: 500 }));
    const result = await client.chatStream(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('hard');
  });

  test('sends stream:true in the request body', async () => {
    const client = new HttpProviderClient({ url: 'http://fake/v1', model: 'test-model' });
    let capturedBody: Record<string, unknown> = {};
    undoFetch = mockFetch((_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return mockSseResponse('');
    });
    await client.chatStream(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(capturedBody['stream']).toBe(true);
  });

  test('returns hard failure if upstream does not return text/event-stream', async () => {
    const client = new HttpProviderClient({ url: 'http://fake/v1', model: 'test-model' });
    undoFetch = mockFetch(() => new Response('{"choices":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } }));
    const result = await client.chatStream(SYSTEM, [{ role: 'user', content: 'hi' }]);
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.kind).toBe('hard');
  });

  test('prepends system message to the request', async () => {
    const client = new HttpProviderClient({ url: 'http://fake/v1', model: 'test-model' });
    let capturedMessages: Array<{ role: string; content: string }> = [];
    undoFetch = mockFetch((_url: string, init: RequestInit) => {
      capturedMessages = (JSON.parse(init.body as string) as { messages: Array<{ role: string; content: string }> }).messages;
      return mockSseResponse('');
    });
    await client.chatStream('my system prompt', [{ role: 'user', content: 'hello' }]);
    expect(capturedMessages[0]).toEqual({ role: 'system', content: 'my system prompt' });
    expect(capturedMessages[1]).toEqual({ role: 'user', content: 'hello' });
  });
});
