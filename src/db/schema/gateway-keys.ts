import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { tenants } from './tenants';

/**
 * GATEWAY API KEYS
 * Bearer tokens that authenticate tenants against the gateway.
 *
 * When a client calls the gateway it passes a raw API key in the Authorization header.
 * The gateway hashes that value and looks it up in this table to identify the owning
 * tenant. The raw key is never stored -- only the hash -- so a database leak does not
 * expose usable credentials.
 *
 * One tenant can hold multiple active keys (e.g., one per application, one per
 * environment), and keys can be rotated by issuing a new one then revoking the old one
 * without any downtime.
 *
 * When it is used: on every inbound HTTP request, during the authentication middleware
 * step, before any routing logic runs.
 *
 * ┌────────────┬─────────┬──────────────────────────────────────────────────────────────────────────┐
 * │ Field      │ Type    │ Description                                                              │
 * ├────────────┼─────────┼──────────────────────────────────────────────────────────────────────────┤
 * │ id         │ text    │ Primary key. UUIDv4 generated at creation time.                          │
 * │ tenantId   │ text    │ Foreign key to tenants.id. Row is deleted when the tenant is deleted.    │
 * │ keyHash    │ text    │ SHA-256 hash of the raw API key. Unique across all keys.                 │
 * │            │         │ The raw key is shown once at creation and never stored.                  │
 * │ createdAt  │ integer │ Unix timestamp of key issuance.                                          │
 * │ lastUsedAt │ integer │ Unix timestamp of the most recent successful authentication.             │
 * │            │         │ Useful for auditing stale keys that can be safely revoked.               │
 * └────────────┬─────────┴──────────────────────────────────────────────────────────────────────────┘
 *
 * Example rows:
 *   { id: "k_01", tenantId: "t_01", keyHash: "e3b0c44...", createdAt: 1700000100, lastUsedAt: 1700500000 }
 *   { id: "k_02", tenantId: "t_01", keyHash: "9f86d08...", createdAt: 1700000200, lastUsedAt: null        }
 *   -- Tenant t_01 has two keys; k_02 has never been used and is a candidate for revocation.
 */
export const gatewayApiKeys = sqliteTable('gateway_api_keys', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  keyHash: text('key_hash').notNull(),
  createdAt: integer('created_at').notNull(),
  lastUsedAt: integer('last_used_at'),
}, t => [uniqueIndex('gateway_api_keys_hash_unique').on(t.keyHash)]);
