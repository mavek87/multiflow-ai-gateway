import { describe, test, expect, beforeAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from '@/db/schema';
import { TenantStore } from '@/tenant/tenant.store';
import { chatRoutePlugin } from '@/chat/chat.routes';
import { Elysia } from 'elysia';

beforeAll(() => {
  process.env['ENCRYPTION_KEY'] = 'c'.repeat(64);
});

const VALID_BODY = JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] });

function makeApp() {
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys=ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' });
  const store = new TenantStore(db);
  return { app: new Elysia().use(chatRoutePlugin(store)), store };
}

describe('chat auth guard', () => {
  test('returns 401 when Authorization header is missing', async () => {
    const { app } = makeApp();
    const res = await app.handle(new Request('http://localhost/v1/chat/completions', {
      method: 'POST', body: VALID_BODY, headers: { 'Content-Type': 'application/json' },
    }));
    expect(res.status).toBe(401);
  });

  test('returns 401 for wrong key', async () => {
    const { app } = makeApp();
    const res = await app.handle(new Request('http://localhost/v1/chat/completions', {
      method: 'POST', body: VALID_BODY,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer gw_wrongkey' },
    }));
    expect(res.status).toBe(401);
  });

  test('returns 422 for invalid body (empty messages)', async () => {
    const { app, store } = makeApp();
    const { rawApiKey } = store.createTenant('TestCorp');
    const res = await app.handle(new Request('http://localhost/v1/chat/completions', {
      method: 'POST', body: JSON.stringify({ messages: [] }),
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawApiKey}` },
    }));
    expect(res.status).toBe(422);
  });

  test('passes auth for valid key (returns 422 due to no providers)', async () => {
    const { app, store } = makeApp();
    const { rawApiKey } = store.createTenant('TestCorp');
    const res = await app.handle(new Request('http://localhost/v1/chat/completions', {
      method: 'POST', body: VALID_BODY,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${rawApiKey}` },
    }));
    expect(res.status).toBe(422);
  });
});
