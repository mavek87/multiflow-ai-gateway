import { describe, expect, it } from 'bun:test';
import { sql } from 'drizzle-orm';
import { db } from '@/db/database';

describe('Database', () => {
  it("should export a ready-to-use 'db' instance", () => {
    expect(db).toBeDefined();
  });

  it('should have initialized and migrated the database', () => {
    expect(typeof db.select).toBe('function');
  });

  it('should have created the tenants table', () => {
    const result = db.all(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='tenants'`);
    expect(result).toHaveLength(1);
  });

  it('should have created the ai_providers table', () => {
    const result = db.all(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='ai_providers'`);
    expect(result).toHaveLength(1);
  });

  it('should have created the gateway_api_keys table', () => {
    const result = db.all(sql`SELECT name FROM sqlite_master WHERE type='table' AND name='gateway_api_keys'`);
    expect(result).toHaveLength(1);
  });
});
