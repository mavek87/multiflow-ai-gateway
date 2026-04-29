import { describe, test, expect, beforeEach } from 'bun:test';
import { ProviderStore } from './provider.store';
import { createTestContext } from '@test/test-setup';
import { OPENAI_PROVIDER_BASE, GROQ_PROVIDER_BASE } from '@test/fixtures/provider-fixtures';

describe('ProviderStore', () => {
  let store: ProviderStore;

  beforeEach(() => {
    const { providerStore } = createTestContext();
    store = providerStore;
  });

  test('createProvider returns provider', () => {
    const result = store.createProvider(OPENAI_PROVIDER_BASE);
    const p = expect(result).toSucceed()._unsafeUnwrap();
    expect(p.name).toBe(OPENAI_PROVIDER_BASE.name);
    expect(p.id).toBeDefined();
  });

  test('createProvider returns duplicate error', () => {
    store.createProvider(OPENAI_PROVIDER_BASE);
    const result = store.createProvider(OPENAI_PROVIDER_BASE);
    expect(result).toFailWith('duplicate');
  });

  test('listProviders returns all providers', () => {
    store.createProvider({ name: 'P1', type: 'openai', baseUrl: 'b1' });
    store.createProvider({ name: 'P2', type: 'openai', baseUrl: 'b2' });
    const providers = store.listProviders();
    expect(providers).toHaveLength(2);
  });

  test('getProviderById returns provider on hit', () => {
    const p = store.createProvider({ name: 'P1', type: 'openai', baseUrl: 'b1' })._unsafeUnwrap();
    const found = store.getProviderById(p.id);
    expect(found?.name).toBe('P1');
  });

  test('createProviderModel returns model', () => {
    const p = store.createProvider(GROQ_PROVIDER_BASE)._unsafeUnwrap();
    const result = store.createProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' });
    const m = expect(result).toSucceed()._unsafeUnwrap();
    expect(m.modelName).toBe('llama3-70b');
  });

  test('listProviderModels returns models for provider', () => {
    const p = store.createProvider(GROQ_PROVIDER_BASE)._unsafeUnwrap();
    store.createProviderModel({ aiProviderId: p.id, modelName: 'm1' });
    store.createProviderModel({ aiProviderId: p.id, modelName: 'm2' });
    const models = store.listProviderModels(p.id);
    expect(models).toHaveLength(2);
  });

  test('getProviderModelById returns model on hit', () => {
    const p = store.createProvider(GROQ_PROVIDER_BASE)._unsafeUnwrap();
    const m = store.createProviderModel({ aiProviderId: p.id, modelName: 'm1' })._unsafeUnwrap();
    const found = store.getProviderModelById(m.id);
    expect(found?.modelName).toBe('m1');
  });

  describe('upsert and lookup methods', () => {
    test('getProviderByName returns provider when exists', () => {
      store.createProvider(OPENAI_PROVIDER_BASE);
      const found = store.getProviderByName(OPENAI_PROVIDER_BASE.name);
      expect(found?.name).toBe(OPENAI_PROVIDER_BASE.name);
    });

    test('getProviderByName returns null when absent', () => {
      expect(store.getProviderByName('Unknown')).toBeNull();
    });

    test('upsertProvider creates when absent', () => {
      store.upsertProvider(OPENAI_PROVIDER_BASE);
      const providers = store.listProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0]!.name).toBe(OPENAI_PROVIDER_BASE.name);
      expect(providers[0]!.type).toBe(OPENAI_PROVIDER_BASE.type);
    });

    test('upsertProvider updates type and baseUrl on conflict', () => {
      store.upsertProvider(OPENAI_PROVIDER_BASE);
      store.upsertProvider({ name: 'OpenAI', type: 'azure', baseUrl: 'https://custom.openai.azure.com/v1' });
      const providers = store.listProviders();
      expect(providers).toHaveLength(1);
      expect(providers[0]!.type).toBe('azure');
      expect(providers[0]!.baseUrl).toBe('https://custom.openai.azure.com/v1');
    });

    test('upsertProvider does not create duplicates', () => {
      store.upsertProvider(OPENAI_PROVIDER_BASE);
      store.upsertProvider(OPENAI_PROVIDER_BASE);
      expect(store.listProviders()).toHaveLength(1);
    });

    test('getProviderModelByName returns model when exists', () => {
      const { provider: p } = store.upsertProvider(GROQ_PROVIDER_BASE);
      store.upsertProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' });
      const found = store.getProviderModelByName(p.id, 'llama3-70b');
      expect(found?.modelName).toBe('llama3-70b');
    });

    test('getProviderModelByName returns null when absent', () => {
      const { provider: p } = store.upsertProvider(GROQ_PROVIDER_BASE);
      expect(store.getProviderModelByName(p.id, 'nonexistent')).toBeNull();
    });

    test('upsertProviderModel creates when absent', () => {
      const { provider: p } = store.upsertProvider(GROQ_PROVIDER_BASE);
      const { model: m } = store.upsertProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' });
      expect(m.modelName).toBe('llama3-70b');
      expect(store.listProviderModels(p.id)).toHaveLength(1);
    });

    test('upsertProviderModel does not duplicate', () => {
      const { provider: p } = store.upsertProvider(GROQ_PROVIDER_BASE);
      store.upsertProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' });
      store.upsertProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' });
      expect(store.listProviderModels(p.id)).toHaveLength(1);
    });

    test('upsertProviderModel preserves original id', () => {
      const { provider: p } = store.upsertProvider(GROQ_PROVIDER_BASE);
      const { model: first } = store.upsertProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' });
      const { model: second } = store.upsertProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' });
      expect(second.id).toBe(first.id);
    });
  });

  describe('Phase A/B newly added methods', () => {
    test('updateProvider updates provider fields', () => {
      const p = store.createProvider({ name: 'P1', type: 'openai', baseUrl: 'b1' })._unsafeUnwrap();
      const updated = store.updateProvider(p.id, { baseUrl: 'b2', type: 'custom' });
      expect(updated?.baseUrl).toBe('b2');
      expect(updated?.type).toBe('custom');
      const found = store.getProviderById(p.id);
      expect(found?.baseUrl).toBe('b2');
    });

    test('deleteProvider deletes the provider', () => {
      const p = store.createProvider({ name: 'P1', type: 'openai', baseUrl: 'b1' })._unsafeUnwrap();
      store.deleteProvider(p.id);
      expect(store.getProviderById(p.id)).toBeNull();
    });

    test('updateProviderModel updates model fields', () => {
      const p = store.createProvider({ name: 'P1', type: 'openai', baseUrl: 'b1' })._unsafeUnwrap();
      const m = store.createProviderModel({ aiProviderId: p.id, modelName: 'm1' })._unsafeUnwrap();
      const updated = store.updateProviderModel(m.id, { enabled: false });
      expect(updated?.enabled).toBe(false);
      const found = store.getProviderModelById(m.id);
      expect(found?.enabled).toBe(false);
    });

    test('deleteProviderModel deletes the model', () => {
      const p = store.createProvider({ name: 'P1', type: 'openai', baseUrl: 'b1' })._unsafeUnwrap();
      const m = store.createProviderModel({ aiProviderId: p.id, modelName: 'm1' })._unsafeUnwrap();
      store.deleteProviderModel(m.id);
      expect(store.getProviderModelById(m.id)).toBeNull();
    });
  });
});
