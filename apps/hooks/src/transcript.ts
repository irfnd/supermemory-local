import fs from 'node:fs';

type Entry = Record<string, any>;
type ContentPart = { type: string; text?: string };

function lastLine<T>(file: string, pick: (entry: Entry) => T | undefined): T | undefined {
	try {
		const lines = fs.readFileSync(file, 'utf-8').trim().split('\n');
		for (let i = lines.length - 1; i >= 0; i--) {
			const found = pick(JSON.parse(lines[i]!));
			if (found !== undefined) return found;
		}
	} catch {}
	return undefined;
}

export function lastTranscriptText(file: string, matches: (entry: Entry) => boolean): string {
	return (
		lastLine(file, (entry) => {
			if (!matches(entry)) return undefined;
			const content: string | ContentPart[] | undefined = entry.message?.content;
			const text =
				typeof content === 'string'
					? content
					: (content ?? [])
							.filter((part) => part.type === 'text')
							.map((part) => part.text)
							.join('\n');
			return text.trim() ? text : undefined;
		}) ?? ''
	);
}

export function lastAgyReply(file: string): string {
	return (
		lastLine(file, (entry) =>
			entry.type === 'PLANNER_RESPONSE' && typeof entry.content === 'string' && entry.content.trim() ? entry.content : undefined,
		) ?? ''
	);
}
