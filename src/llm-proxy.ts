// LLM proxy between supermemory-server and 9router.
// supermemory omits "stream" in its OpenAI calls and 9router then answers with SSE chunks,
// which supermemory can't parse ("Invalid JSON response"). This forces "stream": false when unset.
// Usage: LLM_PROXY_TARGET=http://127.0.0.1:20128/v1 LLM_PROXY_PORT=20129 bun src/llm-proxy.ts

const TARGET = process.env.OPENAI_BASE_URL!.replace(/\/$/, '');
const PORT = Number(process.env.LLM_PROXY_PORT);

export function forceNonStream(body: string): string {
	try {
		const json = JSON.parse(body);
		if (json && typeof json === 'object' && !Array.isArray(json) && json.stream === undefined) {
			return JSON.stringify({ ...json, stream: false });
		}
	} catch {}
	return body;
}

async function proxy(req: Request): Promise<Response> {
	const started = Date.now();
	const url = new URL(req.url);
	const body = req.method === 'GET' || req.method === 'HEAD' ? undefined : forceNonStream(await req.text());
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
