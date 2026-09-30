# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Glue around a self-hosted `supermemory-server` binary (installed separately into `~/.supermemory/bin` or `~/.local/bin`). The server uses local ONNX embeddings, and its LLM calls go through the local **9router** OpenAI-compatible gateway (`127.0.0.1:20128`). This repo adds lifecycle hooks so Claude Code, Antigravity and OpenCode share persistent memory **per project**. It is TypeScript run directly by **Bun** (no build step; runtime has zero dependencies, devDependencies are only types + `tsc`). Bun-only APIs are used (`Bun.spawnSync`, `Bun.stdin`, `Bun.serve`, `import.meta.dir`), so don't run it with node. README.md is in Indonesian.

## Commands

```bash
bun install                     # devDependencies only (types, tsc, prettier)
bun run start                   # scripts/start.sh: starts 9router if down, llm-proxy, zed-adapter, then supermemory-server daemon (PIDs in .llm-proxy.pid / .zed-adapter.pid / .supermemory.pid)
./scripts/start.sh --foreground # run server in foreground
bun run stop                    # ./scripts/stop.sh --all also kills 9router
bun run status
bun test                        # unit tests (src/*.test.ts); single test: bun test -t "stripContext"
bun run typecheck               # tsc --noEmit
bun run format                  # prettier --write . (config: prettier.config.ts extends @irfnd/prettier-config: tabs, single quotes, printWidth 130, organize-imports)
bun run format:check
bun run test-memory             # integration check; needs a running server; writes under <containerTag>_selftest, exits 1 on failure
bun run install-hooks [all|claude-code|antigravity|opencode]
bun run uninstall-hooks [all|claude-code|antigravity|opencode]
```

To exercise a hook by hand, pipe the agent's payload to the entrypoint:

```bash
echo '{"cwd":"/some/repo"}' | bun --env-file=.env bin/supermemory-hook.ts claude-code start
echo '{"cwd":"/some/repo","tool_name":"Edit","tool_input":{"file_path":"x.ts"}}' | bun --env-file=.env bin/supermemory-hook.ts claude-code change
```

Logs: hooks go to `~/.supermemory-hook.log`, the server to `data/supermemory.log`, the LLM proxy (status and duration per call) to `data/llm-proxy.log`, the Zed adapter to `data/zed-adapter.log`, and 9router to `~/.9router/logs/server.log`.

## Architecture

**Flow:** agent hook → `bun --env-file=<repo>/.env bin/supermemory-hook.ts <agent> <action>` → `src/hook-handler.ts#runHook` → `SupermemoryClient` (HTTP to `SUPERMEMORY_API_URL`, default `:6767`).

- **Actions** (with aliases): `start|check|context` recalls memories and prints the context block; `sync|prompt` (Claude `UserPromptSubmit`, OpenCode every turn) prints only documents newer than the session's marker (`$TMPDIR/supermemory-sync/<session>`, written by `start`/`sync`) and not written by that same session (`metadata.session`), falling back to a full `start` when there is no marker yet. Claude's `sync` also runs a hybrid search on the `prompt` (see Recall below); OpenCode's plugin sends no prompt, so it only gets the delta. Antigravity's `PreInvocation` already runs `start` every turn; `change|observation` stores a tool or file-change note; `stop|session-end|summarize` stores the last assistant reply (truncated to 4000 chars); `compact|compacted` (Claude `PostCompact`, OpenCode `session.compacted`) stores the agent's own compaction summary as a `session_summary` (Claude: last `isCompactSummary` transcript entry, trimmed by `trimCompactSummary`; capped at 40000 chars). Antigravity has no compaction hook.
- **Per-agent payload parsing lives in `hook-handler.ts`** Each agent sends a different stdin JSON shape (Claude: `tool_name`/`tool_input`/`last_assistant_message`/`transcript_path`; Antigravity: `toolCall.{name,args}`, `workspacePaths`; OpenCode: `tool`/`args`/`summary` built by the plugin). The working directory comes from `cwd` → `workspacePaths[0]` → `directory` → `process.cwd()`.
- **Project identity** (`src/project-resolver.ts`): git toplevel (or cwd), realpath'd, gives `containerTag = proj_<sanitized-basename>_<sha256(rootDir)[:6]>`. This tag is the only key that isolates projects and links agents together. Changing how it is derived orphans all existing memories.
- **Read-only noise filtering:** the `READONLY_CMD` regex and the `OPENCODE_READONLY_TOOLS` set in `hook-handler.ts`, plus the `view_`/`read_` prefix check for Antigravity.
- **API key:** `SUPERMEMORY_API_KEY=sm_local_key` is a placeholder. The client then falls back to the server-generated `data/api-key`.
- **Recall is newest-first listing, not vector search:** `start` calls `POST /v3/documents/list` (sorted by `createdAt`), picks per-type budgets from `RECALL` (by `metadata.type`: `session_summary` / `change_observation`), then fetches full content with `GET /v3/documents/:id`. The listing includes documents still processing, so writes from other agents are visible immediately. `start` also appends the server-extracted facts from `POST /v4/profile` (all `static`, newest `PROFILE_FACTS` of `dynamic`).
- **Per-prompt hybrid search:** `sync` sends the Claude `prompt` to `POST /v4/search` with `searchMode: "hybrid"` (extracted memories + raw document chunks, the chunks covering documents whose extraction hasn't finished). `pickHits` drops hits from the same session or already injected into it (ids in `$TMPDIR/supermemory-sync/<session>.seen`) and keeps at most `MAX_CHUNKS` chunks, one per document. There is no client-side score threshold: with the multilingual `Xenova/bge-m3` embedding model the server returns nothing for unrelated chit-chat. Prompts under 3 words are skipped to save the call.
- **Feedback-loop guard:** `stripContext()` removes quoted `<supermemory-context>` blocks (identified by `CONTEXT_HEADER`) both before saving and when recalling. Keep the header text stable.
- **Server endpoints used:** `POST /v3/documents`, `POST /v3/documents/list`, `GET /v3/documents/:id`, `POST /v4/search` (hybrid, `sync`), `POST /v4/profile` (`start`), `POST /v3/search` (only `test-memory.ts`), and `GET /v3/search/spaces` (health). The shell scripts probe `POST /v4/search`. Manual cleanup only (see README, "Menghapus Dokumen Satu Container Tag"): `DELETE /v3/documents/:id` via `client.request`, which returns 409 "Document is still processing" until extraction finishes.

## Invariants when editing hooks

- **Never block or break the agent.** `bin/supermemory-hook.ts` swallows all errors (logging them to the hook log) and exits 0. Keep it that way.
- **Stdout is the injection channel.** For `claude-code` and `opencode`, whatever `start` prints becomes model context. Never `console.log` diagnostics; use `log()`.
- **Only `runHook` writes stdout.** Handlers return the context string instead of printing. Antigravity always gets a JSON object (`{}`, or `{"injectSteps":[{"ephemeralMessage": ...}]}` from `start`); the bin's catch prints `{}` on errors.
- **Hooks must run with `--env-file=<repo>/.env`.** Bun auto-loads `.env` from the working directory, which for a hook is the _user's_ project; `--env-file` loads only ours.
- **The installer writes absolute paths** (bun from `process.execPath`, since GUI-launched agents may lack `~/.bun/bin` in PATH, plus `bin/supermemory-hook.ts`) into `~/.claude/settings.json` and `~/.gemini/config/hooks.json`. Edits to `src/` take effect immediately for those agents. It finds and replaces its own entries by the `MARKER` regex (`supermemory-hook.(js|ts)`), and backs up each config as `.bak-<timestamp>` before writing.
- **`src/opencode-plugin.ts` is a template.** The installer copies it to `~/.config/opencode/plugins/supermemory-local.ts` (removing the old `.js`) and rewrites the `const HOOK_CMD = [...];` statement with a regex, so keep that declaration shape. Plugin changes need `bun run install-hooks opencode` to take effect. Do not register the plugin in `opencode.json`, because it would load twice.
- **`src/llm-proxy.ts` must sit between supermemory-server and 9router.** Supermemory's LLM calls (`response_format: json_object`, and tool calling for the memory agent) omit `stream`, and 9router answers with SSE chunks when `stream` is missing, so every document fails with "Invalid JSON response". The proxy sets `"stream": false` when unset, drops the stale `content-length`/`content-encoding` headers, and runs `Bun.serve` with `idleTimeout: 0` (Bun's 10s default would cut the ~50-110s 9router calls). `start.sh` starts it (`LLM_PROXY_PORT`, default 20129) and points the server's `OPENAI_BASE_URL` at it; the upstream is `.env`'s `OPENAI_BASE_URL` (start.sh passes it to both proxy and Zed adapter as `OPENAI_BASE_URL`, falling back to `http://127.0.0.1:$NINEROUTER_PORT/v1`). Each 9router call takes about 50s, so memory extraction for one document takes a few minutes.

- **`src/zed-adapter.ts` is independent of supermemory.** It serves Zed's `open_ai_compatible_api` edit predictions: legacy `POST /v1/completions` (`{prompt}`) becomes a 9router `/chat/completions` call (9router has no `/completions` and ignores `prompt`, so Gemini 400s on empty `contents`). It uses `.env`'s `OPENAI_BASE_URL` + `OPENAI_API_KEY` (Zed's Authorization header only as fallback), sends `reasoning_effort` (`ZED_ADAPTER_REASONING_EFFORT`, default `none`), and `cleanText` unwraps ``` fences, applies `stop` locally and re-adds the zeta `<|editable_region_start|>`/`<|editable_region_end|>` markers when the chat model drops them. `start.sh` launches it (`ZED_ADAPTER_PORT`, default 20130) before the supermemory step, because that step can `exit 0` early.

## Conventions

- Deliberate shortcuts are marked with `// ponytail:` comments, for example the read-only command heuristic.
- `data/` (DB, models, api-key, runtime) and `.env` are gitignored. To reset memory, delete everything in `data/` except `data/models`, so the embedding model does not have to be downloaded again (see the README). The embedding model (`Xenova/bge-m3`, 1024d) is locked per data dir in `data/embedding-plan.json`: the server refuses to start if `.env` names another model or dimension, so switching models requires that same reset.
