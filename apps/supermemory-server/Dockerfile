# supermemory-server: the official image (docker.io/supermemory/supermemory, linux amd64 + arm64) plus our entrypoint,
# which keeps one store per embedding model. The image already sets SUPERMEMORY_HOST=0.0.0.0, HIDE_API_KEY_IN_LOGS and NO_UPDATE_CHECK.
ARG SUPERMEMORY_VERSION=0.0.9
FROM docker.io/supermemory/supermemory:${SUPERMEMORY_VERSION}
# The image runs as `supermemory`, but volumes written by 0.0.8 are root-owned and the entrypoint creates /data/stores
USER root
COPY apps/supermemory-server/entrypoint.sh /usr/local/bin/supermemory-entrypoint.sh
EXPOSE 6767
VOLUME /data
# /v3/health is the only route that needs no key (every other request does since 0.0.9)
HEALTHCHECK --interval=15s --timeout=5s --retries=5 --start-period=180s CMD curl -fsS http://127.0.0.1:6767/v3/health >/dev/null
ENTRYPOINT ["/usr/local/bin/supermemory-entrypoint.sh"]
