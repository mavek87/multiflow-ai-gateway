import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from '@/db/schema';
import { TenantStore } from '@/tenant/tenant.store';
import { ProviderStore } from '@/provider/provider.store';

/**
 * Sets up a fresh in-memory SQLite database with migrations applied.
 */
export function setupTestDb() {
  const sqlite = new Database(':memory:');
  sqlite.run('PRAGMA foreign_keys=ON');
  const db = drizzle(sqlite, { schema });
  migrate(db, { migrationsFolder: './drizzle' });
  return db;
}

/**
 * Ensures ENCRYPTION_KEY is set for tests.
 */
export function ensureTestEncryptionKey() {
  if (!process.env['ENCRYPTION_KEY']) {
    process.env['ENCRYPTION_KEY'] = 'c'.repeat(64);
  }
}

/**
 * Creates a standard test context with a db and stores.
 */
export function createTestContext() {
  ensureTestEncryptionKey();
  const db = setupTestDb();
  const tenantStore = new TenantStore(db);
  const providerStore = new ProviderStore(db);
  
  return { db, tenantStore, providerStore };
}

/**
 * Seeds a test tenant and a provider for common test scenarios.
 */
export function seedTestTenantAndProvider(tenantStore: TenantStore, providerStore: ProviderStore) {
  const { tenant, rawApiKey } = tenantStore.createTenant('TestTenant');
  
  const provider = providerStore.createProvider({ 
    name: 'OpenAI', 
    type: 'openai', 
    baseUrl: 'https://api.openai.com/v1' 
  })._unsafeUnwrap();
  
  const providerModel = providerStore.createProviderModel({ 
    aiProviderId: provider.id, 
    modelName: 'gpt-4o' 
  })._unsafeUnwrap();
  
  tenantStore.assignAiProviderKey(tenant.id, { 
    aiProviderId: provider.id, 
    apiKey: 'sk-fake-key' 
  });
  
  tenantStore.assignAiModelPriority(tenant.id, { 
    aiProviderModelId: providerModel.id, 
    priority: 10 
  });
  
  return { tenant, rawApiKey, provider, providerModel };
}
