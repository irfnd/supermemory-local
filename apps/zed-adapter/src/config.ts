import { token } from '@supermemory-local/shared/di';
import { requireEnv, trimTrailingSlash, type Env } from '@supermemory-local/shared/env';

export interface ZedAdapterConfig {
	upstream: string;
	apiKey?: string;
	token?: string;
	bindHost: string;
	port: number;
	reasoningEffort?: string;
}

export const ZED_ADAPTER_CONFIG = token<ZedAdapterConfig>('ZedAdapterConfig');

export function loadZedAdapterConfig(env: Env = process.env): ZedAdapterConfig {
	return {
		upstream: trimTrailingSlash(requireEnv(env, 'OPENAI_BASE_URL')),
		apiKey: env.OPENAI_API_KEY || undefined,
		token: env.ZED_ADAPTER_TOKEN || undefined,
		bindHost: env.BIND_HOST || '127.0.0.1',
		port: Number(env.ZED_ADAPTER_PORT) || 20130,
		reasoningEffort: env.ZED_ADAPTER_REASONING_EFFORT || undefined,
	};
}
