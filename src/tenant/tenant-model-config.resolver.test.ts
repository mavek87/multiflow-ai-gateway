import { describe, test, expect, beforeAll } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from '@/db/schema';
import { TenantStore } from '@/tenant/tenant.store';
import { TenantModelConfigResolver } from './tenant-model-config.resolver';

beforeAll(() => {
  process.env['ENCRYPTION_KEY'] = 'c'.repeat(64);
});

function createTestSetup() {
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys=ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' });

  const store = new TenantStore(db);
  const { tenant } = store.createTenant('TestTenant');

  const provider = store.createProvider({ name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1' });
  const providerModel = store.createProviderModel({ aiProviderId: provider.id, modelName: 'gpt-4o' });

  store.assignAiProviderKey(tenant.id, { aiProviderId: provider.id, apiKey: 'sk-fake-key' });
  store.assignAiModelPriority(tenant.id, { aiProviderModelId: providerModel.id, priority: 10 });

  const resolver = new TenantModelConfigResolver(store);

  return { store, resolver, tenant };
}

describe('TenantModelConfigResolver', () => {
  test('returns configs when tenant has configured models', () => {
    const { resolver, tenant } = createTestSetup();
    const result = resolver.resolve({ tenantId: tenant.id });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.configs.length).toBe(1);
      expect(result.configs[0]!.model).toBe('gpt-4o');
      expect(result.configs[0]!.apiKey).toBe('sk-fake-key');
      expect(result.configs[0]!.priority).toBe(10);
    }
  });

  test('returns model_not_found if requested model is not assigned to tenant', () => {
    const { resolver, tenant } = createTestSetup();
    const result = resolver.resolve({ tenantId: tenant.id, requestedModel: 'claude-3-opus' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('model_not_found');
      expect(result.model).toBe('claude-3-opus');
    }
  });

  test('returns no_providers if tenant has empty configuration', () => {
    const { store, resolver } = createTestSetup();
    const emptyTenant = store.createTenant('Empty').tenant;

    const result = resolver.resolve({ tenantId: emptyTenant.id });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('no_providers');
    }
  });

  test('returns no_providers if forceAiProviderId does not match any configured provider', () => {
    const { resolver, tenant } = createTestSetup();
    const result = resolver.resolve({ tenantId: tenant.id, forceAiProviderId: 'non-existent-provider-id' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe('no_providers');
    }
  });
});
