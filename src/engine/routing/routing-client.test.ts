import { describe, test, expect } from 'bun:test';
import { RoutingAIClient } from './routing-client';
import { MetricsStore } from '@/engine/observability/metrics';
import { CircuitBreaker } from '@/engine/resilience/circuit-breaker';
import { UCB1Selector } from '@/engine/selection/selector';
import { HttpProviderClient } from '@/engine/client/http-provider-client';

const model = (name: string) => ({
  url: 'http://fake/v1/chat/completions',
  model: name,
  priority: 0,
  aiProviderId: 'provider-1',
  aiProviderModelId: 'model-1',
});

function createRoutingClient(models: any[]) {
  const metrics = new MetricsStore();
  const circuitBreaker = new CircuitBreaker();
  const selector = new UCB1Selector();
  const clients = new Map();
  const aiProviderIds = new Map();

  for (const m of models) {
    clients.set(m.model, new HttpProviderClient(m, 10000, 60000, false));
    aiProviderIds.set(m.model, { name: m.aiProviderId ?? '', baseUrl: m.aiProviderBaseUrl ?? '' });
  }

  return new RoutingAIClient(clients, metrics, circuitBreaker, selector, aiProviderIds);
}

function mockFetchOk(sseBody = 'data: [DONE]\n\n') {
  // @ts-ignore
  globalThis.fetch = async () => new Response(sseBody, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
}

function mockFetchFail(status = 500) {
  // @ts-ignore
  globalThis.fetch = async () => new Response('', { status });
}

describe('RoutingAIClient — callStream()', () => {
  test('returns body and model info on success', async () => {
    mockFetchOk();
    const client = createRoutingClient([model('m1')]);
    const result = await client.callStream([{ role: 'user', content: 'hi' }], 'system');
    expect(result).not.toBeNull();
    expect(result!.model).toBe('m1');
    expect(result!.body).toBeDefined();
  });

  test('returns null when all providers fail', async () => {
    mockFetchFail(500);
    const client = createRoutingClient([model('m1'), model('m2')]);
    const result = await client.callStream([{ role: 'user', content: 'hi' }], 'system');
    expect(result).toBeNull();
  });

  test('falls back to second provider if first returns HTTP error', async () => {
    let calls = 0;
    // @ts-ignore
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return new Response('', { status: 500 });
      return new Response('data: [DONE]\n\n', { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
    };
    const m1 = { ...model('m1'), priority: 0 };
    const m2 = { ...model('m2'), priority: 1 };
    const client = createRoutingClient([m1, m2]);
    const result = await client.callStream([{ role: 'user', content: 'hi' }], 'system');
    expect(result).not.toBeNull();
    expect(result!.model).toBe('m2');
    expect(calls).toBe(2);
  });

  test('returns aiProvider from model config', async () => {
    mockFetchOk();
    const config = { ...model('m1'), aiProviderId: 'groq-id' };
    const client = createRoutingClient([config]);
    const result = await client.callStream([{ role: 'user', content: 'hi' }], 'system');
    expect(result!.aiProvider).toBe('groq-id');
  });
});