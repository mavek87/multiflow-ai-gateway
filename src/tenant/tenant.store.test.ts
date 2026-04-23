import { describe, test, expect, beforeEach, beforeAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from '@/db/schema';
import { TenantStore } from './tenant.store';
import { ProviderStore } from '@/provider/provider.store';

beforeAll(() => {
  process.env['ENCRYPTION_KEY'] = 'b'.repeat(64);
});

function makeDb() {
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys=ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' });
  return db;
}

describe('TenantStore', () => {
  let store: TenantStore;
  let providerStore: ProviderStore;

  beforeEach(() => {
    const db = makeDb();
    store = new TenantStore(db);
    providerStore = new ProviderStore(db);
  });

  test('createTenant returns tenant and raw API key', () => {
    const { tenant, rawApiKey } = store.createTenant('Acme');
    expect(tenant.name).toBe('Acme');
    expect(tenant.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rawApiKey).toMatch(/^gw_/);
  });

  test('getTenantByApiKey returns tenant on hit', () => {
    const { tenant, rawApiKey } = store.createTenant('Acme');
    const found = store.getTenantByApiKey(rawApiKey);
    expect(found?.id).toBe(tenant.id);
    expect(found?.name).toBe('Acme');
  });

  test('getTenantByApiKey returns null on miss', () => {
    expect(store.getTenantByApiKey('gw_wrongkey')).toBeNull();
  });

  test('getDecryptedModelConfigs returns joined config with decrypted key', () => {
    const { tenant } = store.createTenant('Acme');
    const p = providerStore.createProvider({ name: 'Groq', type: 'groq', baseUrl: 'https://api.groq.com/openai/v1' })._unsafeUnwrap();
    const m = providerStore.createProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' })._unsafeUnwrap();
    store.assignAiProviderKey(tenant.id, { aiProviderId: p.id, apiKey: 'sk-groq-secret' });
    store.assignAiModelPriority(tenant.id, { aiProviderModelId: m.id, priority: 0 });

    const configs = store.getDecryptedModelConfigs(tenant.id);
    expect(configs).toHaveLength(1);
    expect(configs[0]!.modelName).toBe('llama3-70b');
    expect(configs[0]!.apiKeyPlain).toBe('sk-groq-secret');
    expect(configs[0]!.baseUrl).toBe('https://api.groq.com/openai/v1');
  });

  test('getDecryptedModelConfigs returns null apiKeyPlain for keyless provider', () => {
    const { tenant } = store.createTenant('Acme');
    const p = providerStore.createProvider({ name: 'Ollama', type: 'ollama', baseUrl: 'http://localhost:11434/v1' })._unsafeUnwrap();
    const m = providerStore.createProviderModel({ aiProviderId: p.id, modelName: 'qwen3-6' })._unsafeUnwrap();
    store.assignAiProviderKey(tenant.id, { aiProviderId: p.id });
    store.assignAiModelPriority(tenant.id, { aiProviderModelId: m.id, priority: 0 });

    const configs = store.getDecryptedModelConfigs(tenant.id);
    expect(configs[0]!.apiKeyPlain).toBeNull();
  });

  test('getDecryptedModelConfigs orders by priority', () => {
    const { tenant } = store.createTenant('Acme');
    const p = providerStore.createProvider({ name: 'Groq', type: 'groq', baseUrl: 'https://api.groq.com/openai/v1' })._unsafeUnwrap();
    const m1 = providerStore.createProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' })._unsafeUnwrap();
    const m2 = providerStore.createProviderModel({ aiProviderId: p.id, modelName: 'llama3-8b' })._unsafeUnwrap();
    store.assignAiProviderKey(tenant.id, { aiProviderId: p.id, apiKey: 'sk-x' });
    store.assignAiModelPriority(tenant.id, { aiProviderModelId: m1.id, priority: 1 });
    store.assignAiModelPriority(tenant.id, { aiProviderModelId: m2.id, priority: 0 });

    const configs = store.getDecryptedModelConfigs(tenant.id);
    expect(configs[0]!.priority).toBe(0);
    expect(configs[1]!.priority).toBe(1);
  });
});
