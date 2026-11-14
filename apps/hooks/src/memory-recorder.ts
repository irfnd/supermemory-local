import { LOGGER, type Logger } from '@supermemory-local/shared/logger';
import { SupermemoryClient } from '@supermemory-local/client/client';
import { MAX_COMPACT, MAX_SUMMARY, MIN_SUMMARY_CHARS, STOP_TRANSLATE_TIMEOUT_MS, type MemoryType } from '@/constants.ts';
import type { HookContext } from '@/hook-context.ts';
import { SessionStore } from '@/session-store.ts';
import { stripContext, trimCompactSummary } from '@/text.ts';
import { lastAgyReply, lastTranscriptText } from '@/transcript.ts';
import { Translator } from '@/translator.ts';

export class MemoryRecorder {
	constructor(
		private readonly client: SupermemoryClient,
		private readonly store: SessionStore,
		private readonly translator: Translator,
		private readonly logger: Logger,
	) {}

	async recordChange(ctx: HookContext) {
		const change = ctx.agent.describeChange(ctx.payload, ctx.project);
		if (change) await this.save(ctx, 'change_observation', change);
	}

	async recordStop(ctx: HookContext) {
		const { payload, agent, project, sessionId } = ctx;
		const summary = stripContext(
			payload.summary ||
				payload.last_assistant_message ||
				payload.assistant_response ||
				(typeof payload.message === 'string' ? payload.message : '') ||
				(payload.transcriptPath ? lastAgyReply(payload.transcriptPath) : '') ||
				(payload.transcript_path ? lastTranscriptText(payload.transcript_path, (entry) => entry.type === 'assistant') : '') ||
				payload.raw ||
				'',
		);
		if (summary.length < MIN_SUMMARY_CHARS || !this.store.firstTime(sessionId, 'stop', summary)) return;
		const english = await this.translator.toEnglish(summary, STOP_TRANSLATE_TIMEOUT_MS);
		await this.save(ctx, 'session_summary', `[Agent: ${agent.label}] Session Summary for ${project.projectName}:\n${english}`);
	}

	async recordCompact(ctx: HookContext) {
		const { payload, agent, project, sessionId } = ctx;
		const summary = stripContext(
			payload.summary ||
				(payload.transcript_path
					? trimCompactSummary(lastTranscriptText(payload.transcript_path, (entry) => entry.isCompactSummary))
					: ''),
		);
		if (summary.length < MIN_SUMMARY_CHARS || !this.store.firstTime(sessionId, 'compact', summary)) return;
		await this.save(
			ctx,
			'session_summary',
			`[Agent: ${agent.label}] Compaction Summary for ${project.projectName}:\n${summary}`,
			MAX_COMPACT,
		);
	}

	private async save({ agent, sessionId, project }: HookContext, type: MemoryType, content: string, max = MAX_SUMMARY) {
		this.logger.info(`Saving ${type} (${agent.label}): ${content.slice(0, 80)}...`);
		const result = await this.client.addDocument({
			content: stripContext(content).slice(0, max),
			// ponytail: one tag only, the server puts extracted memories in the LAST tag; the agent goes in metadata
			containerTags: [project.containerTag],
			metadata: { type, agent: agent.label, session: sessionId, project: project.projectName, rootDir: project.rootDir },
		});
		if (!result.success) this.logger.info(`Save failed: ${result.error}`);
	}
}
