#!/usr/bin/env bash
# LaunchAgents that keep supergateway (and `ssh contaboo-tunnel`, unless CURL_IMPERSONATE is set in .env) running from
# login on, and restart them when they die.
# Usage: bun run launchd <install|start|stop|status|uninstall|plists>
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
AGENTS_DIR="${AGENTS_DIR:-$HOME/Library/LaunchAgents}"
DOMAIN="gui/$(id -u)"
TUNNEL=local.supermemory.tunnel
GATEWAY=local.supermemory.gateway
# hooks reach the VPS through libcurl-impersonate when this is filled, so the tunnel stays off and port 6767 unused
IMPERSONATE="$(grep -E '^CURL_IMPERSONATE=' "$ROOT/.env" 2>/dev/null | head -1 | cut -d= -f2- | tr -d "\"'[:space:]" || true)"
LABELS=("$GATEWAY")
[ -n "$IMPERSONATE" ] || LABELS=("$TUNNEL" "$GATEWAY")
GATEWAY_PORT="$(grep -E '^MCP_GATEWAY_PORT=' "$ROOT/.env" 2>/dev/null | cut -d= -f2 || true)"
GATEWAY_PORT="${GATEWAY_PORT:-20131}"

loaded() { launchctl print "$DOMAIN/$1" >/dev/null 2>&1; }
gateway_up() { curl -s --connect-timeout 1 "http://127.0.0.1:$GATEWAY_PORT/healthz" >/dev/null 2>&1; }

# plist <label> <log> <program> [args...]
plist() {
	local label=$1 log=$2 a
	shift 2
	{
		echo '<?xml version="1.0" encoding="UTF-8"?>'
		echo '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">'
		echo '<plist version="1.0"><dict>'
		echo "<key>Label</key><string>$label</string>"
		echo '<key>ProgramArguments</key><array>'
		for a in "$@"; do
			a=${a//&/&amp;}
			a=${a//</&lt;}
			echo "<string>$a</string>"
		done
		echo '</array>'
		# launchd's PATH lacks bunx/python3 (MCP servers) and brew's supergateway
		echo "<key>EnvironmentVariables</key><dict><key>PATH</key><string>$HOME/.bun/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string></dict>"
		echo '<key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ThrottleInterval</key><integer>10</integer>'
		echo "<key>StandardOutPath</key><string>$log</string><key>StandardErrorPath</key><string>$log</string>"
		echo '</dict></plist>'
	} >"$AGENTS_DIR/$label.plist"
	plutil -lint "$AGENTS_DIR/$label.plist" >/dev/null
}

write_plists() {
	mkdir -p "$AGENTS_DIR" "$ROOT/data"
	if [ -n "$IMPERSONATE" ]; then
		# domain mode: drop a tunnel plist left over from the previous install
		if loaded "$TUNNEL"; then launchctl bootout "$DOMAIN/$TUNNEL"; fi
		rm -f "$AGENTS_DIR/$TUNNEL.plist"
	else
		# BatchMode: no passphrase prompt (the key comes from the keychain agent); the short keepalive notices a dead
		# network (new IP, sleep) in ~45s instead of the ~5 min in ~/.ssh/config, then launchd reconnects
		plist "$TUNNEL" "$ROOT/data/tunnel.log" /usr/bin/ssh -N -o BatchMode=yes -o ExitOnForwardFailure=yes \
			-o ServerAliveInterval=15 -o ServerAliveCountMax=3 contaboo-tunnel
	fi
	# .env fills the ${VAR} placeholders of mcp-config.json; exec so launchd supervises supergateway itself
	plist "$GATEWAY" "$ROOT/data/supergateway.log" /bin/bash -c \
		"set -e; cd '$ROOT'; set -a; . ./.env; set +a; exec supergateway --config mcp-config.json --port \"\${MCP_GATEWAY_PORT:-20131}\""
}

# A hand-started tunnel or gateway holds the ports, so the agent would crash-loop (ExitOnForwardFailure)
check_free() {
	local busy=0
	if [ -z "$IMPERSONATE" ] && ! loaded "$TUNNEL" && pgrep -f 'ssh .*contaboo-tunnel' >/dev/null; then
		echo "❌ an 'ssh contaboo-tunnel' is already running (PID $(pgrep -f 'ssh .*contaboo-tunnel' | tr '\n' ' ')): stop it first"
		busy=1
	fi
	if ! loaded "$GATEWAY" && gateway_up; then
		echo "❌ supergateway already answers on :$GATEWAY_PORT: run 'bun run stop:mcp' first"
		busy=1
	fi
	return $busy
}

start() {
	local l
	for l in "${LABELS[@]}"; do
		if loaded "$l"; then launchctl kickstart -k "$DOMAIN/$l"; else launchctl bootstrap "$DOMAIN" "$AGENTS_DIR/$l.plist"; fi
	done
	for _ in {1..40}; do gateway_up && break; sleep 0.5; done
	status
}

stop() {
	local l
	for l in "${LABELS[@]}"; do loaded "$l" && launchctl bootout "$DOMAIN/$l"; done
	echo "✓ stopped (plists kept, 'start' loads them again)"
}

status() {
	local l
	for l in "${LABELS[@]}"; do
		if loaded "$l"; then
			echo "$l: $(launchctl print "$DOMAIN/$l" | grep -E '^\s*(state|pid|last exit code) ' | sed 's/^\s*//' | tr '\n' ' ')"
		else
			echo "$l: not loaded"
		fi
	done
	gateway_up && echo "gateway   :$GATEWAY_PORT ✓" || echo "gateway   :$GATEWAY_PORT ✗"
	if [ -n "$IMPERSONATE" ]; then
		echo "egress    : curl-impersonate ($IMPERSONATE), tunnel off"
	else
		local code
		code="$(curl -s --connect-timeout 2 -o /dev/null -w '%{http_code}' http://127.0.0.1:6767/v3/health || true)"
		[ "$code" = 200 ] && echo "supermemory :6767 ✓ (through the tunnel)" || echo "supermemory :6767 ✗ ($code)"
	fi
}

install() {
	[ -f "$ROOT/.env" ] || { echo "❌ $ROOT/.env not found"; exit 1; }
	# supergateway aborts on an unset ${VAR} of mcp-config.json: catch it here, not as a launchd crash loop
	local v missing=()
	for v in $(grep -oE '\$\{[A-Z0-9_]+\}' "$ROOT/mcp-config.json" | tr -d '${}' | sort -u); do
		(set -a; . "$ROOT/.env"; [ -n "${!v:-}" ]) || missing+=("$v")
	done
	[ ${#missing[@]} -eq 0 ] || { echo "❌ not set in $ROOT/.env (needed by mcp-config.json): ${missing[*]}"; exit 1; }
	command -v supergateway >/dev/null || PATH="/opt/homebrew/bin:$PATH" command -v supergateway >/dev/null \
		|| { echo "❌ supergateway not found (brew install supercorp-ai/tap/supergateway)"; exit 1; }
	[ -n "$IMPERSONATE" ] || { ssh -G contaboo-tunnel >/dev/null 2>&1 || { echo "❌ no 'Host contaboo-tunnel' in ~/.ssh/config"; exit 1; }; }
	check_free || exit 1
	local l
	for l in "${LABELS[@]}"; do loaded "$l" && launchctl bootout "$DOMAIN/$l"; done
	write_plists
	echo "✓ wrote $AGENTS_DIR/{$(echo "${LABELS[*]}" | tr ' ' ',')}.plist"
	if [ -n "$IMPERSONATE" ]; then echo "ℹ CURL_IMPERSONATE=$IMPERSONATE: tunnel agent not installed"; fi
	start
	echo "ℹ LaunchAgents start at login, not before it: enable automatic login if the Mac must come up unattended."
}

uninstall() {
	local l
	for l in "$TUNNEL" "$GATEWAY"; do
		loaded "$l" && launchctl bootout "$DOMAIN/$l"
		rm -f "$AGENTS_DIR/$l.plist"
	done
	echo "✓ agents removed (logs in $ROOT/data kept)"
}

case "${1:-}" in
install) install ;;
start) start ;;
stop) stop ;;
status) status ;;
uninstall) uninstall ;;
plists) write_plists ;;
*) echo "usage: bun run launchd <install|start|stop|status|uninstall|plists>"; exit 2 ;;
esac
