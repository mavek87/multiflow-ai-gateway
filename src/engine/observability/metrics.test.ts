import { test, expect, describe } from 'bun:test';
import { MetricsStore } from './metrics';

describe('MetricsStore', () => {
  test('returns default metrics for unknown model', () => {
    const store = new MetricsStore();
    const metrics = store.get('unknown-model');
    expect(metrics.calls).toBe(0);
    expect(metrics.successRate).toBe(1);
    expect(metrics.latencyEma).toBe(0);
    expect(metrics.ttftEma).toBe(0);
    expect(metrics.successCount).toBe(0);
    expect(metrics.failureCount).toBe(0);
    expect(metrics.rewardVariance).toBe(0);
  });

  test('first call sets values directly (no EMA on cold start)', () => {
    const store = new MetricsStore();
    store.record('primary-model', { latencyMs: 1000, ttftMs: 200, success: true });
    const metrics = store.get('primary-model');
    expect(metrics.calls).toBe(1);
    expect(metrics.latencyEma).toBe(1000);
    expect(metrics.ttftEma).toBe(200);
    expect(metrics.successRate).toBe(1);
    expect(metrics.successCount).toBe(1);
    expect(metrics.failureCount).toBe(0);
  });

  test('EMA applies on second call', () => {
    const store = new MetricsStore();
    store.record('primary-model', { latencyMs: 1000, ttftMs: 100, success: true });
    store.record('primary-model', { latencyMs: 2000, ttftMs: 300, success: true });
    const metrics = store.get('primary-model');
    // EMA: 0.1 * 2000 + 0.9 * 1000 = 1100
    expect(metrics.latencyEma).toBeCloseTo(1100);
    // EMA ttft: 0.1 * 300 + 0.9 * 100 = 120
    expect(metrics.ttftEma).toBeCloseTo(120);
    expect(metrics.calls).toBe(2);
  });

  test('success rate decreases on failure', () => {
    const store = new MetricsStore();
    store.record('primary-model', { latencyMs: 100, ttftMs: 10, success: true });
    store.record('primary-model', { latencyMs: 100, ttftMs: 10, success: false });
    const metrics = store.get('primary-model');
    // EMA: 0.1 * 0 + 0.9 * 1 = 0.9
    expect(metrics.successRate).toBeCloseTo(0.9);
  });

  test('tracks multiple models independently', () => {
    const store = new MetricsStore();
    store.record('fast-model', { latencyMs: 500, ttftMs: 50, success: true });
    store.record('slow-model', { latencyMs: 2000, ttftMs: 200, success: false });
    expect(store.get('fast-model').latencyEma).toBe(500);
    expect(store.get('slow-model').latencyEma).toBe(2000);
    expect(store.get('fast-model').successRate).toBe(1);
    expect(store.get('slow-model').successRate).toBe(0);
  });

  test('multiple failures bring success rate close to zero', () => {
    const store = new MetricsStore();
    for (let i = 0; i < 10; i++) {
      store.record('flaky-model', { latencyMs: 100, ttftMs: 10, success: false });
    }
    const metrics = store.get('flaky-model');
    expect(metrics.successRate).toBeLessThan(0.1);
  });

  test('consecutive successes maintain high success rate', () => {
    const store = new MetricsStore();
    for (let i = 0; i < 10; i++) {
      store.record('reliable-model', { latencyMs: 100, ttftMs: 10, success: true });
    }
    const metrics = store.get('reliable-model');
    expect(metrics.successRate).toBeGreaterThan(0.9);
  });

  test('successCount and failureCount track raw integers', () => {
    const store = new MetricsStore();
    store.record('m', { latencyMs: 100, ttftMs: 10, success: true });
    store.record('m', { latencyMs: 100, ttftMs: 10, success: true });
    store.record('m', { latencyMs: 100, ttftMs: 10, success: false });
    const metrics = store.get('m');
    expect(metrics.successCount).toBe(2);
    expect(metrics.failureCount).toBe(1);
  });

  test('rewardVariance is 0 after one call (Welford needs at least 2)', () => {
    const store = new MetricsStore();
    store.record('m', { latencyMs: 100, ttftMs: 10, success: true });
    expect(store.get('m').rewardVariance).toBe(0);
  });

  test('rewardVariance increases with mixed outcomes', () => {
    const store = new MetricsStore();
    for (let i = 0; i < 10; i++) store.record('m', { latencyMs: 100, ttftMs: 10, success: i % 2 === 0 });
    const varianceMixed = store.get('m').rewardVariance;

    const store2 = new MetricsStore();
    for (let i = 0; i < 10; i++) store2.record('m', { latencyMs: 100, ttftMs: 10, success: true });
    const varianceConsistent = store2.get('m').rewardVariance;

    expect(varianceMixed).toBeGreaterThan(varianceConsistent);
  });
});
