import type { Project } from '@supermemory-local/client/project-resolver';
import type { Payload } from '@/payload.ts';
import { isReadOnlyCommand } from '@/text.ts';
import { describeToolUse, type AgentAdapter } from '@/agents/agent.ts';

export function describeClaudeChange(label: string, payload: Payload, project: Project): string {
	const tool = payload.tool_name || 'unknown_tool';
	const input = payload.tool_input ?? {};
	if (tool === 'Bash' && isReadOnlyCommand(input.command ?? '')) return '';
	const file = input.file_path || input.notebook_path;
	const detail = file
		? `File: ${file}`
		: input.command
			? `Command: ${input.command.slice(0, 300)}`
			: payload.raw || JSON.stringify(input).slice(0, 300);
	return describeToolUse(label, project, tool, detail);
}

export class ClaudeCodeAdapter implements AgentAdapter {
	readonly id = 'claude-code';
	readonly label = 'Claude Code';
	readonly cachesStart = false;

	describeChange(payload: Payload, project: Project) {
		return describeClaudeChange(this.label, payload, project);
	}

	render(context: string) {
		return context;
	}
}

export class GenericAdapter implements AgentAdapter {
	readonly label: string;
	readonly cachesStart = false;

	constructor(readonly id: string) {
		this.label = id || 'Unknown Agent';
	}

	describeChange(payload: Payload, project: Project) {
		return describeClaudeChange(this.label, payload, project);
	}

	render(context: string) {
		return context;
	}
}
