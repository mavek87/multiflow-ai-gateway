import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { createTestContext, mockSseResponse } from './test-setup';
import { RoutingAIClientFactory } from '@/engine/routing/routing-client-factory';
import { createModelSelector } from '@/engine/selection/selector.factory';
import { MetricsStore } from '@/engine/observability/metrics';
import { CircuitBreaker } from '@/engine/resilience/circuit-breaker';
import { ChatService } from '@/chat/chat.service';
import type { ModelConfig } from '@/engine/client/client.types';

describe('Circuit Breaker Persistence', () => {
  let originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test('should persist circuit state across different calls to ChatService', async () => {
    // 1. Setup - Single Factory created at start (as it happens in the routes plugin)
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();
    const selector = createModelSelector('ucb1-tuned');
    const factory = new RoutingAIClientFactory(metrics, cb, selector);
    const chatService = new ChatService(factory);

    const tenant = { id: 't1' } as any;
    const modelConfigs: ModelConfig[] = [{
      url: 'http://p1/v1',
      model: 'gpt-4o',
      aiProviderId: 'p1',
      aiProviderModelId: 'uuid-1'
    }];

    // 2. Simulate failures (threshold = 3)
    let fetchCalls = 0;
    // @ts-ignore
    globalThis.fetch = async () => {
      fetchCalls++;
      return new Response('Error', { status: 500 });
    };

    // Perform 3 requests
    await chatService.handleChatRequest(tenant, { messages: [] }, modelConfigs);
    await chatService.handleChatRequest(tenant, { messages: [] }, modelConfigs);
    await chatService.handleChatRequest(tenant, { messages: [] }, modelConfigs);

    expect(fetchCalls).toBe(3);
    expect(cb.getState('uuid-1')).toBe('OPEN');

    // 3. The FOURTH request must fail with an explicit error without calling fetch
    const result = await chatService.handleChatRequest(tenant, { messages: [] }, modelConfigs);
    
    expect(fetchCalls).toBe(3); // Should not increase!
    expect(result.isErr()).toBe(true);
    if (result.isErr()) {
        expect(result.error.code).toBe('ai_unavailable');
    }
  });
});
