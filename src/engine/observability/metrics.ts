/**
 * Tracks per-model performance metrics using Exponential Moving Average (EMA).
 *
 * EMA with α=0.1 weights recent calls more heavily while keeping the full history
 * in a single number — no unbounded array of past values needed.
 * Formula: ema = α * newValue + (1 - α) * previousEma
 *
 * On the very first call for a model the raw value is used directly (no prior EMA to blend with).
 */

const ALPHA = 0.1;

export type ModelMetrics = {
  calls: number;
  successRate: number;
  /** EMA of total response time (ms). Used by UCB1Selector as the latency signal. */
  latencyEma: number;
  /** EMA of time-to-first-token (ms). Separate from latencyEma — relevant for stream quality. */
  ttftEma: number;
};

const DEFAULT_METRICS: ModelMetrics = {
  calls: 0,
  successRate: 1,
  latencyEma: 0,
  ttftEma: 0,
};

function applyEma(isFirstCall: boolean, newValue: number, previousEma: number): number {
  return isFirstCall ? newValue : ALPHA * newValue + (1 - ALPHA) * previousEma;
}

export class MetricsStore {
  private store = new Map<string, ModelMetrics>();

  get(model: string): ModelMetrics {
    return this.store.get(model) ?? { ...DEFAULT_METRICS };
  }

  record(model: string, data: { latencyMs: number; ttftMs: number; success: boolean }): void {
    const prev = this.get(model);
    const isFirstCall = prev.calls === 0;

    this.store.set(model, {
      calls: prev.calls + 1,
      successRate: applyEma(isFirstCall, Number(data.success), prev.successRate),
      latencyEma: applyEma(isFirstCall, data.latencyMs, prev.latencyEma),
      ttftEma: applyEma(isFirstCall, data.ttftMs, prev.ttftEma),
    });
  }

  all(): Map<string, ModelMetrics> {
    return this.store;
  }
}
