import { describe, test, expect, beforeEach } from 'bun:test';
import { createTestContext, createTestApp, sendRequest } from '@test/test-setup';
import { CryptoService } from '@/crypto/crypto';
import { config } from '@/config/config';

describe('Admin Routes', () => {
  let app: ReturnType<typeof createTestApp>;
  const MASTER_KEY = config.masterKey;

  beforeEach(() => {
    const { tenantStore, providerStore, auditStore } = createTestContext();
    app = createTestApp(tenantStore, providerStore, new CryptoService(), auditStore);
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
    const { auditStore } = createTestContext();
    const { tenantStore, providerStore, auditStore: localAuditStore } = createTestContext();
    const localApp = createTestApp(tenantStore, providerStore, new CryptoService(), localAuditStore);

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
    const { tenantStore, providerStore, auditStore: localAuditStore } = createTestContext();
    const localApp = createTestApp(tenantStore, providerStore, new CryptoService(), localAuditStore);

    localAuditStore.log({ tenantId: 'tenant-a', aiProvider: { id: 'p1', name: 'Groq' }, model: 'llama3', latencyMs: 100, success: true, statusCode: 200 });
    localAuditStore.log({ tenantId: 'tenant-b', aiProvider: { id: 'p1', name: 'Groq' }, model: 'gpt-4', latencyMs: 200, success: true, statusCode: 200 });

    const res = await sendRequest(localApp, '/admin/audit?tenantId=tenant-a', { masterKey: MASTER_KEY });
    const body = await res.json() as any[];
    expect(body.length).toBe(1);
    expect(body[0].tenantId).toBe('tenant-a');
  });
});
