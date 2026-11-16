import path from 'node:path';
import { parseArgs } from 'node:util';
import { createContainer, get, provide, singleton } from '@supermemory-local/shared/di';
import { ConsoleLogger, LOGGER } from '@supermemory-local/shared/logger';
import { SupermemoryClient } from '@supermemory-local/client/client';
import { loadSupermemoryConfig, SUPERMEMORY_CONFIG } from '@supermemory-local/client/config';
import { MemoryMigrator } from '@/migrate/migrator.ts';

const DEFAULT_FILE = path.resolve(import.meta.dir, '../../../../data/migration/export.json');

const {
	positionals: [command],
	values,
} = parseArgs({
	allowPositionals: true,
	options: {
		file: { type: 'string', default: DEFAULT_FILE },
		'obs-per-project': { type: 'string', default: '20' },
		tag: { type: 'string' },
		limit: { type: 'string' },
		'dry-run': { type: 'boolean', default: false },
		reconcile: { type: 'boolean', default: false },
		'resend-status': { type: 'string' },
		'max-inflight': { type: 'string', default: '50' },
	},
});

if (command !== 'export' && command !== 'import') {
	console.error(
		'usage: bun run migrate <export|import> [--file f] [--obs-per-project 20] [--tag t] [--limit n] [--dry-run] [--reconcile] [--resend-status failed,embedding,...] [--max-inflight 50]',
	);
	process.exit(2);
}

const container = createContainer();
provide(container, SUPERMEMORY_CONFIG, loadSupermemoryConfig());
provide(container, LOGGER, new ConsoleLogger(false));
singleton(container, SupermemoryClient, (c) => new SupermemoryClient(get(c, SUPERMEMORY_CONFIG)));
singleton(container, MemoryMigrator, (c) => new MemoryMigrator(c.resolve(SupermemoryClient), get(c, LOGGER)));

const migrator = container.resolve(MemoryMigrator);
if (command === 'export') {
	await migrator.export(values.file, { observationsPerProject: Number(values['obs-per-project']), tag: values.tag });
	process.exit(0);
}
const ok = await migrator.import(values.file, {
	dryRun: values['dry-run'],
	reconcile: values.reconcile || Boolean(values['resend-status']),
	resendStatuses: values['resend-status']?.split(',').filter(Boolean),
	maxInflight: Number(values['max-inflight']),
	limit: values.limit ? Number(values.limit) : undefined,
});
process.exit(ok ? 0 : 1);
