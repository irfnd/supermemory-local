import { createContainer, get, provide, singleton } from '@supermemory-local/shared/di';
import { ConsoleLogger, LOGGER } from '@supermemory-local/shared/logger';
import { SupermemoryClient } from '@supermemory-local/client/client';
import { loadSupermemoryConfig, SUPERMEMORY_CONFIG } from '@supermemory-local/client/config';
import { ProjectResolver } from '@supermemory-local/client/project-resolver';
import { MemorySelfTest } from '@/self-test/self-test.ts';

const container = createContainer();
provide(container, SUPERMEMORY_CONFIG, loadSupermemoryConfig());
provide(container, LOGGER, new ConsoleLogger(false));
singleton(container, SupermemoryClient, (c) => new SupermemoryClient(get(c, SUPERMEMORY_CONFIG)));
singleton(container, ProjectResolver, () => new ProjectResolver());
singleton(
	container,
	MemorySelfTest,
	(c) => new MemorySelfTest(c.resolve(SupermemoryClient), c.resolve(ProjectResolver), get(c, LOGGER)),
);

process.exit((await container.resolve(MemorySelfTest).run()) ? 0 : 1);
