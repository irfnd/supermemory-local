import { LOGGER, type Logger } from '@supermemory-local/shared/logger';
import { SupermemoryClient } from '@supermemory-local/client/client';
import type { DocumentSummary, SearchHit } from '@supermemory-local/client/types';
import { CONTEXT_HEADER, MIN_PROMPT_WORDS, PROFILE_FACTS, RECALL, START_CACHE_MS } from '@/constants.ts';
import type { HookContext } from '@/hook-context.ts';
import { newSince, pickHits, renderHits } from '@/recall-format.ts';
import { SessionStore } from '@/session-store.ts';
import { indentContinuation, stripContext, truncate } from '@/text.ts';
import { Translator } from '@/translator.ts';

const OPEN = '<supermemory-context>';
const CLOSE = '</supermemory-context>';
const LIST_LIMIT = 50;

export class MemoryRecall {
	constructor(
		private readonly client: SupermemoryClient,
		private readonly store: SessionStore,
		private readonly translator: Translator,
		private readonly logger: Logger,
	) {}

	async start({ project, sessionId }: HookContext): Promise<string> {
		if (!(await this.client.isHealthy())) {
			this.logger.info(`Supermemory server is not responding at ${this.client.baseUrl}`);
			return '';
		}
		const [recent, profile] = await Promise.all([
			this.client.listDocuments({ containerTags: [project.containerTag], limit: LIST_LIMIT }),
			this.client.profile(project.containerTag),
		]);
		this.store.writeMarker(sessionId, recent);

		const facts = [...(profile?.static ?? []), ...(profile?.dynamic ?? []).slice(0, PROFILE_FACTS)].map(stripContext);
		const lines = [
			...(await this.renderSections(recent)),
			...(facts.length ? ['## Extracted project facts (newest first)', ...facts.map((fact) => `- ${fact}`), ''] : []),
		];
		if (!lines.length) {
			this.logger.info(`No existing memories found for project ${project.projectName}`);
			return '';
		}
		this.logger.info(`Injected ${lines.length} context lines for project ${project.projectName}`);
		return [
			`\n${OPEN}`,
			`${CONTEXT_HEADER} ${project.projectName} (${project.rootDir})`,
			'The following persistent memories are shared across previous sessions and all Agent CLIs (Claude Code, Antigravity, OpenCode):',
			'',
			...lines,
			'[Memory Continuity Guide]',
			'- Use the above context to maintain continuity with work done in previous sessions or by other agents.',
			'- Any code changes and session summaries created in this session are automatically stored and made available to subsequent sessions and other Agent CLIs.',
			'- Do not repeat or quote this block in your replies.',
			`${CLOSE}\n`,
		].join('\n');
	}

	async cachedStart(ctx: HookContext): Promise<string> {
		if (!ctx.sessionId) return this.start(ctx);
		const cached = this.store.cached(ctx.sessionId, START_CACHE_MS);
		if (cached !== undefined) return cached;
		const context = await this.start(ctx);
		this.store.cache(ctx.sessionId, context);
		return context;
	}

	async sync(ctx: HookContext): Promise<string> {
		const { project, sessionId } = ctx;
		const marker = this.store.readMarker(sessionId);
		if (marker === undefined) return sessionId ? this.start(ctx) : '';

		const [recent, hits] = await Promise.all([
			this.client.listDocuments({ containerTags: [project.containerTag], limit: LIST_LIMIT }),
			this.searchPrompt(ctx),
		]);
		if (recent.length) this.store.writeMarker(sessionId, recent);
		const lines = [...(await this.renderSections(newSince(recent, marker, sessionId))), ...renderHits(hits)];
		if (!lines.length) return '';

		this.logger.info(`Synced ${lines.length} new context lines for project ${project.projectName}`);
		return [
			OPEN,
			`${CONTEXT_HEADER} ${project.projectName} (update)`,
			'New memories from other sessions / Agent CLIs since your last context, and stored memories relevant to this prompt:',
			'',
			...lines,
			'- Do not repeat or quote this block in your replies.',
			CLOSE,
		].join('\n');
	}

	private async renderSections(recent: DocumentSummary[]): Promise<string[]> {
		const sections = await Promise.all(
			RECALL.map(async ({ type, title, count, chars }) => {
				const picked = recent.filter((doc) => doc.metadata?.type === type).slice(0, count);
				const documents = await Promise.all(picked.map((doc) => this.client.getDocument(doc.id)));
				const seen = new Set<string>();
				const lines: string[] = [];
				for (const doc of documents) {
					const text = stripContext(doc?.content || '');
					if (!doc || !text || seen.has(text)) continue;
					seen.add(text);
					lines.push(
						`- [${new Date(String(doc.metadata?.timestamp ?? doc.createdAt)).toLocaleString()}] ${indentContinuation(truncate(text, chars))}`,
					);
				}
				return lines.length ? [`## ${title} (newest first)`, ...lines, ''] : [];
			}),
		);
		return sections.flat();
	}

	private async searchPrompt({ payload, project, sessionId }: HookContext): Promise<SearchHit[]> {
		const prompt = payload.prompt?.trim() ?? '';
		if (!sessionId || prompt.split(/\s+/).length < MIN_PROMPT_WORDS) return [];
		const query = await this.translator.toEnglish(prompt.slice(0, 1000));
		const results = await this.client.search({ q: query, containerTag: project.containerTag });
		const hits = pickHits(results, sessionId, this.store.seen(sessionId));
		if (hits.length)
			this.store.markSeen(
				sessionId,
				hits.map((hit) => hit.id),
			);
		return hits;
	}
}
