import { describe, test, expect, beforeEach } from 'bun:test';
import { AuditStore } from './audit.store';
import { setupTestDb } from '@test/test-setup';

const entry = (tenantId = 't1') => ({
  tenantId,
  aiProvider: { id: 'p1', name: 'Groq' },
  model: 'llama3',
  latencyMs: 100,
  success: true,
  statusCode: 200,
});

describe('AuditStore', () => {
  let store: AuditStore;

  beforeEach(() => {
    store = new AuditStore(setupTestDb());
  });

  describe('log()', () => {
    test('inserts a record retrievable via query', () => {
      store.log(entry());
      const rows = store.query({});
      expect(rows.length).toBe(1);
      expect(rows[0]!.model).toBe('llama3');
      expect(rows[0]!.aiProviderName).toBe('Groq');
      expect(rows[0]!.tenantId).toBe('t1');
    });

    test('multiple entries are all stored', () => {
      store.log(entry('t1'));
      store.log(entry('t2'));
      store.log(entry('t1'));
      expect(store.query({}).length).toBe(3);
    });
  });

  describe('query()', () => {
    beforeEach(() => {
      store.log(entry('tenant-a'));
      store.log(entry('tenant-b'));
      store.log(entry('tenant-a'));
    });

    test('returns all records when no filters applied', () => {
      expect(store.query({}).length).toBe(3);
    });

    test('filters by tenantId', () => {
      const rows = store.query({ tenantId: 'tenant-a' });
      expect(rows.length).toBe(2);
      expect(rows.every(r => r.tenantId === 'tenant-a')).toBe(true);
    });

    test('respects limit and offset', () => {
      const page1 = store.query({ limit: 2, offset: 0 });
      const page2 = store.query({ limit: 2, offset: 2 });
      expect(page1.length).toBe(2);
      expect(page2.length).toBe(1);
    });

    test('filters by from timestamp', () => {
      const future = Date.now() + 60_000;
      expect(store.query({ from: future }).length).toBe(0);
    });

    test('filters by to timestamp', () => {
      const past = Date.now() - 60_000;
      expect(store.query({ to: past }).length).toBe(0);
    });
  });

  describe('isAllowed()', () => {
    test('returns true when tenant has no entries', () => {
      expect(store.isAllowed('t1', 10)).toBe(true);
    });

    test('returns true when count is below limit', () => {
      store.log(entry('t1'));
      store.log(entry('t1'));
      expect(store.isAllowed('t1', 5)).toBe(true);
    });

    test('returns false when count equals limit', () => {
      store.log(entry('t1'));
      store.log(entry('t1'));
      expect(store.isAllowed('t1', 2)).toBe(false);
    });

    test('returns false when count exceeds limit', () => {
      store.log(entry('t1'));
      store.log(entry('t1'));
      store.log(entry('t1'));
      expect(store.isAllowed('t1', 2)).toBe(false);
    });

    test('does not count entries from other tenants', () => {
      store.log(entry('other-tenant'));
      store.log(entry('other-tenant'));
      store.log(entry('other-tenant'));
      expect(store.isAllowed('t1', 1)).toBe(true);
    });

    test('limit of 0 always blocks', () => {
      expect(store.isAllowed('t1', 0)).toBe(false);
    });
  });

  describe('deleteOlderThan()', () => {
    test('removes records older than the given timestamp', () => {
      store.log(entry());
      const cutoff = Date.now() + 1;
      store.deleteOlderThan(cutoff);
      expect(store.query({}).length).toBe(0);
    });

    test('keeps records newer than the given timestamp', () => {
      const cutoff = Date.now() - 1;
      store.log(entry());
      store.deleteOlderThan(cutoff);
      expect(store.query({}).length).toBe(1);
    });

    test('deletes only old records when mixed', async () => {
      store.log(entry());
      await Bun.sleep(5);
      const cutoff = Date.now();
      await Bun.sleep(5);
      store.log(entry());
      store.deleteOlderThan(cutoff);
      expect(store.query({}).length).toBe(1);
    });
  });
});
