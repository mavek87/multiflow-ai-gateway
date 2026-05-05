import { describe, test, expect, beforeEach } from 'bun:test';
import { TenantModelPoolResolver } from '@/tenant/tenant-model-pool.resolver';
import { createTestContext, seedTestTenantAndProvider, seedTestTenantWithMultipleModels } from '@test/test-setup';
import type { TenantStore } from '@/tenant/tenant.store';
import type { ProviderStore } from '@/provider/provider.store';
import { type Tenant, MULTIFLOW_AUTO_MODEL } from '@/tenant/tenant.types';
import { CryptoService } from '@/crypto/crypto';

describe('TenantModelPoolResolver', () => {
  let store: TenantStore;
  let providerStore: ProviderStore;
  let resolver: TenantModelPoolResolver;
  let tenant: Tenant;
  let cryptoService: CryptoService;

  beforeEach(() => {
    const context = createTestContext();
    store = context.tenantStore;
    providerStore = context.providerStore;
    cryptoService = new CryptoService();
    const seeded = seedTestTenantAndProvider(store, providerStore);
    tenant = seeded.tenant;
    resolver = new TenantModelPoolResolver(store, cryptoService);
  });

  describe('Basic resolution', () => {
    test('returns configs with correct metadata when tenant has configured models', () => {
      const result = resolver.resolve({ tenantId: tenant.id, models: [] });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(1);
        expect(result.value[0]!.model).toBe('gpt-4o');
        expect(result.value[0]!.priority).toBe(10);
        expect(result.value[0]!.aiProviderName).toBe('OpenAI');
      }
    });

    test('correctly decrypts the API key in the resolved config', () => {
      const secretKey = 'sk-real-secret-key';
      const encryptedKey = cryptoService.encrypt(secretKey);

      const provider = providerStore.listProviders()[0]!;
      store.upsertAiProviderKey(tenant.id, {
        aiProviderId: provider.id,
        aiProviderApiKeyEncrypted: encryptedKey
      });

      const result = resolver.resolve({ tenantId: tenant.id, models: [] });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value[0]!.apiKey).toBe(secretKey);
      }
    });

    test('returns multiple providers for the same model name', () => {
      const seeded = seedTestTenantWithMultipleModels(store, providerStore);
      const providerB = providerStore.listProviders().find(p => p.name === 'ProviderB')!;
      const modelAOnB = providerStore.createProviderModel({ aiProviderId: providerB.id, modelName: 'model-a' })._unsafeUnwrap();
      store.assignAiModelPriority(seeded.tenant.id, { aiProviderModelId: modelAOnB.id, priority: 5 });

      const result = resolver.resolve({
        tenantId: seeded.tenant.id,
        models: ['model-a'],
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(2);
        const providers = result.value.map(c => c.aiProviderName);
        expect(providers).toContain('ProviderA');
        expect(providers).toContain('ProviderB');
      }
    });

    test(`routes across all tenant models when model is "${MULTIFLOW_AUTO_MODEL}"`, () => {
      const result = resolver.resolve({
        tenantId: tenant.id,
        models: [MULTIFLOW_AUTO_MODEL],
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBeGreaterThan(0);
      }
    });
  });

  describe('Error cases', () => {
    test('returns model_not_found if requested model is not assigned to tenant', () => {
      const result = resolver.resolve({ tenantId: tenant.id, models: ['claude-3-opus'] });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('model_not_found');
        if (result.error.code === 'model_not_found') expect(result.error.model).toBe('claude-3-opus');
      }
    });

    test('returns no_usable_model if tenant has empty configuration', () => {
      const emptyTenant = store.createTenant('Empty').tenant;

      const result = resolver.resolve({ tenantId: emptyTenant.id, models: [] });
      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.code).toBe('no_usable_model');
    });
  });

  describe('provider/model format (single model field)', () => {
    test('filters by provider name when "provider/model" format is used', () => {
      const result = resolver.resolve({ tenantId: tenant.id, models: ['OpenAI/gpt-4o'] });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(1);
        expect(result.value[0]!.model).toBe('gpt-4o');
      }
    });

    test('provider name match is case-insensitive', () => {
      const result = resolver.resolve({ tenantId: tenant.id, models: ['openai/gpt-4o'] });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value.length).toBe(1);
    });

    test('returns model_not_found if provider name does not match any configured provider', () => {
      const result = resolver.resolve({ tenantId: tenant.id, models: ['Groq/gpt-4o'] });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.code).toBe('model_not_found');
    });

    test('returns model_not_found if provider name matches but model does not', () => {
      const result = resolver.resolve({ tenantId: tenant.id, models: ['OpenAI/gpt-99'] });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.code).toBe('model_not_found');
    });

    test('filters by provider name alone using "provider/" format', () => {
      const result = resolver.resolve({ tenantId: tenant.id, models: ['OpenAI/'] });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value.length).toBe(1);
    });
  });

  describe('models array (multi-model field)', () => {
    test('returns matching config for a single entry in models', () => {
      const result = resolver.resolve({ tenantId: tenant.id, models: ['gpt-4o'] });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(1);
        expect(result.value[0]!.model).toBe('gpt-4o');
      }
    });

    test('returns union of configs for multiple entries across different providers', () => {
      const seeded = seedTestTenantWithMultipleModels(store, providerStore);

      const result = resolver.resolve({
        tenantId: seeded.tenant.id,
        models: ['model-a', 'model-b'],
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(2);
        const models = result.value.map(c => c.model);
        expect(models).toContain('model-a');
        expect(models).toContain('model-b');
      }
    });

    test('filters by provider when entry has "provider/model"', () => {
      const seeded = seedTestTenantWithMultipleModels(store, providerStore);

      const result = resolver.resolve({
        tenantId: seeded.tenant.id,
        models: ['ProviderA/model-a'],
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(1);
        expect(result.value[0]!.model).toBe('model-a');
        expect(result.value[0]!.aiProviderName).toBe('ProviderA');
      }
    });

    test('provider name in models array is case-insensitive', () => {
        const seeded = seedTestTenantWithMultipleModels(store, providerStore);

        const result = resolver.resolve({
          tenantId: seeded.tenant.id,
          models: ['providera/model-a'],
        });

        expect(result.isOk()).toBe(true);
        if (result.isOk()) {
          expect(result.value.length).toBe(1);
          expect(result.value[0]!.aiProviderName).toBe('ProviderA');
        }
      });

    test('returns only models matching providerName when entry is "provider/"', () => {
      const seeded = seedTestTenantWithMultipleModels(store, providerStore);

      const result = resolver.resolve({
        tenantId: seeded.tenant.id,
        models: ['ProviderA/'],
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(1);
        expect(result.value[0]!.aiProviderName).toBe('ProviderA');
      }
    });

    test('returns model_not_found when none of the entries match', () => {
      const result = resolver.resolve({ tenantId: tenant.id, models: ['unknown-model'] });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.code).toBe('model_not_found');
    });

    test('deduplicates configs when multiple entries match the same model', () => {
      const result = resolver.resolve({
        tenantId: tenant.id,
        models: ['gpt-4o', 'OpenAI/'],
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value.length).toBe(1);
    });

    test('handles mixed formats in models array correctly', () => {
      const seeded = seedTestTenantWithMultipleModels(store, providerStore);

      const result = resolver.resolve({
        tenantId: seeded.tenant.id,
        models: ['ProviderA/', 'model-b']
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(2);
        const models = result.value.map(c => c.model);
        expect(models).toContain('model-a'); // from ProviderA/
        expect(models).toContain('model-b'); // from model-b
      }
    });
  });

  describe('forceAiProviderId interaction', () => {
    test('filters by model only within the forced provider (success case)', () => {
      const seeded = seedTestTenantWithMultipleModels(store, providerStore);
      const providerA = providerStore.listProviders().find(p => p.name === 'ProviderA')!;

      const result = resolver.resolve({
        tenantId: seeded.tenant.id,
        models: ['model-a'],
        forceAiProviderId: providerA.id
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(1);
        expect(result.value[0]!.aiProviderName).toBe('ProviderA');
      }
    });

    test('returns model_not_found if model exists but not for the forced provider', () => {
      const seeded = seedTestTenantWithMultipleModels(store, providerStore);
      const providerA = providerStore.listProviders().find(p => p.name === 'ProviderA')!;

      const result = resolver.resolve({
        tenantId: seeded.tenant.id,
        models: ['model-b'],
        forceAiProviderId: providerA.id
      });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) {
        expect(result.error.code).toBe('model_not_found');
      }
    });

    test('returns models of forced provider when auto-model is used', () => {
      const seeded = seedTestTenantWithMultipleModels(store, providerStore);
      const providerA = providerStore.listProviders().find(p => p.name === 'ProviderA')!;

      const result = resolver.resolve({
        tenantId: seeded.tenant.id,
        models: [MULTIFLOW_AUTO_MODEL],
        forceAiProviderId: providerA.id
      });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(1);
        expect(result.value[0]!.aiProviderName).toBe('ProviderA');
        expect(result.value[0]!.model).toBe('model-a');
      }
    });

    test('returns no_usable_model if forceAiProviderId does not match any configured provider', () => {
        const result = resolver.resolve({ tenantId: tenant.id, models: [], forceAiProviderId: 'non-existent-provider-id' });

        expect(result.isErr()).toBe(true);
        if (result.isErr()) expect(result.error.code).toBe('no_usable_model');
      });
  });
});
