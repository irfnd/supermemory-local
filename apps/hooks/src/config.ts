import os from 'node:os';
import path from 'node:path';
import { token } from '@supermemory-local/shared/di';
import type { Env } from '@supermemory-local/shared/env';

export interface TranslateConfig {
	model: string;
	baseUrl: string;
	apiKey: string;
}

export interface HooksConfig {
	logFile: string;
	syncDir: string;
	translate?: TranslateConfig;
	impersonate?: string;
}

export const HOOKS_CONFIG = token<HooksConfig>('HooksConfig');

export function loadHooksConfig(env: Env = process.env): HooksConfig {
	const model = env.TRANSLATE_MODEL?.trim();
	const baseUrl = env.OPENAI_BASE_URL?.replace(/\/$/, '');
	return {
		logFile: path.join(env.HOME || '/tmp', '.supermemory-hook.log'),
		syncDir: path.join(os.tmpdir(), 'supermemory-sync'),
		translate: model && baseUrl ? { model, baseUrl, apiKey: env.OPENAI_API_KEY ?? '' } : undefined,
		impersonate: env.CURL_IMPERSONATE?.trim() || undefined,
	};
}
