import { describe, test, expect } from 'bun:test';
import { SWUcb1TunedSelector } from '@/engine/selection/algorithms/sw-ucb1-tuned';
import { MetricsStore } from '@/engine/observability/metrics';
import { CircuitBreaker } from '@/engine/resilience/circuit-breaker';

describe('SWUcb1TunedSelector windowing', () => {
  test('respects the window size and slides', () => {
    const windowSize = 3;
    const selector = new SWUcb1TunedSelector(windowSize);
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    // Fill window with slow calls
    selector.record('model-a', { success: true, latencyMs: 1000 });
    selector.record('model-a', { success: true, latencyMs: 1000 });
    selector.record('model-a', { success: true, latencyMs: 1000 });

    // One more fast call should push out one slow call
    selector.record('model-a', { success: true, latencyMs: 100 });

    // Internal metrics should now be (1000 + 1000 + 100) / 3 = 700
    // We can't access private methods directly, but we can verify behavior
    // by comparing with another model.
    
    selector.record('model-b', { success: true, latencyMs: 750 });
    selector.record('model-b', { success: true, latencyMs: 750 });
    selector.record('model-b', { success: true, latencyMs: 750 });
    
    // model-a (avg 700) should be better than model-b (avg 750)
    expect(selector.select(['model-a', 'model-b'], metrics, cb)).toBe('model-a');
    
    // Push out all slow calls from model-a
    selector.record('model-a', { success: true, latencyMs: 100 });
    selector.record('model-a', { success: true, latencyMs: 100 });
    
    // Now model-a avg should be 100
    // Record something for b that is 200
    selector.record('model-b', { success: true, latencyMs: 200 });
    selector.record('model-b', { success: true, latencyMs: 200 });
    selector.record('model-b', { success: true, latencyMs: 200 });
    
    expect(selector.select(['model-a', 'model-b'], metrics, cb)).toBe('model-a');
  });

  test('correctly computes metrics for a window', () => {
    const selector = new SWUcb1TunedSelector(10);
    
    // This is essentially testing the private computeWindowMetrics through public select()
    // by creating a scenario where its output determines the winner.
    
    // Model A: perfectly consistent 200ms
    for(let i=0; i<5; i++) selector.record('model-a', { success: true, latencyMs: 200 });
    
    // Model B: noisy 200ms (variance)
    selector.record('model-b', { success: true, latencyMs: 100 });
    selector.record('model-b', { success: true, latencyMs: 300 });
    selector.record('model-b', { success: true, latencyMs: 100 });
    selector.record('model-b', { success: true, latencyMs: 300 });
    selector.record('model-b', { success: true, latencyMs: 200 });
    
    // UCB1-Tuned penalizes variance. Model A should win because it has lower variance.
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();
    expect(selector.select(['model-a', 'model-b'], metrics, cb)).toBe('model-a');
  });
});
