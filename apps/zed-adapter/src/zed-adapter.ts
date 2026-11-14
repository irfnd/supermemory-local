import { LOGGER, type Logger } from '@supermemory-local/shared/logger';
import type { Handler } from '@supermemory-local/shared/serve';
import { toTextCompletion, SYSTEM_PROMPT, type ChatCompletion, type CompletionRequest } from '@/completion.ts';
import { ZED_ADAPTER_CONFIG, type ZedAdapterConfig } from '@/config.ts';

export class ZedAdapter implements Handler {
	constructor(
		private readonly config: ZedAdapterConfig,
		private readonly logger: Logger,
	) {}

	async handle(req: Request): Promise<Response> {
		if (this.config.token && req.headers.get('authorization') !== `Bearer ${this.config.token}`) {
			return Response.json({ error: { message: 'zed-adapter: unauthorized' } }, { status: 401 });
		}
		const started = Date.now();
		const { pathname } = new URL(req.url);
		if (req.method !== 'POST' || pathname !== '/v1/completions') {
			return Response.json({ error: { message: 'zed-adapter: only POST /v1/completions' } }, { status: 404 });
		}
		try {
			const request = (await req.json()) as CompletionRequest;
			const prompt = [request.prompt ?? ''].flat().join('');
			const upstream = await fetch(`${this.config.upstream}/chat/completions`, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json', Authorization: this.authorization(req) },
				body: JSON.stringify({
					model: request.model,
					messages: [
						{ role: 'system', content: SYSTEM_PROMPT },
						{ role: 'user', content: prompt },
					],
					temperature: request.temperature,
					reasoning_effort: this.config.reasoningEffort,
					stream: false,
				}),
			});
			const data = (await upstream.json().catch(() => ({
				error: { message: `upstream ${upstream.status} non-JSON` },
			}))) as ChatCompletion;
			this.logger.info(`${request.model} ${upstream.status} ${Date.now() - started}ms prompt=${prompt.length}ch`);
			if (!upstream.ok || data.error) return Response.json(data, { status: upstream.ok ? 502 : upstream.status });

			const completion = toTextCompletion(data, request, prompt);
			if (!request.stream) return Response.json(completion);
			return new Response(`data: ${JSON.stringify(completion)}\n\ndata: [DONE]\n\n`, {
				headers: { 'Content-Type': 'text/event-stream' },
			});
		} catch (err) {
			const message = (err as Error).message;
			this.logger.info(`ERROR ${message}`);
			return Response.json({ error: { message: `zed-adapter: ${message}` } }, { status: 502 });
		}
	}

	private authorization(req: Request): string {
		return this.config.apiKey ? `Bearer ${this.config.apiKey}` : (req.headers.get('authorization') ?? '');
	}
}
