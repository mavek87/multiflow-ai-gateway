import type { MetricsStore } from '@/engine/observability/metrics';
import type { CircuitBreaker } from '@/engine/resilience/circuit-breaker';
import type { ModelConfig } from '@/engine/types';

export type ModelResolutionError = 'no_providers' | 'model_not_found';

export interface ModelResolutionOptions {
    tenantId: string;
    requestedModel?: string;
    forceAiProviderId?: string | null;
}

export type ModelResolutionResult =
    | { ok: true; configs: ModelConfig[] }
    | { ok: false; error: ModelResolutionError; model?: string };

/**
 * ModelSelector — strategy interface for model selection algorithms.
 *
 * Implement this interface to swap the selection strategy without touching
 * RoutingAIClient. Current implementation: UCB1Selector.
 *
 * TODO: Known alternatives worth implementing post-MVP:
 *
 * - **Thompson Sampling**: Bayesian approach — models a Beta distribution per model
 *   (successes/failures) and samples from it. Adapts faster than UCB1 when one model
 *   degrades suddenly. Used by TensorZero and some OpenRouter internals.
 *
 * - **EXP3 (Exponential-weight algorithm for Exploration and Exploitation)**:
 *   Designed for adversarial settings — when model quality can change unpredictably
 *   (e.g. free-tier rate limiting, non-stationary latency). More robust than UCB1 in
 *   real-world provider conditions.
 *
 * - **Epsilon-greedy with decay**: Simplest alternative. Exploit the best-known model
 *   with probability (1-ε), explore randomly with probability ε. ε decays over time.
 *   Lower overhead, easier to reason about, worse asymptotic performance than UCB1.
 *
 * - **Latency-weighted round-robin**: No bandit math — just round-robin filtered by
 *   circuit breaker, weighted by recent latency. Predictable, debuggable, no warmup.
 *   Used by some simpler gateways (BricksLLM-style).
 *
 * UCB1 weakness in LLM routing specifically:
 * - Assumes stationary reward distribution — provider latency and availability are
 *   highly non-stationary (rate limits, cold starts, model swaps).
 * - Exploration constant C=1.0 is a guess — no principled way to tune it without
 *   domain-specific benchmarks.
 * - Logarithmic exploration term grows slowly — UCB1 under-explores when a previously
 *   good model silently degrades.
 */
export interface ModelSelector {
  select(
    models: string[],
    metrics: MetricsStore,
    circuitBreaker: CircuitBreaker,
  ): string | null;
}
