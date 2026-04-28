import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const requestLog = sqliteTable('request_log', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id').notNull(),
  ts: integer('ts').notNull(),
  model: text('model').notNull(),
  aiProviderId: text('ai_provider_id').notNull(),
  aiProviderName: text('ai_provider_name').notNull(),
  latencyMs: integer('latency_ms').notNull(),
  success: integer('success', { mode: 'boolean' }).notNull(),
  statusCode: integer('status_code').notNull(),
}, t => [index('request_log_tenant_ts_idx').on(t.tenantId, t.ts)]);
