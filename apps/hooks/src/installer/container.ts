import {
	createContainer as createRootContainer,
	get,
	getAll,
	provide,
	singleton,
	type DependencyContainer,
} from '@supermemory-local/shared/di';
import { ConsoleLogger, LOGGER } from '@supermemory-local/shared/logger';
import { AGENT_INSTALLER } from '@/installer/agent-installer.ts';
import { AntigravityInstaller } from '@/installer/antigravity.ts';
import { ClaudeCodeInstaller } from '@/installer/claude-code.ts';
import { INSTALLER_PATHS, loadInstallerPaths, type InstallerPaths } from '@/installer/config.ts';
import { ConfigFiles } from '@/installer/config-files.ts';
import { HookCommands } from '@/installer/hook-commands.ts';
import { InstallerCli } from '@/installer/installer-cli.ts';
import { OpenCodeInstaller } from '@/installer/opencode.ts';

export function createContainer(paths: InstallerPaths = loadInstallerPaths()): DependencyContainer {
	const container = createRootContainer();
	provide(container, INSTALLER_PATHS, paths);
	provide(container, LOGGER, new ConsoleLogger(false));
	singleton(container, ConfigFiles, (c) => new ConfigFiles(get(c, LOGGER)));
	singleton(container, HookCommands, (c) => new HookCommands(get(c, INSTALLER_PATHS)));

	const deps = (c: DependencyContainer) =>
		[get(c, INSTALLER_PATHS), c.resolve(ConfigFiles), c.resolve(HookCommands), get(c, LOGGER)] as const;
	provide(container, AGENT_INSTALLER, new ClaudeCodeInstaller(...deps(container)));
	provide(container, AGENT_INSTALLER, new AntigravityInstaller(...deps(container)));
	provide(container, AGENT_INSTALLER, new OpenCodeInstaller(...deps(container)));
	singleton(
		container,
		InstallerCli,
		(c) => new InstallerCli(getAll(c, AGENT_INSTALLER), c.resolve(HookCommands), get(c, LOGGER)),
	);
	return container;
}
