import { describe, test, expect, beforeAll, beforeEach } from 'bun:test';
import { chatRoutePlugin } from '@/chat/chat.routes';
import { Elysia } from 'elysia';
import { createTestContext, ensureTestEncryptionKey } from '@test/test-setup';
import type { TenantStore } from '@/tenant/tenant.store';

beforeAll(() => {
  ensureTestEncryptionKey();
});

function makeApp(store: TenantStore) {
  return new Elysia().use(chatRoutePlugin(store));
}

const VALID_BODY = JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] });

describe('chat auth guard', () => {
  let app: ReturnType<typeof makeApp>;
  let store: TenantStore;

  beforeEach(() => {
    const context = createTestContext();
    store = context.tenantStore;
    app = makeApp(store);
  });

  test('returns 401 when Authorization header is missing', async () => {
    const res = await app.handle(new Request('http://localhost/v1/chat/completions', {
      method: 'POST', body: VALID_BODY, headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(401);
  });

  test('returns 401 for wrong key', async () => {
    const res = await app.handle(new Request('http://localhost/v1/chat/completions', {
      method: 'POST', body: VALID_BODY,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer gw_wrongkey' },
    }));
    expect(res.status).toBe(401);
  });

  test('returns 422 for invalid body (empty messages)', async () => {
    const { rawApiKey } = store.createTenant('TestCorp');
    const res = await app.handle(new Request('http://localhost/v1/chat/completions', {
      method: 'POST', body: JSON.stringify({ messages: [] }),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawApiKey}` },
    }));
    expect(res.status).toBe(422);
  });

  test('passes auth for valid key (returns 422 due to no providers)', async () => {
    const { rawApiKey } = store.createTenant('TestCorp');
    const res = await app.handle(new Request('http://localhost/v1/chat/completions', {
      method: 'POST', body: VALID_BODY,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawApiKey}` },
    }));
    expect(res.status).toBe(422);
  });
});
