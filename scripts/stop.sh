#!/usr/bin/env bash
# ========================================================
# Stop Supermemory Local Server
# ========================================================
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
PID_FILE="$PROJECT_ROOT/.supermemory.pid"

if [ -f "$PID_FILE" ]; then
  PID="$(cat "$PID_FILE" 2>/dev/null || true)"
  if [ -n "$PID" ] && kill -0 "$PID" 2>/dev/null; then
    echo "Stopping supermemory-server (PID: $PID)..."
    kill "$PID" || true
    sleep 1
    if kill -0 "$PID" 2>/dev/null; then
      kill -9 "$PID" || true
    fi
    echo "✓ supermemory-server stopped."
  else
    echo "supermemory-server is not running (PID $PID was not active)."
  fi
  rm -f "$PID_FILE"
else
  # Fallback to pkill if no pid file
  if pgrep -f "supermemory-server" >/dev/null 2>&1; then
    echo "Stopping supermemory-server processes..."
    pkill -f "supermemory-server" || true
    echo "✓ supermemory-server stopped."
  else
    echo "supermemory-server is not running."
  fi
fi

PROXY_PID_FILE="$PROJECT_ROOT/.llm-proxy.pid"
if [ -f "$PROXY_PID_FILE" ]; then
  kill "$(cat "$PROXY_PID_FILE")" 2>/dev/null && echo "✓ llm-proxy stopped."
  rm -f "$PROXY_PID_FILE"
fi

ZED_ADAPTER_PID_FILE="$PROJECT_ROOT/.zed-adapter.pid"
if [ -f "$ZED_ADAPTER_PID_FILE" ]; then
  kill "$(cat "$ZED_ADAPTER_PID_FILE")" 2>/dev/null && echo "✓ zed-adapter stopped."
  rm -f "$ZED_ADAPTER_PID_FILE"
fi

if [[ "${1:-}" == "--all" ]]; then
  if pgrep -f "9router" >/dev/null 2>&1; then
    echo "Stopping 9router..."
    pkill -f "9router" || true
    echo "✓ 9router stopped."
  fi
fi
