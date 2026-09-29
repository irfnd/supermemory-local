// Zed edit-prediction adapter: OpenAI legacy /v1/completions -> 9router /chat/completions.
// Zed's open_ai_compatible_api provider sends {prompt} to /v1/completions; 9router has no such route and
// ignores `prompt` on /chat/completions (empty `messages` -> Gemini 400 "contents is not specified").
// Usage: ZED_ADAPTER_PORT=20130 OPENAI_API_KEY=... bun src/zed-adapter.ts

const TARGET = process.env.OPENAI_BASE_URL!.replace(/\/$/, '');
const API_KEY = process.env.OPENAI_API_KEY;
const PORT = Number(process.env.ZED_ADAPTER_PORT);
const REASONING = process.env.ZED_ADAPTER_REASONING_EFFORT;

const START = '<|editable_region_start|>';
const END = '<|editable_region_end|>';

const SYSTEM =
	'You are a raw text-completion engine, not a chat assistant. ' +
	'The user message is a prompt that must be continued. Follow any instructions inside it. ' +
	'Output ONLY the continuation text. No explanations, no greetings, no markdown code fences around the whole answer. ' +
	`If the prompt contains ${START} and ${END}, output the rewritten editable region ` +
	'wrapped in exactly those two markers and nothing outside them.';

// Chat models wrap output in ``` fences, ignore stop sequences and sometimes drop the zeta markers; undo all three.
export function cleanText(text?: string, stop: string | string[] = [], prompt = ''): string {
	let t = text ?? '';
	const fenced = t.match(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/);
	if (fenced) t = fenced[1] ?? '';
	for (const s of [stop].flat().filter(Boolean)) {
		const i = t.indexOf(s);
		if (i !== -1) t = t.slice(0, i);
	}
	// zeta prompt_format: Zed only reads what sits between the markers
	if (prompt.includes(START) && !t.includes(START)) t = `${START}\n${t.replace(END, '').trim()}\n${END}`;
	return t;
}

async function complete(req: Request): Promise<Response> {
	const started = Date.now();
	const { pathname } = new URL(req.url);
	if (req.method !== 'POST' || pathname !== '/v1/completions') {
		return Response.json({ error: { message: 'zed-adapter: only POST /v1/completions' } }, { status: 404 });
	}
	try {
		const body: any = await req.json();
		const prompt = [body.prompt].flat().join('');
		const auth = API_KEY ? `Bearer ${API_KEY}` : req.headers.get('authorization') || '';
		const up = await fetch(`${TARGET}/chat/completions`, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json', Authorization: auth },
			body: JSON.stringify({
				model: body.model,
				messages: [
					{ role: 'system', content: SYSTEM },
					{ role: 'user', content: prompt },
				],
				temperature: body.temperature,
				reasoning_effort: REASONING,
				// ponytail: max_tokens not forwarded, thinking models burn it on reasoning and return empty.
				// `stop` is applied locally in cleanText (Gemini caps stop sequences at 5).
				stream: false,
			}),
		});
		const data: any = await up.json().catch(() => ({ error: { message: `upstream ${up.status} non-JSON` } }));
		console.log(`${new Date().toISOString()} ${body.model} ${up.status} ${Date.now() - started}ms prompt=${prompt.length}ch`);
		if (!up.ok || data.error) return Response.json(data, { status: up.ok ? 502 : up.status });

		const choice = data.choices?.[0] ?? {};
		const json = {
			id: data.id?.replace('chatcmpl', 'cmpl') ?? `cmpl-${Date.now()}`,
			object: 'text_completion',
			created: data.created ?? Math.floor(Date.now() / 1000),
			model: data.model ?? body.model,
			choices: [
				{
					index: 0,
					text: cleanText(choice.message?.content, body.stop, prompt),
					logprobs: null,
					finish_reason: choice.finish_reason ?? 'stop',
				},
			],
			usage: data.usage,
		};
		// ponytail: fake stream (one chunk), only in case the client asks for SSE
		if (body.stream) {
			return new Response(`data: ${JSON.stringify(json)}\n\ndata: [DONE]\n\n`, {
				headers: { 'Content-Type': 'text/event-stream' },
			});
		}
		return Response.json(json);
	} catch (err) {
		const message = (err as Error).message;
		console.log(`${new Date().toISOString()} ERROR ${message}`);
		return Response.json({ error: { message: `zed-adapter: ${message}` } }, { status: 502 });
	}
}

if (import.meta.main) {
	// idleTimeout 0: a slow 9router model can exceed Bun's 10s default
	Bun.serve({ hostname: '127.0.0.1', port: PORT, idleTimeout: 0, fetch: complete });
	console.log(`zed-adapter listening on 127.0.0.1:${PORT}/v1/completions -> ${TARGET}/chat/completions`);
}
