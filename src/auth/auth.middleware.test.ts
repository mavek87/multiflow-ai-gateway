import { describe, test, expect, beforeEach } from 'bun:test';
import { createTestContext, createTestApp, sendRequest } from '@test/test-setup';
import { CryptoService } from '@/crypto/crypto';
import type { TenantStore } from '@/tenant/tenant.store';

describe('chat auth guard', () => {
  let app: ReturnType<typeof createTestApp>;
  let tenantStore: TenantStore;

  beforeEach(() => {
    const context = createTestContext();
    tenantStore = context.tenantStore;
    app = createTestApp(tenantStore, context.providerStore, new CryptoService());
  });

  const VALID_BODY = { messages: [{ role: 'user', content: 'hi' }] };

  test('returns 401 when Authorization header is missing', async () => {
    const res = await sendRequest(app, '/v1/chat/completions', { method: 'POST', body: VALID_BODY });
    expect(res.status).toBe(401);
  });

  test('returns 401 for wrong key', async () => {
    const res = await sendRequest(app, '/v1/chat/completions', { method: 'POST', body: VALID_BODY, apiKey: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('returns 422 for invalid body (empty messages)', async () => {
    const { rawApiKey } = tenantStore.createTenant('TestCorp');
    const res = await sendRequest(app, '/v1/chat/completions', {
      method: 'POST', body: { messages: [] }, apiKey: rawApiKey
    });
    expect(res.status).toBe(422);
  });

  test('passes auth for valid key (returns 422 due to no providers)', async () => {
    const { rawApiKey } = tenantStore.createTenant('TestCorp');
    const res = await sendRequest(app, '/v1/chat/completions', {
      method: 'POST', body: VALID_BODY, apiKey: rawApiKey
    });
    expect(res.status).toBe(422);
  });
});
