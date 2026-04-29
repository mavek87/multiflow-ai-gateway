import type { MetricsStore } from '@/engine/observability/metrics';
import type { CircuitBreaker } from '@/engine/resilience/circuit-breaker';

/**
 * ModelSelector -- strategy interface for model selection algorithms.
 */
export interface ModelSelector {
  select(
    models: string[],
    metrics: MetricsStore,
    circuitBreaker: CircuitBreaker,
  ): string | null;

  record?(modelId: string, obs: { success: boolean; latencyMs: number }): void;
}

export type ModelSelectorType = 'thompson' | 'ucb1-tuned' | 'sw-ucb1-tuned';