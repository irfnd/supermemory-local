import {
	createContainer as createRootContainer,
	get,
	getAll,
	provide,
	singleton,
	type DependencyContainer,
} from '@supermemory-local/shared/di';
import type { Env } from '@supermemory-local/shared/env';
import { FileLogger, LOGGER } from '@supermemory-local/shared/logger';
import { SupermemoryClient } from '@supermemory-local/client/client';
import { loadSupermemoryConfig, SUPERMEMORY_CONFIG } from '@supermemory-local/client/config';
import { ProjectResolver } from '@supermemory-local/client/project-resolver';
import { AGENT_ADAPTER } from '@/agents/agent.ts';
import { AntigravityAdapter } from '@/agents/antigravity.ts';
import { ClaudeCodeAdapter } from '@/agents/claude-code.ts';
import { OpenCodeAdapter } from '@/agents/opencode.ts';
import { AgentRegistry } from '@/agents/registry.ts';
import { HOOKS_CONFIG, loadHooksConfig } from '@/config.ts';
import { HookRunner } from '@/hook-runner.ts';
import { MemoryRecall } from '@/memory-recall.ts';
import { MemoryRecorder } from '@/memory-recorder.ts';
import { SessionStore } from '@/session-store.ts';
import { Translator } from '@/translator.ts';

export function createContainer(env: Env = process.env): DependencyContainer {
	const container = createRootContainer();
	const config = loadHooksConfig(env);
	provide(container, HOOKS_CONFIG, config);
	provide(container, SUPERMEMORY_CONFIG, loadSupermemoryConfig(env));
	provide(container, LOGGER, new FileLogger(config.logFile));

	for (const adapter of [new ClaudeCodeAdapter(), new AntigravityAdapter(), new OpenCodeAdapter()]) {
		provide(container, AGENT_ADAPTER, adapter);
	}

	singleton(container, AgentRegistry, (c) => new AgentRegistry(getAll(c, AGENT_ADAPTER)));
	singleton(container, ProjectResolver, () => new ProjectResolver());
	singleton(container, SupermemoryClient, (c) => new SupermemoryClient(get(c, SUPERMEMORY_CONFIG)));
	singleton(container, SessionStore, (c) => new SessionStore(get(c, HOOKS_CONFIG), get(c, LOGGER)));
	singleton(container, Translator, (c) => new Translator(get(c, HOOKS_CONFIG), get(c, LOGGER)));
	singleton(
		container,
		MemoryRecall,
		(c) => new MemoryRecall(c.resolve(SupermemoryClient), c.resolve(SessionStore), c.resolve(Translator), get(c, LOGGER)),
	);
	singleton(
		container,
		MemoryRecorder,
		(c) => new MemoryRecorder(c.resolve(SupermemoryClient), c.resolve(SessionStore), c.resolve(Translator), get(c, LOGGER)),
	);
	singleton(
		container,
		HookRunner,
		(c) =>
			new HookRunner(
				c.resolve(AgentRegistry),
				c.resolve(ProjectResolver),
				c.resolve(MemoryRecall),
				c.resolve(MemoryRecorder),
				get(c, LOGGER),
			),
	);
	return container;
}
