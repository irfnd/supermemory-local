import fs from 'node:fs';
import { describe, expect, test } from 'bun:test';
import type { Logger } from '@supermemory-local/shared/logger';
import { EgressProxy } from '@/proxy.ts';

const bin = process.env.CURL_IMPERSONATE_BIN || '/opt/homebrew/opt/curl-impersonate/bin/curl-impersonate';
const logger = { info() {} } as unknown as Logger;

describe.skipIf(!fs.existsSync(bin))('EgressProxy', () => {
	test('forwards, streams and keeps errors', async () => {
		const up = Bun.serve({
			port: 0,
			async fetch(req) {
				const p = new URL(req.url).pathname;
				if (p === '/v1/sse') {
					return new Response('data: x\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
				}
				if (p === '/v1/no') return new Response('nope', { status: 404 });
				return Response.json({ p, auth: req.headers.get('authorization'), body: await req.text() });
			},
		});
		const proxy = new EgressProxy('t', `http://127.0.0.1:${up.port}/v1`, 'chrome152_macos', logger);
		try {
			const post = await proxy.handle(
				new Request('http://p/v1/chat', { method: 'POST', headers: { authorization: 'Bearer k' }, body: '{"m":1}' }),
			);
			expect(post.status).toBe(200);
			expect(await post.json()).toEqual({ p: '/v1/chat', auth: 'Bearer k', body: '{"m":1}' });

			const sse = await proxy.handle(new Request('http://p/v1/sse'));
			expect(sse.headers.get('content-type')).toContain('text/event-stream');
			expect(await sse.text()).toContain('[DONE]');

			expect((await proxy.handle(new Request('http://p/v1/no'))).status).toBe(404);
		} finally {
			up.stop(true);
		}
	});
});
