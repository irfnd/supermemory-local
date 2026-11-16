import type { DocumentSummary } from '@supermemory-local/client/types';

export interface SelectOptions {
	observationsPerProject: number;
	tag?: string;
}

export function selectForMigration(docs: DocumentSummary[], { observationsPerProject, tag }: SelectOptions): DocumentSummary[] {
	const scoped = tag ? docs.filter((doc) => doc.containerTags?.includes(tag)) : docs;
	const perProject = new Map<string, number>();
	const kept = [...scoped]
		.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
		.filter((doc) => {
			if (doc.metadata?.type !== 'change_observation') return true;
			const project = doc.containerTags?.[0] ?? '';
			const count = (perProject.get(project) ?? 0) + 1;
			perProject.set(project, count);
			return count <= observationsPerProject;
		});
	return kept.reverse();
}
