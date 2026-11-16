import { expect, test } from 'bun:test';
import type { DocumentSummary } from '@supermemory-local/client/types';
import { selectForMigration } from '@/migrate/select.ts';

const doc = (id: string, day: number, type: string, tag = 'a'): DocumentSummary => ({
	id,
	createdAt: `2026-10-${String(day).padStart(2, '0')}T00:00:00.000Z`,
	metadata: { type },
	containerTags: [tag],
});

test('keeps every summary, only the newest observations per project, oldest first', () => {
	const docs = [
		doc('s1', 1, 'session_summary'),
		doc('o1', 2, 'change_observation'),
		doc('o2', 3, 'change_observation'),
		doc('o3', 4, 'change_observation'),
		doc('b1', 5, 'change_observation', 'b'),
		doc('s2', 6, 'session_summary', 'b'),
	];
	expect(selectForMigration(docs, { observationsPerProject: 2 }).map((d) => d.id)).toEqual(['s1', 'o2', 'o3', 'b1', 's2']);
	expect(selectForMigration(docs, { observationsPerProject: 0, tag: 'b' }).map((d) => d.id)).toEqual(['s2']);
});
