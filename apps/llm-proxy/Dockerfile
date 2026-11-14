FROM oven/bun:1-slim
WORKDIR /app
COPY . .
RUN bun install --production --frozen-lockfile
ENV BIND_HOST=0.0.0.0 LLM_PROXY_PORT=20129
USER bun
EXPOSE 20129
HEALTHCHECK --interval=10s --timeout=5s --retries=5 CMD bun -e "await fetch('http://127.0.0.1:20129/models')"
WORKDIR /app/apps/llm-proxy
CMD ["bun", "src/main.ts"]
