import { get } from '@supermemory-local/shared/di';
import { listen } from '@supermemory-local/shared/serve';
import { ZED_ADAPTER_CONFIG } from '@/config.ts';
import { createContainer } from '@/container.ts';
import { ZedAdapter } from '@/zed-adapter.ts';

const container = createContainer();
const config = get(container, ZED_ADAPTER_CONFIG);
listen(container.resolve(ZedAdapter), config);
console.log(`zed-adapter listening on ${config.bindHost}:${config.port}/v1/completions -> ${config.upstream}/chat/completions`);
