import fs from 'node:fs';
import path from 'node:path';
import { LOGGER, type Logger } from '@supermemory-local/shared/logger';
import type { AgentInstaller } from '@/installer/agent-installer.ts';
import { INSTALLER_PATHS, type InstallerPaths } from '@/installer/config.ts';
import { ConfigFiles } from '@/installer/config-files.ts';
import { HookCommands } from '@/installer/hook-commands.ts';

const isOurs = (entry: unknown) => typeof entry === 'string' && entry.includes('supermemory-local.');

export class OpenCodeInstaller implements AgentInstaller {
	readonly id = 'opencode';

	constructor(
		private readonly paths: InstallerPaths,
		private readonly files: ConfigFiles,
		private readonly commands: HookCommands,
		private readonly logger: Logger,
	) {}

	install() {
		this.logger.info(`\n→ Configuring OpenCode plugin (${this.paths.opencodeDir})...`);
		this.removeStaleArtifacts();
		const code = fs
			.readFileSync(this.paths.pluginTemplate, 'utf-8')
			.replace(/const HOOK_CMD = [^;]*;/, `const HOOK_CMD = ${JSON.stringify(this.commands.argv())};`);
		fs.mkdirSync(path.dirname(this.plugin), { recursive: true });
		fs.writeFileSync(this.plugin, code, 'utf-8');
		this.logger.info(`   [plugin] Copied plugin to: ${this.plugin}`);
		this.logger.info('✓ OpenCode plugin installed.');
	}

	uninstall() {
		this.logger.info('\n→ Removing OpenCode plugin...');
		this.removeStaleArtifacts();
		if (fs.existsSync(this.plugin)) {
			fs.unlinkSync(this.plugin);
			this.logger.info(`   [plugin] Removed ${this.plugin}`);
		}
		this.logger.info('✓ OpenCode plugin uninstalled.');
	}

	private get plugin() {
		return path.join(this.paths.opencodeDir, 'plugins', 'supermemory-local.ts');
	}

	// the plugins dir is auto-discovered, so a second listing in opencode.json would load the plugin twice
	private removeStaleArtifacts() {
		const legacy = path.join(this.paths.opencodeDir, 'plugins', 'supermemory-local.js');
		if (fs.existsSync(legacy)) {
			fs.unlinkSync(legacy);
			this.logger.info(`   [plugin] Removed old ${legacy}`);
		}
		const configFile = path.join(this.paths.opencodeDir, 'opencode.json');
		if (!fs.existsSync(configFile)) return;
		const listed = JSON.parse(fs.readFileSync(configFile, 'utf-8')).plugin;
		if (Array.isArray(listed) && listed.some(isOurs)) {
			const config = this.files.read(configFile);
			config.plugin = listed.filter((entry) => !isOurs(entry));
			this.files.write(configFile, config);
			this.logger.info(`   [config] Removed plugin entry from ${configFile}`);
		}
	}
}
