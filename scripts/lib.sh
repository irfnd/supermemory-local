#!/usr/bin/env bash
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_ROOT"

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

MCP_GATEWAY_PORT="${MCP_GATEWAY_PORT:-20131}"
SUPERGATEWAY_PID_FILE="$PROJECT_ROOT/.supergateway.pid"
GATEWAY_LOG="$PROJECT_ROOT/data/supergateway.log"

compose() {
  docker compose -f docker-compose.yml -f docker-compose.local.yml "$@"
}

gateway_up() {
  curl -s --connect-timeout 1 "http://127.0.0.1:$MCP_GATEWAY_PORT/healthz" >/dev/null 2>&1
}
