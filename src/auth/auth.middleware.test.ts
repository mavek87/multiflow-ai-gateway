import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createTestAppEmpty, createTestAppWithTenantAndProvider, sendRequest, mockFetch, mockJsonResponse } from '@test/test-setup';
import type { TenantStore } from '@/tenant/tenant.store';
import { CHAT_COMPLETIONS_PATH } from '@/chat/chat.constants';
import { createFakeChatCompletionResponse } from '@test/fixtures/chat-fixtures';

describe('chat auth guard', () => {
  let app: ReturnType<typeof createTestAppEmpty>['app'];
  let tenantStore: TenantStore;

  beforeEach(() => {
    ({ app, tenantStore } = createTestAppEmpty());
  });

  const VALID_BODY = { messages: [{ role: 'user', content: 'hi' }] };

  test('returns 401 when Authorization header is missing', async () => {
    const res = await sendRequest(app, CHAT_COMPLETIONS_PATH, { method: 'POST', body: VALID_BODY });
    expect(res.status).toBe(401);
  });

  test('returns 401 for wrong key', async () => {
    const res = await sendRequest(app, CHAT_COMPLETIONS_PATH, { method: 'POST', body: VALID_BODY, apiKey: 'wrong' });
    expect(res.status).toBe(401);
  });

  test('returns 422 for invalid body (empty messages)', async () => {
    const { rawApiKey } = tenantStore.createTenant('TestCorp');
    const res = await sendRequest(app, CHAT_COMPLETIONS_PATH, {
      method: 'POST', body: { messages: [] }, apiKey: rawApiKey
    });
    expect(res.status).toBe(422);
  });

  test('passes auth for valid key (returns 422 due to no providers)', async () => {
    const { rawApiKey } = tenantStore.createTenant('TestCorp');
    const res = await sendRequest(app, CHAT_COMPLETIONS_PATH, {
      method: 'POST', body: VALID_BODY, apiKey: rawApiKey
    });
    expect(res.status).toBe(422);
  });

  describe('with provider configured', () => {
    let appWithProvider: ReturnType<typeof createTestAppWithTenantAndProvider>['app'];
    let apiKeyWithProvider: string;
    let undoFetch: () => void;

    beforeEach(() => {
      ({ app: appWithProvider, rawApiKey: apiKeyWithProvider } = createTestAppWithTenantAndProvider());
      undoFetch = mockFetch(() => mockJsonResponse(createFakeChatCompletionResponse('ok')));
    });

    afterEach(() => undoFetch());

    test('returns 200 when key is valid', async () => {
      const res = await sendRequest(appWithProvider, CHAT_COMPLETIONS_PATH, {
        method: 'POST', body: VALID_BODY, apiKey: apiKeyWithProvider
      });
      expect(res.status).toBe(200);
    });

    test('returns 401 when key is wrong', async () => {
      const res = await sendRequest(appWithProvider, CHAT_COMPLETIONS_PATH, {
        method: 'POST', body: VALID_BODY, apiKey: 'gw_wrong'
      });
      expect(res.status).toBe(401);
    });
  });
});
