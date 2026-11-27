import { ConsoleLogger } from '@supermemory-local/shared/logger';
import { listen } from '@supermemory-local/shared/serve';
import { loadEgressConfig } from '@/config.ts';
import { EgressProxy } from '@/proxy.ts';

const config = loadEgressConfig();
const logger = new ConsoleLogger();

listen(new EgressProxy('router', config.router.upstream, config.impersonate, logger), {
	bindHost: config.bindHost,
	port: config.router.port,
});
listen(new EgressProxy('zed', config.zed.upstream, config.impersonate, logger), {
	bindHost: config.bindHost,
	port: config.zed.port,
});

console.log(
	`egress-proxy listening on ${config.bindHost}:${config.router.port} -> ${config.router.upstream}, ` +
		`${config.bindHost}:${config.zed.port} -> ${config.zed.upstream} (${config.impersonate})`,
);
