# supermemory-server: the release binary from GitHub (sha256 verified against the release manifest), Linux build for the build host's arch
FROM debian:bookworm-slim
ARG SUPERMEMORY_VERSION=0.0.8
ARG TARGETARCH
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl jq && rm -rf /var/lib/apt/lists/*
RUN set -eux; \
	case "$TARGETARCH" in amd64) p=linux-x64 ;; arm64) p=linux-arm64 ;; *) echo "unsupported arch: $TARGETARCH" >&2; exit 1 ;; esac; \
	base="https://github.com/supermemoryai/supermemory/releases/download/server-v${SUPERMEMORY_VERSION}"; \
	curl -fsSL "$base/manifest.json" -o /tmp/manifest.json; \
	curl -fsSL "$base/supermemory-server-$p" -o /usr/local/bin/supermemory-server; \
	echo "$(jq -er ".platforms[\"$p\"].checksum" /tmp/manifest.json)  /usr/local/bin/supermemory-server" | sha256sum -c -; \
	chmod +x /usr/local/bin/supermemory-server; rm /tmp/manifest.json
COPY apps/supermemory-server/entrypoint.sh /usr/local/bin/supermemory-entrypoint.sh
ENV PORT=6767 SUPERMEMORY_PORT=6767 WORKFLOW_ENGINE=direct
EXPOSE 6767
VOLUME /data
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=180s CMD curl -fsS -X POST http://127.0.0.1:6767/v4/search -H 'Content-Type: application/json' -d '{"q":"ping","limit":1}' >/dev/null
ENTRYPOINT ["/usr/local/bin/supermemory-entrypoint.sh"]
