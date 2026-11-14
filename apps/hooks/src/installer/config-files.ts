import fs from 'node:fs';
import path from 'node:path';
import { LOGGER, type Logger } from '@supermemory-local/shared/logger';
import { HOOK_MARKER } from '@/installer/hook-commands.ts';

export type Json = Record<string, any>;

export class ConfigFiles {
	constructor(private readonly logger: Logger) {}

	read(file: string): Json {
		if (!fs.existsSync(file)) return {};
		const backup = `${file}.bak-${new Date().toISOString().replace(/[:.]/g, '-')}`;
		fs.copyFileSync(file, backup);
		this.logger.info(`   [backup] Created backup: ${backup}`);
		return JSON.parse(fs.readFileSync(file, 'utf-8'));
	}

	write(file: string, data: Json) {
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf-8');
	}

	withoutOurs(groups: unknown): Json[] {
		return Array.isArray(groups) ? groups.filter((group) => !HOOK_MARKER.test(JSON.stringify(group))) : [];
	}
}
