import type { MetricsStore } from '@/engine/observability/metrics';
import type { CircuitBreaker } from '@/engine/resilience/circuit-breaker';

/**
 * ModelSelector — strategy interface for model selection algorithms.
 */
export interface ModelSelector {
  select(
    models: string[],
    metrics: MetricsStore,
    circuitBreaker: CircuitBreaker,
  ): string | null;
}
