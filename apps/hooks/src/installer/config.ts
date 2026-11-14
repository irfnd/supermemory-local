import os from 'node:os';
import path from 'node:path';
import { token } from '@supermemory-local/shared/di';

export interface InstallerPaths {
	bun: string;
	hookBin: string;
	envFile: string;
	pluginTemplate: string;
	claudeSettings: string;
	antigravityHooks: string;
	opencodeDir: string;
}

export const INSTALLER_PATHS = token<InstallerPaths>('InstallerPaths');

export function loadInstallerPaths(home = os.homedir()): InstallerPaths {
	const root = path.resolve(import.meta.dir, '../../../..');
	return {
		bun: process.execPath,
		hookBin: path.join(root, 'bin', 'supermemory-hook.ts'),
		envFile: path.join(root, '.env'),
		pluginTemplate: path.join(root, 'apps', 'hooks', 'src', 'opencode-plugin.ts'),
		claudeSettings: path.join(home, '.claude', 'settings.json'),
		antigravityHooks: path.join(home, '.gemini', 'config', 'hooks.json'),
		opencodeDir: path.join(home, '.config', 'opencode'),
	};
}
