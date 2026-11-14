import { token } from '@supermemory-local/shared/di';
import { requireEnv, trimTrailingSlash, type Env } from '@supermemory-local/shared/env';

export interface LlmProxyConfig {
	upstream: string;
	bindHost: string;
	port: number;
	dimensions?: number;
}

export const LLM_PROXY_CONFIG = token<LlmProxyConfig>('LlmProxyConfig');

export function loadLlmProxyConfig(env: Env = process.env): LlmProxyConfig {
	return {
		upstream: trimTrailingSlash(requireEnv(env, 'OPENAI_BASE_URL')),
		bindHost: env.BIND_HOST || '127.0.0.1',
		port: Number(env.LLM_PROXY_PORT) || 20129,
		dimensions: Number(env.SUPERMEMORY_EMBEDDING_DIMENSIONS) || undefined,
	};
}
