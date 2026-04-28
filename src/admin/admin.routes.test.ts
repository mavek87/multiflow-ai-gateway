import { describe, test, expect, beforeEach } from 'bun:test';
import { createTestAppEmpty, sendRequest } from '@test/test-setup';
import { config } from '@/config/config';

describe('Admin Routes', () => {
  let app: ReturnType<typeof createTestAppEmpty>['app'];
  const MASTER_KEY = config.masterKey;

  beforeEach(() => {
    ({ app } = createTestAppEmpty());
  });

  test('GET /admin/tenants returns 403 without master key', async () => {
    const res = await sendRequest(app, '/admin/tenants');
    expect(res.status).toBe(403);
  });

  test('GET /admin/tenants returns 200 with master key', async () => {
    const res = await sendRequest(app, '/admin/tenants', { masterKey: MASTER_KEY });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  test('POST /admin/tenants creates a new tenant', async () => {
    const res = await sendRequest(app, '/admin/tenants', {
      method: 'POST',
      masterKey: MASTER_KEY,
      body: { name: 'NewCorp' }
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.name).toBe('NewCorp');
    expect(body.apiKey).toMatch(/^gw_/);
  });

  test('POST /admin/providers creates a global provider', async () => {
    const res = await sendRequest(app, '/admin/providers', {
      method: 'POST',
      masterKey: MASTER_KEY,
      body: { name: 'Anthropic', type: 'openai', baseUrl: 'https://api.anthropic.com/v1' }
    });
    expect(res.status).toBe(201);
    const body = await res.json() as any;
    expect(body.name).toBe('Anthropic');
  });

  test('PATCH /admin/tenants/:id sets rateLimitDailyRequests', async () => {
    const createRes = await sendRequest(app, '/admin/tenants', {
      method: 'POST',
      masterKey: MASTER_KEY,
      body: { name: 'LimitedTenant' }
    });
    const created = await createRes.json() as any;

    const patchRes = await sendRequest(app, `/admin/tenants/${created.tenantId}`, {
      method: 'PATCH',
      masterKey: MASTER_KEY,
      body: { rateLimitDailyRequests: 100 }
    });
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json() as any;
    expect(updated.rateLimitDailyRequests).toBe(100);
  });

  test('PATCH /admin/tenants/:id removes rateLimitDailyRequests when set to null', async () => {
    const createRes = await sendRequest(app, '/admin/tenants', {
      method: 'POST',
      masterKey: MASTER_KEY,
      body: { name: 'UnlimitedTenant' }
    });
    const created = await createRes.json() as any;

    await sendRequest(app, `/admin/tenants/${created.tenantId}`, {
      method: 'PATCH',
      masterKey: MASTER_KEY,
      body: { rateLimitDailyRequests: 50 }
    });

    const patchRes = await sendRequest(app, `/admin/tenants/${created.tenantId}`, {
      method: 'PATCH',
      masterKey: MASTER_KEY,
      body: { rateLimitDailyRequests: null }
    });
    expect(patchRes.status).toBe(200);
    const updated = await patchRes.json() as any;
    expect(updated.rateLimitDailyRequests).toBeNull();
  });

  test('GET /admin/audit returns empty array initially', async () => {
    const res = await sendRequest(app, '/admin/audit', { masterKey: MASTER_KEY });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBe(0);
  });

  test('GET /admin/audit returns logged entries', async () => {
    const { app: localApp, auditStore: localAuditStore } = createTestAppEmpty();

    localAuditStore.log({
      tenantId: 'test-tenant',
      aiProvider: { id: 'p1', name: 'Groq' },
      model: 'llama3',
      latencyMs: 100,
      success: true,
      statusCode: 200,
    });

    const res = await sendRequest(localApp, '/admin/audit', { masterKey: MASTER_KEY });
    expect(res.status).toBe(200);
    const body = await res.json() as any[];
    expect(body.length).toBe(1);
    expect(body[0].model).toBe('llama3');
    expect(body[0].aiProviderName).toBe('Groq');
  });

  test('GET /admin/audit filters by tenantId', async () => {
    const { app: localApp, auditStore: localAuditStore } = createTestAppEmpty();

    localAuditStore.log({ tenantId: 'tenant-a', aiProvider: { id: 'p1', name: 'Groq' }, model: 'llama3', latencyMs: 100, success: true, statusCode: 200 });
    localAuditStore.log({ tenantId: 'tenant-b', aiProvider: { id: 'p1', name: 'Groq' }, model: 'gpt-4', latencyMs: 200, success: true, statusCode: 200 });

    const res = await sendRequest(localApp, '/admin/audit?tenantId=tenant-a', { masterKey: MASTER_KEY });
    const body = await res.json() as any[];
    expect(body.length).toBe(1);
    expect(body[0].tenantId).toBe('tenant-a');
  });

  describe('Phase A/B newly added endpoints', () => {
    test('DELETE /admin/tenants/:id', async () => {
      const res1 = await sendRequest(app, '/admin/tenants', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'ToDel' }});
      const tenant = await res1.json() as any;
      const res2 = await sendRequest(app, `/admin/tenants/${tenant.tenantId}`, { method: 'DELETE', masterKey: MASTER_KEY });
      expect(res2.status).toBe(204);
      const res3 = await sendRequest(app, `/admin/tenants/${tenant.tenantId}`, { masterKey: MASTER_KEY });
      expect(res3.status).toBe(404);
    });

    test('PATCH /admin/providers/:id', async () => {
      const res1 = await sendRequest(app, '/admin/providers', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'P1', type: 't1', baseUrl: 'b1' }});
      const provider = await res1.json() as any;
      const res2 = await sendRequest(app, `/admin/providers/${provider.id}`, { method: 'PATCH', masterKey: MASTER_KEY, body: { type: 't2' }});
      expect(res2.status).toBe(200);
      const updated = await res2.json() as any;
      expect(updated.type).toBe('t2');
    });

    test('DELETE /admin/providers/:id', async () => {
      const res1 = await sendRequest(app, '/admin/providers', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'P2', type: 't1', baseUrl: 'b1' }});
      const provider = await res1.json() as any;
      const res2 = await sendRequest(app, `/admin/providers/${provider.id}`, { method: 'DELETE', masterKey: MASTER_KEY });
      expect(res2.status).toBe(204);
    });

    test('PATCH /admin/providers/:providerId/models/:modelId', async () => {
      const res1 = await sendRequest(app, '/admin/providers', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'P3', type: 't1', baseUrl: 'b1' }});
      const provider = await res1.json() as any;
      const res2 = await sendRequest(app, `/admin/providers/${provider.id}/models`, { method: 'POST', masterKey: MASTER_KEY, body: { modelName: 'm1' }});
      const model = await res2.json() as any;
      const res3 = await sendRequest(app, `/admin/providers/${provider.id}/models/${model.id}`, { method: 'PATCH', masterKey: MASTER_KEY, body: { enabled: false }});
      expect(res3.status).toBe(200);
      const updated = await res3.json() as any;
      expect(updated.enabled).toBe(false);
    });

    test('DELETE /admin/providers/:providerId/models/:modelId', async () => {
      const res1 = await sendRequest(app, '/admin/providers', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'P4', type: 't1', baseUrl: 'b1' }});
      const provider = await res1.json() as any;
      const res2 = await sendRequest(app, `/admin/providers/${provider.id}/models`, { method: 'POST', masterKey: MASTER_KEY, body: { modelName: 'm1' }});
      const model = await res2.json() as any;
      const res3 = await sendRequest(app, `/admin/providers/${provider.id}/models/${model.id}`, { method: 'DELETE', masterKey: MASTER_KEY });
      expect(res3.status).toBe(204);
    });

    test('PATCH /admin/tenants/:id/credentials/:credentialId', async () => {
      const resT = await sendRequest(app, '/admin/tenants', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'T1' }});
      const tenant = await resT.json() as any;
      const resP = await sendRequest(app, '/admin/providers', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'P1', type: 't1', baseUrl: 'b1' }});
      const provider = await resP.json() as any;
      const resC = await sendRequest(app, `/admin/tenants/${tenant.tenantId}/credentials`, { method: 'POST', masterKey: MASTER_KEY, body: { aiProviderId: provider.id, apiKey: 'abc' }});
      const cred = await resC.json() as any;
      const resPatch = await sendRequest(app, `/admin/tenants/${tenant.tenantId}/credentials/${cred.id}`, { method: 'PATCH', masterKey: MASTER_KEY, body: { enabled: false }});
      expect(resPatch.status).toBe(200);
      const updated = await resPatch.json() as any;
      expect(updated.enabled).toBe(false);
    });

    test('DELETE /admin/tenants/:id/credentials/:credentialId', async () => {
      const resT = await sendRequest(app, '/admin/tenants', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'T2' }});
      const tenant = await resT.json() as any;
      const resP = await sendRequest(app, '/admin/providers', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'P2', type: 't1', baseUrl: 'b1' }});
      const provider = await resP.json() as any;
      const resC = await sendRequest(app, `/admin/tenants/${tenant.tenantId}/credentials`, { method: 'POST', masterKey: MASTER_KEY, body: { aiProviderId: provider.id, apiKey: 'abc' }});
      const cred = await resC.json() as any;
      const resDel = await sendRequest(app, `/admin/tenants/${tenant.tenantId}/credentials/${cred.id}`, { method: 'DELETE', masterKey: MASTER_KEY });
      expect(resDel.status).toBe(204);
    });

    test('PATCH /admin/tenants/:id/models/:entryId', async () => {
      const resT = await sendRequest(app, '/admin/tenants', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'T3' }});
      const tenant = await resT.json() as any;
      const resP = await sendRequest(app, '/admin/providers', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'P3', type: 't1', baseUrl: 'b1' }});
      const provider = await resP.json() as any;
      const resM = await sendRequest(app, `/admin/providers/${provider.id}/models`, { method: 'POST', masterKey: MASTER_KEY, body: { modelName: 'm1' }});
      const model = await resM.json() as any;
      const resPri = await sendRequest(app, `/admin/tenants/${tenant.tenantId}/models`, { method: 'POST', masterKey: MASTER_KEY, body: { aiProviderModelId: model.id, priority: 1 }});
      const pri = await resPri.json() as any;
      const resPatch = await sendRequest(app, `/admin/tenants/${tenant.tenantId}/models/${pri.id}`, { method: 'PATCH', masterKey: MASTER_KEY, body: { priority: 2, enabled: false }});
      expect(resPatch.status).toBe(200);
      const updated = await resPatch.json() as any;
      expect(updated.priority).toBe(2);
      expect(updated.enabled).toBe(false);
    });

    test('DELETE /admin/tenants/:id/models/:entryId', async () => {
      const resT = await sendRequest(app, '/admin/tenants', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'T4' }});
      const tenant = await resT.json() as any;
      const resP = await sendRequest(app, '/admin/providers', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'P4', type: 't1', baseUrl: 'b1' }});
      const provider = await resP.json() as any;
      const resM = await sendRequest(app, `/admin/providers/${provider.id}/models`, { method: 'POST', masterKey: MASTER_KEY, body: { modelName: 'm1' }});
      const model = await resM.json() as any;
      const resPri = await sendRequest(app, `/admin/tenants/${tenant.tenantId}/models`, { method: 'POST', masterKey: MASTER_KEY, body: { aiProviderModelId: model.id, priority: 1 }});
      const pri = await resPri.json() as any;
      const resDel = await sendRequest(app, `/admin/tenants/${tenant.tenantId}/models/${pri.id}`, { method: 'DELETE', masterKey: MASTER_KEY });
      expect(resDel.status).toBe(204);
    });

    test('GET /admin/tenants/:id/api-keys', async () => {
      const res1 = await sendRequest(app, '/admin/tenants', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'T5' }});
      const tenant = await res1.json() as any;
      const res2 = await sendRequest(app, `/admin/tenants/${tenant.tenantId}/api-keys`, { masterKey: MASTER_KEY });
      expect(res2.status).toBe(200);
      const keys = await res2.json() as any[];
      expect(keys.length).toBeGreaterThan(0);
    });

    test('POST /admin/tenants/:id/api-keys', async () => {
      const res1 = await sendRequest(app, '/admin/tenants', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'T6' }});
      const tenant = await res1.json() as any;
      const res2 = await sendRequest(app, `/admin/tenants/${tenant.tenantId}/api-keys`, { method: 'POST', masterKey: MASTER_KEY });
      expect(res2.status).toBe(201);
      const newKey = await res2.json() as any;
      expect(newKey.keyId).toBeDefined();
    });

    test('DELETE /admin/tenants/:id/api-keys/:keyId', async () => {
      const res1 = await sendRequest(app, '/admin/tenants', { method: 'POST', masterKey: MASTER_KEY, body: { name: 'T7' }});
      const tenant = await res1.json() as any;
      const res2 = await sendRequest(app, `/admin/tenants/${tenant.tenantId}/api-keys`, { method: 'POST', masterKey: MASTER_KEY });
      const newKey = await res2.json() as any;
      const res3 = await sendRequest(app, `/admin/tenants/${tenant.tenantId}/api-keys/${newKey.keyId}`, { method: 'DELETE', masterKey: MASTER_KEY });
      expect(res3.status).toBe(204);
    });

    test('GET /admin/metrics', async () => {
      const res = await sendRequest(app, '/admin/metrics', { masterKey: MASTER_KEY });
      expect(res.status).toBe(200);
      const body = await res.json() as any;
      expect(typeof body).toBe('object');
      expect(Array.isArray(body)).toBe(false);
    });

    test('GET /admin/circuit-breakers', async () => {
      const res = await sendRequest(app, '/admin/circuit-breakers', { masterKey: MASTER_KEY });
      expect(res.status).toBe(200);
    });
  });
});
