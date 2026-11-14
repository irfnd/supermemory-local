import type { DocumentSummary, SearchHit } from '@supermemory-local/client/types';
import { MAX_CHUNK_CHARS, MAX_CHUNKS } from '@/constants.ts';
import { indentContinuation, stripContext, truncate } from '@/text.ts';

export function newSince(recent: DocumentSummary[], marker: string, sessionId?: string): DocumentSummary[] {
	const since = Date.parse(marker) || 0;
	return recent.filter((doc) => Date.parse(doc.createdAt) > since && (!sessionId || doc.metadata?.session !== sessionId));
}

export function pickHits(hits: SearchHit[], sessionId?: string, seen = new Set<string>()): SearchHit[] {
	const documents = new Set<string>();
	return hits.filter((hit) => {
		if ((sessionId && hit.metadata?.session === sessionId) || seen.has(hit.id)) return false;
		if (!hit.chunk) return !!hit.memory;
		const documentId = hit.documents?.[0]?.id ?? hit.id;
		if (documents.size >= MAX_CHUNKS || documents.has(documentId)) return false;
		documents.add(documentId);
		return true;
	});
}

export function renderHits(hits: SearchHit[]): string[] {
	if (!hits.length) return [];
	const lines = hits.map((hit) => {
		const timestamp = hit.metadata?.timestamp;
		const date = timestamp ? `[${new Date(String(timestamp)).toLocaleString()}] ` : '';
		const text = truncate(stripContext(hit.memory ?? hit.chunk ?? ''), MAX_CHUNK_CHARS);
		return `- ${date}${indentContinuation(text)}`;
	});
	return ['## Relevant to this prompt (memories + document excerpts)', ...lines, ''];
}
