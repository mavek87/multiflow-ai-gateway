import { test, expect, describe } from 'bun:test';
import { UCB1TunedSelector } from '@/engine/selection/algorithms/ucb1-tuned';
import { SWUcb1TunedSelector } from '@/engine/selection/algorithms/sw-ucb1-tuned';
import { ThompsonSelector } from '@/engine/selection/algorithms/thompson';
import { MetricsStore } from '@/engine/observability/metrics';
import { CircuitBreaker } from '@/engine/resilience/circuit-breaker';

describe('UCB1TunedSelector', () => {
  test('returns null if no models available', () => {
    const selector = new UCB1TunedSelector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();
    for (let i = 0; i < 3; i++) cb.recordHardFailure('only-model');
    expect(selector.select(['only-model'], metrics, cb)).toBeNull();
  });

  test('warmup: returns first unseen model', () => {
    const selector = new UCB1TunedSelector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    metrics.record('fast-model', { latencyMs: 500, ttftMs: 50, success: true });

    const chosen = selector.select(['fast-model', 'backup-model', 'slow-model'], metrics, cb);
    expect(chosen).toBe('backup-model');
  });

  test('warmup: skips models with open circuit', () => {
    const selector = new UCB1TunedSelector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    metrics.record('fast-model', { latencyMs: 500, ttftMs: 50, success: true });
    for (let i = 0; i < 3; i++) cb.recordHardFailure('broken-model');

    const chosen = selector.select(['fast-model', 'broken-model', 'unseen-model'], metrics, cb);
    expect(chosen).toBe('unseen-model');
  });

  test('after warmup, picks model with best score', () => {
    const selector = new UCB1TunedSelector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    for (let i = 0; i < 5; i++) metrics.record('fast-reliable-model', { latencyMs: 200, ttftMs: 20, success: true });
    for (let i = 0; i < 5; i++) metrics.record('slow-model', { latencyMs: 5000, ttftMs: 500, success: true });
    for (let i = 0; i < 5; i++) metrics.record('unreliable-model', { latencyMs: 200, ttftMs: 20, success: false });

    const chosen = selector.select(['fast-reliable-model', 'slow-model', 'unreliable-model'], metrics, cb);
    expect(chosen).toBe('fast-reliable-model');
  });

  test('excludes models with open circuit', () => {
    const selector = new UCB1TunedSelector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    for (let i = 0; i < 5; i++) metrics.record('primary-model', { latencyMs: 200, ttftMs: 20, success: true });
    for (let i = 0; i < 5; i++) metrics.record('backup-model', { latencyMs: 200, ttftMs: 20, success: true });
    for (let i = 0; i < 3; i++) cb.recordHardFailure('primary-model');

    const chosen = selector.select(['primary-model', 'backup-model'], metrics, cb);
    expect(chosen).toBe('backup-model');
  });
});

describe('SWUcb1TunedSelector', () => {
  test('returns null if no models available', () => {
    const selector = new SWUcb1TunedSelector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();
    for (let i = 0; i < 3; i++) cb.recordHardFailure('only-model');
    expect(selector.select(['only-model'], metrics, cb)).toBeNull();
  });

  test('warmup: returns first unseen model before any record() call', () => {
    const selector = new SWUcb1TunedSelector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    selector.record('fast-model', { success: true, latencyMs: 200 });
    const chosen = selector.select(['fast-model', 'backup-model'], metrics, cb);
    expect(chosen).toBe('backup-model');
  });

  test('after warmup, prefers fast and reliable model', () => {
    const selector = new SWUcb1TunedSelector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    for (let i = 0; i < 10; i++) selector.record('fast-reliable', { success: true, latencyMs: 200 });
    for (let i = 0; i < 10; i++) selector.record('slow-model', { success: true, latencyMs: 5000 });
    for (let i = 0; i < 10; i++) selector.record('unreliable', { success: false, latencyMs: 200 });

    const chosen = selector.select(['fast-reliable', 'slow-model', 'unreliable'], metrics, cb);
    expect(chosen).toBe('fast-reliable');
  });

  test('reacts to degradation within the window', () => {
    const selector = new SWUcb1TunedSelector(10);
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    // Initially model-a is best
    for (let i = 0; i < 10; i++) selector.record('model-a', { success: true, latencyMs: 200 });
    for (let i = 0; i < 10; i++) selector.record('model-b', { success: true, latencyMs: 5000 });

    // model-a degrades: fill window with failures
    for (let i = 0; i < 10; i++) selector.record('model-a', { success: false, latencyMs: 200 });

    const chosen = selector.select(['model-a', 'model-b'], metrics, cb);
    expect(chosen).toBe('model-b');
  });

  test('excludes models with open circuit', () => {
    const selector = new SWUcb1TunedSelector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    for (let i = 0; i < 5; i++) selector.record('primary', { success: true, latencyMs: 200 });
    for (let i = 0; i < 5; i++) selector.record('backup', { success: true, latencyMs: 200 });
    for (let i = 0; i < 3; i++) cb.recordHardFailure('primary');

    const chosen = selector.select(['primary', 'backup'], metrics, cb);
    expect(chosen).toBe('backup');
  });

  test('falls back to MetricsStore data for models with empty window', () => {
    const selector = new SWUcb1TunedSelector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    // model-a has window data, model-b only has MetricsStore data
    for (let i = 0; i < 5; i++) selector.record('model-a', { success: true, latencyMs: 200 });
    for (let i = 0; i < 5; i++) metrics.record('model-b', { latencyMs: 5000, ttftMs: 500, success: true });

    const chosen = selector.select(['model-a', 'model-b'], metrics, cb);
    expect(chosen).toBe('model-a');
  });
});

describe('ThompsonSelector', () => {
  test('returns null if no models available', () => {
    const selector = new ThompsonSelector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();
    for (let i = 0; i < 3; i++) cb.recordHardFailure('only-model');
    expect(selector.select(['only-model'], metrics, cb)).toBeNull();
  });

  test('returns a model from the list', () => {
    const selector = new ThompsonSelector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();
    const chosen = selector.select(['model-a', 'model-b'], metrics, cb);
    expect(chosen).not.toBeNull();
    expect(['model-a', 'model-b']).toContain(chosen!);
  });

  test('excludes models with open circuit', () => {
    const selector = new ThompsonSelector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();
    for (let i = 0; i < 3; i++) cb.recordHardFailure('broken-model');
    const chosen = selector.select(['broken-model', 'healthy-model'], metrics, cb);
    expect(chosen).toBe('healthy-model');
  });

  test('strongly prefers the reliable model after many observations', () => {
    const selector = new ThompsonSelector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    // reliable-model: 50 successes, unreliable-model: 50 failures
    for (let i = 0; i < 50; i++) metrics.record('reliable-model', { latencyMs: 200, ttftMs: 20, success: true });
    for (let i = 0; i < 50; i++) metrics.record('unreliable-model', { latencyMs: 200, ttftMs: 20, success: false });

    // Over 100 trials, reliable-model should win the vast majority
    let reliableWins = 0;
    for (let i = 0; i < 100; i++) {
      if (selector.select(['reliable-model', 'unreliable-model'], metrics, cb) === 'reliable-model') {
        reliableWins++;
      }
    }
    expect(reliableWins).toBeGreaterThan(90);
  });

  test('explores unseen models (no explicit warmup needed)', () => {
    const selector = new ThompsonSelector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    // model-a has many successes, model-b is unseen
    for (let i = 0; i < 20; i++) metrics.record('model-a', { latencyMs: 200, ttftMs: 20, success: true });

    // model-b should be selected at least some of the time due to high uncertainty
    let modelBSelected = 0;
    for (let i = 0; i < 100; i++) {
      if (selector.select(['model-a', 'model-b'], metrics, cb) === 'model-b') modelBSelected++;
    }
    expect(modelBSelected).toBeGreaterThan(0);
  });
});
