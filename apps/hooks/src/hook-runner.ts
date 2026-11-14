import { LOGGER, type Logger } from '@supermemory-local/shared/logger';
import { ProjectResolver } from '@supermemory-local/client/project-resolver';
import { AgentRegistry } from '@/agents/registry.ts';
import type { HookContext } from '@/hook-context.ts';
import { MemoryRecall } from '@/memory-recall.ts';
import { MemoryRecorder } from '@/memory-recorder.ts';
import { parsePayload, sessionIdOf, workingDirectory } from '@/payload.ts';

type Action = 'start' | 'sync' | 'change' | 'stop' | 'compact';

const ACTIONS: Record<string, Action> = {
	start: 'start',
	check: 'start',
	context: 'start',
	sync: 'sync',
	prompt: 'sync',
	change: 'change',
	observation: 'change',
	stop: 'stop',
	'session-end': 'stop',
	summarize: 'stop',
	compact: 'compact',
	compacted: 'compact',
};

export class HookRunner {
	constructor(
		private readonly agents: AgentRegistry,
		private readonly projects: ProjectResolver,
		private readonly recall: MemoryRecall,
		private readonly recorder: MemoryRecorder,
		private readonly logger: Logger,
	) {}

	async run(agentId: string, action: string, rawInput: string): Promise<string> {
		this.logger.info(`Invoked: agent=${agentId}, action=${action}`);
		const agent = this.agents.get(agentId);
		const payload = parsePayload(rawInput);
		const project = this.projects.resolve(workingDirectory(payload));
		this.logger.info(`Project: ${project.projectName} (${project.rootDir}), Agent: ${agent.label}`);
		const ctx: HookContext = { agent, sessionId: sessionIdOf(payload), project, payload };
		return agent.render(await this.dispatch(ACTIONS[action], ctx));
	}

	renderEmpty(agentId: string): string {
		return this.agents.get(agentId).render('');
	}

	private async dispatch(action: Action | undefined, ctx: HookContext): Promise<string> {
		switch (action) {
			case 'start':
				return ctx.agent.cachesStart ? this.recall.cachedStart(ctx) : this.recall.start(ctx);
			case 'sync':
				return this.recall.sync(ctx);
			case 'change':
				await this.recorder.recordChange(ctx);
				return '';
			case 'stop':
				await this.recorder.recordStop(ctx);
				return '';
			case 'compact':
				await this.recorder.recordCompact(ctx);
				return '';
			default:
				return '';
		}
	}
}
