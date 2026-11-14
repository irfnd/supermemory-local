import { afterAll, expect, test } from 'bun:test';
import { cleanText, REGION_END, REGION_START } from '@/completion.ts';
import { LOGGER } from '@supermemory-local/shared/logger';
import { createContainer } from '@/container.ts';
import { ZedAdapter } from '@/zed-adapter.ts';

test('cleanText unwraps fences, applies stop and restores zeta markers', () => {
	expect(cleanText('```python\nfoo()\n```')).toBe('foo()');
	expect(cleanText('abc<|endoftext|>junk', ['<|endoftext|>'])).toBe('abc');
	expect(cleanText(undefined)).toBe('');
	expect(cleanText('x = 1', [], `a ${REGION_START} b`)).toBe(`${REGION_START}\nx = 1\n${REGION_END}`);
	expect(cleanText(`${REGION_START}\nx\n${REGION_END}`, [], REGION_START)).toBe(`${REGION_START}\nx\n${REGION_END}`);
});

let sent: { auth: string | null; body: any } | undefined;
const upstream = Bun.serve({
	port: 0,
	async fetch(req) {
		sent = { auth: req.headers.get('authorization'), body: await req.json() };
		return Response.json({ id: 'chatcmpl-1', choices: [{ message: { content: '```\na + b\n```' } }] });
	},
});
afterAll(() => upstream.stop(true));

const adapter = (extra: Record<string, string> = {}) => {
	const container = createContainer({
		OPENAI_BASE_URL: `http://127.0.0.1:${upstream.port}/v1`,
		OPENAI_API_KEY: 'sk-test',
		ZED_ADAPTER_REASONING_EFFORT: 'none',
		...extra,
	});
	container.register(LOGGER, { useValue: { info() {} } });
	return container.resolve(ZedAdapter);
};
const complete = (body: object) =>
	new Request('http://adapter/v1/completions', {
		method: 'POST',
		body: JSON.stringify(body),
		headers: { authorization: 'Bearer from-zed' },
	});

test('adapter turns /v1/completions into a chat call and returns a cleaned text completion', async () => {
	const res = await adapter().handle(complete({ model: 'm', prompt: ['def add(a, b):\n', '    return'] }));
	const json = (await res.json()) as any;

	expect(json.object).toBe('text_completion');
	expect(json.id).toBe('cmpl-1');
	expect(json.choices[0].text).toBe('a + b');
	expect(sent?.auth).toBe('Bearer sk-test');
	expect(sent?.body).toMatchObject({ model: 'm', stream: false, reasoning_effort: 'none' });
	expect(sent?.body.messages[1]).toEqual({ role: 'user', content: 'def add(a, b):\n    return' });
});

test('adapter falls back to the client key and rejects other routes', async () => {
	const keyless = adapter({ OPENAI_API_KEY: '' });
	await keyless.handle(complete({ model: 'm', prompt: 'x' }));
	expect(sent?.auth).toBe('Bearer from-zed');
	expect((await keyless.handle(new Request('http://adapter/v1/models'))).status).toBe(404);
});

test('adapter requires the bearer token when ZED_ADAPTER_TOKEN is set', async () => {
	const guarded = adapter({ ZED_ADAPTER_TOKEN: 'secret' });
	expect((await guarded.handle(complete({ model: 'm', prompt: 'x' }))).status).toBe(401);
	const ok = new Request('http://adapter/v1/completions', {
		method: 'POST',
		body: JSON.stringify({ model: 'm', prompt: 'x' }),
		headers: { authorization: 'Bearer secret' },
	});
	expect((await guarded.handle(ok)).status).toBe(200);
});
