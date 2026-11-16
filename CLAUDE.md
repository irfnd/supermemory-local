# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Persistent per-project memory for Claude Code, Antigravity and OpenCode. The shared services run as **Docker Compose** containers (on the Mac, or on a VPS through Dokploy): `supermemory-server` (release binary), `9router` (published `decolua/9router` image, the OpenAI-compatible LLM gateway), `llm-proxy` and `zed-adapter`. What stays on the Mac: the hooks (Bun) and `supergateway` (brew), which serves the laptop-bound MCP servers of `mcp-config.json`. Embeddings default to the server's built-in local ONNX model `Xenova/bge-base-en-v1.5` (768d, English-only, so hooks translate non-English text first, see Translation), or a multilingual 9router model (`openai-compatible`, e.g. `jina/jina-embeddings-v4`).

TypeScript run directly by **Bun** (no build step). Runtime dependencies are only `tsyringe` + `reflect-metadata`; devDependencies are types, `tsc` and prettier. Bun-only APIs are used (`Bun.spawnSync`, `Bun.stdin`, `Bun.serve`, `Bun.CryptoHasher`, `import.meta.dir`), so don't run it with node. README.md is in Indonesian.

## Commands

```bash
bun install
bun run start            # docker compose up --build --wait (+ local overrides) then supergateway (PID .supergateway.pid)
bun run start:mcp        # supergateway only (server lives on a VPS)
bun run stop             # supergateway, then docker compose down (volumes and ./data kept); stop:mcp = gateway only
bun run status
bun run logs             # docker compose logs -f
bun run mcp:check        # supergateway --checkConfig on mcp-config.json (loads .env for the ${VAR}s)
bun test                 # all unit/DI tests (apps/**, packages/**); single test: bun test -t "stripContext"
bun run typecheck        # tsc --noEmit in every workspace
bun run format           # prettier --write . (tabs, single quotes, printWidth 130, organize-imports)
bun run format:check
bun run test-memory      # integration check against a running server; writes under <containerTag>_selftest, exits 1 on failure
bun run install-hooks [all|claude-code|antigravity|opencode]
bun run uninstall-hooks [all|claude-code|antigravity|opencode]
```

To exercise a hook by hand, pipe the agent's payload to the entrypoint (works from any cwd):

```bash
echo '{"cwd":"/some/repo"}' | bun --env-file=.env bin/supermemory-hook.ts claude-code start
echo '{"cwd":"/some/repo","tool_name":"Edit","tool_input":{"file_path":"x.ts"}}' | bun --env-file=.env bin/supermemory-hook.ts claude-code change
```

Logs: containers via `bun run logs`, the MCP gateway in `data/supergateway.log`, hooks in `~/.supermemory-hook.log`.

## Layout and DI

Bun-workspaces monorepo: `apps/<service>` (`hooks`, `llm-proxy`, `zed-adapter`, plus Dockerfile-only `supermemory-server` and `9router`) and `packages/` (`shared`: logger, env, `Bun.serve` wrapper, tsyringe helpers; `client`: supermemory HTTP client + project resolver). Package names are `@supermemory-local/<name>`; `shared` and `client` export `./*` → `./src/*.ts`, so imports read `@supermemory-local/shared/di`. `bunfig.toml` sets `linker = "hoisted"`: Bun 1.3's default isolated linker puts workspace links only inside each workspace, so `bin/supermemory-hook.ts` at the root could not resolve them and prettier could not find its plugin. Each app has `config.ts` (typed config loaded from env), plain classes with constructor injection, `container.ts` (the composition root) and colocated `*.test.ts`; the installer and self-test live inside `apps/hooks/src/installer` and `src/self-test`.

- **No decorators.** Classes take their dependencies as typed constructor parameters and know nothing about tsyringe. All wiring is in each `container.ts` via `provide` (values), `singleton` (cached factory) and `getAll` (multi-binding) from `@supermemory-local/shared/di`. Reason: Bun applies `experimentalDecorators` from the tsconfig it finds for the _cwd_, and hooks run in the user's project, so `@injectable()`/`@inject()` yields `TypeInfo not known` there (the hook then fails silently). Keep it decorator-free.
- Import DI primitives only from `@supermemory-local/shared/di` (it loads `reflect-metadata` before tsyringe).
- Tokens are typed symbols (`token<T>()`) declared next to their interface/config (`LOGGER`, `HOOKS_CONFIG`, `AGENT_ADAPTER`, ...); classes are their own tokens.
- Tests build the real container with a fake env, then override a binding (`container.register(SupermemoryClient, { useValue: fake })`, or a silent `LOGGER`) before the first `resolve`. Proxy/adapter tests run against a local `Bun.serve` upstream.
- Per-agent behavior is a strategy (`apps/hooks/src/agents/`): `AgentAdapter { id, label, cachesStart, describeChange, render }`. A new agent is one adapter + one `provide(container, AGENT_ADAPTER, ...)`; unknown agent ids fall back to the Claude-format `GenericAdapter`.

## Hook architecture

**Flow:** agent hook → `bun --env-file=<repo>/.env bin/supermemory-hook.ts <agent> <action>` → `apps/hooks/src/main.ts` → `HookRunner.run` → `MemoryRecall` / `MemoryRecorder` → `SupermemoryClient` (`SUPERMEMORY_API_URL`, default `http://127.0.0.1:6767`).

- **Actions** (aliases in `hook-runner.ts`): `start|check|context` recalls and prints the context block; `sync|prompt` (Claude `UserPromptSubmit`, OpenCode every turn) prints only documents newer than the session marker (`$TMPDIR/supermemory-sync/<session>`, `SessionStore`) and not written by that session, plus a hybrid search on the Claude `prompt`; falls back to a full `start` without a marker. Antigravity's `PreInvocation` runs `start` before every model call (~20 per turn), so its adapter has `cachesStart` and `cachedStart` reuses the rendered recall per `conversationId` for 30s. `change|observation` stores a tool/file-change note; `stop|session-end|summarize` stores the last assistant reply (max 4000 chars); `compact|compacted` (Claude `PostCompact`, OpenCode `session.compaction.ended`) stores the agent's compaction summary as `session_summary` (max 40000). Antigravity has no compaction hook.
- **Payload parsing** is per agent (`payload.ts` + adapters). Claude: `tool_name`/`tool_input`/`last_assistant_message`/`transcript_path`; Antigravity: `toolCall.{name,args}`, `workspacePaths`, `transcriptPath`; OpenCode: `tool`/`args`/`summary` built by the plugin. Working directory: `cwd` → `workspacePaths[0]` → `directory` → `process.cwd()`.
- **Project identity** (`ProjectResolver`): git toplevel (or cwd), realpath'd → `containerTag = proj_<sanitized-basename>_<sha256(rootDir)[:6]>`. It is the only key isolating projects and linking agents. Changing its derivation orphans all memories.
- **Read-only noise filtering:** `isReadOnlyCommand` (`text.ts`), the OpenCode read-only tool set, and the `view_`/`read_` prefix check in the Antigravity adapter.
- **API key:** `SUPERMEMORY_API_KEY`; when the variable is _unset_, `data/supermemory/current/api-key` (the bind-mounted store of the local compose); when it is set but empty, no `Authorization` header is sent (`??`, not `||`, so a tunnel to a remote server does not borrow the local container's key and get 401). The server generates its key at first boot, so it cannot be chosen. Since 0.0.9 every request needs `Authorization: Bearer <key>`, loopback included (0.0.8 auto-applied it to loopback requests, which is what made an empty key work through a tunnel); only `GET /v3/health` is open.
- **Recall is newest-first listing, not vector search:** `start` calls `POST /v3/documents/list` (sorted by `createdAt`), picks per-type budgets from `RECALL` (`session_summary` / `change_observation`), then `GET /v3/documents/:id` for full content. Listing includes documents still processing, so other agents' writes are visible at once. `start` also appends `POST /v4/profile` facts (all `static`, newest `PROFILE_FACTS` of `dynamic`).
- **Per-prompt hybrid search:** `sync` sends the Claude `prompt` to `POST /v4/search` with `searchMode: "hybrid"`. `pickHits` drops hits from the same session or already injected (`<session>.seen`) and keeps at most `MAX_CHUNKS` chunks, one per document. No client-side score threshold. Prompts under 3 words are skipped.
- **Translation (`TRANSLATE_MODEL`):** for English-only embeddings, `Translator.toEnglish` translates the `sync` prompt (8s) and the `stop` summary (8s, the agent waits on it) through a 9router chat call (`OPENAI_BASE_URL`, `stream: false`). `isEnglish` (stopword ratio) skips English text. Change notes and compaction summaries are never translated. Any failure returns the original text; empty `TRANSLATE_MODEL` disables it.
- **Feedback-loop guard:** `stripContext()` removes quoted `<supermemory-context>` blocks (identified by `CONTEXT_HEADER`) before saving and when recalling. Keep the header text stable.
- **Server endpoints used:** `POST /v3/documents`, `POST /v3/documents/list`, `GET /v3/documents/:id`, `POST /v4/search`, `POST /v4/profile`, `POST /v3/search` (self-test only), `GET /v3/search/spaces` (health). Manual cleanup: `DELETE /v3/documents/:id` via `client.request`, which returns 409 until extraction finishes.

## Invariants when editing hooks

- **Never block or break the agent.** `main.ts` swallows all errors (logging to the hook log) and exits 0. Antigravity always gets a JSON object (`render('')` → `{}`).
- **Stdout is the injection channel.** For `claude-code` and `opencode`, whatever `start` prints becomes model context. Never `console.log` diagnostics; use the `Logger`.
- **Only `main.ts` writes stdout.** Handlers return strings; `AgentAdapter.render` shapes them.
- **Hooks must run with `--env-file=<repo>/.env`.** Bun auto-loads `.env` from the cwd, which for a hook is the user's project.
- **The installer writes absolute paths** (bun from `process.execPath`, plus `bin/supermemory-hook.ts`) into `~/.claude/settings.json` and `~/.gemini/config/hooks.json`; edits under `apps/` and `packages/` apply immediately. It finds its own entries by `HOOK_MARKER` (`supermemory-hook.(js|ts)`) and backs up each config as `.bak-<timestamp>`. `bin/supermemory-hook.ts` must stay at that path.
- **`apps/hooks/src/opencode-plugin.ts` is a standalone template for the OpenCode 2.x plugin API** (no imports from this repo; v1 hooks are never called). The installer copies it to `~/.config/opencode/plugins/supermemory-local.ts` and rewrites the `const HOOK_CMD = [...];` statement with a regex, so keep that declaration shape. v2 loads only a default export `{ id, setup(ctx) }`; `ctx.session.hook('context')` replaces `system.transform`, `ctx.tool.hook('execute.after')` replaces `tool.execute.after`; there is no idle event, so `stop` is sent on `session.execution.succeeded` with the last `session.text.ended` text. `session.compaction.ended`'s payload is undocumented (`summary`/`text` is a guess). Stale plugin instances survive hot reloads and each handles every event, hence `SessionStore.firstTime`. Plugin changes need `bun run install-hooks opencode`. Do not also list the plugin in `opencode.json`.

## Containers

- **Per-app deployment (Dokploy):** every service has its own `apps/<service>/Dockerfile`, all built with the repo root as context (`COPY . .` then `bun install --production --frozen-lockfile`; `.dockerignore` strips `data`, `.env*`, tests). In Dokploy each is a separate Application (Build Type Dockerfile, Dockerfile Path `apps/<service>/Dockerfile`, Docker Context Path `.` filled in explicitly: when empty, Dokploy 0.31 builds with the Dockerfile's own directory as context, which lacks `packages/` and the root `package.json` workspaces), reaching the others at `http://<App Name>:<port>` through `OPENAI_BASE_URL` in its Environment tab. Variables two or more apps must agree on (`NINEROUTER_URL`, `LLM_PROXY_URL`, `OPENAI_API_KEY`, `SUPERMEMORY_EMBEDDING_DIMENSIONS`) are Dokploy project variables (`dokploy.env.example`), referenced as `${{project.NAME}}`; the rest is app specific (`apps/<service>/.env.example`). `HEALTHCHECK` lives in the Dockerfiles, so compose and Swarm inherit it. Recreating the `llm-proxy` app changes its App Name and locks existing supermemory stores out (embedding endpoint is locked). **`docker-compose.yml`** runs the same four images as one stack: `expose` only, named volumes by default (`supermemory-data`, `ninerouter-data`), variables via `${VAR}` interpolation. **`docker-compose.local.yml`** adds `127.0.0.1` port publishing for the Mac; `scripts/lib.sh#compose` always passes both files. The same `.env` feeds compose interpolation and the hooks, so compose must not interpolate `OPENAI_BASE_URL` (in `.env` it points hooks at `127.0.0.1:20128`); the compose services hardcode `http://9router:20128/v1`.
- **`supermemory`**: `apps/supermemory-server/Dockerfile` is the official `docker.io/supermemory/supermemory:${SUPERMEMORY_VERSION}` image (bind `0.0.0.0`, key hidden in logs, non-root `supermemory`) with our entrypoint, run as root because older volumes are root-owned; `WORKFLOW_ENGINE=direct` no longer exists (0.0.9 uses `rivet`). Upgrade = official procedure: stop, back up `/data`, bump `SUPERMEMORY_VERSION`, redeploy, `GET /v3/health`; never point an older image at a migrated store (the new server verifies a full backup before migrating, and its cleanup can drop older duplicate documents). `apps/supermemory-server/entrypoint.sh` picks `/data/stores/<model>-<dim>d` (one store per embedding model: the server locks a data dir to provider/model/dimensions/endpoint via `embedding-plan.json` and refuses to boot on a mismatch) and links `/data/current` to it. The store is encrypted with a key derived from the machine id (hardware id on macOS, `machine-key` file on Linux), so a store created by the macOS binary cannot be opened in a container: migrate through the API, never by copying files (a failed boot also writes `machine-key`/`error.log` into the store dir).
- **`llm-proxy`** (`apps/llm-proxy/`) must sit between supermemory-server and 9router: supermemory omits `stream` and 9router then answers SSE (every document fails with "Invalid JSON response"), so the proxy sets `stream:false` on chat; it fills `dimensions` on `/embeddings` from `SUPERMEMORY_EMBEDDING_DIMENSIONS` (the server sends it only for `text-embedding-3-*`; Jina v4's 2048 / Gemini's 3072 exceed pgvector's 2000); it adds `usage.prompt_tokens` to embeddings that only carry `total_tokens` (Jina); it drops stale `content-length`/`content-encoding`; `listen` sets `idleTimeout: 0` (9router calls take up to ~110s). Changing the proxy's service name or port breaks existing stores (the endpoint is locked).
- **`zed-adapter`** (`apps/zed-adapter/`) is independent of supermemory: Zed's legacy `POST /v1/completions` becomes a 9router `/chat/completions` call (`reasoning_effort` from `ZED_ADAPTER_REASONING_EFFORT`, default `none`; `cleanText` unwraps fences, applies `stop` locally, re-adds the zeta region markers). Optional inbound auth: with `ZED_ADAPTER_TOKEN` set it requires `Authorization: Bearer <token>`; without it, never give it a public domain.
- **`9router`**: image `decolua/9router:${NINEROUTER_VERSION}`, data dir `/app/data`. Locally it bind-mounts `~/.9router`, so never run the host 9router and the container on the same data. `REQUIRE_API_KEY` is off by default; turn it on only after `OPENAI_API_KEY` is a key created in the dashboard. Model extraction speed depends on `OPENAI_MODEL` (`cc/claude-haiku-4-5-20251001` ~1-5s; the `ag/*` models ~50s per call and need an active Antigravity login in 9router).
- **`mcp-config.json`** is the single MCP source for the local supergateway (`start.sh` runs it with `< /dev/null`, because a closed stdin pipe stops it, and `$HOME/.bun/bin:/opt/homebrew/bin` prepended to PATH). Each server is `http://127.0.0.1:20131/<name>/mcp` (streamableHttp, stateful). Secrets are `${VAR}` placeholders filled from `.env`; an unset variable aborts startup. `stop.sh` waits up to ~6s for graceful child shutdown before `kill -9`. Agent configs point at the gateway and fail to connect while it is down.

## Conventions

- Imports are absolute: `@/*` → `./src/*` (per-app `tsconfig.json` `paths`, resolved per importing file so hooks keep working from any cwd) inside an app, and `@supermemory-local/<package>/<file>` across packages. No relative `./` or `../` imports; `opencode-plugin.ts` has none because it is copied out of the repo. Docker images copy the whole repo (minus `.dockerignore`), so every tsconfig is present.
- Keep comments to non-obvious _why_; deliberate shortcuts are marked `// ponytail:` (for example the read-only command heuristic).
- `data/` and `.env` are gitignored. Reset memory: `bun run stop`, `rm -rf data/supermemory`, `bun run start`. Switching embedding model: edit `.env`, `bun run stop && bun run start` (each model keeps its own store); the README section "Mengganti Model" has the full procedure.
