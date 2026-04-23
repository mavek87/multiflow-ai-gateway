import { describe, test, expect, beforeAll, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from '@/db/schema';
import { TenantStore } from '@/tenant/tenant.store';
import { chatRoutePlugin } from './chat.routes';
import { Elysia } from 'elysia';

import { ProviderStore } from '@/provider/provider.store';

beforeAll(() => {
  process.env['ENCRYPTION_KEY'] = 'c'.repeat(64);
});

function makeApp() {
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys=ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' });
  const store = new TenantStore(db);
  const providerStore = new ProviderStore(db);
  
  const { tenant, rawApiKey } = store.createTenant('TestCorp');
  
  const provider = providerStore.createProvider({ name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1' })._unsafeUnwrap();
  const providerModel = providerStore.createProviderModel({ aiProviderId: provider.id, modelName: 'gpt-4o' })._unsafeUnwrap();
  
  store.assignAiProviderKey(tenant.id, { aiProviderId: provider.id, apiKey: 'sk-fake-key' });
  store.assignAiModelPriority(tenant.id, { aiProviderModelId: providerModel.id, priority: 10 });

  return { app: new Elysia().use(chatRoutePlugin(store)), rawApiKey };
}

const originalFetch = globalThis.fetch;

describe('chatPlugin E2E', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('returns 200 OK with correct response format for standard chat', async () => {
    const { app, rawApiKey } = makeApp();

    // Mock the external API call
    // @ts-ignore
    globalThis.fetch = async () => {
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Hello from gateway' } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const res = await app.handle(new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawApiKey}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] })
    }));

    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(body.object).toBe('chat.completion');
    expect(body.model).toBe('gpt-4o');
    expect(body.choices[0].message.content).toBe('Hello from gateway');
  });

  test('returns 200 OK event-stream for stream requests', async () => {
    const { app, rawApiKey } = makeApp();

    // @ts-ignore
    globalThis.fetch = async () => {
      const sse = `data: ${JSON.stringify({ choices: [{ delta: { content: 'Stream message' } }] })}\n\ndata: [DONE]\n\n`;
      return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };

    const res = await app.handle(new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawApiKey}` },
      body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], stream: true })
    }));

    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    const text = await res.text();
    expect(text).toContain('Stream message');
  });

  test('returns 400 Bad Request when requested model is not available', async () => {
    const { app, rawApiKey } = makeApp();

    const res = await app.handle(new Request('http://localhost/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawApiKey}` },
      body: JSON.stringify({ model: 'claude-opus', messages: [{ role: 'user', content: 'hi' }] })
    }));

    expect(res.status).toBe(400);
  });
});
