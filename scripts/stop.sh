#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/lib.sh"

if [ -f "$SUPERGATEWAY_PID_FILE" ]; then
  PID="$(cat "$SUPERGATEWAY_PID_FILE")"
  if kill "$PID" 2>/dev/null; then
    # supergateway stops its MCP child servers on SIGTERM and wants more than 5s of grace
    for _ in {1..24}; do kill -0 "$PID" 2>/dev/null || break; sleep 0.25; done
    kill -0 "$PID" 2>/dev/null && kill -9 "$PID" 2>/dev/null || true
    echo "✓ supergateway stopped."
  fi
  rm -f "$SUPERGATEWAY_PID_FILE"
fi

if [[ "${1:-}" != "--mcp-only" ]] && docker info >/dev/null 2>&1; then
  compose down
  echo "✓ containers stopped (volumes kept)."
fi
