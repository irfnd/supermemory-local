import { CONTEXT_HEADER } from '@/constants.ts';

const OPEN_TAG = '<supermemory-context>';

const CONTEXT_BLOCK = new RegExp(`${OPEN_TAG}\\s*${CONTEXT_HEADER}(?:(?!${OPEN_TAG})[\\s\\S])*?</supermemory-context>`, 'g');
const UNCLOSED_BLOCK = new RegExp(`${OPEN_TAG}\\s*${CONTEXT_HEADER}[\\s\\S]*$`);

export function stripContext(text: string): string {
	let previous: string;
	do {
		previous = text;
		text = text.replace(CONTEXT_BLOCK, '');
	} while (text !== previous);
	return text.replace(UNCLOSED_BLOCK, '').trim();
}

const ENGLISH_STOPWORDS = new Set(
	'the a an is are was were be been to of and or in on at for with by from as that this it its not no do does did have has had will would can could should what why how which who when where i you we they he she'.split(
		' ',
	),
);

// ponytail: stopword ratio instead of a language detector; code-heavy text can read as non-English and cost one no-op translation call
export function isEnglish(text: string): boolean {
	const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
	if (words.length < 4) return !/[^\x00-\x7F]/.test(text);
	return words.filter((word) => ENGLISH_STOPWORDS.has(word)).length / words.length >= 0.12;
}

export function trimCompactSummary(text: string): string {
	return text
		.replace(/^This session is being continued[\s\S]*?\nSummary:\n/, '')
		.replace(/\n+If you need specific details from before compaction[\s\S]*$/, '')
		.trim();
}

export const truncate = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max)}…` : text);

export const indentContinuation = (text: string): string => text.replace(/\n/g, '\n  ');

const READONLY_COMMAND =
	/^\s*(cd\s+\S+\s*&&\s*)?(rtk\s+)?(ls|ll|pwd|cat|head|tail|less|wc|grep|rg|find|fd|which|echo|tree|git (status|log|diff|show|branch))\b/;

// ponytail: prefix heuristic, read-only shell commands flood memory with noise
export const isReadOnlyCommand = (command: string): boolean => READONLY_COMMAND.test(command);
