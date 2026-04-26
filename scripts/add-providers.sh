#!/bin/bash
# Example: seed providers, models, and assign them to a tenant.
# Usage: TENANT_ID=<id> ./scripts/add-providers.sh
# Reads MASTER_KEY from .env in the project root.

set -euo pipefail
cd "$(dirname "$0")/.."

MASTER_KEY=$(grep ^MASTER_KEY .env | cut -d= -f2-)
BASE="http://localhost:3000"
H_MASTER="x-master-key: $MASTER_KEY"
H_JSON="Content-Type: application/json"

if [[ -z "${TENANT_ID:-}" ]]; then
  echo "Error: TENANT_ID env var is required."
  echo "  export TENANT_ID=<tenant-uuid>"
  exit 1
fi

echo "==> Creating providers..."

OLLAMA_ID=$(curl -sf -X POST "$BASE/admin/providers" \
  -H "$H_MASTER" -H "$H_JSON" \
  -d '{"name":"Ollama Local","type":"ollama","baseUrl":"http://localhost:11434/v1"}' \
  | jq -r '.id')
echo "Ollama provider: $OLLAMA_ID"

GROQ_ID=$(curl -sf -X POST "$BASE/admin/providers" \
  -H "$H_MASTER" -H "$H_JSON" \
  -d '{"name":"Groq","type":"groq","baseUrl":"https://api.groq.com/openai/v1"}' \
  | jq -r '.id')
echo "Groq provider: $GROQ_ID"

echo ""
echo "==> Creating models..."

declare -A OLLAMA_MODELS=(
  ["qwen3.5:397b-cloud"]=0
  ["gemini-3-flash-preview"]=1
  ["gemma4:31b-cloud"]=2
  ["deepseek-v3.2:cloud"]=3
)

declare -A OLLAMA_MODEL_IDS
for MODEL in "${!OLLAMA_MODELS[@]}"; do
  ID=$(curl -sf -X POST "$BASE/admin/providers/$OLLAMA_ID/models" \
    -H "$H_MASTER" -H "$H_JSON" \
    -d "{\"modelName\":\"$MODEL\"}" \
    | jq -r '.id')
  OLLAMA_MODEL_IDS[$MODEL]=$ID
  echo "  $MODEL -> $ID"
done

GROQ_MODEL="llama3-70b-8192"
GROQ_MODEL_ID=$(curl -sf -X POST "$BASE/admin/providers/$GROQ_ID/models" \
  -H "$H_MASTER" -H "$H_JSON" \
  -d "{\"modelName\":\"$GROQ_MODEL\"}" \
  | jq -r '.id')
echo "  $GROQ_MODEL -> $GROQ_MODEL_ID"

POLLINATIONS_ID=$(curl -sf -X POST "$BASE/admin/providers" \
  -H "$H_MASTER" -H "$H_JSON" \
  -d '{"name":"Pollinations","type":"openai","baseUrl":"https://gen.pollinations.ai/v1"}' \
  | jq -r '.id')
echo "Pollinations provider: $POLLINATIONS_ID"

POLLINATIONS_MODEL="openai"
POLLINATIONS_MODEL_ID=$(curl -sf -X POST "$BASE/admin/providers/$POLLINATIONS_ID/models" \
  -H "$H_MASTER" -H "$H_JSON" \
  -d "{\"modelName\":\"$POLLINATIONS_MODEL\"}" \
  | jq -r '.id')
echo "  $POLLINATIONS_MODEL -> $POLLINATIONS_MODEL_ID"

echo ""
echo "==> Assigning AI provider keys to tenant $TENANT_ID..."

# Ollama does not need an API key
curl -sf -X POST "$BASE/admin/tenants/$TENANT_ID/credentials" \
  -H "$H_MASTER" -H "$H_JSON" \
  -d "{\"aiProviderId\":\"$OLLAMA_ID\"}" | jq -r '"  Ollama provider key: " + .id'

# Replace GROQ_API_KEY with your actual key (or set it as an env var)
GROQ_API_KEY="${GROQ_API_KEY:-}"
if [[ -n "$GROQ_API_KEY" ]]; then
  curl -sf -X POST "$BASE/admin/tenants/$TENANT_ID/credentials" \
    -H "$H_MASTER" -H "$H_JSON" \
    -d "{\"aiProviderId\":\"$GROQ_ID\",\"apiKey\":\"$GROQ_API_KEY\"}" | jq -r '"  Groq provider key: " + .id'
else
  echo "  Skipping Groq provider key (GROQ_API_KEY not set)"
fi

POLLINATIONS_API_KEY="${POLLINATIONS_API_KEY:-}"
if [[ -n "$POLLINATIONS_API_KEY" ]]; then
  curl -sf -X POST "$BASE/admin/tenants/$TENANT_ID/credentials" \
    -H "$H_MASTER" -H "$H_JSON" \
    -d "{\"aiProviderId\":\"$POLLINATIONS_ID\",\"apiKey\":\"$POLLINATIONS_API_KEY\"}" | jq -r '"  Pollinations provider key: " + .id'
else
  echo "  Skipping Pollinations provider key (POLLINATIONS_API_KEY not set)"
fi

echo ""
echo "==> Assigning AI model priorities to tenant $TENANT_ID..."

PRIORITY=0

# Groq first (if credential was assigned)
if [[ -n "$GROQ_API_KEY" ]]; then
  curl -sf -X POST "$BASE/admin/tenants/$TENANT_ID/models" \
    -H "$H_MASTER" -H "$H_JSON" \
    -d "{\"aiProviderModelId\":\"$GROQ_MODEL_ID\",\"priority\":$PRIORITY}" | jq -r "\"  priority $PRIORITY: $GROQ_MODEL (Groq)\""
  PRIORITY=$((PRIORITY + 1))
fi

# Ollama models as fallback
for MODEL in "qwen3.5:397b-cloud" "gemini-3-flash-preview" "gemma4:31b-cloud" "deepseek-v3.2:cloud"; do
  MODEL_ID=${OLLAMA_MODEL_IDS[$MODEL]}
  curl -sf -X POST "$BASE/admin/tenants/$TENANT_ID/models" \
    -H "$H_MASTER" -H "$H_JSON" \
    -d "{\"aiProviderModelId\":\"$MODEL_ID\",\"priority\":$PRIORITY}" | jq -r "\"  priority $PRIORITY: $MODEL\""
  PRIORITY=$((PRIORITY + 1))
done

# Pollinations last (if credential was assigned)
if [[ -n "$POLLINATIONS_API_KEY" ]]; then
  curl -sf -X POST "$BASE/admin/tenants/$TENANT_ID/models" \
    -H "$H_MASTER" -H "$H_JSON" \
    -d "{\"aiProviderModelId\":\"$POLLINATIONS_MODEL_ID\",\"priority\":$PRIORITY}" | jq -r "\"  priority $PRIORITY: $POLLINATIONS_MODEL (Pollinations)\""
  PRIORITY=$((PRIORITY + 1))
fi

echo ""
echo "Done."
