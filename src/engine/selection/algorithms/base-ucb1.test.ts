import { describe, test, expect } from 'bun:test';
import { computeReward } from './base-ucb1';

describe('BaseUCB1Selector utils', () => {
  describe('computeReward', () => {
    test('returns 1.0 for perfect success and zero latency', () => {
      expect(computeReward(1, 0, 100)).toBe(1.0);
    });

    test('returns 0.0 for total failure and max latency', () => {
      expect(computeReward(0, 100, 100)).toBe(0.0);
    });

    test('weights success and latency equally (0.5 each)', () => {
      // 1.0 success, 1.0 normalized latency -> 0.5 * 1 + 0.5 * (1 - 1) = 0.5
      expect(computeReward(1, 100, 100)).toBe(0.5);
      // 0.0 success, 0.0 normalized latency -> 0.5 * 0 + 0.5 * (1 - 0) = 0.5
      expect(computeReward(0, 0, 100)).toBe(0.5);
    });

    test('handles latency higher than maxLatency by capping or proportional reduction', () => {
      // computeReward uses: latencyEma / maxLatency
      // if latencyEma (120) / maxLatency (100) = 1.2
      // result = 1 * 0.5 + (1 - 1.2) * 0.5 = 0.5 - 0.1 = 0.4
      expect(computeReward(1, 120, 100)).toBe(0.4);
    });

    test('handles zero maxLatency by using 1 as fallback in the caller, but here it might be -Infinity if not careful', () => {
      // The caller (BaseUCB1Selector) ensures maxLatency is at least 1.
      // If we pass 0 here, 50/0 is Infinity, and 1-Infinity is -Infinity.
      expect(computeReward(1, 50, 0)).toBe(-Infinity);
    });
  });
});
