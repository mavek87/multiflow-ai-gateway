import type { ModelMetrics, MetricsStore } from '@/engine/observability/metrics';
import type { CircuitBreaker } from '@/engine/resilience/circuit-breaker';
import type { ModelSelector } from '@/engine/selection/selector.types';
import { createLogger } from '@/utils/logger';

const log = createLogger('SELECTOR');

/**
 * Shared UCB1-Tuned logic.
 *
 * Subclasses override resolveMetrics() to control the observation window:
 * - UCB1TunedSelector: full history from MetricsStore
 * - SWUcb1TunedSelector: sliding window of the last W observations
 *
 * score(model) = reward(model) + sqrt((ln(N) / n) * min(1/4, V(model)))
 * where V(model) = rewardVariance + sqrt(2 * ln(N) / n)
 */
export abstract class BaseUCB1Selector implements ModelSelector {
  select(models: string[], metrics: MetricsStore, circuitBreaker: CircuitBreaker): string | null {
    const availableModels = models.filter((modelId) => circuitBreaker.isAvailable(modelId));
    if (availableModels.length === 0) return null;

    const unseenModel = availableModels.find((modelId) => this.resolveMetrics(modelId, metrics).calls === 0);
    if (unseenModel) {
      log.debug({ model: unseenModel }, 'selected (warmup)');
      return unseenModel;
    }

    return this.pickByUCB1Tuned(availableModels, metrics);
  }

  protected abstract resolveMetrics(modelId: string, metrics: MetricsStore): ModelMetrics;

  protected abstract label(): string;

  private pickByUCB1Tuned(availableModels: string[], metrics: MetricsStore): string | null {
    const resolved = availableModels.map((modelId) => ({
      modelId,
      m: this.resolveMetrics(modelId, metrics),
    }));

    const totalCalls = resolved.reduce((sum, { m }) => sum + m.calls, 0);
    const maxLatency = Math.max(...resolved.map(({ m }) => m.latencyEma).filter((l) => l > 0), 1);

    let bestModel: string | null = null;
    let bestScore = -Infinity;

    for (const { modelId, m } of resolved) {
      const reward = computeReward(m.successRate, m.latencyEma, maxLatency);
      const logRatio = Math.log(totalCalls) / m.calls;
      const varianceBound = m.rewardVariance + Math.sqrt(2 * logRatio);
      const exploration = Math.sqrt(logRatio * Math.min(0.25, varianceBound));
      const score = reward + exploration;
      if (score > bestScore) {
        bestScore = score;
        bestModel = modelId;
      }
    }

    log.debug({ model: bestModel, score: bestScore.toFixed(3) }, `selected (${this.label()})`);
    return bestModel;
  }
}

/** Reward in [0, 1] - higher is better. Combines success rate (50%) and inverse normalized latency (50%). */
export function computeReward(successRate: number, latencyEma: number, maxLatency: number): number {
  const normalizedLatency = latencyEma / maxLatency;
  return successRate * 0.5 + (1 - normalizedLatency) * 0.5;
}
