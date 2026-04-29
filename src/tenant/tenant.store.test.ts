import { describe, test, expect, beforeEach } from 'bun:test';
import { TenantStore } from './tenant.store';
import { ProviderStore } from '@/provider/provider.store';
import { CryptoService } from '@/crypto/crypto';
import { setupTenantStoreContext } from '@test/fixtures/tenant-fixtures';
import { GROQ_PROVIDER_BASE, OLLAMA_PROVIDER_BASE } from '@test/fixtures/provider-fixtures';

describe('TenantStore', () => {
  let tenantStore: TenantStore;
  let providerStore: ProviderStore;
  let cryptoService: CryptoService;

  beforeEach(() => {
    const context = setupTenantStoreContext();
    tenantStore = context.tenantStore;
    providerStore = context.providerStore;
    cryptoService = context.cryptoService;
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
    const pResult = providerStore.createProvider(GROQ_PROVIDER_BASE);
    expect(pResult).toSucceed();
    const p = pResult._unsafeUnwrap();

    const mResult = providerStore.createProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' });
    expect(mResult).toSucceed();
    const m = mResult._unsafeUnwrap();

    const encryptedKey = cryptoService.encrypt('sk-groq-secret');
    tenantStore.assignAiProviderKey(tenant.id, { aiProviderId: p.id, aiProviderApiKeyEncrypted: encryptedKey });
    tenantStore.assignAiModelPriority(tenant.id, { aiProviderModelId: m.id, priority: 0 });

    const configs = tenantStore.getTenantModelConfigs(tenant.id);
    expect(configs).toHaveLength(1);
    expect(configs[0]!.modelName).toBe('llama3-70b');
    expect(configs[0]!.aiProviderApiKeyEncrypted).toBe(encryptedKey);
    expect(configs[0]!.baseUrl).toBe(GROQ_PROVIDER_BASE.baseUrl);
  });

  test('getTenantModelConfigs returns null aiProviderApiKeyEncrypted for keyless provider', () => {
    const { tenant } = tenantStore.createTenant('Acme');
    const pResult = providerStore.createProvider(OLLAMA_PROVIDER_BASE);
    expect(pResult).toSucceed();
    const p = pResult._unsafeUnwrap();

    const mResult = providerStore.createProviderModel({ aiProviderId: p.id, modelName: 'qwen3-6' });
    expect(mResult).toSucceed();
    const m = mResult._unsafeUnwrap();

    tenantStore.assignAiProviderKey(tenant.id, { aiProviderId: p.id });
    tenantStore.assignAiModelPriority(tenant.id, { aiProviderModelId: m.id, priority: 0 });

    const configs = tenantStore.getTenantModelConfigs(tenant.id);
    expect(configs[0]!.aiProviderApiKeyEncrypted).toBeNull();
  });

  test('getTenantModelConfigs orders by priority', () => {
    const { tenant } = tenantStore.createTenant('Acme');
    const pResult = providerStore.createProvider(GROQ_PROVIDER_BASE);
    expect(pResult).toSucceed();
    const p = pResult._unsafeUnwrap();

    const m1 = providerStore.createProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' })._unsafeUnwrap();
    const m2 = providerStore.createProviderModel({ aiProviderId: p.id, modelName: 'llama3-8b' })._unsafeUnwrap();
    
    tenantStore.assignAiProviderKey(tenant.id, { aiProviderId: p.id, aiProviderApiKeyEncrypted: cryptoService.encrypt('sk-x') });
    tenantStore.assignAiModelPriority(tenant.id, { aiProviderModelId: m1.id, priority: 1 });
    tenantStore.assignAiModelPriority(tenant.id, { aiProviderModelId: m2.id, priority: 0 });

    const configs = tenantStore.getTenantModelConfigs(tenant.id);
    expect(configs[0]!.priority).toBe(0);
    expect(configs[1]!.priority).toBe(1);
  });

  describe('upsert and lookup methods', () => {
    test('getTenantByName returns tenant when exists', () => {
      const { tenant } = tenantStore.createTenant('Acme');
      const found = tenantStore.getTenantByName('Acme');
      expect(found?.id).toBe(tenant.id);
    });

    test('getTenantByName returns null when absent', () => {
      expect(tenantStore.getTenantByName('Unknown')).toBeNull();
    });

    test('upsertTenant creates when absent', () => {
      const { tenant, rawApiKey, isNew } = tenantStore.upsertTenant('Acme');
      expect(isNew).toBe(true);
      expect(rawApiKey).toMatch(/^gw_/);
      expect(tenantStore.listTenants().map(t => t.id)).toContain(tenant.id);
    });

    test('upsertTenant returns existing when present', () => {
      const first = tenantStore.upsertTenant('Acme');
      const second = tenantStore.upsertTenant('Acme');
      expect(second.isNew).toBe(false);
      expect(second.rawApiKey).toBeNull();
      expect(second.tenant.id).toBe(first.tenant.id);
    });

    test('upsertTenant does not create duplicate API key rows', () => {
      const { tenant, rawApiKey } = tenantStore.upsertTenant('Acme');
      tenantStore.upsertTenant('Acme');
      const found = tenantStore.getTenantByApiKey(rawApiKey!);
      expect(found?.id).toBe(tenant.id);
    });

    test('upsertAiProviderKey creates when absent', () => {
      const { tenant } = tenantStore.upsertTenant('Acme');
      const { provider: p } = providerStore.upsertProvider(GROQ_PROVIDER_BASE);
      const encrypted = cryptoService.encrypt('sk-groq-secret');
      const key = tenantStore.upsertAiProviderKey(tenant.id, { aiProviderId: p.id, aiProviderApiKeyEncrypted: encrypted });
      expect(key.aiProviderApiKeyEncrypted).toBe(encrypted);
    });

    test('upsertAiProviderKey overwrites credential on conflict', () => {
      const { tenant } = tenantStore.upsertTenant('Acme');
      const { provider: p } = providerStore.upsertProvider(GROQ_PROVIDER_BASE);
      const encryptedA = cryptoService.encrypt('sk-key-a');
      const encryptedB = cryptoService.encrypt('sk-key-b');
      tenantStore.upsertAiProviderKey(tenant.id, { aiProviderId: p.id, aiProviderApiKeyEncrypted: encryptedA });
      const key = tenantStore.upsertAiProviderKey(tenant.id, { aiProviderId: p.id, aiProviderApiKeyEncrypted: encryptedB });
      expect(key.aiProviderApiKeyEncrypted).toBe(encryptedB);
    });

    test('upsertAiProviderKey stores null for no-auth provider', () => {
      const { tenant } = tenantStore.upsertTenant('Acme');
      const { provider: p } = providerStore.upsertProvider(OLLAMA_PROVIDER_BASE);
      const key = tenantStore.upsertAiProviderKey(tenant.id, { aiProviderId: p.id });
      expect(key.aiProviderApiKeyEncrypted).toBeNull();
    });

    test('upsertAiModelPriority creates when absent', () => {
      const { tenant } = tenantStore.upsertTenant('Acme');
      const { provider: p } = providerStore.upsertProvider(GROQ_PROVIDER_BASE);
      const { model: m } = providerStore.upsertProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' });
      const { priority } = tenantStore.upsertAiModelPriority(tenant.id, { aiProviderModelId: m.id, priority: 5 });
      expect(priority.priority).toBe(5);
    });

    test('upsertAiModelPriority updates priority on conflict', () => {
      const { tenant } = tenantStore.upsertTenant('Acme');
      const { provider: p } = providerStore.upsertProvider(GROQ_PROVIDER_BASE);
      const { model: m } = providerStore.upsertProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' });
      tenantStore.upsertAiModelPriority(tenant.id, { aiProviderModelId: m.id, priority: 5 });
      const { priority: updated } = tenantStore.upsertAiModelPriority(tenant.id, { aiProviderModelId: m.id, priority: 10 });
      expect(updated.priority).toBe(10);
    });

    test('upsertAiModelPriority does not duplicate', () => {
      const { tenant } = tenantStore.upsertTenant('Acme');
      const { provider: p } = providerStore.upsertProvider(GROQ_PROVIDER_BASE);
      const { model: m } = providerStore.upsertProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' });
      tenantStore.upsertAiModelPriority(tenant.id, { aiProviderModelId: m.id, priority: 5 });
      tenantStore.upsertAiModelPriority(tenant.id, { aiProviderModelId: m.id, priority: 10 });
      expect(tenantStore.listTenantAiModelPriorities(tenant.id)).toHaveLength(1);
    });
  });

  describe('Phase A/B newly added methods', () => {
    test('deleteTenant deletes the tenant', () => {
      const { tenant } = tenantStore.createTenant('ToDelete');
      expect(tenantStore.getTenantById(tenant.id)).not.toBeNull();
      const deleted = tenantStore.deleteTenant(tenant.id);
      expect(deleted).toBe(true);
      expect(tenantStore.getTenantById(tenant.id)).toBeNull();
    });

    test('updateTenantAiProviderKey updates enabled status', () => {
      const { tenant } = tenantStore.createTenant('Acme');
      const pResult = providerStore.createProvider({ name: 'P1', type: 't1', baseUrl: 'b1' });
      expect(pResult).toSucceed();
      const p = pResult._unsafeUnwrap();
      
      const key = tenantStore.assignAiProviderKey(tenant.id, { aiProviderId: p.id });
      const updated = tenantStore.updateTenantAiProviderKey(key.id, { enabled: false });
      expect(updated?.enabled).toBe(false);
      const found = tenantStore.getTenantAiProviderKeyById(key.id);
      expect(found?.enabled).toBe(false);
    });

    test('deleteTenantAiProviderKey deletes the key', () => {
      const { tenant } = tenantStore.createTenant('Acme');
      const pResult = providerStore.createProvider({ name: 'P1', type: 't1', baseUrl: 'b1' });
      expect(pResult).toSucceed();
      const p = pResult._unsafeUnwrap();
      
      const key = tenantStore.assignAiProviderKey(tenant.id, { aiProviderId: p.id });
      tenantStore.deleteTenantAiProviderKey(key.id);
      expect(tenantStore.getTenantAiProviderKeyById(key.id)).toBeNull();
    });

    test('updateTenantAiModelPriority updates priority and enabled', () => {
      const { tenant } = tenantStore.createTenant('Acme');
      const pResult = providerStore.createProvider({ name: 'P1', type: 't1', baseUrl: 'b1' });
      expect(pResult).toSucceed();
      const p = pResult._unsafeUnwrap();
      
      const mResult = providerStore.createProviderModel({ aiProviderId: p.id, modelName: 'm1' });
      expect(mResult).toSucceed();
      const m = mResult._unsafeUnwrap();
      
      const priority = tenantStore.assignAiModelPriority(tenant.id, { aiProviderModelId: m.id, priority: 1 });
      const updated = tenantStore.updateTenantAiModelPriority(priority.id, { priority: 2, enabled: false });
      expect(updated?.priority).toBe(2);
      expect(updated?.enabled).toBe(false);
    });

    test('deleteTenantAiModelPriority deletes the priority', () => {
      const { tenant } = tenantStore.createTenant('Acme');
      const pResult = providerStore.createProvider({ name: 'P1', type: 't1', baseUrl: 'b1' });
      expect(pResult).toSucceed();
      const p = pResult._unsafeUnwrap();
      
      const mResult = providerStore.createProviderModel({ aiProviderId: p.id, modelName: 'm1' });
      expect(mResult).toSucceed();
      const m = mResult._unsafeUnwrap();
      
      const priority = tenantStore.assignAiModelPriority(tenant.id, { aiProviderModelId: m.id, priority: 1 });
      tenantStore.deleteTenantAiModelPriority(priority.id);
      expect(tenantStore.getTenantAiModelPriorityById(priority.id)).toBeNull();
    });

    test('Gateway API Keys lifecycle', () => {
      const { tenant } = tenantStore.createTenant('Acme');
      const initialKeys = tenantStore.listGatewayApiKeys(tenant.id);
      expect(initialKeys).toHaveLength(1); // One created by default

      const newKey = tenantStore.createGatewayApiKey(tenant.id);
      expect(newKey).not.toBeNull();
      
      const keys = tenantStore.listGatewayApiKeys(tenant.id);
      expect(keys).toHaveLength(2);
      expect(keys.map(k => k.id)).toContain(newKey!.keyId);

      tenantStore.deleteGatewayApiKey(newKey!.keyId);
      const keysAfterDelete = tenantStore.listGatewayApiKeys(tenant.id);
      expect(keysAfterDelete).toHaveLength(1);
    });
  });
});
