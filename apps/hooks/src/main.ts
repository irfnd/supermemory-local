import { get } from '@supermemory-local/shared/di';
import { LOGGER } from '@supermemory-local/shared/logger';
import { createContainer } from '@/container.ts';
import { HookRunner } from '@/hook-runner.ts';
import { readStdin } from '@/stdin.ts';

export async function main(argv: string[] = process.argv): Promise<void> {
	const agent = argv[2] || 'generic';
	const action = argv[3] || 'check';

	let output = '';
	try {
		const container = createContainer();
		const runner = container.resolve(HookRunner);
		try {
			output = await runner.run(agent, action, await readStdin());
		} catch (err) {
			get(container, LOGGER).info(`Hook error (${agent} ${action}): ${(err as Error).stack || err}`);
			output = runner.renderEmpty(agent);
		}
	} catch {}

	if (output) console.log(output);
	process.exit(0);
}
