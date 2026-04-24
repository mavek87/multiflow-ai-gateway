/**
 * Tracks per-model performance metrics using Exponential Moving Average (EMA).
 *
 * EMA with α=0.1 weights recent calls more heavily while keeping the full history
 * in a single number - no unbounded array of past values needed.
 * Formula: ema = α * newValue + (1 - α) * previousEma
 *
 * On the very first call for a model the raw value is used directly (no prior EMA to blend with).
 */

const ALPHA = 0.1;

export type ModelMetrics = {
  calls: number;
  successRate: number;
  /** EMA of total response time (ms). Used by selectors as the latency signal. */
  latencyEma: number;
  /** EMA of time-to-first-token (ms). Separate from latencyEma - relevant for stream quality. */
  ttftEma: number;
  /** Raw success count. Used by Thompson Sampling for Beta distribution. */
  successCount: number;
  /** Raw failure count. Used by Thompson Sampling for Beta distribution. */
  failureCount: number;
  /**
   * Online variance of the reward signal (Welford's algorithm).
   * Used by UCB1-Tuned to tighten the exploration term when rewards are consistent.
   */
  rewardVariance: number;
};

const DEFAULT_METRICS: ModelMetrics = {
  calls: 0,
  successRate: 1,
  latencyEma: 0,
  ttftEma: 0,
  successCount: 0,
  failureCount: 0,
  rewardVariance: 0,
};

function applyEma(isFirstCall: boolean, newValue: number, previousEma: number): number {
  return isFirstCall ? newValue : ALPHA * newValue + (1 - ALPHA) * previousEma;
}

/**
 * Welford's online algorithm for computing running variance.
 * Returns updated { mean, variance } given a new sample and previous state.
 */
function welfordUpdate(n: number, mean: number, m2: number, newValue: number): { mean: number; m2: number; variance: number } {
  const delta = newValue - mean;
  const newMean = mean + delta / n;
  const delta2 = newValue - newMean;
  const newM2 = m2 + delta * delta2;
  return { mean: newMean, m2: newM2, variance: n > 1 ? newM2 / (n - 1) : 0 };
}

export class MetricsStore {
  private store = new Map<string, ModelMetrics>();
  // Welford state (not exposed in ModelMetrics to keep the public type clean)
  private welford = new Map<string, { mean: number; m2: number }>();

  get(model: string): ModelMetrics {
    return this.store.get(model) ?? { ...DEFAULT_METRICS };
  }

  record(model: string, data: { latencyMs: number; ttftMs: number; success: boolean }): void {
    const prev = this.get(model);
    const isFirstCall = prev.calls === 0;
    const newCalls = prev.calls + 1;

    const reward = data.success ? 1 : 0;
    const w = this.welford.get(model) ?? { mean: 0, m2: 0 };
    const { mean, m2, variance } = welfordUpdate(newCalls, w.mean, w.m2, reward);
    this.welford.set(model, { mean, m2 });

    this.store.set(model, {
      calls: newCalls,
      successRate: applyEma(isFirstCall, Number(data.success), prev.successRate),
      latencyEma: applyEma(isFirstCall, data.latencyMs, prev.latencyEma),
      ttftEma: applyEma(isFirstCall, data.ttftMs, prev.ttftEma),
      successCount: prev.successCount + (data.success ? 1 : 0),
      failureCount: prev.failureCount + (data.success ? 0 : 1),
      rewardVariance: variance,
    });
  }

  all(): Map<string, ModelMetrics> {
    return this.store;
  }
}
