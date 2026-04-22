import { test, expect, describe } from 'bun:test';
import { UCB1Selector } from './selector';
import { MetricsStore } from '@/engine/observability/metrics';
import { CircuitBreaker } from '@/engine/resilience/circuit-breaker';

describe('UCB1Selector', () => {
  test('returns null if no models available', () => {
    const selector = new UCB1Selector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();
    for (let i = 0; i < 3; i++) cb.recordHardFailure('only-model');
    expect(selector.select(['only-model'], metrics, cb)).toBeNull();
  });

  test('warmup: returns first unseen model', () => {
    const selector = new UCB1Selector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    // fast-model has data, backup-model and slow-model have none
    metrics.record('fast-model', { latencyMs: 500, ttftMs: 50, success: true });

    const chosen = selector.select(['fast-model', 'backup-model', 'slow-model'], metrics, cb);
    expect(chosen).toBe('backup-model');
  });

  test('warmup: skips models with open circuit', () => {
    const selector = new UCB1Selector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    metrics.record('fast-model', { latencyMs: 500, ttftMs: 50, success: true });
    for (let i = 0; i < 3; i++) cb.recordHardFailure('broken-model'); // OPEN

    const chosen = selector.select(['fast-model', 'broken-model', 'unseen-model'], metrics, cb);
    expect(chosen).toBe('unseen-model'); // broken-model skipped, unseen-model is warmup candidate
  });

  test('after warmup, picks model with best UCB1 score', () => {
    const selector = new UCB1Selector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    // fast-reliable-model: fast and reliable
    for (let i = 0; i < 5; i++) metrics.record('fast-reliable-model', { latencyMs: 200, ttftMs: 20, success: true });
    // slow-model: high latency
    for (let i = 0; i < 5; i++) metrics.record('slow-model', { latencyMs: 5000, ttftMs: 500, success: true });
    // unreliable-model: frequent failures
    for (let i = 0; i < 5; i++) metrics.record('unreliable-model', { latencyMs: 200, ttftMs: 20, success: false });

    const chosen = selector.select(['fast-reliable-model', 'slow-model', 'unreliable-model'], metrics, cb);
    expect(chosen).toBe('fast-reliable-model');
  });

  test('excludes models with open circuit from UCB1', () => {
    const selector = new UCB1Selector();
    const metrics = new MetricsStore();
    const cb = new CircuitBreaker();

    for (let i = 0; i < 5; i++) metrics.record('primary-model', { latencyMs: 200, ttftMs: 20, success: true });
    for (let i = 0; i < 5; i++) metrics.record('backup-model', { latencyMs: 200, ttftMs: 20, success: true });

    // Open primary-model's circuit
    for (let i = 0; i < 3; i++) cb.recordHardFailure('primary-model');

    const chosen = selector.select(['primary-model', 'backup-model'], metrics, cb);
    expect(chosen).toBe('backup-model');
  });
});
