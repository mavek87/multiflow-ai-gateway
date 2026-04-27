/**
 * Model selector using Thompson Sampling.
 *
 * Each model is modelled as a Beta(alpha, beta) distribution where:
 *   alpha = successCount + 1  (successes, Laplace smoothing)
 *   beta  = failureCount + 1  (failures, Laplace smoothing)
 *
 * At each selection, a sample is drawn from every model's distribution.
 * The model with the highest sample wins. Models with high uncertainty
 * (few observations) have wide distributions and get explored naturally --
 * no explicit warmup phase needed.
 *
 * Does not consider latency. Best suited when latency differences between
 * providers are negligible and only availability/error rates matter.
 */

import type { MetricsStore } from '@/engine/observability/metrics';
import type { CircuitBreaker } from '@/engine/resilience/circuit-breaker';
import type { ModelSelector } from '@/engine/selection/model-selector.types';
import { createLogger } from '@/utils/logger';

const log = createLogger('SELECTOR');

export class ThompsonSelector implements ModelSelector {
  select(models: string[], metrics: MetricsStore, circuitBreaker: CircuitBreaker): string | null {
    const available = models.filter((id) => circuitBreaker.isAvailable(id));
    if (available.length === 0) return null;

    let bestModel: string | null = null;
    let bestSample = -Infinity;

    for (const modelId of available) {
      const { successCount, failureCount } = metrics.get(modelId);
      const sample = sampleBeta(successCount + 1, failureCount + 1);
      if (sample > bestSample) {
        bestSample = sample;
        bestModel = modelId;
      }
    }

    log.debug({ model: bestModel, sample: bestSample.toFixed(3) }, 'selected (Thompson)');
    return bestModel;
  }
}

/**
 * Samples from a Beta(alpha, beta) distribution using the Johnk method:
 * draw two Gamma samples and normalize. For small integer parameters
 * (alpha, beta <= ~20) this is accurate and fast enough.
 *
 * Gamma(k, 1) is approximated via the Marsaglia-Tsang method for k >= 1,
 * and via the transformation Gamma(k) = Gamma(k+1) / U^(1/k) for k < 1.
 */
function sampleBeta(alpha: number, beta: number): number {
  const x = sampleGamma(alpha);
  const y = sampleGamma(beta);
  return x / (x + y);
}

function sampleGamma(shape: number): number {
  if (shape < 1) {
    // Ahrens-Dieter transformation: Gamma(k) = Gamma(k+1) * U^(1/k)
    return sampleGamma(shape + 1) * Math.pow(Math.random(), 1 / shape);
  }
  // Marsaglia-Tsang squeeze method
  const d = shape - 1 / 3;
  const c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x: number;
    let v: number;
    do {
      x = randn();
      v = 1 + c * x;
    } while (v <= 0);
    v = v * v * v;
    const u = Math.random();
    if (u < 1 - 0.0331 * (x * x) * (x * x)) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}

/** Standard normal sample via Box-Muller. */
function randn(): number {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}
