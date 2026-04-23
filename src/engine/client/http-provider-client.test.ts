import { describe, test, expect } from 'bun:test';
import { HttpProviderClient } from './http-provider-client';

// Helper: build a mock fetch returning an OpenAI SSE stream
function mockStreamFetch(tokens: string[]) {
  return async (): Promise<Response> => {
    const lines = tokens.map((t) => `data: ${JSON.stringify({ choices: [{ delta: { content: t } }] })}`);
    lines.push('data: [DONE]');
    const body = lines.join('\n\n') + '\n\n';
    return new Response(body, { status: 200 });
  };
}

describe('HttpProviderClient — OpenAI-compat response parsing', () => {
  // call() uses stream=true — mock must return SSE format
  test('call() returns content from SSE stream', async () => {
    const client = new HttpProviderClient(
      { url: 'http://fake/v1', model: 'test-model' },
      'system prompt',
    );
    // @ts-ignore
    globalThis.fetch = mockStreamFetch(['Hello', ' world']);
    const result = await client.call([{ role: 'user', content: 'hi' }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe('Hello world');
  });

  test('call() strips <think> tags from streamed response', async () => {
    const client = new HttpProviderClient(
      { url: 'http://fake/v1', model: 'test-model' },
      'system prompt',
    );
    // @ts-ignore
    globalThis.fetch = mockStreamFetch(['<think>internal reasoning</think>', 'actual answer']);
    const result = await client.call([{ role: 'user', content: 'hi' }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.content).toBe('actual answer');
  });

  test('call() returns hard failure on HTTP 500', async () => {
    const client = new HttpProviderClient(
      { url: 'http://fake/v1', model: 'test-model' },
      'system prompt',
    );
    // @ts-ignore
    globalThis.fetch = async () => new Response('', { status: 500 });
    const result = await client.call([{ role: 'user', content: 'hi' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('hard');
  });

  test('includes Authorization header when apiKey is set', async () => {
    let capturedHeaders: Record<string, string> = {};
    const client = new HttpProviderClient(
      { url: 'http://fake/v1', model: 'test-model', apiKey: 'sk-test-key' },
      'system prompt',
    );
    // @ts-ignore
    globalThis.fetch = async (_url: string, init: RequestInit) => {
      capturedHeaders = Object.fromEntries(new Headers(init.headers as Record<string, string>).entries());
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sse, { status: 200 });
    };
    await client.call([{ role: 'user', content: 'hi' }]);
    expect(capturedHeaders['authorization']).toBe('Bearer sk-test-key');
  });
});

describe('HttpProviderClient — callStream()', () => {
  test('returns ok=true with body on HTTP 200', async () => {
    const client = new HttpProviderClient(
      { url: 'http://fake/v1', model: 'test-model' },
      'system prompt',
    );
    const sseBody = `data: ${JSON.stringify({ choices: [{ delta: { content: 'hi' } }] })}\n\ndata: [DONE]\n\n`;
    // @ts-ignore
    globalThis.fetch = async () => new Response(sseBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    const result = await client.callStream([{ role: 'user', content: 'hi' }]);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.body).toBeDefined();
  });

  test('returns hard failure on HTTP 500', async () => {
    const client = new HttpProviderClient(
      { url: 'http://fake/v1', model: 'test-model' },
      'system prompt',
    );
    // @ts-ignore
    globalThis.fetch = async () => new Response('', { status: 500 });
    const result = await client.callStream([{ role: 'user', content: 'hi' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('hard');
  });

  test('sends stream:true in the request body', async () => {
    const client = new HttpProviderClient(
      { url: 'http://fake/v1', model: 'test-model' },
      'system prompt',
    );
    let capturedBody: Record<string, unknown> = {};
    // @ts-ignore
    globalThis.fetch = async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string);
      return new Response('data: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    await client.callStream([{ role: 'user', content: 'hi' }]);
    expect(capturedBody['stream']).toBe(true);
  });

  test('returns hard failure if upstream does not return text/event-stream', async () => {
    const client = new HttpProviderClient(
      { url: 'http://fake/v1', model: 'test-model' },
      'system prompt',
    );
    // @ts-ignore
    globalThis.fetch = async () => new Response('{"choices":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } });
    const result = await client.callStream([{ role: 'user', content: 'hi' }]);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.kind).toBe('hard');
  });

  test('prepends system message to the request', async () => {
    const client = new HttpProviderClient(
      { url: 'http://fake/v1', model: 'test-model' },
      'my system prompt',
    );
    let capturedMessages: Array<{ role: string; content: string }> = [];
    // @ts-ignore
    globalThis.fetch = async (_url: string, init: RequestInit) => {
      capturedMessages = (JSON.parse(init.body as string) as { messages: Array<{ role: string; content: string }> }).messages;
      return new Response('data: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    await client.callStream([{ role: 'user', content: 'hello' }]);
    expect(capturedMessages[0]).toEqual({ role: 'system', content: 'my system prompt' });
    expect(capturedMessages[1]).toEqual({ role: 'user', content: 'hello' });
  });
});
