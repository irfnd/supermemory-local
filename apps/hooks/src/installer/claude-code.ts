import fs from 'node:fs';
import { LOGGER, type Logger } from '@supermemory-local/shared/logger';
import type { AgentInstaller } from '@/installer/agent-installer.ts';
import { INSTALLER_PATHS, type InstallerPaths } from '@/installer/config.ts';
import { ConfigFiles } from '@/installer/config-files.ts';
import { HookCommands } from '@/installer/hook-commands.ts';

export class ClaudeCodeInstaller implements AgentInstaller {
	readonly id = 'claude-code';

	constructor(
		private readonly paths: InstallerPaths,
		private readonly files: ConfigFiles,
		private readonly commands: HookCommands,
		private readonly logger: Logger,
	) {}

	install() {
		const file = this.paths.claudeSettings;
		this.logger.info(`\n→ Configuring Claude Code hooks (${file})...`);
		const settings = this.files.read(file);
		const hooks = (settings.hooks ??= {});
		const add = (event: string, matcher: string, action: string) => {
			hooks[event] = [...this.files.withoutOurs(hooks[event]), { matcher, hooks: [this.commands.entry(this.id, action)] }];
		};
		add('SessionStart', 'startup|resume|clear|compact', 'start');
		add('UserPromptSubmit', '', 'sync');
		add('PostToolUse', 'Write|Edit|MultiEdit|NotebookEdit|Bash', 'change');
		add('Stop', '', 'stop');
		add('PostCompact', '', 'compact');
		this.files.write(file, settings);
		this.logger.info('✓ Claude Code hooks installed successfully.');
	}

	uninstall() {
		const file = this.paths.claudeSettings;
		this.logger.info(`\n→ Removing Claude Code hooks (${file})...`);
		if (!fs.existsSync(file)) return;
		const settings = this.files.read(file);
		for (const event of Object.keys(settings.hooks ?? {})) {
			settings.hooks[event] = this.files.withoutOurs(settings.hooks[event]);
		}
		this.files.write(file, settings);
		this.logger.info('✓ Claude Code hooks uninstalled.');
	}
}
