import { describe, test, expect, beforeEach } from 'bun:test';
import { createTestContext, createTestApp, sendRequest } from '@test/test-setup';
import { CryptoService } from '@/crypto/crypto';
import { config } from '@/config/config';
describe('Admin Routes', () => {
  let app: ReturnType<typeof createTestApp>;
  const MASTER_KEY = config.masterKey;

  beforeEach(() => {
    const { tenantStore, providerStore } = createTestContext();
    app = createTestApp(tenantStore, providerStore, new CryptoService());
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
});
