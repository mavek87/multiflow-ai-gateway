import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { createTestContext, seedTestTenantAndProvider, createTestApp, sendRequest, mockSseResponse } from '@test/test-setup';
import { CryptoService } from '@/crypto/crypto';
const originalFetch = globalThis.fetch;

describe('chatPlugin E2E', () => {
  let app: ReturnType<typeof createTestApp>;
  let rawApiKey: string;

  beforeEach(() => {
    const { tenantStore, providerStore } = createTestContext();
    const seeded = seedTestTenantAndProvider(tenantStore, providerStore);
    rawApiKey = seeded.rawApiKey;
    app = createTestApp(tenantStore, providerStore, new CryptoService());
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns 200 OK with correct response format for standard chat', async () => {
    // @ts-ignore
    globalThis.fetch = async () => mockSseResponse('Hello from gateway');

    const res = await sendRequest(app, '/v1/chat/completions', {
      method: 'POST',
      apiKey: rawApiKey,
      body: { messages: [{ role: 'user', content: 'hi' }] }
    });

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe('chat.completion');
    expect(body.choices[0].message.content).toBe('Hello from gateway');
  });

  test('returns 200 OK event-stream for stream requests', async () => {
    // @ts-ignore
    globalThis.fetch = async () => mockSseResponse('Stream message');

    const res = await sendRequest(app, '/v1/chat/completions', {
      method: 'POST',
      apiKey: rawApiKey,
      body: { messages: [{ role: 'user', content: 'hi' }], stream: true }
    });

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(await res.text()).toContain('Stream message');
  });

  test('returns 400 Bad Request when requested model is not available', async () => {
    const res = await sendRequest(app, '/v1/chat/completions', {
      method: 'POST',
      apiKey: rawApiKey,
      body: { model: 'claude-opus', messages: [{ role: 'user', content: 'hi' }] }
    });

    expect(res.status).toBe(400);
  });
});
