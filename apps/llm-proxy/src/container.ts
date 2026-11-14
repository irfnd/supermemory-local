import {
	createContainer as createRootContainer,
	get,
	provide,
	singleton,
	type DependencyContainer,
} from '@supermemory-local/shared/di';
import type { Env } from '@supermemory-local/shared/env';
import { ConsoleLogger, LOGGER } from '@supermemory-local/shared/logger';
import { LLM_PROXY_CONFIG, loadLlmProxyConfig } from '@/config.ts';
import { LlmProxy } from '@/llm-proxy.ts';

export function createContainer(env: Env = process.env): DependencyContainer {
	const container = createRootContainer();
	provide(container, LLM_PROXY_CONFIG, loadLlmProxyConfig(env));
	provide(container, LOGGER, new ConsoleLogger());
	singleton(container, LlmProxy, (c) => new LlmProxy(get(c, LLM_PROXY_CONFIG), get(c, LOGGER)));
	return container;
}
