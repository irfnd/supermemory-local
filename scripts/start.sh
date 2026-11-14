#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

MCP_ONLY=0
[[ "${1:-}" == "--mcp-only" ]] && MCP_ONLY=1

[ -f .env ] || { echo "❌ .env not found (cp .env.example .env)"; exit 1; }

echo "========================================================"
echo " Starting Supermemory Local (docker compose + MCP gateway)"
echo "========================================================"

if [ "$MCP_ONLY" -eq 0 ]; then
  docker info >/dev/null 2>&1 || { echo "❌ Docker is not running"; exit 1; }
  echo "→ docker compose up (9router, llm-proxy, zed-adapter, supermemory)..."
  compose up -d --build --wait --wait-timeout 300
fi

echo -n "→ MCP gateway on port $MCP_GATEWAY_PORT... "
if gateway_up; then
  echo "✓ Running"
elif ! command -v supergateway >/dev/null 2>&1; then
  echo "⚠ supergateway not found (brew install supercorp-ai/tap/supergateway), skipped"
else
  mkdir -p data
  # stdin must not be a closed pipe (it stops the gateway); PATH needs bunx/python3/pdfcraft-cli
  PATH="$HOME/.bun/bin:/opt/homebrew/bin:$PATH" nohup supergateway --config "$PROJECT_ROOT/mcp-config.json" --port "$MCP_GATEWAY_PORT" \
    < /dev/null >> "$GATEWAY_LOG" 2>&1 &
  echo $! > "$SUPERGATEWAY_PID_FILE"
  for _ in {1..20}; do gateway_up && break; sleep 0.25; done
  if kill -0 "$(cat "$SUPERGATEWAY_PID_FILE")" 2>/dev/null; then
    echo "✓ Started (PID: $(cat "$SUPERGATEWAY_PID_FILE"), log: $GATEWAY_LOG)"
  else
    echo "⚠ Exited right away, see $GATEWAY_LOG (check: bun run mcp:check)"
    rm -f "$SUPERGATEWAY_PID_FILE"
  fi
fi

echo "========================================================"
echo "  Supermemory Local is UP"
if [ "$MCP_ONLY" -eq 0 ]; then
  echo "  - Supermemory: http://127.0.0.1:6767"
  echo "  - 9router:     http://127.0.0.1:20128 (dashboard + /v1)"
  echo "  - LLM proxy:   http://127.0.0.1:20129"
  echo "  - Zed adapter: http://127.0.0.1:20130/v1/completions"
fi
echo "  - MCP gateway: http://127.0.0.1:$MCP_GATEWAY_PORT/<server>/mcp (mcp-config.json)"
echo "  - Logs:        bun run logs | $GATEWAY_LOG"
echo "========================================================"
