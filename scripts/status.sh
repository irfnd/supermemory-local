#!/usr/bin/env bash
# ========================================================
# Check Status of Supermemory Local & 9router
# ========================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Load .env
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

NINEROUTER_PORT="${NINEROUTER_PORT:-20128}"
NINEROUTER_URL="http://127.0.0.1:${NINEROUTER_PORT}/v1"
SM_PORT="${PORT:-6767}"
PID_FILE="$PROJECT_ROOT/.supermemory.pid"

echo "========================================================"
echo " Supermemory Local & 9router Status"
echo "========================================================"

# 1. 9router Status
echo "1. 9router Status:"
if curl -s --connect-timeout 2 "$NINEROUTER_URL/models" >/dev/null 2>&1; then
  echo "   ● Gateway: Running on http://127.0.0.1:${NINEROUTER_PORT}"
  MODEL_COUNT=$(curl -s "$NINEROUTER_URL/models" | grep -o '"id":' | wc -l | tr -d ' ' || echo "0")
  echo "   ● Available Models: $MODEL_COUNT models detected"
  echo "   ● Configured Model: ${OPENAI_MODEL:-ag/gemini-3.8-flash-low}"
else
  echo "   ○ Gateway: NOT running (Expected port $NINEROUTER_PORT)"
fi

LLM_PROXY_PORT="${LLM_PROXY_PORT:-20129}"
if curl -s --connect-timeout 2 "http://127.0.0.1:$LLM_PROXY_PORT/models" >/dev/null 2>&1; then
  echo "   ● LLM proxy: Running on http://127.0.0.1:$LLM_PROXY_PORT (forces stream:false)"
else
  echo "   ○ LLM proxy: NOT running (supermemory memory generation will fail)"
fi
ZED_ADAPTER_PORT="${ZED_ADAPTER_PORT:-20130}"
if curl -s --connect-timeout 2 "http://127.0.0.1:$ZED_ADAPTER_PORT/v1/completions" >/dev/null 2>&1; then
  echo "   ● Zed adapter: Running on http://127.0.0.1:$ZED_ADAPTER_PORT/v1/completions"
else
  echo "   ○ Zed adapter: NOT running (Zed edit predictions will fail)"
fi
echo ""

# 2. Supermemory Status
echo "2. Supermemory Status:"
IS_RUNNING=0
if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    IS_RUNNING=1
    echo "   ● Process: Running (PID: $PID)"
  fi
fi

if [ "$IS_RUNNING" -eq 0 ]; then
  if pgrep -f "supermemory-server" >/dev/null 2>&1; then
    IS_RUNNING=1
    echo "   ● Process: Running (detected via process table)"
  else
    echo "   ○ Process: NOT running"
  fi
fi

if curl -s --connect-timeout 2 "http://localhost:$SM_PORT/v4/search" \
  -H "Content-Type: application/json" \
  -d '{"q":"ping","limit":1}' >/dev/null 2>&1; then
  echo "   ● HTTP API: Healthy on http://localhost:$SM_PORT"
  echo "   ● Storage:  ${SUPERMEMORY_DATA_DIR:-./data}"
  echo "   ● Embeddings: ${SUPERMEMORY_EMBEDDING_MODEL:-jina/jina-embeddings-v4} (${SUPERMEMORY_EMBEDDING_PROVIDER:-openai-compatible})"
else
  echo "   ○ HTTP API: Not responding on port $SM_PORT"
fi

echo "========================================================"
