import { LOGGER, type Logger } from '@supermemory-local/shared/logger';
import { AGENT_INSTALLER, type AgentInstaller } from '@/installer/agent-installer.ts';
import { HookCommands } from '@/installer/hook-commands.ts';

export type InstallAction = 'install' | 'uninstall';

export class InstallerCli {
	constructor(
		private readonly installers: AgentInstaller[],
		private readonly commands: HookCommands,
		private readonly logger: Logger,
	) {}

	run(action: string, target: string): boolean {
		const ids = this.installers.map((installer) => installer.id);
		if (action !== 'install' && action !== 'uninstall') {
			this.logger.info(`Unknown action: ${action}. Use 'install' or 'uninstall'.`);
			return false;
		}
		if (target !== 'all' && !ids.includes(target)) {
			this.logger.info(`Unknown target: ${target}. Use all, ${ids.join(', ')}.`);
			return false;
		}

		this.logger.info(
			[
				'========================================================',
				` Supermemory Hooks Manager: ${action.toUpperCase()}`,
				` Target CLI(s): ${target}`,
				` Hook command:  ${this.commands.shell('<agent>', '<action>')}`,
				'========================================================',
			].join('\n'),
		);
		for (const installer of this.installers.filter((candidate) => target === 'all' || candidate.id === target)) {
			installer[action]();
		}
		this.logger.info(`\n✨ All requested hooks ${action === 'install' ? 'installed' : 'uninstalled'}.`);
		return true;
	}
}
