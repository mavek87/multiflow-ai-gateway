# Multiflow AI Gateway

A self-hosted, multi-tenant AI Gateway written in TypeScript/Bun. It sits between your applications and multiple LLM providers, exposing an OpenAI-compatible API with intelligent routing, resilience, and per-tenant isolation.

---

## Features

- **OpenAI-compatible API** - drop-in replacement for `POST /v1/chat/completions` with SSE streaming support
- **Multi-tenancy** - each tenant has isolated API keys and provider configurations
- **Intelligent model selection** - UCB1 algorithm balances performance and exploration across models
- **Circuit breaker** - automatically skips failing providers and recovers gracefully
- **Multi-model fallback** - up to 3 attempts across different models per request
- **Tool calling** - up to 10 rounds of tool execution per request
- **Encrypted secrets** - provider API keys stored at rest with AES-256-GCM
- **Audit logging** - append-only JSON lines trail per request
- **Admin API** - manage tenants and providers via REST, protected by master key
- **Auto-generated Swagger UI** - available at `/docs`

---

## Requirements

- [Bun](https://bun.sh) 1.0+

SQLite is bundled in Bun. Drizzle ORM and Elysia are the only significant runtime dependencies. Migrations are generated and applied automatically on every startup via Drizzle.

---

## Setup

### 1. Install dependencies

```bash
bun install
```

### 2. Configure environment

Create a `.env` file in the project root:

```env
PORT=3000
MASTER_KEY=<strong-random-base64-32>
ENCRYPTION_KEY=<64-hex-chars>
DB_PATH=./data/gateway.db
AUDIT_LOG_PATH=./logs/audit.jsonl
```

Generate the values:

```bash
# MASTER_KEY (protects /admin/* endpoints)
openssl rand -base64 32

# ENCRYPTION_KEY (AES-256 key, 32 bytes as hex)
openssl rand -hex 32
```

### 3. Start the server

```bash
bun run dev    # hot reload
bun run start  # production
```

The database is created automatically on first start. The server listens on `http://localhost:3000` (or the configured `PORT`).

---

## Architecture

```
Request
  |
  v
Elysia HTTP server (index.ts)
  |
  v
Auth (derive: Bearer token -> SHA-256 -> DB lookup -> Tenant)
  |
  v
Chat Route (routes/chat.ts)
  |
  v
Tenant Provider Configs (decrypt API keys from SQLite via Drizzle)
  |
  v
RoutingAIClient
  |-- UCB1Selector     (picks best model based on EMA metrics)
  |-- CircuitBreaker   (skips models in OPEN state)
  |-- ModelEndpointClient (HTTP call to OpenAI-compatible endpoint)
  |-- MetricsStore     (updates latency/success EMA after each call)
  |
  v
OpenAI-compatible response
  |
  v
Audit Log (async, JSON lines)
```

### Database

SQLite via Drizzle ORM. Schema defined in `src/db/schema.ts`. Migrations in `drizzle/` and applied automatically at boot.

| Table | Purpose |
|---|---|
| `tenants` | Tenant registry |
| `gateway_api_keys` | SHA-256 hashes of issued gateway API keys |
| `ai_providers` | Global provider registry (Groq, Ollama, OpenRouter, ...) |
| `ai_provider_models` | Models available per provider |
| `tenant_ai_provider_keys` | Per-tenant API key for each provider (AES-256-GCM encrypted) |
| `tenant_ai_model_priorities` | Which models a tenant can use, with priority order |

---

## Quick Start: Onboard a New Client

The full flow to add a tenant and make it ready to call `/v1/chat/completions`:

```bash
BASE=http://localhost:3000
MASTER=your-master-key

# 1. Create a global provider (once per provider, shared across tenants)
PROVIDER_ID=$(curl -sf -X POST $BASE/admin/providers \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"name":"Groq","type":"groq","baseUrl":"https://api.groq.com/openai/v1"}' \
  | jq -r '.id')

# 2. Add a model to that provider (once per model)
MODEL_ID=$(curl -sf -X POST $BASE/admin/providers/$PROVIDER_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"modelName":"llama3-70b-8192"}' \
  | jq -r '.id')

# 3. Create the tenant -- save the returned apiKey, it is shown only once
RESULT=$(curl -sf -X POST $BASE/admin/tenants \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"name":"ClienteA"}')
TENANT_ID=$(echo $RESULT | jq -r '.tenantId')
TENANT_KEY=$(echo $RESULT | jq -r '.apiKey')

# 4. Assign the provider credential to the tenant
curl -sf -X POST $BASE/admin/tenants/$TENANT_ID/credentials \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerId\":\"$PROVIDER_ID\",\"apiKey\":\"sk-groq-secret\"}"

# 5. Assign the model to the tenant with a priority (0 = first choice)
curl -sf -X POST $BASE/admin/tenants/$TENANT_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerModelId\":\"$MODEL_ID\",\"priority\":0}"

# 6. The tenant can now call the gateway
curl -X POST $BASE/v1/chat/completions \
  -H "Authorization: Bearer $TENANT_KEY" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello!"}]}'
```

For a more complete example with multiple providers and fallbacks, see `scripts/add-providers.sh`.

---

## Tenant and Provider Configuration

### How the data model works

Providers and their models are **global resources** managed by the admin. Tenants never share configurations directly: what makes a provider available to a tenant is the combination of:

1. A **credential** (`POST /admin/tenants/:id/credentials`) -- the tenant's own API key for that provider, stored encrypted.
2. A **model config** (`POST /admin/tenants/:id/models`) -- which specific model(s) the tenant is allowed to route to, with an optional priority.

The gateway builds the routing candidate list per request by joining these tables for the calling tenant only. Two tenants that both use Groq have separate credentials and separate model lists; neither can see or affect the other.

```
Global layer (admin-managed)          Per-tenant layer
--------------------------------      ------------------------------------------
ai_providers                          tenant_ai_provider_keys    (tenant's API key per provider)
  |-- ai_provider_models         <--  tenant_ai_model_priorities (which models + priority order)
```

---

### Scenario A -- 1 tenant, 1 provider, 1 model

The simplest possible setup. All requests go to one model; if it fails the gateway returns an error.

```bash
BASE=http://localhost:3000
MASTER=your-master-key

# 1. Register the provider (once, globally)
PROVIDER_ID=$(curl -sf -X POST $BASE/admin/providers \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"name":"Groq","type":"groq","baseUrl":"https://api.groq.com/openai/v1"}' \
  | jq -r '.id')

# 2. Register the model under that provider
MODEL_ID=$(curl -sf -X POST $BASE/admin/providers/$PROVIDER_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"modelName":"llama3-70b-8192"}' \
  | jq -r '.id')

# 3. Create the tenant
RESULT=$(curl -sf -X POST $BASE/admin/tenants \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"name":"ClienteA"}')
TENANT_ID=$(echo $RESULT | jq -r '.tenantId')
TENANT_KEY=$(echo $RESULT | jq -r '.apiKey')

# 4. Assign the credential (tenant's own API key for Groq)
curl -sf -X POST $BASE/admin/tenants/$TENANT_ID/credentials \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerId\":\"$PROVIDER_ID\",\"apiKey\":\"sk-groq-secret\"}"

# 5. Assign the model to the tenant
curl -sf -X POST $BASE/admin/tenants/$TENANT_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerModelId\":\"$MODEL_ID\",\"priority\":0}"

# Result: tenant has 1 model in its pool
# Routing pool for ClienteA: [llama3-70b-8192 @ Groq]
```

---

### Scenario B -- 1 tenant, 1 provider, multiple models

The tenant gets multiple models from the same provider. UCB1 selects between them adaptively; on failure the router falls back to the next best model automatically.

```bash
# Register two models under the same provider
MODEL_A=$(curl -sf -X POST $BASE/admin/providers/$PROVIDER_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"modelName":"llama3-70b-8192"}' | jq -r '.id')

MODEL_B=$(curl -sf -X POST $BASE/admin/providers/$PROVIDER_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"modelName":"mixtral-8x7b-32768"}' | jq -r '.id')

# One credential covers both models (same provider)
curl -sf -X POST $BASE/admin/tenants/$TENANT_ID/credentials \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerId\":\"$PROVIDER_ID\",\"apiKey\":\"sk-groq-secret\"}"

# Assign both models; priority 0 is preferred in warmup, UCB1 takes over after
curl -sf -X POST $BASE/admin/tenants/$TENANT_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerModelId\":\"$MODEL_A\",\"priority\":0}"

curl -sf -X POST $BASE/admin/tenants/$TENANT_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerModelId\":\"$MODEL_B\",\"priority\":1}"

# Result: routing pool for the tenant has 2 models
# Routing pool: [llama3-70b-8192 (priority 0), mixtral-8x7b-32768 (priority 1)] @ Groq
```

---

### Scenario C -- 1 tenant, 2 providers, multiple models each

The most resilient setup. The tenant draws models from two independent providers. A full provider outage only removes half the pool; the circuit breaker opens for that provider's models while the other provider keeps serving.

```bash
# Two global providers
GROQ_ID=$(curl -sf -X POST $BASE/admin/providers \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"name":"Groq","type":"groq","baseUrl":"https://api.groq.com/openai/v1"}' \
  | jq -r '.id')

OPENROUTER_ID=$(curl -sf -X POST $BASE/admin/providers \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"name":"OpenRouter","type":"openrouter","baseUrl":"https://openrouter.ai/api/v1"}' \
  | jq -r '.id')

# Two models each
GROQ_MODEL_A=$(curl -sf -X POST $BASE/admin/providers/$GROQ_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"modelName":"llama3-70b-8192"}' | jq -r '.id')

GROQ_MODEL_B=$(curl -sf -X POST $BASE/admin/providers/$GROQ_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"modelName":"mixtral-8x7b-32768"}' | jq -r '.id')

OR_MODEL_A=$(curl -sf -X POST $BASE/admin/providers/$OPENROUTER_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"modelName":"mistralai/mistral-7b-instruct"}' | jq -r '.id')

OR_MODEL_B=$(curl -sf -X POST $BASE/admin/providers/$OPENROUTER_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"modelName":"meta-llama/llama-3-8b-instruct"}' | jq -r '.id')

# One credential per provider -- each has its own API key
curl -sf -X POST $BASE/admin/tenants/$TENANT_ID/credentials \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerId\":\"$GROQ_ID\",\"apiKey\":\"sk-groq-secret\"}"

curl -sf -X POST $BASE/admin/tenants/$TENANT_ID/credentials \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerId\":\"$OPENROUTER_ID\",\"apiKey\":\"sk-or-secret\"}"

# Assign all 4 models with priorities
curl -sf -X POST $BASE/admin/tenants/$TENANT_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerModelId\":\"$GROQ_MODEL_A\",\"priority\":0}"

curl -sf -X POST $BASE/admin/tenants/$TENANT_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerModelId\":\"$GROQ_MODEL_B\",\"priority\":1}"

curl -sf -X POST $BASE/admin/tenants/$TENANT_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerModelId\":\"$OR_MODEL_A\",\"priority\":2}"

curl -sf -X POST $BASE/admin/tenants/$TENANT_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerModelId\":\"$OR_MODEL_B\",\"priority\":3}"

# Routing pool for the tenant: 4 models across 2 independent providers
# UCB1 selects the best performer; circuit breaker isolates individual failures
```

---

### Scenario D -- 2 tenants, different providers, full isolation

Two tenants share the same gateway instance but have completely separate pools. Each sees only its own models and uses its own credentials.

```bash
# Global providers (created once)
GROQ_ID=...     # created above
OLLAMA_ID=$(curl -sf -X POST $BASE/admin/providers \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"name":"Ollama","type":"ollama","baseUrl":"http://localhost:11434/v1"}' \
  | jq -r '.id')

GROQ_MODEL_ID=...    # created above
OLLAMA_MODEL_ID=$(curl -sf -X POST $BASE/admin/providers/$OLLAMA_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"modelName":"llama3"}' | jq -r '.id')

# Tenant 1 -- uses Groq with its own API key
RESULT1=$(curl -sf -X POST $BASE/admin/tenants \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"name":"ClienteA"}')
T1_ID=$(echo $RESULT1 | jq -r '.tenantId')
T1_KEY=$(echo $RESULT1 | jq -r '.apiKey')

curl -sf -X POST $BASE/admin/tenants/$T1_ID/credentials \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerId\":\"$GROQ_ID\",\"apiKey\":\"sk-groq-clienteA\"}"

curl -sf -X POST $BASE/admin/tenants/$T1_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerModelId\":\"$GROQ_MODEL_ID\",\"priority\":0}"

# Tenant 2 -- uses only local Ollama (no API key required)
RESULT2=$(curl -sf -X POST $BASE/admin/tenants \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"name":"ClienteB"}')
T2_ID=$(echo $RESULT2 | jq -r '.tenantId')
T2_KEY=$(echo $RESULT2 | jq -r '.apiKey')

# Ollama does not require an API key -- omit the apiKey field
curl -sf -X POST $BASE/admin/tenants/$T2_ID/credentials \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerId\":\"$OLLAMA_ID\"}"

curl -sf -X POST $BASE/admin/tenants/$T2_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerModelId\":\"$OLLAMA_MODEL_ID\",\"priority\":0}"

# ClienteA request (routed to Groq)
curl -X POST $BASE/v1/chat/completions \
  -H "Authorization: Bearer $T1_KEY" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello from ClienteA"}]}'

# ClienteB request (routed to Ollama)
curl -X POST $BASE/v1/chat/completions \
  -H "Authorization: Bearer $T2_KEY" -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Hello from ClienteB"}]}'
```

---

### Scenario E -- 2 tenants, same provider, different credentials

Two tenants both use Groq but with separate API keys (e.g. separate billing accounts). The provider record is shared; the credential is per-tenant.

```bash
# The Groq provider and its models are already registered globally.
# Just create two tenants and assign each its own credential.

# Tenant 1
curl -sf -X POST $BASE/admin/tenants/$T1_ID/credentials \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerId\":\"$GROQ_ID\",\"apiKey\":\"sk-groq-clienteA-billing\"}"

# Tenant 2 -- same provider, different key
curl -sf -X POST $BASE/admin/tenants/$T2_ID/credentials \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"providerId\":\"$GROQ_ID\",\"apiKey\":\"sk-groq-clienteB-billing\"}"

# Each tenant can then be assigned any subset of models from that provider.
# Model records are global; credentials and model assignments are per-tenant.
```

---

### Scenario F -- forcing a tenant to a specific provider

A tenant can be restricted to route only through a single provider, even if it has models from multiple providers configured. This is useful when you want UCB1 to balance between models of one provider while keeping other providers as dormant fallbacks that are never activated for that tenant.

```bash
# Force tenant to Groq -- only Groq models will be considered during routing
curl -sf -X PATCH $BASE/admin/tenants/$TENANT_ID \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"forceAiProviderId\":\"$GROQ_ID\"}"

# Remove the force -- routing resumes across all configured providers
curl -sf -X PATCH $BASE/admin/tenants/$TENANT_ID \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d '{"forceAiProviderId":null}'
```

The forced provider is stored on the tenant record and applied at query time. It filters the routing pool before UCB1 runs, so load balancing still happens between models of the forced provider.

---

### Configuration matrix summary

| Tenants | Providers | Models per provider | Lock | Result |
|---------|-----------|---------------------|------|--------|
| 1 | 1 | 1 | -- | Single model, no fallback |
| 1 | 1 | N | -- | UCB1 selects best; automatic fallback across models |
| 1 | N | M each | -- | UCB1 + fallback across all N*M models; provider outage only removes M candidates |
| 1 | N | M each | provider | UCB1 across M models of the forced provider only |
| N | separate | any | -- | Full isolation; each tenant sees only its pool with its credentials |
| N | shared | any | -- | Shared provider definition, separate credentials and model lists per tenant |

---

## Operational Notes

### Routing state is in-memory only

While a new `RoutingAIClient` is instantiated for each chat request, the Circuit breaker state and UCB1 metrics are managed by a singleton factory. This means routing metrics and circuit breaker statuses persist across requests but are **in-memory only and reset to zero on every server restart**. After a restart, all models start fresh with no learned preferences or failure counts.

### Back up ENCRYPTION_KEY separately from the database

If you lose the `ENCRYPTION_KEY` environment variable, every provider API key stored in the database becomes permanently unreadable. The gateway cannot decrypt them and all tenant credentials must be re-entered from scratch. Store `ENCRYPTION_KEY` in a secrets manager or a location that is independent of the database file.

---

## API Reference

Interactive docs available at `http://localhost:3000/docs` once the server is running.

### Health

```
GET /health
```

Returns `{ "status": "ok", "timestamp": "..." }`.

---

### Documentation

```
GET /docs          # Swagger UI
GET /openapi.json  # OpenAPI 3.0 spec
```

---

### Chat completions

```
POST /v1/chat/completions
Authorization: Bearer <tenant-api-key>
Content-Type: application/json
```

OpenAI-compatible request body:

```json
{
  "model": "optional-model-filter",
  "messages": [
    { "role": "user", "content": "Hello!" }
  ],
  "system": "Optional system prompt override",
  "stream": false
}
```

The `model` field is optional. When provided, only provider configs with a matching `modelName` are considered. When omitted, all enabled providers for the tenant are candidates.

Set `"stream": true` to receive a `text/event-stream` (SSE) response in OpenAI format. The gateway forwards the upstream SSE stream directly to the client. Fallback across providers is still attempted before the stream opens -- if the first provider returns an HTTP error the gateway retries with the next. Once streaming has started, mid-stream failures close the connection.

Returns an OpenAI-compatible response object (or SSE stream when `stream: true`).

---

### Admin: Tenants

All admin endpoints require the `X-Master-Key` header.

**Create tenant**

```
POST /admin/tenants
X-Master-Key: <master-key>
Content-Type: application/json

{ "name": "my-app" }
```

Returns the tenant ID and API key. The API key is shown only once.

**List tenants**

```
GET /admin/tenants
X-Master-Key: <master-key>
```

**Get tenant**

```
GET /admin/tenants/:id
X-Master-Key: <master-key>
```

Returns tenant details, its credentials, and its model config list (API keys are never returned).

---

### Admin: Global Providers

Providers are global resources. Create a provider once, then assign it to any tenant.

**List providers**

```
GET /admin/providers
X-Master-Key: <master-key>
```

**Create provider**

```
POST /admin/providers
X-Master-Key: <master-key>
Content-Type: application/json

{
  "name": "Groq",
  "type": "groq",
  "baseUrl": "https://api.groq.com/openai/v1"
}
```

**List models for a provider**

```
GET /admin/providers/:providerId/models
X-Master-Key: <master-key>
```

**Add model to provider**

```
POST /admin/providers/:providerId/models
X-Master-Key: <master-key>
Content-Type: application/json

{ "modelName": "llama3-70b" }
```

---

### Admin: Tenant Credentials

Assign a provider API key to a tenant. One credential per (tenant, provider) pair.

```
POST /admin/tenants/:id/credentials
X-Master-Key: <master-key>
Content-Type: application/json

{
  "providerId": "<provider-id>",
  "apiKey": "sk-..."
}
```

`apiKey` is optional for providers that do not require authentication (e.g. local Ollama). The key is encrypted with AES-256-GCM before storage.

```
GET /admin/tenants/:id/credentials
X-Master-Key: <master-key>
```

---

### Admin: Tenant Model Config

Assign a provider model to a tenant with a routing priority (lower = tried first).

```
POST /admin/tenants/:id/models
X-Master-Key: <master-key>
Content-Type: application/json

{
  "providerModelId": "<model-id>",
  "priority": 0
}
```

```
GET /admin/tenants/:id/models
X-Master-Key: <master-key>
```

---

## Error Responses

| Status | When |
|---|---|
| `400` | `messages` is missing or empty; requested `model` not available for this tenant |
| `401` | Missing, malformed, or invalid `Authorization: Bearer` header |
| `403` | Wrong or missing `X-Master-Key` on admin endpoints |
| `404` | Tenant or resource not found |
| `422` | Tenant has no provider models configured |
| `500` | Internal error (also appended to the audit log) |

---

## How Routing Works

When a chat request arrives the gateway:

1. Resolves the tenant's active model list: joins `tenant_ai_model_priorities` -> `ai_provider_models` -> `ai_providers` + `tenant_ai_provider_keys`, decrypting provider API keys in memory.
2. Filters by `modelName` if the request includes a `model` field.
3. Passes the candidate list to `RoutingAIClient`, which:
   - Skips models whose circuit breaker is in OPEN state.
   - Uses the **UCB1 selector** to rank the remaining models.
   - Calls the top-ranked model via `ModelEndpointClient`.
   - On failure, marks the failure in the circuit breaker and retries with the next best model (up to 3 attempts total).
   - On success, updates the EMA metrics for that model.

### Circuit breaker states

| State | Condition | Behavior |
|---|---|---|
| CLOSED | Normal | Requests pass through |
| OPEN | 3 hard failures or 5 soft failures | Requests blocked for 30 seconds |
| HALF_OPEN | After 30s timeout | One probe request; 2 successes restore CLOSED |

---

## Security

- **API keys** are stored as SHA-256 hashes; the plaintext is shown only at creation time.
- **Provider API keys** are encrypted at rest with AES-256-GCM (random IV per encryption, auth tag prevents tampering).
- **Master key** is required for all admin operations and is never stored in the database.
- **Tenant isolation** is enforced at the route level: each request is scoped to exactly one tenant derived from the Bearer token.

---

## Audit Logging

Every chat request appends one JSON line to `logs/audit.jsonl`:

```json
{
  "ts": "2026-01-01T00:00:00.000Z",
  "tenantId": "...",
  "provider": "ollama",
  "model": "llama3",
  "latencyMs": 312,
  "success": true,
  "statusCode": 200
}
```

---

## Development

```bash
bun run dev        # generate migrations + start with hot reload
bun run start      # generate migrations + start (production)
bun test src/      # run tests
bun run typecheck  # TypeScript type check
bun run check      # typecheck + tests
bun run db:generate  # generate migration files from schema changes
bun run db:migrate   # apply pending migrations manually
```

---

## Project Structure

```
src/
  index.ts                  # Entry point (Elysia app)
  types.ts                  # Shared request/response types
  auth/                     # API key generation and hashing
  config/                   # Environment variable validation
  db/                       # SQLite connection, Drizzle setup, schema
  tenant/                   # Tenant/provider CRUD and types
  engine/
    client/                 # OpenAI-compatible HTTP client
    routing/                # Multi-model router with fallback
    selection/              # UCB1 model selector + types
    resilience/             # Circuit breaker
    observability/          # EMA metrics store
  routes/                   # Elysia plugins (admin, chat)
  utils/                    # Crypto, audit log, HTTP helpers, logger
drizzle/                    # SQL migration files (auto-generated by drizzle-kit)
logs/                       # audit.jsonl (runtime)
data/                       # gateway.db (runtime)
```

---

## Troubleshooting

**"AI service unavailable. Try again later."**
The model name does not exist in the provider (e.g. Ollama does not have it pulled). Check with `ollama ls` and add a provider model record that matches an available model name.

**422 — "No providers configured for this tenant"**
The tenant was created but no model was assigned. Complete steps 2, 4, and 5 of the onboarding flow (register a model, assign a credential, assign the model to the tenant).

**Server won't start — "Missing required environment variable"**
The `.env` file is not loaded. Run `source .env && bun run dev` or use a process manager that injects environment variables.

**I lost the gateway API key for a tenant**
It cannot be recovered — SHA-256 hashes are one-way. Issue a new key: `POST /admin/tenants/:id/keys` (or create a new tenant if key rotation is not yet implemented). Revoke the old one.

**I lost the ENCRYPTION_KEY**
All provider credentials stored in the database are permanently unreadable. You must re-add every credential via `POST /admin/tenants/:id/credentials`. See the Operational Notes section above.

**Reset everything and start fresh**
```bash
rm -f data/gateway.db logs/audit.jsonl
bun run dev
```
Drizzle re-runs all migrations on the next start.

---

## Roadmap

Post-MVP features:

- Sub-users per tenant with per-user rate limits
- LightRAG integration for multi-domain RAG
- MCP client support per tenant
- Prometheus metrics endpoint
- Additional provider adapters (Groq, Gemini native, Claude native)
- Web admin UI
- PostgreSQL support for horizontal scaling
