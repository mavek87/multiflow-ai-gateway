import { describe, test, expect, beforeAll, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { drizzle } from 'drizzle-orm/bun-sqlite';
import { migrate } from 'drizzle-orm/bun-sqlite/migrator';
import * as schema from '@/db/schema';
import { TenantStore } from '@/tenant/tenant-store';
import { ChatService } from './chat.service';
import { RoutingAIClientFactory } from '@/engine/routing/routing-client-factory';
import type { Tenant } from '@/tenant/types';
import type { AIClient } from '@/engine/types';

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
  
  // Create a provider and model
  const provider = store.createProvider({ name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1' });
  const providerModel = store.createProviderModel({ aiProviderId: provider.id, modelName: 'gpt-4o' });
  
  // Assign AI provider key and model priority to tenant
  store.assignAiProviderKey(tenant.id, { aiProviderId: provider.id, apiKey: 'sk-fake-key' });
  store.assignAiModelPriority(tenant.id, { aiProviderModelId: providerModel.id, priority: 10 });
  
  const service = new ChatService(store, new RoutingAIClientFactory());

  return { store, service, tenant };
}

// Mock fetch for network calls
const originalFetch = globalThis.fetch;

describe('ChatService', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  describe('resolveModelConfigs', () => {
    test('returns configs when tenant has configured models', () => {
      const { service, tenant } = createTestSetup();
      const result = service.resolveModelConfigs({ tenantId: tenant.id });
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.configs.length).toBe(1);
        expect(result.configs[0]!.model).toBe('gpt-4o');
        expect(result.configs[0]!.apiKey).toBe('sk-fake-key');
        expect(result.configs[0]!.priority).toBe(10);
      }
    });

    test('returns model_not_found if requested model is not assigned to tenant', () => {
      const { service, tenant } = createTestSetup();
      const result = service.resolveModelConfigs({ tenantId: tenant.id, requestedModel: 'claude-3-opus' });
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('model_not_found');
        expect(result.model).toBe('claude-3-opus');
      }
    });
    
    test('returns no_providers if tenant has empty configuration', () => {
      const { store, service } = createTestSetup();
      const emptyTenant = store.createTenant('Empty').tenant;
      
      const result = service.resolveModelConfigs({ tenantId: emptyTenant.id });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBe('no_providers');
      }
    });
  });

  describe('handleChatRequest', () => {
    function makeFactory(client: AIClient): RoutingAIClientFactory {
      return { create: () => client } as unknown as RoutingAIClientFactory;
    }

    test('handles standard chat request successfully', async () => {
      const { store, tenant } = createTestSetup();
      const mockClient: AIClient = {
        chat: async () => ({ model: 'gpt-4o', content: 'Mocked reply', aiProvider: 'openai' }),
      };
      const service = new ChatService(store, makeFactory(mockClient));
      const configs = service.resolveModelConfigs({ tenantId: tenant.id });
      if (!configs.ok) return;

      const result = await service.handleChatRequest(tenant as Tenant, { messages: [{ role: 'user', content: 'Hello' }] }, configs.configs);
      expect(result.isStream).toBe(false);
      if (!result.isStream) {
        expect(result.model).toBe('gpt-4o');
        expect(result.data.choices[0]!.message.content).toBe('Mocked reply');
      }
    });

    test('handles standard stream request successfully', async () => {
      const { store, tenant } = createTestSetup();
      const fakeBody = new ReadableStream();
      const mockClient: AIClient = {
        chat: async () => ({ model: 'gpt-4o', content: '', aiProvider: 'openai' }),
        openStream: async () => ({ body: fakeBody, model: 'gpt-4o', aiProvider: 'openai' }),
      };
      const service = new ChatService(store, makeFactory(mockClient));
      const configs = service.resolveModelConfigs({ tenantId: tenant.id });
      if (!configs.ok) return;

      const result = await service.handleChatRequest(tenant as Tenant, { messages: [{ role: 'user', content: 'Hello' }], stream: true }, configs.configs);
      expect(result.isStream).toBe(true);
      if (result.isStream) {
        expect(result.streamBody).toBe(fakeBody);
      }
    });

    test('returns error if model fails', async () => {
      const { store, tenant } = createTestSetup();
      const mockClient: AIClient = {
        chat: async () => ({ model: 'gpt-4o', content: '', aiProvider: 'openai' }),
        openStream: async () => null,
      };
      const service = new ChatService(store, makeFactory(mockClient));
      const configs = service.resolveModelConfigs({ tenantId: tenant.id });
      if (!configs.ok) return;

      try {
        await service.handleChatRequest(tenant as Tenant, { messages: [{ role: 'user', content: 'Hello' }], stream: true }, configs.configs);
        expect(true).toBe(false);
      } catch (err: any) {
        expect(err.message).toBe('AI service unavailable');
      }
    });
  });
});
