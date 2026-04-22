/**
 * Model selector using the UCB1 (Upper Confidence Bound) algorithm.
 *
 * UCB1 balances exploitation (use the best-known model) with exploration
 * (try models that haven't been called much yet):
 *
 *   score(model) = reward(model) + C * sqrt(ln(totalCalls) / calls(model))
 *
 * The exploration term grows for models with few calls, ensuring every model
 * gets a fair chance before the router commits to a favourite.
 *
 * Warmup phase: any model with 0 calls is returned immediately (round-robin
 * across the list) so UCB1 has at least one data point per model before scoring.
 *
 * C = 1.0 — conservative constant; lower = exploit more, higher = explore more.
 */

import type { MetricsStore } from '@/engine/observability/metrics';
import type { CircuitBreaker } from '@/engine/resilience/circuit-breaker';
import type { ModelSelector } from './types';
import { createLogger } from '@/utils/logger';

const log = createLogger('SELECTOR');

const UCB1_EXPLORATION_CONSTANT = 1.0;

export class UCB1Selector implements ModelSelector {
  select(models: string[], metrics: MetricsStore, circuitBreaker: CircuitBreaker): string | null {
    const availableModels = models.filter((modelId) => circuitBreaker.isAvailable(modelId));
    if (availableModels.length === 0) return null;

    const unseenModel = availableModels.find((modelId) => metrics.get(modelId).calls === 0);
    if (unseenModel) {
      log.debug({ model: unseenModel }, 'selected (warmup)');
      return unseenModel;
    }

    return this.pickByUCB1(availableModels, metrics);
  }

  private pickByUCB1(availableModels: string[], metrics: MetricsStore): string | null {
    const totalCalls = availableModels.reduce((sum, modelId) => sum + metrics.get(modelId).calls, 0);
    const maxLatency = this.maxLatencyAcross(availableModels, metrics);

    let bestModel: string | null = null;
    let bestScore = -Infinity;

    for (const modelId of availableModels) {
      const { calls, successRate, latencyEma } = metrics.get(modelId);
      const reward = computeReward(successRate, latencyEma, maxLatency);
      const exploration = UCB1_EXPLORATION_CONSTANT * Math.sqrt(Math.log(totalCalls) / calls);
      const score = reward + exploration;
      if (score > bestScore) {
        bestScore = score;
        bestModel = modelId;
      }
    }

    log.debug({ model: bestModel, score: bestScore.toFixed(3) }, 'selected (UCB1)');
    return bestModel;
  }

  private maxLatencyAcross(models: string[], metrics: MetricsStore): number {
    const latencies = models.map((modelId) => metrics.get(modelId).latencyEma).filter((l) => l > 0);
    return latencies.length > 0 ? Math.max(...latencies) : 1;
  }
}

/**
 * Reward in [0, 1] — higher is better.
 * Combines success rate (50%) and inverse normalized latency (50%).
 * Latency is normalized so a single slow outlier doesn't collapse all rewards to near-zero.
 */
function computeReward(successRate: number, latencyEma: number, maxLatency: number): number {
  const normalizedLatency = latencyEma / maxLatency;
  return successRate * 0.5 + (1 - normalizedLatency) * 0.5;
}
