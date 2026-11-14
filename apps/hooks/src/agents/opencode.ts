import type { Project } from '@supermemory-local/client/project-resolver';
import type { Payload } from '@/payload.ts';
import { isReadOnlyCommand } from '@/text.ts';
import type { AgentAdapter } from '@/agents/agent.ts';

const READONLY_TOOLS = new Set([
	'read',
	'glob',
	'grep',
	'list',
	'webfetch',
	'websearch',
	'codesearch',
	'todoread',
	'todowrite',
	'skill',
]);

export class OpenCodeAdapter implements AgentAdapter {
	readonly id = 'opencode';
	readonly label = 'OpenCode';
	readonly cachesStart = false;

	describeChange(payload: Payload, project: Project) {
		const tool = payload.tool || 'action';
		if (READONLY_TOOLS.has(tool) || (tool === 'bash' && isReadOnlyCommand(payload.args?.command ?? ''))) return '';
		const args = payload.args ? JSON.stringify(payload.args).slice(0, 300) : '';
		return `[Agent: ${this.label}] Action "${tool}" in ${project.projectName}:\n${args}`;
	}

	render(context: string) {
		return context;
	}
}
