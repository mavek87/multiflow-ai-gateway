/**
 * Model selector using Sliding Window UCB1-Tuned (SW-UCB1-Tuned).
 *
 * Identical to UCB1-Tuned but metrics are computed from the last W observations
 * instead of full history. This makes the selector reactive to provider
 * degradations and recoveries within W calls rather than waiting for historical
 * data to be diluted.
 *
 * Recommended over UCB1-Tuned when traffic is high enough to fill the window
 * (hundreds of calls/day per tenant or more). With very low traffic the window
 * stays sparse and estimates become noisy -- prefer UCB1-Tuned in that case.
 *
 * Default window size: 100 observations per model.
 */

import type {MetricsStore, ModelMetrics} from '@/engine/observability/metrics';
import {BaseUCB1Selector} from '@/engine/selection/algorithms/base-ucb1';

type Observation = { success: boolean; latencyMs: number };

const DEFAULT_WINDOW = 100;

export class SWUcb1TunedSelector extends BaseUCB1Selector {
    private readonly windowSize: number;
    private readonly windows = new Map<string, Observation[]>();

    constructor(windowSize = DEFAULT_WINDOW) {
        super();
        this.windowSize = windowSize;
    }

    record(modelId: string, obs: Observation): void {
        const buffer = this.windows.get(modelId) ?? [];
        buffer.push(obs);
        if (buffer.length > this.windowSize) buffer.shift();
        this.windows.set(modelId, buffer);
    }

    protected resolveMetrics(modelId: string, metrics: MetricsStore): ModelMetrics {
        const buffer = this.windows.get(modelId);
        if (!buffer || buffer.length === 0) return metrics.get(modelId);
        return this.computeWindowMetrics(buffer);
    }

    protected label(): string {
        return 'SW-UCB1-Tuned';
    }

    private computeWindowMetrics(buffer: Observation[]): ModelMetrics {
        const n = buffer.length;
        const successCount = buffer.filter((o) => o.success).length;
        const failureCount = n - successCount;
        const successRate = successCount / n;
        const latencyEma = buffer.reduce((sum, o) => sum + o.latencyMs, 0) / n;

        let mean = 0;
        let m2 = 0;
        for (let i = 0; i < n; i++) {
            const reward = buffer[i]!.success ? 1 : 0;
            const delta = reward - mean;
            mean += delta / (i + 1);
            m2 += delta * (reward - mean);
        }
        const rewardVariance = n > 1 ? m2 / (n - 1) : 0;

        return {
            calls: n,
            successRate,
            latencyEma,
            ttftEma: 0,
            successCount,
            failureCount,
            rewardVariance,
        };
    }
}

