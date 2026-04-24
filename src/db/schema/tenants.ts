import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';
import { aiProviders, aiProviderModels } from './providers';

/**
 * TENANTS
 * The top-level billing and access boundary of the gateway.
 *
 * A tenant represents any distinct consumer of the gateway: a product team, an external
 * customer, a third-party application, or an internal service. Every request flowing
 * through the gateway must belong to exactly one tenant. Isolation is enforced at the
 * API-key level: a tenant can only reach providers and models explicitly configured for
 * its account.
 *
 * When it is used: on every inbound request, immediately after the tenant API key is
 * validated. The tenant row determines which providers, models, and credentials are
 * loaded for that request.
 *
 * ┌────────────────────┬─────────┬──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ Field              │ Type    │ Description                                                                              │
 * ├────────────────────┼─────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
 * │ id                 │ text    │ Primary key. UUIDv4 generated at creation time.                                          │
 * │ name               │ text    │ Human-readable label (e.g., "Acme Corp", "internal-search-service").                     │
 * │ forceAiProviderId  │ text    │ Optional. When set, all requests from this tenant are forced to this provider,           │
 * │                    │         │ ignoring any tenant model config priority order.                                         │
 * │                    │         │ Becomes NULL automatically if the referenced provider is deleted.                        │
 * │ createdAt          │ integer │ Unix timestamp (milliseconds) of when this tenant was registered.                        │
 * └────────────────────┴─────────┴──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Example rows:
 *   { id: "t_01", name: "Acme Corp",              forceAiProviderId: null,   createdAt: 1700000000 }
 *   { id: "t_02", name: "internal-ops-bot",        forceAiProviderId: "p_03", createdAt: 1700001000 }
 *   -- "internal-ops-bot" is forced to provider p_03 (e.g., a local Ollama instance).
 */
export const tenants = sqliteTable('tenants', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  forceAiProviderId: text('force_ai_provider_id').references(() => aiProviders.id, { onDelete: 'set null' }),
  createdAt: integer('created_at').notNull(),
}, t => [uniqueIndex('tenants_name_unique').on(t.name)]);

/**
 * TENANT AI PROVIDER KEYS  (the "secure wallet")
 * Each tenant's own API keys for the external providers they are allowed to use.
 *
 * In a multi-tenant gateway, every tenant typically has their own account and billing
 * relationship with each upstream provider. This table stores those credentials
 * encrypted at rest (AES-256-GCM), so the gateway can impersonate each tenant when
 * forwarding requests without ever exposing the raw key.
 *
 * A unique credential row for (tenantId, aiProviderId) is required before the gateway
 * will route any request from that tenant to that provider. For providers that require no
 * authentication (e.g., a local Ollama instance on a private network), aiProviderApiKeyEncrypted
 * can be left null.
 *
 * When it is used: on every chat request. After the routing engine selects a target
 * provider, the gateway fetches the matching credential, decrypts it, and injects it
 * into the outgoing Authorization header.
 *
 * ┌───────────────────────────┬─────────┬──────────────────────────────────────────────────────────────────────────────────────┐
 * │ Field                     │ Type    │ Description                                                                          │
 * ├───────────────────────────┼─────────┼──────────────────────────────────────────────────────────────────────────────────────┤
 * │ id                        │ text    │ Primary key. UUIDv4 generated at creation time.                                      │
 * │ tenantId                  │ text    │ Foreign key to tenants.id. Row is deleted when the tenant is deleted.                │
 * │ aiProviderId              │ text    │ Foreign key to aiProviders.id. Row is deleted when the provider is deleted.          │
 * │ aiProviderApiKeyEncrypted │ text    │ AES-256-GCM ciphertext of the tenant's raw API key for this provider.                │
 * │                           │         │ Null for local / no-auth providers such as Ollama on a private network.              │
 * │ enabled                   │ boolean │ Per-tenant kill-switch. When false the gateway skips this provider                   │
 * │                           │         │ even if tenantAiModelPriorities still lists models from it.                          │
 * │ createdAt                 │ integer │ Unix timestamp of credential creation.                                               │
 * └───────────────────────────┴─────────┴──────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Example rows:
 *   { id: "c_01", tenantId: "t_01", aiProviderId: "p_01", aiProviderApiKeyEncrypted: "gsk_enc_...", enabled: true,  createdAt: 1700000020 }
 *   { id: "c_02", tenantId: "t_01", aiProviderId: "p_03", aiProviderApiKeyEncrypted: null,          enabled: true,  createdAt: 1700000021 }
 *   { id: "c_03", tenantId: "t_02", aiProviderId: "p_01", aiProviderApiKeyEncrypted: "gsk_enc_...", enabled: false, createdAt: 1700000022 }
 *   -- c_02: Acme uses Ollama-local with no key. c_03: Groq is disabled for t_02, requests will skip it.
 */
export const tenantAiProviderKeys = sqliteTable('tenant_ai_provider_keys', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  aiProviderId: text('ai_provider_id')
    .notNull()
    .references(() => aiProviders.id, { onDelete: 'cascade' }),
  aiProviderApiKeyEncrypted: text('ai_provider_api_key_encrypted'),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
}, t => [uniqueIndex('tenant_ai_provider_keys_tenant_provider_unique').on(t.tenantId, t.aiProviderId)]);

/**
 * TENANT AI MODEL PRIORITIES  (the "personalized menu and fallback chain")
 * Maps which models a specific tenant can use and defines the priority order for
 * automatic failover.
 *
 * This table is the core of the resilience layer. Each row grants a tenant access to
 * one model and assigns a numeric priority. When a request comes in without a specific
 * model override, the routing engine sorts all enabled rows for that tenant by priority
 * ascending and tries them in order. If the first model fails (rate limit, timeout,
 * server error), it automatically retries with the next one.
 *
 * Example fallback chain for tenant t_01:
 *   priority 0 -> Llama-3 70B on Groq       (fastest, primary)
 *   priority 1 -> Mixtral 8x7B on Groq      (fallback if Llama-3 is rate-limited)
 *   priority 2 -> Llama-3.2 on Ollama-local (last resort, always available locally)
 *
 * When it is used: at the start of every request to build the ordered list of candidate
 * models that the routing engine will iterate through.
 *
 * ┌───────────────────┬─────────┬──────────────────────────────────────────────────────────────────────────────────────────┐
 * │ Field             │ Type    │ Description                                                                              │
 * ├───────────────────┼─────────┼──────────────────────────────────────────────────────────────────────────────────────────┤
 * │ id                │ text    │ Primary key. UUIDv4 generated at creation time.                                          │
 * │ tenantId          │ text    │ Foreign key to tenants.id. Row is deleted when the tenant is deleted.                    │
 * │ aiProviderModelId │ text    │ Foreign key to aiProviderModels.id. Row is deleted when the model is deleted.            │
 * │ priority          │ integer │ Routing order. Lower value = higher priority. Default 0 (highest).                       │
 * │                   │         │ The routing engine sorts by priority ASC and stops at the first success.                 │
 * │ enabled           │ boolean │ Per-tenant toggle for this specific model. When false the model is excluded              │
 * │                   │         │ from the fallback chain without removing the row.                                        │
 * │ createdAt         │ integer │ Unix timestamp of configuration creation.                                                │
 * └───────────────────┴─────────┴──────────────────────────────────────────────────────────────────────────────────────────┘
 *
 * Example rows (all for tenant t_01, building the chain described above):
 *   { id: "cfg_01", tenantId: "t_01", aiProviderModelId: "m_01", priority: 0, enabled: true, createdAt: 1700000030 }
 *   { id: "cfg_02", tenantId: "t_01", aiProviderModelId: "m_02", priority: 1, enabled: true, createdAt: 1700000031 }
 *   { id: "cfg_03", tenantId: "t_01", aiProviderModelId: "m_03", priority: 2, enabled: true, createdAt: 1700000032 }
 *   -- If Groq returns 429 for m_01, the engine retries with m_02, then m_03 before returning an error.
 */
export const tenantAiModelPriorities = sqliteTable('tenant_ai_model_priorities', {
  id: text('id').primaryKey(),
  tenantId: text('tenant_id')
    .notNull()
    .references(() => tenants.id, { onDelete: 'cascade' }),
  aiProviderModelId: text('ai_provider_model_id')
    .notNull()
    .references(() => aiProviderModels.id, { onDelete: 'cascade' }),
  priority: integer('priority').notNull().default(0),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
}, t => [uniqueIndex('tenant_ai_model_priorities_tenant_model_unique').on(t.tenantId, t.aiProviderModelId)]);
