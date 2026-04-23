import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
 * └────────────┴─────────┴──────────────────────────────────────────────────────────────────────────┘
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


/**
 * AI PROVIDERS
 * Registry of external LLM backends the gateway can route traffic to.
 *
 * A provider is a remote (or local) service that exposes an inference API: Groq,
 * OpenRouter, a self-hosted Ollama instance, etc. This table stores the connection
 * details needed to forward requests to each backend.
 *
 * Adding a new provider here makes it available for assignment to tenants via
 * tenantAiProviderKeys and tenantAiModelPriorities, without any code changes.
 *
 * When it is used: at request routing time to resolve the target base URL,
 * and in the admin API to list and manage available backends.
 *
 * ┌───────────┬─────────┬──────────────────────────────────────────────────────────────────────────────┐
 * │ Field     │ Type    │ Description                                                                  │
 * ├───────────┼─────────┼──────────────────────────────────────────────────────────────────────────────┤
 * │ id        │ text    │ Primary key. UUIDv4 generated at creation time.                              │
 * │ name      │ text    │ Unique display name (e.g., "Groq", "Ollama-local").                          │
 * │           │         │ Unique constraint prevents duplicate registrations.                          │
 * │ type      │ text    │ Adapter discriminator, reserved for future use. Currently all providers are  │
 * │           │         │ routed through the same OpenAI-compatible client. Intended for future        │
 * │           │         │ adapters targeting non-OpenAI-compat APIs (e.g., Gemini native, Bedrock).    │
 * │ baseUrl   │ text    │ Root endpoint of the provider API                                            │
 * │           │         │ (e.g., "https://api.groq.com", "http://localhost:11434").                    │
 * │ createdAt │ integer │ Unix timestamp of provider registration.                                     │
 * └───────────┴─────────┴──────────────────────────────────────────────────────────────────────────────┘
 *
 * NOTE: the routing layer uses a single OpenAI-compatible HTTP client for all providers
 * (HttpProviderClient). The "type" field is stored but not yet read by the engine --
 * every provider is treated as OpenAI-compatible until a second adapter is introduced.
 *
 * Example rows:
 *   { id: "p_01", name: "Groq",         type: "openai", baseUrl: "https://api.groq.com",       createdAt: 1700000000 }
 *   { id: "p_02", name: "OpenRouter",   type: "openai", baseUrl: "https://openrouter.ai/api",  createdAt: 1700000001 }
 *   { id: "p_03", name: "Ollama-local", type: "openai", baseUrl: "http://localhost:11434",      createdAt: 1700000002 }
 */
export const aiProviders = sqliteTable('ai_providers', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  type: text('type').notNull(),
  baseUrl: text('base_url').notNull(),
  createdAt: integer('created_at').notNull(),
}, t => [uniqueIndex('ai_providers_name_unique').on(t.name)]);

/**
 * AI PROVIDER MODELS
 * The global catalog of models available under each provider.
 *
 * Each row declares that a specific model identifier (as the provider's API expects it)
 * exists under a given provider. This is the shared model registry: it does not say
 * which tenants can use a model -- that is controlled by tenantAiModelPriorities. It only says
 * the model exists and whether it is globally enabled for routing.
 *
 * Disabling a model here (enabled = false) blocks it for all tenants regardless of their
 * individual config, which is useful for emergency deprecation or capacity management.
 * A unique constraint on (aiProviderId, modelName) prevents the same model from being
 * registered twice under the same provider.
 *
 * When it is used: during request routing, the gateway resolves the target model from
 * this table to confirm it is registered and enabled before forwarding the request.
 *
 * ┌──────────────┬─────────┬──────────────────────────────────────────────────────────────────────────────┐
 * │ Field        │ Type    │ Description                                                                  │
 * ├──────────────┼─────────┼──────────────────────────────────────────────────────────────────────────────┤
 * │ id           │ text    │ Primary key. UUIDv4 generated at creation time.                              │
 * │ aiProviderId │ text    │ Foreign key to aiProviders.id. Row is deleted when the provider is deleted.  │
 * │ modelName    │ text    │ Technical model identifier as required by the provider's API                 │
 * │              │         │ (e.g., "llama3-70b-8192", "mixtral-8x7b-32768", "llama3.2").                 │
 * │ enabled      │ boolean │ Global kill-switch. When false the model is unavailable to all tenants.      │
 * │ createdAt    │ integer │ Unix timestamp of model registration.                                        │
 * └──────────────┴─────────┴──────────────────────────────────────────────────────────────────────────────┘
 *
 * Example rows:
 *   { id: "m_01", aiProviderId: "p_01", modelName: "llama3-70b-8192",    enabled: true,  createdAt: 1700000010 }
 *   { id: "m_02", aiProviderId: "p_01", modelName: "mixtral-8x7b-32768", enabled: true,  createdAt: 1700000011 }
 *   { id: "m_03", aiProviderId: "p_03", modelName: "llama3.2",           enabled: false, createdAt: 1700000012 }
 *   -- m_03 is on Ollama-local but globally disabled; no tenant can reach it until re-enabled.
 */
export const aiProviderModels = sqliteTable('ai_provider_models', {
  id: text('id').primaryKey(),
  aiProviderId: text('ai_provider_id')
    .notNull()
    .references(() => aiProviders.id, { onDelete: 'cascade' }),
  modelName: text('model_name').notNull(),
  enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: integer('created_at').notNull(),
}, t => [uniqueIndex('ai_provider_models_provider_model_unique').on(t.aiProviderId, t.modelName)]);

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
