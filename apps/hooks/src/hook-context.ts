import type { Project } from '@supermemory-local/client/project-resolver';
import type { AgentAdapter } from '@/agents/agent.ts';
import type { Payload } from '@/payload.ts';

export interface HookContext {
	agent: AgentAdapter;
	sessionId?: string;
	project: Project;
	payload: Payload;
}
