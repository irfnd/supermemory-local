import fs from 'node:fs';
import { describe, expect, test } from 'bun:test';
import { curlFetch } from '@supermemory-local/shared/curl';

const bin = process.env.CURL_IMPERSONATE_BIN || '/opt/homebrew/opt/curl-impersonate/bin/curl-impersonate';

describe.skipIf(!fs.existsSync(bin))('curlFetch', () => {
	test('forwards method, headers and body, and keeps non-2xx status', async () => {
		const server = Bun.serve({
			port: 0,
			async fetch(req) {
				const body = await req.text();
				if (new URL(req.url).pathname === '/missing') return new Response('nope', { status: 404 });
				return Response.json({ method: req.method, auth: req.headers.get('authorization'), body });
			},
		});
		const base = `http://127.0.0.1:${server.port}`;
		try {
			const res = await curlFetch(
				`${base}/x`,
				{ method: 'POST', headers: { Authorization: 'Bearer k' }, body: '{"a":1}' },
				'chrome152_macos',
			);
			expect(res.status).toBe(200);
			expect(await res.json()).toEqual({ method: 'POST', auth: 'Bearer k', body: '{"a":1}' });

			const missing = await curlFetch(`${base}/missing`, {}, 'chrome152_macos');
			expect(missing.status).toBe(404);
			expect(await missing.text()).toBe('nope');
		} finally {
			server.stop(true);
		}
	});
});
