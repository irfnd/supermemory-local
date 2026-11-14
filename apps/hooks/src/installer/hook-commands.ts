import { INSTALLER_PATHS, type InstallerPaths } from '@/installer/config.ts';

export const HOOK_MARKER = /supermemory-hook\.(js|ts)/;

export interface CommandEntry {
	type: 'command';
	command: string;
	timeout: number;
}

export class HookCommands {
	constructor(private readonly paths: InstallerPaths) {}

	shell(agent: string, action: string): string {
		return `"${this.paths.bun}" --env-file="${this.paths.envFile}" "${this.paths.hookBin}" ${agent} ${action}`;
	}

	entry(agent: string, action: string, timeout = 15): CommandEntry {
		return { type: 'command', command: this.shell(agent, action), timeout };
	}

	argv(): string[] {
		return [this.paths.bun, `--env-file=${this.paths.envFile}`, this.paths.hookBin];
	}
}
