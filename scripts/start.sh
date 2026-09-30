#!/usr/bin/env bash
# ========================================================
# Start Supermemory Local Server with 9router
# ========================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

# Load .env
if [ -f "$PROJECT_ROOT/.env" ]; then
  set -a
  source "$PROJECT_ROOT/.env"
  set +a
fi

NINEROUTER_PORT="${NINEROUTER_PORT:-20128}"
NINEROUTER_URL="http://127.0.0.1:${NINEROUTER_PORT}/v1"
SM_PORT="${PORT:-6767}"
DATA_DIR="${SUPERMEMORY_DATA_DIR:-./data}"
[[ "$DATA_DIR" = /* ]] || DATA_DIR="$PROJECT_ROOT/${DATA_DIR#./}"
PID_FILE="$PROJECT_ROOT/.supermemory.pid"
PROXY_PID_FILE="$PROJECT_ROOT/.llm-proxy.pid"
LLM_PROXY_PORT="${LLM_PROXY_PORT:-20129}"
LLM_UPSTREAM="${OPENAI_BASE_URL:-$NINEROUTER_URL}"
ZED_ADAPTER_PID_FILE="$PROJECT_ROOT/.zed-adapter.pid"
ZED_ADAPTER_PORT="${ZED_ADAPTER_PORT:-20130}"
LOG_FILE="$DATA_DIR/supermemory.log"

mkdir -p "$DATA_DIR"

echo "========================================================"
echo " Starting Supermemory Local with 9router"
echo "========================================================"

# 1. Check or start 9router
echo -n "→ Checking 9router at $NINEROUTER_URL... "
if curl -s --connect-timeout 2 "$NINEROUTER_URL/models" >/dev/null 2>&1; then
  echo "✓ Running"
else
  echo "Not running."
  if command -v 9router >/dev/null 2>&1; then
    echo "→ Starting 9router in background..."
    mkdir -p "$HOME/.9router/logs"
    # Launch in background with tray/no-browser mode
    nohup 9router -n --port "$NINEROUTER_PORT" > "$HOME/.9router/logs/server.log" 2>&1 &

    # Wait for 9router to start
    ready=0
    for i in {1..20}; do
      if curl -s --connect-timeout 1 "$NINEROUTER_URL/models" >/dev/null 2>&1; then
        ready=1
        break
      fi
      sleep 0.5
    done

    if [ "$ready" -eq 1 ]; then
      echo "✓ 9router started successfully"
    else
      echo "⚠ Warning: 9router did not respond within 10s. Check ~/.9router/logs/server.log"
    fi
  else
    echo "⚠ 9router command not found in PATH! Make sure 9router is installed and on PATH."
  fi
fi

# 2. LLM proxy (forces "stream": false; 9router answers SSE otherwise and supermemory can't parse it)
echo -n "→ Checking LLM proxy on port $LLM_PROXY_PORT... "
if curl -s --connect-timeout 1 "http://127.0.0.1:$LLM_PROXY_PORT/models" >/dev/null 2>&1; then
  echo "✓ Running"
else
  OPENAI_BASE_URL="$LLM_UPSTREAM" LLM_PROXY_PORT="$LLM_PROXY_PORT" SUPERMEMORY_EMBEDDING_DIMENSIONS="${SUPERMEMORY_EMBEDDING_DIMENSIONS:-1024}" \
    nohup bun "$PROJECT_ROOT/src/llm-proxy.ts" >> "$DATA_DIR/llm-proxy.log" 2>&1 &
  echo $! > "$PROXY_PID_FILE"
  for i in {1..20}; do
    curl -s --connect-timeout 1 "http://127.0.0.1:$LLM_PROXY_PORT/models" >/dev/null 2>&1 && break
    sleep 0.25
  done
  echo "✓ Started (PID: $(cat "$PROXY_PID_FILE"), log: $DATA_DIR/llm-proxy.log)"
fi

# 2b. Zed edit-prediction adapter (/v1/completions -> 9router /chat/completions, key from .env)
echo -n "→ Checking Zed adapter on port $ZED_ADAPTER_PORT... "
if curl -s --connect-timeout 1 "http://127.0.0.1:$ZED_ADAPTER_PORT/v1/completions" >/dev/null 2>&1; then
  echo "✓ Running"
else
  OPENAI_BASE_URL="$LLM_UPSTREAM" ZED_ADAPTER_PORT="$ZED_ADAPTER_PORT" \
    nohup bun "$PROJECT_ROOT/src/zed-adapter.ts" >> "$DATA_DIR/zed-adapter.log" 2>&1 &
  echo $! > "$ZED_ADAPTER_PID_FILE"
  for i in {1..20}; do
    curl -s --connect-timeout 1 "http://127.0.0.1:$ZED_ADAPTER_PORT/v1/completions" >/dev/null 2>&1 && break
    sleep 0.25
  done
  echo "✓ Started (PID: $(cat "$ZED_ADAPTER_PID_FILE"), log: $DATA_DIR/zed-adapter.log)"
fi

# 3. Check if supermemory-server is already running
if [ -f "$PID_FILE" ]; then
  EXISTING_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$EXISTING_PID" ] && kill -0 "$EXISTING_PID" 2>/dev/null; then
    echo "✓ supermemory-server is already running (PID: $EXISTING_PID) at http://localhost:$SM_PORT"
    exit 0
  fi
fi

# Something else (started outside this script) may already own the port
if curl -s --connect-timeout 1 "http://localhost:$SM_PORT/v4/search" \
  -H "Content-Type: application/json" -d '{"q":"ping","limit":1}' >/dev/null 2>&1; then
  echo "✓ Supermemory already responding on port $SM_PORT (not started by this script, no PID file)"
  exit 0
fi

# 4. Locate supermemory-server binary
SM_BIN=""
if [ -x "$HOME/.supermemory/bin/supermemory-server" ]; then
  SM_BIN="$HOME/.supermemory/bin/supermemory-server"
elif [ -x "$HOME/.local/bin/supermemory-server" ]; then
  SM_BIN="$HOME/.local/bin/supermemory-server"
elif command -v supermemory-server >/dev/null 2>&1; then
  SM_BIN="$(command -v supermemory-server)"
else
  echo "❌ supermemory-server binary not found!"
  echo "Please run: curl -fsSL https://supermemory.ai/install | bash"
  exit 1
fi

echo "→ Starting supermemory-server (binary: $SM_BIN)..."

# Ensure non-interactive environment variables are passed
export SUPERMEMORY_EMBEDDING_PROVIDER="${SUPERMEMORY_EMBEDDING_PROVIDER:-openai-compatible}"
export SUPERMEMORY_EMBEDDING_MODEL="${SUPERMEMORY_EMBEDDING_MODEL:-jina/jina-embeddings-v4}"
export SUPERMEMORY_EMBEDDING_DIMENSIONS="${SUPERMEMORY_EMBEDDING_DIMENSIONS:-1024}"
export WORKFLOW_ENGINE="${WORKFLOW_ENGINE:-direct}"
export PORT="$SM_PORT"
export SUPERMEMORY_PORT="$SM_PORT"
export SUPERMEMORY_DATA_DIR="$DATA_DIR"
export OPENAI_BASE_URL="http://127.0.0.1:$LLM_PROXY_PORT"
export OPENAI_API_KEY="${OPENAI_API_KEY:?OPENAI_API_KEY is not set (copy .env.example to .env)}"
export OPENAI_MODEL="${OPENAI_MODEL:-ag/gemini-3.8-flash-low}"

if [[ "${1:-}" == "--foreground" || "${1:-}" == "-f" ]]; then
  echo "Starting in foreground..."
  exec "$SM_BIN"
fi

# Start as daemon
nohup "$SM_BIN" > "$LOG_FILE" 2>&1 &
SM_PID=$!
echo "$SM_PID" > "$PID_FILE"

# Wait for server ready
echo -n "→ Waiting for supermemory-server to listen on port $SM_PORT... "
is_up=0
for i in {1..30}; do
  if curl -s --connect-timeout 1 "http://localhost:$SM_PORT/v4/search" \
    -H "Content-Type: application/json" \
    -d '{"q":"ping","limit":1}' >/dev/null 2>&1; then
    is_up=1
    break
  fi
  sleep 0.5
done

if [ "$is_up" -eq 1 ]; then
  echo "✓ Ready!"
  echo "========================================================"
  echo "  Supermemory Local is UP and RUNNING"
  echo "  - URL:         http://localhost:$SM_PORT"
  echo "  - PID:         $SM_PID (saved in .supermemory.pid)"
  echo "  - Data:        $DATA_DIR"
  echo "  - Embeddings:  $SUPERMEMORY_EMBEDDING_MODEL ($SUPERMEMORY_EMBEDDING_PROVIDER, ${SUPERMEMORY_EMBEDDING_DIMENSIONS}d)"
  echo "  - AI Model:    $OPENAI_MODEL via llm-proxy :$LLM_PROXY_PORT -> $LLM_UPSTREAM"
  echo "  - Log:         $LOG_FILE"
  echo "  - Zed adapter: http://127.0.0.1:$ZED_ADAPTER_PORT/v1/completions"
  echo "========================================================"
else
  echo "⚠ Server started with PID $SM_PID, but endpoint check timed out."
  echo "Check log file: $LOG_FILE"
fi
