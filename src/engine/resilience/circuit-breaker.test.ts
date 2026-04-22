import { test, expect, describe } from 'bun:test';
import { CircuitBreaker } from './circuit-breaker';

describe('CircuitBreaker', () => {
  test('starts CLOSED and available', () => {
    const cb = new CircuitBreaker();
    expect(cb.isAvailable('primary-model')).toBe(true);
    expect(cb.getState('primary-model')).toBe('CLOSED');
  });

  test('opens after 3 hard failures', () => {
    const cb = new CircuitBreaker();
    cb.recordHardFailure('primary-model');
    cb.recordHardFailure('primary-model');
    expect(cb.isAvailable('primary-model')).toBe(true);
    cb.recordHardFailure('primary-model');
    expect(cb.getState('primary-model')).toBe('OPEN');
    expect(cb.isAvailable('primary-model')).toBe(false);
  });

  test('opens after 5 soft failures', () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 4; i++) cb.recordSoftFailure('primary-model');
    expect(cb.isAvailable('primary-model')).toBe(true);
    cb.recordSoftFailure('primary-model');
    expect(cb.getState('primary-model')).toBe('OPEN');
    expect(cb.isAvailable('primary-model')).toBe(false);
  });

  test('hard failure resets soft failure counter', () => {
    const cb = new CircuitBreaker();
    cb.recordSoftFailure('primary-model');
    cb.recordSoftFailure('primary-model');
    cb.recordHardFailure('primary-model'); // resets soft counter
    // need 3 hard failures to open
    expect(cb.getState('primary-model')).toBe('CLOSED');
  });

  test('transitions to HALF_OPEN after timeout', () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 3; i++) cb.recordHardFailure('primary-model');
    expect(cb.getState('primary-model')).toBe('OPEN');

    // Simulate timeout by patching internal state
    const breakerState = (cb as any).breakers.get('primary-model');
    breakerState.openedAt = Date.now() - 31_000;

    expect(cb.isAvailable('primary-model')).toBe(true);
    expect(cb.getState('primary-model')).toBe('HALF_OPEN');
  });

  test('requires 2 successes in HALF_OPEN to close', () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 3; i++) cb.recordHardFailure('primary-model');
    const breakerState = (cb as any).breakers.get('primary-model');
    breakerState.openedAt = Date.now() - 31_000;
    cb.isAvailable('primary-model'); // triggers transition to HALF_OPEN

    cb.recordSuccess('primary-model');
    expect(cb.getState('primary-model')).toBe('HALF_OPEN');
    cb.recordSuccess('primary-model');
    expect(cb.getState('primary-model')).toBe('CLOSED');
  });

  test('success in CLOSED resets failure counters', () => {
    const cb = new CircuitBreaker();
    cb.recordHardFailure('primary-model');
    cb.recordHardFailure('primary-model');
    cb.recordSuccess('primary-model');
    cb.recordHardFailure('primary-model');
    cb.recordHardFailure('primary-model');
    // counter was reset, still need 3 from now
    expect(cb.getState('primary-model')).toBe('CLOSED');
  });

  test('single hard failure does not open circuit', () => {
    const cb = new CircuitBreaker();
    cb.recordHardFailure('primary-model');
    expect(cb.getState('primary-model')).toBe('CLOSED');
    expect(cb.isAvailable('primary-model')).toBe(true);
  });

  test('multiple soft failures below threshold do not open', () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 4; i++) cb.recordSoftFailure('primary-model');
    expect(cb.isAvailable('primary-model')).toBe(true);
  });

  test('two models have independent circuit state', () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 3; i++) cb.recordHardFailure('failing-model');
    expect(cb.isAvailable('failing-model')).toBe(false);
    expect(cb.isAvailable('healthy-model')).toBe(true);
  });
});
