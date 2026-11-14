import fs from 'node:fs';
import { LOGGER, type Logger } from '@supermemory-local/shared/logger';
import type { AgentInstaller } from '@/installer/agent-installer.ts';
import { INSTALLER_PATHS, type InstallerPaths } from '@/installer/config.ts';
import { ConfigFiles } from '@/installer/config-files.ts';
import { HookCommands } from '@/installer/hook-commands.ts';

const HOOK_NAME = 'supermemory-local';
const CHANGE_TOOLS = 'write_to_file|write_file|replace_file_content|multi_replace_file_content|edit_file|run_command';

export class AntigravityInstaller implements AgentInstaller {
	readonly id = 'antigravity';

	constructor(
		private readonly paths: InstallerPaths,
		private readonly files: ConfigFiles,
		private readonly commands: HookCommands,
		private readonly logger: Logger,
	) {}

	install() {
		const file = this.paths.antigravityHooks;
		this.logger.info(`\n→ Configuring Antigravity hooks (${file})...`);
		const data = this.files.read(file);
		// tight timeouts: these run inline in the agent loop (start = health 3s + one request round, stop = 8s translation + 5s save)
		data[HOOK_NAME] = {
			enabled: true,
			PreInvocation: [this.commands.entry(this.id, 'start', 8)],
			PostToolUse: [{ matcher: CHANGE_TOOLS, hooks: [this.commands.entry(this.id, 'change', 5)] }],
			Stop: [this.commands.entry(this.id, 'stop', 15)],
		};
		this.files.write(file, data);
		this.logger.info('✓ Antigravity hooks installed successfully.');
	}

	uninstall() {
		const file = this.paths.antigravityHooks;
		this.logger.info(`\n→ Removing Antigravity hooks (${file})...`);
		if (!fs.existsSync(file)) return;
		const data = this.files.read(file);
		delete data[HOOK_NAME];
		this.files.write(file, data);
		this.logger.info('✓ Antigravity hooks uninstalled.');
	}
}
