import { describe, test, expect, beforeEach, beforeAll } from 'bun:test';
import { ProviderStore } from './provider.store';
import { createTestContext, ensureTestEncryptionKey } from '@test/test-setup';

beforeAll(() => {
  ensureTestEncryptionKey();
});

describe('ProviderStore', () => {
  let store: ProviderStore;

  beforeEach(() => {
    const { providerStore } = createTestContext();
    store = providerStore;
  });

  test('createProvider returns provider', () => {
    const result = store.createProvider({ 
        name: 'OpenAI', 
        type: 'openai', 
        baseUrl: 'https://api.openai.com/v1' 
    });
    expect(result.isOk()).toBe(true);
    const p = result._unsafeUnwrap();
    expect(p.name).toBe('OpenAI');
    expect(p.id).toBeDefined();
  });

  test('createProvider returns duplicate error', () => {
    store.createProvider({ name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1' });
    const result = store.createProvider({ name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1' });
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
        expect(result.error).toBe('duplicate');
    }
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
    const p = store.createProvider({ name: 'Groq', type: 'groq', baseUrl: 'https://api.groq.com/openai/v1' })._unsafeUnwrap();
    const result = store.createProviderModel({ aiProviderId: p.id, modelName: 'llama3-70b' });
    expect(result.isOk()).toBe(true);
    const m = result._unsafeUnwrap();
    expect(m.modelName).toBe('llama3-70b');
  });

  test('listProviderModels returns models for provider', () => {
    const p = store.createProvider({ name: 'Groq', type: 'groq', baseUrl: 'https://api.groq.com/openai/v1' })._unsafeUnwrap();
    store.createProviderModel({ aiProviderId: p.id, modelName: 'm1' });
    store.createProviderModel({ aiProviderId: p.id, modelName: 'm2' });
    const models = store.listProviderModels(p.id);
    expect(models).toHaveLength(2);
  });

  test('getProviderModelById returns model on hit', () => {
    const p = store.createProvider({ name: 'Groq', type: 'groq', baseUrl: 'https://api.groq.com/openai/v1' })._unsafeUnwrap();
    const m = store.createProviderModel({ aiProviderId: p.id, modelName: 'm1' })._unsafeUnwrap();
    const found = store.getProviderModelById(m.id);
    expect(found?.modelName).toBe('m1');
  });
});
