import { describe, test, expect } from 'bun:test';
import { AIRouter } from './ai-router';
import { MetricsStore } from '@/engine/observability/metrics';
import { CircuitBreaker } from '@/engine/resilience/circuit-breaker';
import { UCB1TunedSelector } from '@/engine/selection/algorithms/ucb1-tuned';
import { HttpProviderClient } from '@/engine/client/http-provider-client';
import { mockSseResponse } from '@test/test-setup';

const model = (name: string) => ({
  url: 'http://fake/v1/chat/completions',
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

  for (const m of models) {
    clients.set(m.model, new HttpProviderClient(m, 10000, 60000, false));
    aiProviderIds.set(m.model, { name: m.aiProviderId ?? '', baseUrl: m.aiProviderBaseUrl ?? '' });
  }

  return new AIRouter(clients, metrics, circuitBreaker, selector, aiProviderIds);
}

function mockFetchOk(content = '') {
  // @ts-ignore
  globalThis.fetch = async () => mockSseResponse(content);
}

function mockFetchFail(status = 500) {
  // @ts-ignore
  globalThis.fetch = async () => new Response('', { status });
}

describe('AIRouter - chatStream()', () => {
  test('returns body and model info on success', async () => {
    mockFetchOk();
    const router = createAIRouter([model('m1')]);
    const result = await router.chatStream('system', [{ role: 'user', content: 'hi' }]);
    expect(result).not.toBeNull();
    expect(result!.model).toBe('m1');
    expect(result!.body).toBeDefined();
  });

  test('returns null when all providers fail', async () => {
    mockFetchFail(500);
    const router = createAIRouter([model('m1'), model('m2')]);
    const result = await router.chatStream('system', [{ role: 'user', content: 'hi' }]);
    expect(result).toBeNull();
  });

  test('falls back to second provider if first returns HTTP error', async () => {
    let calls = 0;
    // @ts-ignore
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return new Response('', { status: 500 });
      return mockSseResponse('');
    };
    const m1 = { ...model('m1'), priority: 0 };
    const m2 = { ...model('m2'), priority: 1 };
    const router = createAIRouter([m1, m2]);
    const result = await router.chatStream('system', [{ role: 'user', content: 'hi' }]);
    expect(result).not.toBeNull();
    expect(result!.model).toBe('m2');
    expect(calls).toBe(2);
  });

  test('returns aiProvider from model config', async () => {
    mockFetchOk();
    const config = { ...model('m1'), aiProviderId: 'groq-id' };
    const router = createAIRouter([config]);
    const result = await router.chatStream('system', [{ role: 'user', content: 'hi' }]);
    expect(result!.aiProvider).toBe('groq-id');
  });
});
