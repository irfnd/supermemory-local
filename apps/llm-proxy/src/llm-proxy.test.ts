import { afterAll, beforeAll, expect, test } from 'bun:test';
import { LOGGER } from '@supermemory-local/shared/logger';
import { createContainer } from '@/container.ts';
import { LlmProxy } from '@/llm-proxy.ts';
import { fixEmbeddingResponse, rewriteBody } from '@/rewrite.ts';

test('rewriteBody sets stream:false on chat and dimensions on embeddings, only when unset', () => {
	expect(JSON.parse(rewriteBody('{"model":"m"}', '/chat/completions')).stream).toBe(false);
	expect(JSON.parse(rewriteBody('{"stream":true}', '/chat/completions')).stream).toBe(true);
	expect(rewriteBody('not json', '/chat/completions')).toBe('not json');
	expect(rewriteBody('', '/chat/completions')).toBe('');
	expect(JSON.parse(rewriteBody('{"input":"x"}', '/embeddings', 1024))).toEqual({ input: 'x', dimensions: 1024 });
	expect(JSON.parse(rewriteBody('{"input":"x","dimensions":768}', '/embeddings', 1024)).dimensions).toBe(768);
});

test('fixEmbeddingResponse adds usage.prompt_tokens when a provider only sends total_tokens', () => {
	expect(JSON.parse(fixEmbeddingResponse('{"data":[],"usage":{"total_tokens":6}}')).usage).toEqual({
		total_tokens: 6,
		prompt_tokens: 6,
	});
	expect(JSON.parse(fixEmbeddingResponse('{"usage":{"prompt_tokens":2,"total_tokens":6}}')).usage.prompt_tokens).toBe(2);
	expect(fixEmbeddingResponse('{"data":[]}')).toBe('{"data":[]}');
	expect(fixEmbeddingResponse('not json')).toBe('not json');
});

const received: { path: string; body: unknown }[] = [];
const upstream = Bun.serve({
	port: 0,
	async fetch(req) {
		const { pathname } = new URL(req.url);
		received.push({ path: pathname, body: await req.json() });
		return pathname.endsWith('/embeddings')
			? Response.json({ data: [{ embedding: [0.1] }], usage: { total_tokens: 3 } })
			: Response.json({ choices: [{ message: { content: 'ok' } }] });
	},
});
afterAll(() => upstream.stop(true));

const proxyFor = (url: string, dimensions = '4') => {
	const container = createContainer({ OPENAI_BASE_URL: `${url}/v1/`, SUPERMEMORY_EMBEDDING_DIMENSIONS: dimensions });
	container.register(LOGGER, { useValue: { info() {} } });
	return container.resolve(LlmProxy);
};
const post = (path: string, body: object) =>
	new Request(`http://proxy${path}`, {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { 'content-type': 'application/json' },
	});

test('proxy forwards chat with stream:false and fills embedding dimensions and usage', async () => {
	const proxy = proxyFor(`http://127.0.0.1:${upstream.port}`);
	expect((await proxy.handle(post('/chat/completions', { model: 'm' }))).status).toBe(200);
	const embeddings = (await (await proxy.handle(post('/embeddings', { input: 'x' }))).json()) as any;

	expect(received[0]).toEqual({ path: '/v1/chat/completions', body: { model: 'm', stream: false } });
	expect(received[1]).toEqual({ path: '/v1/embeddings', body: { input: 'x', dimensions: 4 } });
	expect(embeddings.usage).toEqual({ total_tokens: 3, prompt_tokens: 3 });
});

test('proxy answers 502 when the upstream is unreachable', async () => {
	const res = await proxyFor('http://127.0.0.1:1').handle(post('/chat/completions', { model: 'm' }));
	expect(res.status).toBe(502);
});

test('/health is answered locally, without touching the upstream', async () => {
	const before = received.length;
	const res = await proxyFor('http://127.0.0.1:1').handle(new Request('http://proxy/health'));
	expect(res.status).toBe(200);
	expect(received.length).toBe(before);
});
