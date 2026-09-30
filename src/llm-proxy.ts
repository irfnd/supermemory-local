// LLM + embedding proxy between supermemory-server and 9router.
// supermemory omits "stream" in its OpenAI calls and 9router then answers with SSE chunks,
// which supermemory can't parse ("Invalid JSON response"). This forces "stream": false when unset.
// supermemory also sends /embeddings `dimensions` only for text-embedding-3-*, so Jina v4 (2048) or Gemini (3072) answer
// above pgvector's 2000 limit; this fills SUPERMEMORY_EMBEDDING_DIMENSIONS instead.
// Usage: OPENAI_BASE_URL=http://127.0.0.1:20128/v1 LLM_PROXY_PORT=20129 SUPERMEMORY_EMBEDDING_DIMENSIONS=1024 bun src/llm-proxy.ts

const TARGET = process.env.OPENAI_BASE_URL!.replace(/\/$/, '');
const PORT = Number(process.env.LLM_PROXY_PORT);
const DIMENSIONS = Number(process.env.SUPERMEMORY_EMBEDDING_DIMENSIONS) || undefined;

/**
 * Fills what supermemory leaves unset: `stream: false` on chat calls, `dimensions` on /embeddings
 */
export function rewriteBody(body: string, path: string, dimensions = DIMENSIONS): string {
	try {
		const json = JSON.parse(body);
		if (json && typeof json === 'object' && !Array.isArray(json)) {
			if (path.endsWith('/embeddings')) {
				if (json.dimensions === undefined && dimensions) return JSON.stringify({ ...json, dimensions });
			} else if (json.stream === undefined) {
				return JSON.stringify({ ...json, stream: false });
			}
		}
	} catch {}
	return body;
}

async function proxy(req: Request): Promise<Response> {
	const started = Date.now();
	const url = new URL(req.url);
	const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : rewriteBody(await req.text(), url.pathname);
	const headers = new Headers(req.headers);
	// fetch sets these itself; a stale content-length would truncate the rewritten body
	headers.delete('host');
	headers.delete('content-length');
	try {
		const up = await fetch(TARGET + url.pathname + url.search, { method: req.method, headers, body });
		console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} ${up.status} ${Date.now() - started}ms`);
		// fetch already decompressed the body, so these upstream headers no longer match it
		const out = new Headers(up.headers);
		out.delete('content-encoding');
		out.delete('content-length');
		return new Response(up.body, { status: up.status, headers: out });
	} catch (err) {
		const message = (err as Error).message;
		console.log(`${new Date().toISOString()} ${req.method} ${url.pathname} ERROR ${message}`);
		return Response.json({ error: { message: `llm-proxy: ${message}` } }, { status: 502 });
	}
}

if (import.meta.main) {
	// idleTimeout 0: 9router calls take ~50-110s, Bun's 10s default would drop them
	Bun.serve({ hostname: '127.0.0.1', port: PORT, idleTimeout: 0, fetch: proxy });
	console.log(`llm-proxy listening on 127.0.0.1:${PORT} -> ${TARGET}`);
}
