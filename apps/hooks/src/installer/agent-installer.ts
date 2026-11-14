import { token } from '@supermemory-local/shared/di';

export interface AgentInstaller {
	readonly id: string;
	install(): void;
	uninstall(): void;
}

export const AGENT_INSTALLER = token<AgentInstaller>('AgentInstaller');
