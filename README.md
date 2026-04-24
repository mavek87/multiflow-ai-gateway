# Multiflow AI Gateway

A self-hosted, multi-tenant AI Gateway written in TypeScript/Bun. It sits between your applications and multiple LLM providers, exposing an OpenAI-compatible API with intelligent routing, resilience, and per-tenant isolation.

---

## Features

- **OpenAI-compatible API** - drop-in replacement for `POST /v1/chat/completions` with SSE streaming support
- **Multi-tenancy** - each tenant has isolated API keys and provider configurations
- **Intelligent model selection** - UCB1-Tuned (default), Thompson Sampling, or SW-UCB1-Tuned, configurable via `SELECTOR_TYPE`
- **Circuit breaker** - automatically skips failing providers and recovers gracefully
- **Multi-model fallback** - up to 3 attempts across different models per request
- **Tool calling** - up to 10 rounds of tool execution per request
- **Encrypted secrets** - provider API keys stored at rest with AES-256-GCM
- **Audit logging** - append-only JSON lines trail per request
- **Admin API** - manage tenants and providers via REST, protected by master key
- **Auto-generated Swagger UI** - available at `/docs`
- **Modular Architecture** - clean Folder-by-Feature structure for high maintainability

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
# SELECTOR_TYPE=ucb1-tuned  # options: ucb1-tuned (default), thompson, sw-ucb1-tuned
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
Auth Module (src/auth/auth.middleware.ts)
  |
  v
Chat Module (src/chat/chat.routes.ts)
  |
  v
Tenant Resolver (src/tenant/tenant-model-config.resolver.ts)
  |
  v
AuditedAIClient (src/audit/audit.ai-client.decorator.ts)
  |
  v
RoutingAIClient (src/engine/routing/routing-client.ts)
  |-- ModelSelector          (pluggable strategy: UCB1-Tuned, Thompson Sampling, SW-UCB1-Tuned)
  |-- CircuitBreaker        (skips models in OPEN state)
  |-- HttpProviderClient    (low-level HTTP to OpenAI-compatible endpoint)
  |   |-- ToolCallOrchestrator (handles multi-turn tool execution loop)
  |-- MetricsStore          (updates latency/success EMA after each chat)
  |
  v
OpenAI-compatible response
  |
  v
Audit Log (src/audit/audit.log.ts)
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
  -d "{\"aiProviderId\":\"$PROVIDER_ID\",\"apiKey\":\"sk-groq-secret\"}"

# 5. Assign the model to the tenant with a priority (0 = first choice)
curl -sf -X POST $BASE/admin/tenants/$TENANT_ID/models \
  -H "x-master-key: $MASTER" -H "Content-Type: application/json" \
  -d "{\"aiProviderModelId\":\"$MODEL_ID\",\"priority\":0}"

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

## Model Selection Algorithms

The gateway uses a multi-armed bandit strategy to pick the best model for each request. The algorithm is configured globally via the `SELECTOR_TYPE` environment variable.

Each algorithm evaluates models that are not blocked by the circuit breaker. Models with zero observations are always tried first (warmup phase), except Thompson Sampling which handles exploration naturally via its distribution.

| Algorithm | `SELECTOR_TYPE` | Default | Signals used |
|---|---|---|---|
| UCB1-Tuned | `ucb1-tuned` | **YES** | success rate + latency (full history) |
| SW-UCB1-Tuned | `sw-ucb1-tuned` | no | success rate + latency (last W calls) |
| Thompson Sampling | `thompson` | no | success/failure counts only |

### UCB1-Tuned (default)

Balances success rate and latency 50/50 into a reward score, then adds an exploration bonus that shrinks as observations accumulate. Uses the observed variance of rewards to avoid over-exploring stable models.

**Use when**: traffic is low-to-medium (tens to low hundreds of calls per day per tenant), or when provider behavior is stable. The best general-purpose choice.

### SW-UCB1-Tuned

Same algorithm as UCB1-Tuned but metrics are computed from the last W observations (default: 100) instead of full history. Reacts to provider degradations and recoveries within W calls.

**Use when**: traffic is high enough to fill the window (hundreds or more calls per day per tenant) and fast reaction to provider quality changes matters more than stability. With very low traffic the window stays sparse and estimates become noisy -- UCB1-Tuned is safer in that case.

### Thompson Sampling

Models each provider as a Beta distribution over success/failure counts and draws a random sample at each selection. Does not consider latency. Statistically efficient for pure success/failure optimization.

**Use when**: latency differences between providers are negligible and you only care about availability/error rates.

---

## Operational Notes

### Routing state is in-memory only

The `RoutingAIClientFactory` -- which owns the `MetricsStore`, `CircuitBreaker`, and `ModelSelector` instances -- is created once when the chat plugin initializes. A new `RoutingAIClient` is built per request via `factory.create()`, but it shares these stateful components across all requests. This means routing metrics and circuit breaker statuses persist across requests but are **in-memory only and reset to zero on every server restart**. After a restart, all models start fresh with no learned preferences or failure counts.

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

Returns an OpenAI-compatible response object (or SSE stream when `stream: true`).

---

### Admin API

All admin endpoints require the `X-Master-Key` header.

**Tenants**
- `GET /admin/tenants` - List all tenants
- `POST /admin/tenants` - Create tenant
- `GET /admin/tenants/:id` - Get details (includes credentials/models)
- `PATCH /admin/tenants/:id` - Update settings (e.g. `forceAiProviderId`)

**Global Providers**
- `GET /admin/providers` - List global providers
- `POST /admin/providers` - Create provider
- `GET /admin/providers/:id/models` - List models for a provider
- `POST /admin/providers/:id/models` - Add model to provider

**Tenant assignments**
- `POST /admin/tenants/:id/credentials` - Assign provider API key to tenant
- `POST /admin/tenants/:id/models` - Assign model priority to tenant

---

## Error Responses

| Status | When |
|---|---|
| `400` | `messages` is missing or empty; requested `model` not available for this tenant |
| `401` | Missing, malformed, or invalid `Authorization: Bearer` header |
| `403` | Wrong or missing `X-Master-Key` on admin endpoints |
| `404` | Tenant or resource not found |
| `422` | Tenant has no provider models configured |
| `503` | AI Service unavailable (all retries failed) |
| `500` | Internal error |

---

## Project Structure

The project follows a **Modular Architecture (Folder-by-Feature)**. Each feature directory contains its own routes, services, schemas, and tests.

```
src/
  admin/                    # Admin API routes
  audit/                    # Audit logging and decorator
  auth/                     # Authentication (Tenant & Admin)
  chat/                     # Chat Completions feature (core)
  config/                   # App configuration
  db/                       # Database connection and schema
  engine/                   # Shared AI Engine core
    |-- client/             # AI Provider clients and response parsers
    |-- observability/      # Latency and success rate metrics
    |-- resilience/         # Circuit breaker implementation
    |-- routing/            # Multi-model routing logic and factory
    |-- selection/          # Model selection: types and algorithm implementations
    |   |-- algorithms/     # UCB1-Tuned, SW-UCB1-Tuned, Thompson Sampling
    |-- tools/              # Tool-calling (function calling) orchestration
  provider/                 # Global provider registry
  tenant/                   # Tenant management and resolution
  utils/                    # Shared utilities (crypto, http, logger)
  index.ts                  # Entry point
```

File naming convention: `[feature].[type].ts` (e.g., `chat.routes.ts`, `tenant.store.ts`).

---

## Roadmap

- Sub-users per tenant with per-user rate limits
- LightRAG integration for multi-domain RAG
- MCP client support per tenant
- Prometheus metrics endpoint
- Additional provider adapters (Groq, Gemini native, Claude native)
- Web admin UI
- PostgreSQL support for horizontal scaling
