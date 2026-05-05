import { describe, test, expect, afterEach } from 'bun:test';
import { AIRouter } from './ai-router';
import { MetricsStore } from '@/engine/observability/metrics';
import { CircuitBreaker } from '@/engine/resilience/circuit-breaker';
import type { ModelSelector } from '@/engine/selection/model-selector.types';
import { UCB1TunedSelector } from '@/engine/selection/algorithms/ucb1-tuned';
import { HttpProviderClient } from '@/engine/client/http-provider-client';
import { mockSseResponse, mockFetch, setupTestDb } from '@test/test-setup';
import { AuditStore } from '@/audit/audit.store';
import { CHAT_COMPLETIONS_PATH } from '@/chat/chat.constants';

const model = (name: string) => ({
  url: `http://fake${CHAT_COMPLETIONS_PATH}`,
  model: name,
  priority: 0,
  aiProviderId: 'provider-1',
  aiProviderModelId: 'model-1',
});

function createAIRouter(models: any[]) {
  const metrics = new MetricsStore();
  const circuitBreaker = new CircuitBreaker();
  const selector = new UCB1TunedSelector();
  const clients = new Map();
  const aiProviderIds = new Map();
  const auditStore = new AuditStore(setupTestDb());

  for (const m of models) {
    clients.set(m.model, new HttpProviderClient(m, 10000, 10000, false));
    aiProviderIds.set(m.model, { name: m.aiProviderId ?? '', baseUrl: m.aiProviderBaseUrl ?? '' });
  }

  return new AIRouter(clients, metrics, circuitBreaker, selector, aiProviderIds, auditStore);
}

describe('AIRouter - chatStream()', () => {
  let undoFetch: () => void;

  afterEach(() => undoFetch());

  test('returns body and model info on success', async () => {
    undoFetch = mockFetch(() => mockSseResponse(''));
    const router = createAIRouter([model('m1')]);
    const result = await router.chatStream('system', [{ role: 'user', content: 'hi' }]);
    expect(result).not.toBeNull();
    expect(result!.model).toBe('m1');
    expect(result!.body).toBeDefined();
  });

  test('returns null when all providers fail', async () => {
    undoFetch = mockFetch(() => new Response('', { status: 500 }));
    const router = createAIRouter([model('m1'), model('m2')]);
    const result = await router.chatStream('system', [{ role: 'user', content: 'hi' }]);
    expect(result).toBeNull();
  });

  test('falls back to second provider if first returns HTTP error', async () => {
    let calls = 0;
    undoFetch = mockFetch(() => {
      calls++;
      if (calls === 1) return new Response('', { status: 500 });
      return mockSseResponse('');
    });
    const m1 = { ...model('m1'), priority: 0 };
    const m2 = { ...model('m2'), priority: 1 };
    const router = createAIRouter([m1, m2]);
    const result = await router.chatStream('system', [{ role: 'user', content: 'hi' }]);
    expect(result).not.toBeNull();
    expect(result!.model).toBe('m2');
    expect(calls).toBe(2);
  });

  test('returns aiProvider from model config', async () => {
    undoFetch = mockFetch(() => mockSseResponse(''));
    const config = { ...model('m1'), aiProviderId: 'groq-id' };
    const router = createAIRouter([config]);
    const result = await router.chatStream('system', [{ role: 'user', content: 'hi' }]);
    expect(result!.aiProvider).toBe('groq-id');
  });

  test('calls selector.record if it is implemented', async () => {
    undoFetch = mockFetch(() => mockSseResponse(''));
    let recordCalled = false;
    class MockSelector implements ModelSelector {
      select() { return 'm1'; }
      record() { recordCalled = true; }
    }
    const metrics = new MetricsStore();
    const circuitBreaker = new CircuitBreaker();
    const selector = new MockSelector();
    const clients = new Map();
    clients.set('m1', new HttpProviderClient(model('m1'), 10000, 10000, false));
    const aiProviderIds = new Map();
    const auditStore = new AuditStore(setupTestDb());
    
    const router = new AIRouter(clients, metrics, circuitBreaker, selector, aiProviderIds, auditStore);
    await router.chatStream('system', [{ role: 'user', content: 'hi' }]);
    expect(recordCalled).toBe(true);
  });
});
