import { describe, test, expect, beforeEach, beforeAll } from 'bun:test';
import { TenantStore } from './tenant.store';
import { ProviderStore } from '@/provider/provider.store';
import { createTestContext, ensureTestEncryptionKey } from '@test/test-setup';
import { CryptoService } from '@/crypto/crypto';

beforeAll(() => {
  ensureTestEncryptionKey();
});

describe('TenantStore', () => {
  let tenantStore: TenantStore;
  let providerStore: ProviderStore;
  let cryptoService: CryptoService;

  beforeEach(() => {
    const context = createTestContext();
    tenantStore = context.tenantStore;
    providerStore = context.providerStore;
    cryptoService = new CryptoService();
  });

  test('createTenant returns tenant and raw API key', () => {
    const { tenant, rawApiKey } = tenantStore.createTenant('Acme');
    expect(tenant.name).toBe('Acme');
    expect(tenant.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(rawApiKey).toMatch(/^gw_/);
  });

  test('getTenantByApiKey returns tenant on hit', () => {
    const { tenant, rawApiKey } = tenantStore.createTenant('Acme');
    const found = tenantStore.getTenantByApiKey(rawApiKey);
    expect(found?.id).toBe(tenant.id);
    expect(found?.name).toBe('Acme');
  });

  test('getTenantByApiKey returns null on miss', () => {
    expect(tenantStore.getTenantByApiKey('gw_wrongkey')).toBeNull();
  });

  test('getTenantModelConfigs returns joined config with encrypted key', () => {
    const { tenant } = tenantStore.createTenant('Acme');
    const p = providerStore.createProvider({ name: 'Groq', type: 'groq', baseUrl: 'https://api.groq.com/openai/v1' })._unsafeUnwrap();
    const m = providerStore.createProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' })._unsafeUnwrap();
    const encryptedKey = cryptoService.encrypt('sk-groq-secret');
    tenantStore.assignAiProviderKey(tenant.id, { aiProviderId: p.id, aiProviderApiKeyEncrypted: encryptedKey });
    tenantStore.assignAiModelPriority(tenant.id, { aiProviderModelId: m.id, priority: 0 });

    const configs = tenantStore.getTenantModelConfigs(tenant.id);
    expect(configs).toHaveLength(1);
    expect(configs[0]!.modelName).toBe('llama3-70b');
    expect(configs[0]!.aiProviderApiKeyEncrypted).toBe(encryptedKey);
    expect(configs[0]!.baseUrl).toBe('https://api.groq.com/openai/v1');
  });

  test('getTenantModelConfigs returns null aiProviderApiKeyEncrypted for keyless provider', () => {
    const { tenant } = tenantStore.createTenant('Acme');
    const p = providerStore.createProvider({ name: 'Ollama', type: 'ollama', baseUrl: 'http://localhost:11434/v1' })._unsafeUnwrap();
    const m = providerStore.createProviderModel({ aiProviderId: p.id, modelName: 'qwen3-6' })._unsafeUnwrap();
    tenantStore.assignAiProviderKey(tenant.id, { aiProviderId: p.id });
    tenantStore.assignAiModelPriority(tenant.id, { aiProviderModelId: m.id, priority: 0 });

    const configs = tenantStore.getTenantModelConfigs(tenant.id);
    expect(configs[0]!.aiProviderApiKeyEncrypted).toBeNull();
  });

  test('getTenantModelConfigs orders by priority', () => {
    const { tenant } = tenantStore.createTenant('Acme');
    const p = providerStore.createProvider({ name: 'Groq', type: 'groq', baseUrl: 'https://api.groq.com/openai/v1' })._unsafeUnwrap();
    const m1 = providerStore.createProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' })._unsafeUnwrap();
    const m2 = providerStore.createProviderModel({ aiProviderId: p.id, modelName: 'llama3-8b' })._unsafeUnwrap();
    tenantStore.assignAiProviderKey(tenant.id, { aiProviderId: p.id, aiProviderApiKeyEncrypted: cryptoService.encrypt('sk-x') });
    tenantStore.assignAiModelPriority(tenant.id, { aiProviderModelId: m1.id, priority: 1 });
    tenantStore.assignAiModelPriority(tenant.id, { aiProviderModelId: m2.id, priority: 0 });

    const configs = tenantStore.getTenantModelConfigs(tenant.id);
    expect(configs[0]!.priority).toBe(0);
    expect(configs[1]!.priority).toBe(1);
  });
});
