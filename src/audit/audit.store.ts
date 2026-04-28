import { and, asc, count, desc, eq, gt, lt, gte, lte } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import type { DrizzleDb } from '@/db/database';
import { requestLog } from '@/db/schema';

export type AuditLogEntry = {
  tenantId: string;
  aiProvider: { id: string; name: string };
  model: string;
  latencyMs: number;
  success: boolean;
  statusCode: number;
};

export type AuditRecord = {
  id: string;
  tenantId: string;
  ts: number;
  model: string;
  aiProviderId: string;
  aiProviderName: string;
  latencyMs: number;
  success: boolean;
  statusCode: number;
};

export type AuditQueryParams = {
  tenantId?: string;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export class AuditStore {
  constructor(private readonly db: DrizzleDb) {}

  log(entry: AuditLogEntry): void {
    try {
      this.db.insert(requestLog).values({
        id: randomUUID(),
        tenantId: entry.tenantId,
        ts: Date.now(),
        model: entry.model,
        aiProviderId: entry.aiProvider.id,
        aiProviderName: entry.aiProvider.name,
        latencyMs: entry.latencyMs,
        success: entry.success,
        statusCode: entry.statusCode,
      }).run();
    } catch {
      // Non-fatal: audit failure must not break the request
    }
  }

  isAllowed(tenantId: string, limitPerDay: number): boolean {
    const since = Date.now() - DAY_MS;
    const result = this.db
      .select({ count: count() })
      .from(requestLog)
      .where(and(eq(requestLog.tenantId, tenantId), gt(requestLog.ts, since)))
      .get();
    return (result?.count ?? 0) < limitPerDay;
  }

  query(params: AuditQueryParams): AuditRecord[] {
    const { tenantId, from, to, limit = 100, offset = 0 } = params;

    const conditions = [];
    if (tenantId) conditions.push(eq(requestLog.tenantId, tenantId));
    if (from !== undefined) conditions.push(gte(requestLog.ts, from));
    if (to !== undefined) conditions.push(lte(requestLog.ts, to));

    return this.db
      .select()
      .from(requestLog)
      .where(conditions.length > 0 ? and(...conditions) : undefined)
      .orderBy(desc(requestLog.ts))
      .limit(limit)
      .offset(offset)
      .all();
  }

  getRecentRecords(sinceMs: number): { model: string; latencyMs: number; success: boolean }[] {
    return this.db
      .select({ model: requestLog.model, latencyMs: requestLog.latencyMs, success: requestLog.success })
      .from(requestLog)
      .where(gte(requestLog.ts, sinceMs))
      .orderBy(asc(requestLog.ts))
      .all();
  }

  deleteOlderThan(olderThanMs: number): void {
    this.db.delete(requestLog).where(lt(requestLog.ts, olderThanMs)).run();
  }
}
