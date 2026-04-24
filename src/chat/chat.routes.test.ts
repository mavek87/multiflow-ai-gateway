import { describe, test, expect, beforeAll, afterEach, beforeEach } from 'bun:test';
import { chatRoutePlugin } from './chat.routes';
import { Elysia } from 'elysia';
import { createTestContext, seedTestTenantAndProvider, ensureTestEncryptionKey } from '@test/test-setup';
import type { TenantStore } from '@/tenant/tenant.store';

function makeApp(store: TenantStore) {
  return new Elysia().use(chatRoutePlugin(store));
}

beforeAll(() => {
  ensureTestEncryptionKey();
});

const originalFetch = globalThis.fetch;

describe('chatPlugin E2E', () => {
  let app: ReturnType<typeof makeApp>;
  let rawApiKey: string;

  beforeEach(() => {
    const { tenantStore: store, providerStore } = createTestContext();
    const seeded = seedTestTenantAndProvider(store, providerStore);
    rawApiKey = seeded.rawApiKey;
    app = makeApp(store);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns 200 OK with correct response format for standard chat', async () => {
    // Mock the external API call
    // @ts-ignore
    globalThis.fetch = async () => {
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello from gateway' } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const res = await app.handle(new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawApiKey}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe('chat.completion');
    expect(body.model).toBe('gpt-4o');
    expect(body.choices[0].message.content).toBe('Hello from gateway');
  });

  test('returns 200 OK event-stream for stream requests', async () => {
    // @ts-ignore
    globalThis.fetch = async () => {
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Stream message' } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const res = await app.handle(new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawApiKey}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: true })
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const text = await res.text();
    expect(text).toContain('Stream message');
  });

  test('returns 400 Bad Request when requested model is not available', async () => {
    const res = await app.handle(new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawApiKey}` },
      body: JSON.stringify({ model: 'claude-opus', messages: [{ role: 'user', content: 'hi' }] })
    }));

    expect(res.status).toBe(400);
  });
});
