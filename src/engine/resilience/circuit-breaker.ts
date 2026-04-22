/**
 * Per-model circuit breaker that prevents wasting time on known-down models.
 *
 * State machine (per model):
 *
 *   CLOSED ──(3 hard failures)──→ OPEN ──(30 s timeout)──→ HALF_OPEN
 *     ↑                                                          │
 *     └──────────────(2 consecutive successes)───────────────────┘
 *
 * - CLOSED    : normal operation, all calls go through.
 * - OPEN      : model is skipped — isAvailable() returns false immediately.
 * - HALF_OPEN : one probe is allowed; 2 consecutive successes restore to CLOSED.
 *
 * Failure types:
 * - Hard failure (HTTP 4xx/5xx): opens after 3 consecutive.
 * - Soft failure (timeout):      opens after 5 consecutive.
 */

type State = 'CLOSED' | 'OPEN' | 'HALF_OPEN';

const HARD_FAILURE_THRESHOLD = 3;
const SOFT_FAILURE_THRESHOLD = 5;
const HALF_OPEN_SUCCESSES_REQUIRED = 2;
const OPEN_TIMEOUT_MS = 30_000;

type BreakerState = {
  state: State;
  consecutiveHardFailures: number;
  consecutiveSoftFailures: number;
  halfOpenSuccesses: number;
  openedAt: number | null;
};

export class CircuitBreaker {
  private breakers = new Map<string, BreakerState>();

  isAvailable(model: string): boolean {
    const breaker = this.getBreaker(model);
    this.tryRecoverFromOpen(breaker);
    return breaker.state === 'CLOSED' || breaker.state === 'HALF_OPEN';
  }

  recordSuccess(model: string): void {
    const breaker = this.getBreaker(model);
    if (breaker.state === 'HALF_OPEN') {
      breaker.halfOpenSuccesses += 1;
      if (breaker.halfOpenSuccesses >= HALF_OPEN_SUCCESSES_REQUIRED) {
        this.closeCircuit(breaker);
      }
    } else {
      this.resetFailureCounters(breaker);
    }
  }

  recordHardFailure(model: string): void {
    const breaker = this.getBreaker(model);
    breaker.consecutiveHardFailures += 1;
    breaker.consecutiveSoftFailures = 0;
    if (breaker.state !== 'OPEN' && breaker.consecutiveHardFailures >= HARD_FAILURE_THRESHOLD) {
      this.openCircuit(breaker);
    }
  }

  recordSoftFailure(model: string): void {
    const breaker = this.getBreaker(model);
    breaker.consecutiveSoftFailures += 1;
    if (breaker.state !== 'OPEN' && breaker.consecutiveSoftFailures >= SOFT_FAILURE_THRESHOLD) {
      this.openCircuit(breaker);
    }
  }

  getState(model: string): State {
    return this.getBreaker(model).state;
  }

  private getBreaker(model: string): BreakerState {
    if (!this.breakers.has(model)) {
      this.breakers.set(model, {
        state: 'CLOSED',
        consecutiveHardFailures: 0,
        consecutiveSoftFailures: 0,
        halfOpenSuccesses: 0,
        openedAt: null,
      });
    }
    return this.breakers.get(model)!;
  }

  /**
   * Transitions OPEN → HALF_OPEN if the recovery timeout has elapsed.
   * Called inside isAvailable() so the state is always current before being read.
   */
  private tryRecoverFromOpen(breaker: BreakerState): void {
    if (breaker.state !== 'OPEN') return;
    if (breaker.openedAt !== null && Date.now() - breaker.openedAt >= OPEN_TIMEOUT_MS) {
      breaker.state = 'HALF_OPEN';
      breaker.halfOpenSuccesses = 0;
    }
  }

  private openCircuit(breaker: BreakerState): void {
    breaker.state = 'OPEN';
    breaker.openedAt = Date.now();
  }

  private closeCircuit(breaker: BreakerState): void {
    breaker.state = 'CLOSED';
    breaker.halfOpenSuccesses = 0;
    breaker.openedAt = null;
    this.resetFailureCounters(breaker);
  }

  private resetFailureCounters(breaker: BreakerState): void {
    breaker.consecutiveHardFailures = 0;
    breaker.consecutiveSoftFailures = 0;
  }
}
