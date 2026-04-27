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

## Feature Gaps to Address

| Feature | Priority | Implementation |
|---------|----------|----------------|
| **Prompt Management** | High | Version + environments for RAG use case |
| **Custom Properties** | High | Extend audit log with arbitrary KV |
| **Caching** | Medium | TTL cache for repeated prompts (exact hash) |
| **Load Balancing** | Medium | Multiple provider keys per tenant |
| **Session Grouping** | Medium | Group requests by session_id |
| **Eval Scores** | Medium | Submit scores, use in model selection |

---

## Recommendations

### High Priority (Align with Existing Architecture)

1. **Prompt Management**
   - Version tenant prompts
   - Environment promotion (dev → staging → prod)

2. **Custom Properties**
   - Extend audit log with KV pairs
   - Filter by properties in query

3. **Eval Scores**
   - Allow clients to submit scores
   - Use as reward signal in selection

### Medium Priority

4. **Caching** - Simple TTL cache for identical prompts
5. **Load Balancing** - Distribute across provider keys
6. **Session Grouping** - Debug agent flows

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