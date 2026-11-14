import type { Project } from '@supermemory-local/client/project-resolver';
import type { Payload } from '@/payload.ts';
import { isReadOnlyCommand } from '@/text.ts';
import { describeToolUse, type AgentAdapter } from '@/agents/agent.ts';

const NOISY_TOOLS = new Set(['search_web', 'schedule']);
const NOISY_PREFIXES = ['view_', 'read_'];

export class AntigravityAdapter implements AgentAdapter {
	readonly id = 'antigravity';
	readonly label = 'Antigravity';
	readonly cachesStart = true;

	describeChange(payload: Payload, project: Project) {
		const tool = payload.toolCall?.name || 'unknown_tool';
		const args = payload.toolCall?.args ?? {};
		if (NOISY_TOOLS.has(tool) || NOISY_PREFIXES.some((prefix) => tool.startsWith(prefix))) return '';

		const file = args.TargetFile || args.Path;
		let detail: string;
		if (file) {
			detail = `File: ${file}\nDescription: ${args.Description || args.Instruction || ''}`;
		} else if (args.CommandLine) {
			if (isReadOnlyCommand(args.CommandLine)) return '';
			detail = `Command: ${args.CommandLine}`;
		} else {
			detail = JSON.stringify(args).slice(0, 300);
		}
		return describeToolUse(this.label, project, tool, detail);
	}

	render(context: string) {
		return JSON.stringify(context ? { injectSteps: [{ ephemeralMessage: context }] } : {});
	}
}
