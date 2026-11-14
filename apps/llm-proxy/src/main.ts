import { get } from '@supermemory-local/shared/di';
import { listen } from '@supermemory-local/shared/serve';
import { LLM_PROXY_CONFIG } from '@/config.ts';
import { createContainer } from '@/container.ts';
import { LlmProxy } from '@/llm-proxy.ts';

const container = createContainer();
const config = get(container, LLM_PROXY_CONFIG);
listen(container.resolve(LlmProxy), config);
console.log(`llm-proxy listening on ${config.bindHost}:${config.port} -> ${config.upstream}`);
