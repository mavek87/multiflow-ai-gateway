/**
 * Model selector using the UCB1-Tuned algorithm.
 *
 * UCB1-Tuned is a strictly better variant of UCB1: instead of using the
 * worst-case exploration bound, it uses the observed variance of rewards.
 * When rewards are consistent (low variance), it explores less aggressively.
 * Proven tighter regret bounds than UCB1 (Auer et al., 2002).
 *
 * Uses full history from MetricsStore. Recommended for low-to-medium traffic
 * tenants where observations are scarce and stability matters more than
 * reacting to provider degradations quickly.
 */

import type { ModelMetrics, MetricsStore } from '@/engine/observability/metrics';
import { BaseUCB1Selector } from '@/engine/selection/algorithms/base-ucb1';

export class UCB1TunedSelector extends BaseUCB1Selector {
  protected resolveMetrics(modelId: string, metrics: MetricsStore): ModelMetrics {
    return metrics.get(modelId);
  }

  protected label(): string {
    return 'UCB1-Tuned';
  }
}
