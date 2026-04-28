import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { createTestContext, createTestApp, createTestAppWithTenantAndProvider, createTestAppWithMultipleModels, sendRequest, mockSseResponse, mockFetch } from '@test/test-setup';
import { CryptoService } from '@/crypto/crypto';


describe('chatPlugin E2E', () => {
  let app: ReturnType<typeof createTestAppWithTenantAndProvider>['app'];
  let rawApiKey: string;
  let undoFetch: () => void;

  beforeEach(() => {
    const testApp = createTestAppWithTenantAndProvider();
    app = testApp.app;
    rawApiKey = testApp.rawApiKey;
    undoFetch = mockFetch(() => new Response('')); // Default empty mock
  });

  afterEach(() => {
    undoFetch();
  });

  test('returns 200 OK with correct response format for standard chat', async () => {
    undoFetch();
    undoFetch = mockFetch(() => mockSseResponse('Hello from gateway'));

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
    undoFetch();
    undoFetch = mockFetch(() => mockSseResponse('Stream message'));

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

  describe('model field routing', () => {
    test('routes correctly when model is omitted (uses all tenant providers)', async () => {
      undoFetch();
      undoFetch = mockFetch(() => mockSseResponse('ok'));

      const res = await sendRequest(app, '/v1/chat/completions', {
        method: 'POST',
        apiKey: rawApiKey,
        body: { messages: [{ role: 'user', content: 'hi' }] }
      });

      expect(res.status).toBe(200);
    });

    test('routes correctly with provider/model format', async () => {
      undoFetch();
      undoFetch = mockFetch(() => mockSseResponse('ok'));

      const res = await sendRequest(app, '/v1/chat/completions', {
        method: 'POST',
        apiKey: rawApiKey,
        body: { model: 'OpenAI/gpt-4o', messages: [{ role: 'user', content: 'hi' }] }
      });

      expect(res.status).toBe(200);
    });

    test('returns 400 when provider in provider/model format does not match any configured provider', async () => {
      const res = await sendRequest(app, '/v1/chat/completions', {
        method: 'POST',
        apiKey: rawApiKey,
        body: { model: 'Groq/gpt-4o', messages: [{ role: 'user', content: 'hi' }] }
      });

      expect(res.status).toBe(400);
    });

    test('returns 400 when model in provider/model format does not match any configured model', async () => {
      const res = await sendRequest(app, '/v1/chat/completions', {
        method: 'POST',
        apiKey: rawApiKey,
        body: { model: 'OpenAI/gpt-99', messages: [{ role: 'user', content: 'hi' }] }
      });

      expect(res.status).toBe(400);
    });

    test('routes correctly with provider-only format (no model specified after slash)', async () => {
      undoFetch();
      undoFetch = mockFetch(() => mockSseResponse('ok'));

      const res = await sendRequest(app, '/v1/chat/completions', {
        method: 'POST',
        apiKey: rawApiKey,
        body: { model: 'OpenAI/', messages: [{ role: 'user', content: 'hi' }] }
      });

      expect(res.status).toBe(200);
    });
  });

  describe('models array routing', () => {
    let multiRawApiKey: string;
    let multiApp: ReturnType<typeof createTestAppWithTenantAndProvider>['app'];
    let multiUndoFetch: () => void;

    beforeEach(() => {
      const testApp = createTestAppWithMultipleModels();
      multiRawApiKey = testApp.rawApiKey;
      multiApp = testApp.app;
      multiUndoFetch = mockFetch(() => new Response(''));
    });

    afterEach(() => {
      multiUndoFetch();
    });

    test('returns 200 when models array contains valid models', async () => {
      multiUndoFetch();
      multiUndoFetch = mockFetch(() => mockSseResponse('ok'));

      const res = await sendRequest(multiApp, '/v1/chat/completions', {
        method: 'POST',
        apiKey: multiRawApiKey,
        body: { models: ['model-a', 'model-b'], messages: [{role: 'user', content: 'hi'}] }
      });

      expect(res.status).toBe(200);
    });

    test('returns 200 with provider/model format in models array', async () => {
      multiUndoFetch();
      multiUndoFetch = mockFetch(() => mockSseResponse('ok'));

      const res = await sendRequest(multiApp, '/v1/chat/completions', {
        method: 'POST',
        apiKey: multiRawApiKey,
        body: { models: ['ProviderA/model-a'], messages: [{role: 'user', content: 'hi'}] }
      });

      expect(res.status).toBe(200);
    });

    test('returns 400 when models array contains no valid models', async () => {
      const res = await sendRequest(multiApp, '/v1/chat/completions', {
        method: 'POST',
        apiKey: multiRawApiKey,
        body: { models: ['unknown-model'], messages: [{role: 'user', content: 'hi'}] }
      });

      expect(res.status).toBe(400);
    });

    test('returns 400 when both model and models are provided', async () => {
      const res = await sendRequest(multiApp, '/v1/chat/completions', {
        method: 'POST',
        apiKey: multiRawApiKey,
        body: { model: 'model-a', models: ['model-b'], messages: [{role: 'user', content: 'hi'}] }
      });

      expect(res.status).toBe(400);
    });
  });

  describe('error responses', () => {
    test('returns 422 when tenant has no providers configured', async () => {
      const { tenantStore, providerStore, auditStore: localAuditStore, metricsStore: localMetricsStore } = createTestContext();
      const emptyTenant = tenantStore.createTenant('Empty');
      const emptyApp = createTestApp(tenantStore, providerStore, localAuditStore, localMetricsStore, new CryptoService());

      const res = await sendRequest(emptyApp, '/v1/chat/completions', {
        method: 'POST',
        apiKey: emptyTenant.rawApiKey,
        body: { messages: [{ role: 'user', content: 'hi' }] }
      });

      expect(res.status).toBe(422);
    });

    test('returns 429 when tenant daily rate limit is exhausted', async () => {
      const { tenantStore, providerStore, auditStore: localAuditStore, metricsStore: localMetricsStore } = createTestContext();
      const { tenant, rawApiKey: limitedKey } = tenantStore.createTenant('RateLimited');
      tenantStore.updateTenant(tenant.id, { rateLimitDailyRequests: 0 });

      const limitedApp = createTestApp(tenantStore, providerStore, localAuditStore, localMetricsStore, new CryptoService());

      const res = await sendRequest(limitedApp, '/v1/chat/completions', {
        method: 'POST',
        apiKey: limitedKey,
        body: { messages: [{ role: 'user', content: 'hi' }] }
      });

      expect(res.status).toBe(429);
    });
  });
});