import { describe, test, expect, afterEach, beforeEach } from 'bun:test';
import { createTestAppWithTenantAndProvider, createTestAppEmpty, sendRequest, mockSseResponse, mockFetch } from './test-setup';

describe('Full System Integration', () => {
  let app: ReturnType<typeof createTestAppWithTenantAndProvider>['app'];
  let rawApiKey: string;
  let tenantId: string;
  let undoFetch: () => void;
  const masterKey = process.env.MASTER_KEY || 'test-master-key';

  beforeEach(() => {
    const testApp = createTestAppWithTenantAndProvider();
    app = testApp.app;
    rawApiKey = testApp.rawApiKey;
    tenantId = testApp.tenant.id;
    undoFetch = mockFetch(() => new Response(''));
  });

  afterEach(() => {
    undoFetch();
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

  test('Full Lifecycle: Provisioning via HTTP', async () => {
    const { app: emptyApp } = createTestAppEmpty();

    const provRes = await sendRequest(emptyApp as any, '/admin/providers', {
      method: 'POST',
      masterKey,
      body: { name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1' }
    });
    expect(provRes.status).toBe(201);
    const provider = await provRes.json() as any;

    const modelRes = await sendRequest(emptyApp as any, `/admin/providers/${provider.id}/models`, {
      method: 'POST',
      masterKey,
      body: { modelName: 'gpt-4o' }
    });
    expect(modelRes.status).toBe(201);
    const model = await modelRes.json() as any;

    const tenantRes = await sendRequest(emptyApp as any, '/admin/tenants', {
      method: 'POST',
      masterKey,
      body: { name: 'E2E-Client' }
    });
    expect(tenantRes.status).toBe(201);
    const { tenantId: newTenantId, apiKey } = await tenantRes.json() as any;

    const credRes = await sendRequest(emptyApp as any, `/admin/tenants/${newTenantId}/credentials`, {
      method: 'POST',
      masterKey,
      body: { aiProviderId: provider.id, apiKey: 'sk-test-123' }
    });
    expect(credRes.status).toBe(201);

    const prioRes = await sendRequest(emptyApp as any, `/admin/tenants/${newTenantId}/models`, {
      method: 'POST',
      masterKey,
      body: { aiProviderModelId: model.id, priority: 100 }
    });
    expect(prioRes.status).toBe(201);

    undoFetch();
    undoFetch = mockFetch(() => mockSseResponse('Provisioning success'));

    const chatRes = await sendRequest(emptyApp as any, '/v1/chat/completions', {
      method: 'POST',
      apiKey,
      body: { model: 'gpt-4o', messages: [{ role: 'user', content: 'hello' }] }
    });
    expect(chatRes.status).toBe(200);
    const chatBody = await chatRes.json() as any;
    expect(chatBody.choices[0].message.content).toBe('Provisioning success');
  });

  test('Full Lifecycle: Usage -> Audit', async () => {
    undoFetch();
    undoFetch = mockFetch(() => mockSseResponse('Integration success'));

    const chatRes = await sendRequest(app as any, '/v1/chat/completions', {
      method: 'POST',
      apiKey: rawApiKey,
      body: {
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }]
      }
    });

    expect(chatRes.status).toBe(200);
    const chatBody = await chatRes.json() as any;
    expect(chatBody.choices[0].message.content).toBe('Integration success');

    const auditRes = await sendRequest(app as any, `/admin/audit?tenantId=${tenantId}`, { masterKey });
    expect(auditRes.status).toBe(200);
    const auditEntries = await auditRes.json() as any[];
    expect(auditEntries.length).toBeGreaterThan(0);
    expect(auditEntries[0]!.tenantId).toBe(tenantId);
    expect(auditEntries[0]!.success).toBe(true);
  });
});