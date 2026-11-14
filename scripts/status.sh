#!/usr/bin/env bash
set -uo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

probe() { curl -s -o /dev/null --connect-timeout 2 "$@"; }
line() { if probe "$2"; then echo "   ● $1: $3"; else echo "   ○ $1: NOT responding ($3)"; fi; }

echo "========================================================"
echo " Supermemory Local Status"
echo "========================================================"
echo "1. Containers (docker compose):"
if docker info >/dev/null 2>&1; then
  compose ps --format '   {{.Service}}: {{.Status}}' 2>/dev/null || true
else
  echo "   ○ Docker is not running"
fi
echo ""
echo "2. Endpoints:"
line "9router" "http://127.0.0.1:20128/v1/models" "http://127.0.0.1:20128"
line "LLM proxy" "http://127.0.0.1:20129/models" "http://127.0.0.1:20129"
line "Zed adapter" "http://127.0.0.1:20130/v1/completions" "http://127.0.0.1:20130/v1/completions"
line "Supermemory" "http://127.0.0.1:6767/v3/search/spaces" "http://127.0.0.1:6767"
echo "   ● Embeddings: ${SUPERMEMORY_EMBEDDING_MODEL:-Xenova/bge-base-en-v1.5} (${SUPERMEMORY_EMBEDDING_PROVIDER:-local}), translate: ${TRANSLATE_MODEL:-off}, LLM: ${OPENAI_MODEL:-?}"
echo ""
echo "3. MCP gateway (supergateway, mcp-config.json):"
if gateway_up; then
  echo "   ● Gateway: Running on http://127.0.0.1:$MCP_GATEWAY_PORT (PID: $(cat "$SUPERGATEWAY_PID_FILE" 2>/dev/null || echo '?'))"
  supergateway --config "$PROJECT_ROOT/mcp-config.json" --checkConfig 2>&1 | sed -n '2,$p' \
    | while read -r path name _; do echo "   ● MCP: http://127.0.0.1:$MCP_GATEWAY_PORT$path/mcp ($name)"; done
else
  echo "   ○ Gateway: NOT running (expected port $MCP_GATEWAY_PORT)"
fi
echo "========================================================"
