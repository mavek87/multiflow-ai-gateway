import { describe, test, expect } from 'bun:test';
import { AIRouterFactory } from '@/engine/routing/ai-router.factory';
import { createModelSelector } from '@/engine/selection/model-selector.factory';
import type { ModelConfig } from '@/engine/client/http-provider-client.types';
import { mockJsonResponse, setupTestDb } from '@test/test-setup';
import { MetricsStore } from '@/engine/observability/metrics';
import { CircuitBreaker } from '@/engine/resilience/circuit-breaker';
import { AuditStore } from '@/db/audit/audit.store';

function createTestFactory() {
  const metrics = new MetricsStore();
  const cb = new CircuitBreaker();
  const selector = createModelSelector('ucb1-tuned');
  const auditStore = new AuditStore(setupTestDb());
  return new AIRouterFactory(metrics, cb, selector, auditStore);
}

describe('Routing Integration', () => {
  test('should NOT overwrite providers when they offer the same model name', () => {
    const factory = createTestFactory();
    
    // Two different providers for the same model 'gpt-4o'
    const configs: ModelConfig[] = [
      {
        url: 'http://provider-1/v1',
        model: 'gpt-4o',
        aiProviderId: 'p1',
        aiProviderName: 'Provider 1',
        aiProviderModelId: 'uuid-1'
      },
      {
        url: 'http://provider-2/v1',
        model: 'gpt-4o',
        aiProviderId: 'p2',
        aiProviderName: 'Provider 2',
        aiProviderModelId: 'uuid-2'
      }
    ];

    const router = factory.create(configs);
    const internalClients = (router as any).clients;
    
    // Verify that the map contains both unique IDs
    expect(internalClients.size).toBe(2);
    expect(internalClients.has('uuid-1')).toBe(true);
    expect(internalClients.has('uuid-2')).toBe(true);
  });

  test('should return the correct model name even when using unique internal IDs', async () => {
    // @ts-ignore
    globalThis.fetch = async () => mockJsonResponse({ choices: [{ message: { content: 'hi' } }] });

    const factory = createTestFactory();
    const configs: ModelConfig[] = [{
      url: 'http://provider-1/v1',
      model: 'gpt-4o-requested',
      aiProviderId: 'p1',
      aiProviderModelId: 'uuid-unique-1'
    }];

    const router = factory.create(configs);
    const result = await router.chat('system', [{ role: 'user', content: 'hi' }]);
    
    // The returned model must be the 'logical' one (gpt-4o-requested), not the internal ID (uuid-unique-1)
    expect(result!.model).toBe('gpt-4o-requested');
  });

  test('should isolate circuit breaker between different providers of the same model', () => {
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();
    const selector = createModelSelector('ucb1-tuned');
    const auditStore = new AuditStore(setupTestDb());
    const factory = new AIRouterFactory(metrics, cb, selector, auditStore);

    const configs: ModelConfig[] = [
      {
        url: 'http://p1/v1',
        model: 'gpt-4o',
        aiProviderId: 'p1',
        aiProviderModelId: 'uuid-1'
      },
      {
        url: 'http://p2/v1',
        model: 'gpt-4o',
        aiProviderId: 'p2',
        aiProviderModelId: 'uuid-2'
      }
    ];

    factory.create(configs);
    
    // Simulate 3 hard failures on Provider 1 (uuid-1)
    cb.recordHardFailure('uuid-1');
    cb.recordHardFailure('uuid-1');
    cb.recordHardFailure('uuid-1');

    // Provider 1 must be OPEN (blocked)
    expect(cb.isAvailable('uuid-1')).toBe(false);
    // Provider 2 (still gpt-4o but with ID uuid-2) must still be CLOSED (available)
    expect(cb.isAvailable('uuid-2')).toBe(true);
  });
});
