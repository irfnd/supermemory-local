import fs from 'node:fs';
import path from 'node:path';
import { token } from '@supermemory-local/shared/di';
import type { Env } from '@supermemory-local/shared/env';

export interface SupermemoryConfig {
	baseUrl: string;
	apiKey: string;
}

export const SUPERMEMORY_CONFIG = token<SupermemoryConfig>('SupermemoryConfig');

export const DEFAULT_KEY_FILE = path.resolve(import.meta.dir, '../../../data/supermemory/current/api-key');

export function loadSupermemoryConfig(env: Env = process.env, keyFile = DEFAULT_KEY_FILE): SupermemoryConfig {
	return {
		baseUrl: env.SUPERMEMORY_API_URL || 'http://127.0.0.1:6767',
		apiKey: env.SUPERMEMORY_API_KEY ?? readKeyFile(keyFile),
	};
}

function readKeyFile(file: string): string {
	try {
		return fs.readFileSync(file, 'utf-8').trim();
	} catch {
		return '';
	}
}
