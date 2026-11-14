import { AGENT_ADAPTER, type AgentAdapter } from '@/agents/agent.ts';
import { GenericAdapter } from '@/agents/claude-code.ts';

export class AgentRegistry {
	constructor(private readonly adapters: AgentAdapter[]) {}

	get(id: string): AgentAdapter {
		const normalized = id.toLowerCase();
		return this.adapters.find((adapter) => adapter.id === normalized) ?? new GenericAdapter(id);
	}
}
