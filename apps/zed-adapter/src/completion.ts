export const REGION_START = '<|editable_region_start|>';
export const REGION_END = '<|editable_region_end|>';

export const SYSTEM_PROMPT =
	'You are a raw text-completion engine, not a chat assistant. ' +
	'The user message is a prompt that must be continued. Follow any instructions inside it. ' +
	'Output ONLY the continuation text. No explanations, no greetings, no markdown code fences around the whole answer. ' +
	`If the prompt contains ${REGION_START} and ${REGION_END}, output the rewritten editable region ` +
	'wrapped in exactly those two markers and nothing outside them.';

export interface CompletionRequest {
	model?: string;
	prompt?: string | string[];
	temperature?: number;
	stop?: string | string[];
	stream?: boolean;
}

export interface ChatCompletion {
	id?: string;
	created?: number;
	model?: string;
	choices?: { message?: { content?: string }; finish_reason?: string }[];
	usage?: unknown;
	error?: unknown;
}

export function cleanText(text?: string, stop: string | string[] = [], prompt = ''): string {
	let result = text ?? '';
	const fenced = result.match(/^\s*```[^\n]*\n([\s\S]*?)\n?```\s*$/);
	if (fenced) result = fenced[1] ?? '';
	for (const sequence of [stop].flat().filter(Boolean)) {
		const index = result.indexOf(sequence);
		if (index !== -1) result = result.slice(0, index);
	}
	if (prompt.includes(REGION_START) && !result.includes(REGION_START)) {
		result = `${REGION_START}\n${result.replace(REGION_END, '').trim()}\n${REGION_END}`;
	}
	return result;
}

export function toTextCompletion(data: ChatCompletion, request: CompletionRequest, prompt: string) {
	const choice = data.choices?.[0];
	return {
		id: data.id?.replace('chatcmpl', 'cmpl') ?? `cmpl-${Date.now()}`,
		object: 'text_completion',
		created: data.created ?? Math.floor(Date.now() / 1000),
		model: data.model ?? request.model,
		choices: [
			{
				index: 0,
				text: cleanText(choice?.message?.content, request.stop, prompt),
				logprobs: null,
				finish_reason: choice?.finish_reason ?? 'stop',
			},
		],
		usage: data.usage,
	};
}
