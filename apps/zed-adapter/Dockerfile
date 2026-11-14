FROM oven/bun:1-slim
WORKDIR /app
COPY . .
RUN bun install --production --frozen-lockfile
ENV BIND_HOST=0.0.0.0 ZED_ADAPTER_PORT=20130
USER bun
EXPOSE 20130
HEALTHCHECK --interval=10s --timeout=5s --retries=5 CMD bun -e "await fetch('http://127.0.0.1:20130/v1/completions')"
WORKDIR /app/apps/zed-adapter
CMD ["bun", "src/main.ts"]
