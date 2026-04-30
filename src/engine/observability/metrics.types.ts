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
