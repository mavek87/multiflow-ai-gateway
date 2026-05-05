import { test, expect } from 'bun:test';
import { createLogger } from '@/utils/logger';

test('L1: createLogger returns a pino child with the given label binding', () => {
  const log = createLogger('TEST_LABEL');
  expect(typeof log.info).toBe('function');
  expect(typeof log.warn).toBe('function');
  expect(typeof log.error).toBe('function');
  expect((log.bindings() as Record<string, unknown>).label).toBe('TEST_LABEL');
});

test('L2: child loggers have independent labels', () => {
  const a = createLogger('A');
  const b = createLogger('B');
  expect((a.bindings() as Record<string, unknown>).label).toBe('A');
  expect((b.bindings() as Record<string, unknown>).label).toBe('B');
});
