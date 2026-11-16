ARG NINEROUTER_VERSION=0.5.119
FROM decolua/9router:${NINEROUTER_VERSION}
ENV DATA_DIR=/app/data
EXPOSE 20128
HEALTHCHECK --interval=10s --timeout=5s --retries=5 --start-period=30s CMD node -e "fetch('http://127.0.0.1:20128/v1/models').then(() => process.exit(0), () => process.exit(1))"
