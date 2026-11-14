import { expect, test } from 'bun:test';
import { newSince, pickHits } from '@/recall-format.ts';

test('newSince keeps only newer docs from other sessions', () => {
	const doc = (id: string, createdAt: string, session?: string) => ({ id, createdAt, metadata: { session } });
	const recent = [
		doc('a', '2026-01-03T00:00:00Z', 'other'),
		doc('b', '2026-01-02T00:00:00Z', 'me'),
		doc('c', '2026-01-01T00:00:00Z'),
	];
	expect(newSince(recent, '2026-01-01T00:00:00Z', 'me').map((d) => d.id)).toEqual(['a']);
	expect(newSince(recent, '', 'me').map((d) => d.id)).toEqual(['a', 'c']);
});

test('pickHits drops own-session and already-seen hits and keeps one chunk per document, two at most', () => {
	const memory = (id: string, session = 'other') => ({ id, memory: id, similarity: 0.8, metadata: { session } });
	const chunk = (id: string, doc: string) => ({ id, chunk: id, similarity: 0.7, metadata: {}, documents: [{ id: doc }] });
	const hits = [
		memory('m1'),
		memory('m2', 'me'),
		memory('m3'),
		chunk('c1', 'd1'),
		chunk('c2', 'd1'),
		chunk('c3', 'd2'),
		chunk('c4', 'd3'),
	];
	expect(pickHits(hits, 'me', new Set(['m3'])).map((h) => h.id)).toEqual(['m1', 'c1', 'c3']);
});
