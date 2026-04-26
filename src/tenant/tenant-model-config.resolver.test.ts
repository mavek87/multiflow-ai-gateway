import { describe, test, expect, beforeAll, beforeEach } from 'bun:test';
import { TenantModelConfigResolver } from './tenant-model-config.resolver';
import { createTestContext, seedTestTenantAndProvider, ensureTestEncryptionKey } from '@test/test-setup';
import type { TenantStore } from '@/tenant/tenant.store';
import type { Tenant } from '@/tenant/tenant.types';
import { CryptoService } from '@/crypto/crypto';

beforeAll(() => {
  ensureTestEncryptionKey();
});

describe('TenantModelConfigResolver', () => {
  let store: TenantStore;
  let resolver: TenantModelConfigResolver;
  let tenant: Tenant;
  let cryptoService: CryptoService;

  beforeEach(() => {
    const context = createTestContext();
    store = context.tenantStore;
    cryptoService = new CryptoService();
    const seeded = seedTestTenantAndProvider(store, context.providerStore);
    tenant = seeded.tenant;
    resolver = new TenantModelConfigResolver(store, cryptoService);
  });

  test('returns configs when tenant has configured models', () => {
    const result = resolver.resolve({ tenantId: tenant.id });

    expect(result.isOk()).toBe(true);
    if (result.isOk()) {
      expect(result.value.length).toBe(1);
      expect(result.value[0]!.model).toBe('gpt-4o');
      expect(result.value[0]!.apiKey).toBe('sk-fake-key');
      expect(result.value[0]!.priority).toBe(10);
    }
  });

  test('returns model_not_found if requested model is not assigned to tenant', () => {
    const result = resolver.resolve({ tenantId: tenant.id, requestedModel: 'claude-3-opus' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
      expect(result.error.code).toBe('model_not_found');
      if (result.error.code === 'model_not_found') expect(result.error.model).toBe('claude-3-opus');
    }
  });

  test('returns no_providers if tenant has empty configuration', () => {
    const emptyTenant = store.createTenant('Empty').tenant;

    const result = resolver.resolve({ tenantId: emptyTenant.id });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('no_providers');
  });

  test('returns no_providers if forceAiProviderId does not match any configured provider', () => {
    const result = resolver.resolve({ tenantId: tenant.id, forceAiProviderId: 'non-existent-provider-id' });

    expect(result.isErr()).toBe(true);
    if (result.isErr()) expect(result.error.code).toBe('no_providers');
  });

  describe('provider/model format', () => {
    test('filters by provider name when requestedProviderName is provided', () => {
      const result = resolver.resolve({ tenantId: tenant.id, requestedModel: 'gpt-4o', requestedProviderName: 'OpenAI' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) {
        expect(result.value.length).toBe(1);
        expect(result.value[0]!.model).toBe('gpt-4o');
      }
    });

    test('provider name match is case-insensitive', () => {
      const result = resolver.resolve({ tenantId: tenant.id, requestedModel: 'gpt-4o', requestedProviderName: 'openai' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value.length).toBe(1);
    });

    test('returns model_not_found if provider name does not match any configured provider', () => {
      const result = resolver.resolve({ tenantId: tenant.id, requestedModel: 'gpt-4o', requestedProviderName: 'Groq' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.code).toBe('model_not_found');
    });

    test('returns model_not_found if provider name matches but model does not', () => {
      const result = resolver.resolve({ tenantId: tenant.id, requestedModel: 'gpt-99', requestedProviderName: 'OpenAI' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.code).toBe('model_not_found');
    });

    test('filters by provider name alone without requestedModel', () => {
      const result = resolver.resolve({ tenantId: tenant.id, requestedProviderName: 'OpenAI' });

      expect(result.isOk()).toBe(true);
      if (result.isOk()) expect(result.value.length).toBe(1);
    });

    test('returns model_not_found if only provider name is given and does not match', () => {
      const result = resolver.resolve({ tenantId: tenant.id, requestedProviderName: 'Unknown' });

      expect(result.isErr()).toBe(true);
      if (result.isErr()) expect(result.error.code).toBe('model_not_found');
    });
  });
});
