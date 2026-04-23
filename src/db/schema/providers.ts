import { sqliteTable, text, integer, uniqueIndex } from 'drizzle-orm/sqlite-core';

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
