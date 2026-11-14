const isPlainObject = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

export function rewriteBody(body: string, path: string, dimensions?: number): string {
	try {
		const json: unknown = JSON.parse(body);
		if (!isPlainObject(json)) return body;
		if (path.endsWith('/embeddings')) {
			return json.dimensions === undefined && dimensions ? JSON.stringify({ ...json, dimensions }) : body;
		}
		return json.stream === undefined ? JSON.stringify({ ...json, stream: false }) : body;
	} catch {
		return body;
	}
}

export function fixEmbeddingResponse(body: string): string {
	try {
		const json: unknown = JSON.parse(body);
		const usage = isPlainObject(json) ? json.usage : undefined;
		if (isPlainObject(json) && isPlainObject(usage) && usage.prompt_tokens === undefined) {
			return JSON.stringify({ ...json, usage: { ...usage, prompt_tokens: usage.total_tokens ?? 0 } });
		}
	} catch {}
	return body;
}
