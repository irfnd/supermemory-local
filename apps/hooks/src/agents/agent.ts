import { token } from '@supermemory-local/shared/di';
import type { Project } from '@supermemory-local/client/project-resolver';
import type { Payload } from '@/payload.ts';

export interface AgentAdapter {
	readonly id: string;
	readonly label: string;
	readonly cachesStart: boolean;
	describeChange(payload: Payload, project: Project): string;
	render(context: string): string;
}

export const AGENT_ADAPTER = token<AgentAdapter>('AgentAdapter');

export const describeToolUse = (label: string, project: Project, tool: string, detail: string) =>
	`[Agent: ${label}] Tool "${tool}" executed in ${project.projectName}:\n${detail}`;
