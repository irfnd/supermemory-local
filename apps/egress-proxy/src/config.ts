import { requireEnv, trimTrailingSlash, type Env } from '@supermemory-local/shared/env';

export interface EgressConfig {
	impersonate: string;
	bindHost: string;
	router: { port: number; upstream: string };
	zed: { port: number; upstream: string };
}

// Ports mirror the SSH tunnel forwards, so Zed and OpenCode configs keep working unchanged.
export function loadEgressConfig(env: Env = process.env): EgressConfig {
	return {
		impersonate: requireEnv(env, 'CURL_IMPERSONATE'),
		bindHost: env.EGRESS_BIND_HOST || '127.0.0.1',
		router: {
			port: Number(env.EGRESS_ROUTER_PORT) || 20128,
			upstream: trimTrailingSlash(requireEnv(env, 'OPENAI_BASE_URL')),
		},
		zed: {
			port: Number(env.EGRESS_ZED_PORT) || 20130,
			upstream: trimTrailingSlash(env.EGRESS_ZED_URL || 'https://zed-adapter.irfnd.id'),
		},
	};
}
