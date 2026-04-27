# Notes

## Competitors and Similar Projects

### Vercel AI Gateway
- URL: https://vercel.com/ai-gateway
- Model format: `provider/model-name` in the `model` field (e.g. `openai/gpt-5.4`)
- Auth: one unified gateway API key per client; provider keys managed centrally in the dashboard (team-scoped)
- BYOK: supports per-request provider key override via `providerOptions.gateway.byok` - useful for SaaS where end-users bring their own keys
- Key insight: OIDC tokens for Vercel-deployed apps (auto-generated, no manual key management)
- Self-hosted: no, SaaS only
- Relevant to us: the `provider/model` format is already implemented in multiflow

### Portkey AI Gateway
- URL: https://github.com/Portkey-ai/gateway / https://portkey.ai
- Model: fundamentally different architecture - BYOK per-request via `Authorization` header; Portkey does not store keys, it proxies them
- Auth: `x-portkey-api-key` (Portkey key) + `Authorization` (provider key passed by the client in each request)
- Virtual Keys (legacy): provider keys stored encrypted server-side, referenced by a slug - conceptually equivalent to our `tenantAiProviderKeys`
- Secret References: instead of storing encrypted keys, store a reference (e.g. `vault:secret/groq`) resolved at request time from AWS Secrets Manager, Azure Key Vault, or HashiCorp Vault
- Self-hosted: yes, via Docker or npx
- Key insight: in self-hosted mode, no Portkey API key needed; clients pass provider keys directly in each request
- Relevant to us: Secret References pattern is interesting for future key rotation ergonomics; the rest (Model Catalog, Virtual Keys governance) is SaaS complexity we do not need

### LiteLLM
- URL: https://github.com/BerriAI/litellm
- Python-based proxy and SDK wrapper for 100+ LLM providers
- Supports load balancing, fallbacks, spend tracking, budgets per key
- Config-as-file: uses a `config.yaml` for providers, models, and routing rules at startup
- Key insight: their YAML seed approach is mature and battle-tested - good reference for our seed file design

### Helicone AI Gateway
- URL: https://docs.helicone.ai/getting-started/quick-start
- SaaS AI Gateway with OpenAI-compatible API (baseURL: https://ai-gateway.helicone.ai)
- Access to 100+ models: OpenAI, Anthropic, Google, Vertex, Groq, and more
- Model format: just model name (e.g. `gpt-4o-mini`)
- Auth: Helicone API key via `Authorization` header or `x-helicone-api-key`
- Credit system: Helicone manages provider keys; users add credits to account (0% markup)
- BYOK: also supports bring-your-own-provider-keys
- Automatic fallbacks if provider is down
- Self-hosted: no, SaaS only
- Relevant to us: Their credit model is different - they manage keys centrally and charge user's credits; we manage per-tenant keys
- SaaS router: one API key gives access to 200+ models from multiple providers
- Model format: `provider/model-name` (same as Vercel)
- No self-hosting option
- Relevant to us: we are essentially a self-hosted OpenRouter with per-tenant isolation and UCB1 routing
