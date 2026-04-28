import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { createTestContext, sendRequest, mockSseResponse } from './test-setup';
import { CryptoService } from '@/crypto/crypto';
import { Elysia } from 'elysia';
import { adminRoutePlugin } from '@/admin/admin.routes';
import { chatRoutePlugin } from '@/chat/chat.routes';
import { MetricsStore } from '@/engine/observability/metrics';

const originalFetch = globalThis.fetch;

function createFullApp(context: ReturnType<typeof createTestContext>) {
  const { tenantStore, providerStore, auditStore, metricsStore } = context;
  const cryptoService = new CryptoService();
  return new Elysia()
    .get('/health', () => ({ status: 'ok', timestamp: new Date().toISOString() }))
    .use(adminRoutePlugin(tenantStore, providerStore, cryptoService, auditStore))
    .use(chatRoutePlugin(tenantStore, auditStore, metricsStore, cryptoService));
}

describe('Full System Integration', () => {
  let context: ReturnType<typeof createTestContext>;
  let app: ReturnType<typeof createFullApp>;
  const masterKey = process.env.MASTER_KEY || 'test-master-key';

  beforeEach(() => {
    context = createTestContext();
    app = createFullApp(context);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('Health check works', async () => {
    const res = await app.handle(new Request('http://localhost/health'));
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.status).toBe('ok');
  });

  test('Security: Unauthorized access is blocked', async () => {
    const adminRes = await sendRequest(app as any, '/admin/tenants', { method: 'GET' });
    expect(adminRes.status).toBe(403);

    const chatRes1 = await sendRequest(app as any, '/v1/chat/completions', {
      method: 'POST',
      body: { messages: [{ role: 'user', content: 'hi' }] }
    });
    expect(chatRes1.status).toBe(401);

    const chatRes2 = await sendRequest(app as any, '/v1/chat/completions', {
      method: 'POST',
      apiKey: 'invalid-key',
      body: { messages: [{ role: 'user', content: 'hi' }] }
    });
    expect(chatRes2.status).toBe(401);
  });

  test('Full Lifecycle: Provisioning -> Usage -> Audit', async () => {
    // 1. Create Provider
    const provRes = await sendRequest(app as any, '/admin/providers', {
      method: 'POST',
      masterKey,
      body: { name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1' }
    });
    expect(provRes.status).toBe(201);
    const provider = await provRes.json() as any;

    // 2. Add Model
    const modelRes = await sendRequest(app as any, `/admin/providers/${provider.id}/models`, {
      method: 'POST',
      masterKey,
      body: { modelName: 'gpt-4o' }
    });
    expect(modelRes.status).toBe(201);
    const model = await modelRes.json() as any;

    // 3. Create Tenant
    const tenantRes = await sendRequest(app as any, '/admin/tenants', {
      method: 'POST',
      masterKey,
      body: { name: 'E2E-Client' }
    });
    expect(tenantRes.status).toBe(201);
    const { tenantId, apiKey } = await tenantRes.json() as any;

    // 4. Link Tenant to Provider
    const credRes = await sendRequest(app as any, `/admin/tenants/${tenantId}/credentials`, {
      method: 'POST',
      masterKey,
      body: { aiProviderId: provider.id, apiKey: 'sk-test-123' }
    });
    expect(credRes.status).toBe(201);

    // 5. Set Model Priority
    const prioRes = await sendRequest(app as any, `/admin/tenants/${tenantId}/models`, {
      method: 'POST',
      masterKey,
      body: { aiProviderModelId: model.id, priority: 100 }
    });
    expect(prioRes.status).toBe(201);

    // 6. Use Chat API
    // @ts-ignore
    globalThis.fetch = async () => mockSseResponse('Integration success');

    const chatRes = await sendRequest(app as any, '/v1/chat/completions', {
      method: 'POST',
      apiKey: apiKey,
      body: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }]
      }
    });

    expect(chatRes.status).toBe(200);
    const chatBody = await chatRes.json() as any;
    expect(chatBody.choices[0].message.content).toBe('Integration success');

    // 7. Verify Audit Log via DB
    const auditRes = await sendRequest(app as any, `/admin/audit?tenantId=${tenantId}`, { masterKey });
    expect(auditRes.status).toBe(200);
    const auditEntries = await auditRes.json() as any[];
    expect(auditEntries.length).toBeGreaterThan(0);
    expect(auditEntries[0]!.tenantId).toBe(tenantId);
    expect(auditEntries[0]!.success).toBe(true);
  });
});
