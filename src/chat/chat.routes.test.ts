import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { createTestContext, createTestApp, createTestAppWithTenantAndProvider, createTestAppWithMultipleModels, sendRequest, mockSseResponse, mockJsonResponse, mockFetch } from '@test/test-setup';
import { CryptoService } from '@/crypto/crypto';
import { MULTIFLOW_AUTO_MODEL } from '@/tenant/tenant.types';

import { createFakeChatCompletionResponse } from '@test/fixtures/chat-fixtures';

function mockChatJson(content: string) {
  return mockJsonResponse(createFakeChatCompletionResponse(content));
}

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
    undoFetch = mockFetch(() => mockChatJson('Hello from gateway'));

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
      undoFetch = mockFetch(() => mockChatJson('ok'));

      const res = await sendRequest(app, '/v1/chat/completions', {
        method: 'POST',
        apiKey: rawApiKey,
        body: { messages: [{ role: 'user', content: 'hi' }] }
      });

      expect(res.status).toBe(200);
    });

    test('routes correctly with provider/model format', async () => {
      undoFetch();
      undoFetch = mockFetch(() => mockChatJson('ok'));

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
      undoFetch = mockFetch(() => mockChatJson('ok'));

      const res = await sendRequest(app, '/v1/chat/completions', {
        method: 'POST',
        apiKey: rawApiKey,
        body: { model: 'OpenAI/', messages: [{ role: 'user', content: 'hi' }] }
      });

      expect(res.status).toBe(200);
    });

    test(`routes across all tenant models when model is "${MULTIFLOW_AUTO_MODEL}"`, async () => {
      undoFetch();
      undoFetch = mockFetch(() => mockChatJson('ok'));

      const res = await sendRequest(app, '/v1/chat/completions', {
        method: 'POST',
        apiKey: rawApiKey,
        body: { model: MULTIFLOW_AUTO_MODEL, messages: [{ role: 'user', content: 'hi' }] }
      });

      expect(res.status).toBe(200);
    });

    test('returns 400 when model is unknown (auto-model sentinel is the only special case)', async () => {
      const res = await sendRequest(app, '/v1/chat/completions', {
        method: 'POST',
        apiKey: rawApiKey,
        body: { model: 'some-unknown-model', messages: [{ role: 'user', content: 'hi' }] }
      });

      expect(res.status).toBe(400);
    });
  });

  describe('models array routing', () => {
    let multiRawApiKey: string;
    let multiApp: ReturnType<typeof createTestAppWithTenantAndProvider>['app'];

    beforeEach(() => {
      const testApp = createTestAppWithMultipleModels();
      multiRawApiKey = testApp.rawApiKey;
      multiApp = testApp.app;
    });

    test('returns 200 when models array contains valid models', async () => {
      undoFetch();
      undoFetch = mockFetch(() => mockChatJson('ok'));

      const res = await sendRequest(multiApp, '/v1/chat/completions', {
        method: 'POST',
        apiKey: multiRawApiKey,
        body: { models: ['model-a', 'model-b'], messages: [{role: 'user', content: 'hi'}] }
      });

      expect(res.status).toBe(200);
    });

    test('returns 200 with provider/model format in models array', async () => {
      undoFetch();
      undoFetch = mockFetch(() => mockChatJson('ok'));

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
      const { tenantStore, providerStore, auditStore: localAuditStore, metricsStore: localMetricsStore, circuitBreaker: localCircuitBreaker } = createTestContext();
      const emptyTenant = tenantStore.createTenant('Empty');
      const emptyApp = createTestApp(tenantStore, providerStore, localAuditStore, localMetricsStore, localCircuitBreaker, new CryptoService());

      const res = await sendRequest(emptyApp, '/v1/chat/completions', {
        method: 'POST',
        apiKey: emptyTenant.rawApiKey,
        body: { messages: [{ role: 'user', content: 'hi' }] }
      });

      expect(res.status).toBe(422);
    });

    test('returns 429 when tenant daily rate limit is exhausted', async () => {
      const { tenantStore, providerStore, auditStore: localAuditStore, metricsStore: localMetricsStore, circuitBreaker: localCircuitBreaker } = createTestContext();
      const { tenant, rawApiKey: limitedKey } = tenantStore.createTenant('RateLimited');
      tenantStore.updateTenant(tenant.id, { rateLimitDailyRequests: 0 });

      const limitedApp = createTestApp(tenantStore, providerStore, localAuditStore, localMetricsStore, localCircuitBreaker, new CryptoService());

      const res = await sendRequest(limitedApp, '/v1/chat/completions', {
        method: 'POST',
        apiKey: limitedKey,
        body: { messages: [{ role: 'user', content: 'hi' }] }
      });

      expect(res.status).toBe(429);
    });
  });

  describe('tool calling pass-through', () => {
    test('accepts request with tools array and sampling params', async () => {
      undoFetch();
      undoFetch = mockFetch(() => mockJsonResponse({ choices: [{ message: { content: 'sunny', tool_calls: undefined } }] }));

      const res = await sendRequest(app, '/v1/chat/completions', {
        method: 'POST',
        apiKey: rawApiKey,
        body: {
          messages: [{ role: 'user', content: 'weather?' }],
          tools: [{
            type: 'function',
            function: { name: 'get_weather', description: 'Get weather', parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] } },
          }],
          tool_choice: 'auto',
          temperature: 0.7,
          max_tokens: 256,
        },
      });

      expect(res.status).toBe(200);
    });

    test('returns tool_calls and finish_reason tool_calls when provider responds with tool call', async () => {
      const toolCall = { id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Rome"}' } };
      undoFetch();
      undoFetch = mockFetch(() => mockJsonResponse({
        choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [toolCall] }, finish_reason: 'tool_calls' }],
      }));

      const res = await sendRequest(app, '/v1/chat/completions', {
        method: 'POST',
        apiKey: rawApiKey,
        body: {
          messages: [{ role: 'user', content: 'weather in Rome?' }],
          tools: [{ type: 'function', function: { name: 'get_weather', parameters: {} } }],
        },
      });

      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(body.choices[0].finish_reason).toBe('tool_calls');
      expect(body.choices[0].message.content).toBeNull();
      expect(body.choices[0].message.tool_calls).toHaveLength(1);
      expect(body.choices[0].message.tool_calls[0].function.name).toBe('get_weather');
    });

    test('accepts assistant message with null content (tool call history)', async () => {
      undoFetch();
      undoFetch = mockFetch(() => mockChatJson('done'));

      const res = await sendRequest(app, '/v1/chat/completions', {
        method: 'POST',
        apiKey: rawApiKey,
        body: {
          messages: [
            { role: 'user', content: 'weather?' },
            { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_weather', arguments: '{}' } }] },
            { role: 'tool', content: 'sunny', tool_call_id: 'c1' },
          ],
        },
      });

      expect(res.status).toBe(200);
    });

    test('accepts arguments as JSON string (OpenAI spec)', async () => {
      undoFetch();
      undoFetch = mockFetch(() => mockChatJson('ok'));

      const res = await sendRequest(app, '/v1/chat/completions', {
        method: 'POST',
        apiKey: rawApiKey,
        body: {
          messages: [
            { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'foo', arguments: '{"x":1}' } }] },
            { role: 'tool', content: 'result', tool_call_id: 'c1' },
            { role: 'user', content: 'ok' },
          ],
        },
      });

      expect(res.status).toBe(200);
    });

    test('returns 422 when arguments is not a string', async () => {
      const res = await sendRequest(app, '/v1/chat/completions', {
        method: 'POST',
        apiKey: rawApiKey,
        body: {
          messages: [
            { role: 'assistant', content: null, tool_calls: [{ id: 'c1', type: 'function', function: { name: 'foo', arguments: { x: 1 } } }] },
            { role: 'user', content: 'ok' },
          ],
        },
      });

      expect(res.status).toBe(422);
    });
  });
});