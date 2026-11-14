import {
	createContainer as createRootContainer,
	get,
	provide,
	singleton,
	type DependencyContainer,
} from '@supermemory-local/shared/di';
import type { Env } from '@supermemory-local/shared/env';
import { ConsoleLogger, LOGGER } from '@supermemory-local/shared/logger';
import { loadZedAdapterConfig, ZED_ADAPTER_CONFIG } from '@/config.ts';
import { ZedAdapter } from '@/zed-adapter.ts';

export function createContainer(env: Env = process.env): DependencyContainer {
	const container = createRootContainer();
	provide(container, ZED_ADAPTER_CONFIG, loadZedAdapterConfig(env));
	provide(container, LOGGER, new ConsoleLogger());
	singleton(container, ZedAdapter, (c) => new ZedAdapter(get(c, ZED_ADAPTER_CONFIG), get(c, LOGGER)));
	return container;
}
