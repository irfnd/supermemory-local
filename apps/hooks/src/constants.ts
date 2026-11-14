export const CONTEXT_HEADER = '# Shared Project Memory:';
export const MAX_SUMMARY = 4000;
export const MAX_COMPACT = 40_000;
export const PROFILE_FACTS = 15;
export const MAX_CHUNKS = 2;
export const MAX_CHUNK_CHARS = 600;
export const START_CACHE_MS = 30_000;
export const MIN_PROMPT_WORDS = 3;
export const MIN_SUMMARY_CHARS = 11;
export const STOP_TRANSLATE_TIMEOUT_MS = 8000;

export const RECALL = [
	{ type: 'session_summary', title: 'Recent session summaries', count: 5, chars: 800 },
	{ type: 'change_observation', title: 'Recent changes', count: 10, chars: 300 },
] as const;

export type MemoryType = (typeof RECALL)[number]['type'];
