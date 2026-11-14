import { LOGGER, type Logger } from '@supermemory-local/shared/logger';
import type { Handler } from '@supermemory-local/shared/serve';
import { LLM_PROXY_CONFIG, type LlmProxyConfig } from '@/config.ts';
import { fixEmbeddingResponse, rewriteBody } from '@/rewrite.ts';

export class LlmProxy implements Handler {
	constructor(
		private readonly config: LlmProxyConfig,
		private readonly logger: Logger,
	) {}

	async handle(req: Request): Promise<Response> {
		const started = Date.now();
		const url = new URL(req.url);
		const body =
			req.method === 'GET' || req.method === 'HEAD'
				? undefined
				: rewriteBody(await req.text(), url.pathname, this.config.dimensions);
		const headers = new Headers(req.headers);
		headers.delete('host');
		headers.delete('content-length');
		try {
			const upstream = await fetch(this.config.upstream + url.pathname + url.search, { method: req.method, headers, body });
			this.logger.info(`${req.method} ${url.pathname} ${upstream.status} ${Date.now() - started}ms`);
			const out = new Headers(upstream.headers);
			out.delete('content-encoding');
			out.delete('content-length');
			if (upstream.ok && url.pathname.endsWith('/embeddings')) {
				return new Response(fixEmbeddingResponse(await upstream.text()), { status: upstream.status, headers: out });
			}
			return new Response(upstream.body, { status: upstream.status, headers: out });
		} catch (err) {
			const message = (err as Error).message;
			this.logger.info(`${req.method} ${url.pathname} ERROR ${message}`);
			return Response.json({ error: { message: `llm-proxy: ${message}` } }, { status: 502 });
		}
	}
}
