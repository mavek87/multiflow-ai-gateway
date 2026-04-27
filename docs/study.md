# Competitive Study: All AI Gateways vs Multiflow

## Overview

This document analyzes all AI gateway competitors (Vercel, Portkey, LiteLLM, Helicone, OpenRouter) and compares features against our current implementation to identify opportunities for enhancement.

---

## Feature Matrix

| Feature | Vercel | Portkey | LiteLLM | Helicone | OpenRouter | Multiflow (Us) |
|---------|--------|---------|---------|---------|-----------|----------------|
| **Self-hosted** | No | Yes | Yes | No | No | **Yes** |
| **Multi-tenancy** | Team-scoped | Yes | Per key/team | SaaS | No | **Yes (per-tenant)** |
| **Caching** | No | Yes (simple + semantic) | Via Redis | Yes | No | No |
| **Prompt Management** | No | Yes (versioning, A/B) | No | Yes | No | No |
| **Fallbacks** | Auto retry | Configurable | Configurable | Auto | Configurable | **Circuit breaker** |
| **Load Balancing** | Yes | Yes | Yes (multiple strategies) | No | No | No |
| **Circuit Breaker** | No | Yes | Yes (cooldowns) | No | No | **Yes (hard/soft)** |
| **Adaptive Routing** | No | No | No | No | No | **Yes (UCB1/Thompson)** |
| **Rate Limits** | Yes | Yes | Yes (rpm/tpm) | Custom | Yes | No |
| **Observability** | Basic | Deep | Deep | Deep | Basic | **Per-tenant** |
| **Budget/Spend Tracking** | Yes | Yes | Yes | Yes | No | No |
| **Guardrails** | No | Yes (50+) | No | Yes (LLM security) | No | No |
| **MCP Support** | No | Yes | No | No | No | No |
| **BYOK** | Yes | Yes | Yes | Yes | No | No |
| **Custom Hosts** | No | Yes | Yes | No | No | No |

---

## Detailed Competitor Analysis

### 1. Vercel AI Gateway

**URL:** https://vercel.com/ai-gateway

**Model format:** `provider/model-name` (e.g. `anthropic/claude-opus-4.6`)

**Strengths:**
- Tight integration with Vercel AI SDK (v5/v6)
- One key, hundreds of models
- Usage monitoring, budgets
- No markup on tokens

**Routing:** Simple fallback on failure, no adaptive selection

**Self-hosted:** No (SaaS only)

**Gap vs us:** No multi-tenant isolation, no intelligent routing

---

### 2. Portkey AI Gateway

**URL:** https://portkey.ai

**Model format:** Universal API for 250+ models

**Strengths:**
- **Hybrid deployment**: Data Plane in customer VPC, Control Plane hosted
- **Cache**: Simple + semantic caching
- **Guardrails**: 50+ built-in guardrails (deterministic + LLM-based)
- **MCP Support**: Connect to remote MCP servers
- **Configurable fallbacks**: Strategy-based routing
- **Conditional routing**: Route based on custom checks
- **Load balancing**: Across multiple API keys
- **Budget limits**: Per-cost or per-token
- **gRPC**: For lower latency (beta)

**Self-hosted:** Yes (Docker, Kubernetes, npx)

**Architecture:** Hono-based, layered architecture with:
- Entry Layer (middleware pipeline)
- Orchestration Layer (proxyHandler, tryTargetsRecursively)
- Execution Layer (retry, tryPost)
- Provider Abstraction Layer (70+ providers)

**Gap vs us:** No adaptive model selection (UCB1), simpler failure handling (no hard/soft differentiation)

---

### 3. LiteLLM

**URL:** https://github.com/BerriAI/litellm

**Model format:** 100+ providers via config.yaml

**Strengths:**
- **Python-based**: Battle-tested SDK
- **Config-as-file**: YAML config for providers, models, routing
- **Routing strategies**: simple-shuffle, least-busy, latency-based, cost-based, usage-based
- **Adaptive Router** (Beta): ML-based selection
- **Auto Routing**: Route based on semantic matching
- **Budget routing**: Cost-based selection
- **Tag-based routing**
- **Health check driven routing**: Proactive health checks
- **Request prioritization** (Beta)
- **UI for keys/teams**: Granular router settings
- **Order-based deployments**: Priority tiers

**Routing strategies detail:**
- `simple-shuffle`: Random (recommended for prod)
- `least-busy`: Fewest active requests
- `latency-based-routing`: Fastest deployment
- `cost-based-routing`: Cheapest deployment

**Failure handling:**
- `allowed_fails`: cooldown after N failures/minute
- `cooldown_time`: default 30s
- Non-retryable errors: 401, 404, 408

**Gap vs us:** No per-tenant isolation (key-based), no hard/soft circuit breaker differentiation

---

### 4. Helicone AI Gateway

**URL:** https://docs.helicone.ai/getting-started/quick-start

**Model format:** Just model name (e.g. `gpt-4o-mini`)

**Strengths:**
- **Observability**: Deep integration with Langfuse, LangChain, DSPy, etc.
- **Prompt Management**: Versioning, environments, A/B testing
- **LLM Caching**: Cache by prompt
- **Prompt Caching**: Context caching across providers
- **Custom Properties**: Arbitrary metadata per request
- **Eval/Scores**: Submit scores per request
- **Sessions**: Request grouping for agents
- **Token Limit Handlers**: Truncate, middle-out, fallback

**Credit system:** 0% markup, manages provider keys centrally

**Gap vs us:** SaaS only, no self-hosted, simple fallback routing (not adaptive)

---

### 5. OpenRouter

**URL:** https://openrouter.ai

**Model format:** `provider/model-name`

**Strengths:**
- 200+ models from multiple providers
- Unified API

**Gap vs us:** SaaS only, no self-hosted, no multi-tenant isolation, no intelligent routing

---

## Our Technical Advantages

| Area | Our Implementation | Competitors | Why It Matters |
|------|-------------------|------------|----------------|
| **Multi-tenancy** | Per-tenant provider keys, isolation | Portkey (key-based), others (team/key-scoped) | Self-hosted enterprise requirement |
| **Adaptive Routing** | UCB1-Tuned + Thompson Sampling | LiteLLM (Beta adaptive), others (simple) | Better latency/quality tradeoff |
| **Circuit Breaker** | Hard/soft failure differentiation | Portkey (generic), LiteLLM (cooldowns) | More resilient to transient vs permanent failures |
| **Data Ownership** | Full (self-hosted, SQLite) | Only Portkey (hybrid) | Enterprise compliance |
| **Observability** | Per-tenant metrics store | All have SaaS analytics | Data sovereignty |

---

## Routing Architecture Comparison

### LiteLLM Routing

```yaml
model_list:
  - model_name: gpt-4o
    litellm_params:
      model: azure/gpt-4
router_settings:
  routing_strategy: simple-shuffle
  num_retries: 3
  allowed_fails: 3
  cooldown_time: 30
```

Strategies: simple-shuffle, least-busy, latency-based, cost-based, usage-based

### Portkey Routing

```yaml
targets:
  - url: https://api.openai.com/v1
    params:
      model: gpt-4
  - url: https://api.anthropic.com
    params:
      model: claude-3-opus
strategy:
  mode: loadbalance  # or fallback, circuit-breaker
```

Strategies: loadbalance, fallback, circuit-breaker, concurrent

### Our Routing

```typescript
// UCB1-Tuned or Thompson Sampling
modelSelector.select(availableModels, metrics, circuitBreaker)
  // → picks model based on:
  //   - reward = successRate * 0.5 + (1 - normalizedLatency) * 0.5
  //   - exploration term using rewardVariance + sqrt(2 * ln(N) / n)
```

**Our advantages:**
- Per-model EMA metrics (latency, ttft, success rate)
- Welford's online variance for reward signal
- Hard vs soft failure handling (different thresholds)
- Warmup phase (unseen models get priority)

---

## Roadmap

| # | Feature | Priority | Area | Status |
|---|---------|----------|------|--------|
| 1 | Prometheus metrics endpoint | Critical | Observability | Not started |
| 2 | Rate limiting / sub-users per tenant | High | Multi-tenancy | Not started |
| 3 | Proactive health checks | High | Routing | Not started |
| 4 | Exact-match prompt caching | High | Performance | Not started |
| 5 | Additional provider adapters (Groq, Gemini, Claude native) | Medium | Providers | Not started |
| 6 | BYOK per-request | Medium | Auth | Not started |
| 7 | PostgreSQL support | Low | Infrastructure | Not started |

---

### Feature Descriptions

#### 1. Prometheus Metrics Endpoint

Expose a `/metrics` endpoint in Prometheus format with per-tenant and per-model counters (requests, errors, latency histograms, token usage). This is a prerequisite for any production deployment: without external metrics there is no alerting, no dashboarding, and no SLA visibility. All other features are harder to validate without it.

**Scope:** new Elysia plugin, metrics registry (prom-client or hand-rolled), per-request middleware that records counters/histograms.

---

#### 2. Rate Limiting / Sub-users per Tenant

Each tenant can define sub-users (API keys) with individual rate limits (requests per minute, tokens per minute). The gateway enforces these limits before forwarding to any provider. Without this, a single misbehaving tenant can saturate all upstream providers and degrade service for others -- making the multi-tenant isolation incomplete.

**Scope:** new `sub_user` and `rate_limit` tables, sliding window counter in SQLite (or in-memory with periodic flush), enforcement middleware before the routing layer.

---

#### 3. Proactive Health Checks

A background job periodically pings each active provider/model endpoint and marks it as degraded before it causes real request failures. This feeds a health signal into the UCB1 selector, complementing the reactive circuit breaker. Currently the circuit breaker only opens after observed failures -- a proactive check catches providers that are throttling silently (e.g. Groq free tier hitting rate limits between requests).

**Scope:** background scheduler (Bun's `setInterval` or a cron job), health check result stored per provider, exposed as an additional input to the model selector.

---

#### 4. Exact-Match Prompt Caching

Cache responses keyed by a hash of `(tenant_id, model, messages, temperature, max_tokens)` with a configurable TTL. On cache hit, return the stored response without calling the provider. Especially high ROI for RAG workloads where the same context + question is repeated across users or retries.

**Scope:** new `prompt_cache` table in SQLite, cache lookup/store in the request pipeline before the routing layer, per-tenant opt-in flag and TTL setting.

---

#### 5. Additional Provider Adapters (Groq, Gemini native, Claude native)

Add first-class adapters for Groq, Google Gemini, and Anthropic Claude (currently likely proxied via OpenAI-compatible endpoints). Native adapters unlock provider-specific features (streaming formats, tool use schemas, context caching) and give UCB1 more diverse providers to route across -- which is where the algorithm's value compounds.

**Scope:** one adapter module per provider following the existing provider abstraction, integration tests with provider sandboxes.

---

#### 6. BYOK Per-request (Bring Your Own Key)

Allow a tenant to pass their own provider API key at request time via a header (e.g. `x-provider-key`), bypassing the gateway's stored keys entirely. This is a hard requirement for enterprise clients that have a zero-key-custody policy -- they will not allow a third party (even self-hosted) to store their provider credentials.

**Scope:** optional header extraction in the auth middleware, key passed directly to the provider adapter without being persisted.

---

#### 7. PostgreSQL Support

Replace SQLite with PostgreSQL as an optional backend for horizontal scaling (multiple gateway instances sharing state). Low priority because SQLite is sufficient for single-node deployments and most self-hosted use cases. Only relevant when tenants need high availability across multiple nodes.

**Scope:** Drizzle adapter swap, connection pooling, migration scripts for Postgres dialect.

---

## Conclusion

**Our core value:**
- Self-hosted with full data ownership
- Multi-tenant isolation with per-tenant provider keys
- Adaptive model selection (UCB1-Tuned/Thompson)
- Hard/soft circuit breaker

**Competitor strengths to learn from:**
- LiteLLM: Config-as-file, routing strategies, retry policies
- Portkey: Hybrid deployment, guardrails, semantic caching
- Helicone: Prompt management, observability integrations

**Focus:** Prompt management + eval scores as they align with RAG workloads and enhance model selection.