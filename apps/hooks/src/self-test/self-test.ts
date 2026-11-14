import { LOGGER, type Logger } from '@supermemory-local/shared/logger';
import { SupermemoryClient } from '@supermemory-local/client/client';
import { ProjectResolver } from '@supermemory-local/client/project-resolver';

const INDEX_WAIT_MS = 2000;

export class MemorySelfTest {
	constructor(
		private readonly client: SupermemoryClient,
		private readonly projects: ProjectResolver,
		private readonly log: Logger,
	) {}

	async run(): Promise<boolean> {
		const banner = '========================================================';
		this.log.info(`${banner}\n Testing Supermemory Local: Cross-Session & Cross-Agent\n${banner}`);

		const healthy = await this.client.isHealthy();
		this.log.info(`Server health: ${healthy ? 'ONLINE ✓' : 'OFFLINE ✗'} (${this.client.baseUrl})`);
		if (!healthy) {
			this.log.info('Supermemory server is not running! Run "bun run start" first.');
			return false;
		}

		const project = this.projects.resolve();
		const testTag = `${project.containerTag}_selftest`;
		this.log.info(`Current Project: ${project.projectName}`);
		this.log.info(`Git/Root Path:   ${project.rootDir}`);
		this.log.info(`Container Tag:   ${project.containerTag} (test uses ${testTag})`);

		this.log.info('\n[Simulasi 1] Claude Code menyimpan keputusan arsitektur...');
		const claude = await this.client.addDocument({
			content: `[Agent: Claude Code] Architectural Note: Implemented caching layer with Redis and SQLite for ${project.projectName}.`,
			containerTags: [testTag],
			metadata: { agent: 'Claude Code', project: project.projectName },
		});

		this.log.info('[Simulasi 2] Antigravity merekam perubahan schema database...');
		const antigravity = await this.client.addDocument({
			content: '[Agent: Antigravity] Migration: Added user_profiles table with indexes on email and uuid.',
			containerTags: [testTag],
			metadata: { agent: 'Antigravity', project: project.projectName },
		});

		for (const result of [claude, antigravity]) {
			if (!result.success) {
				this.log.info(`✗ addDocument failed: ${result.error}`);
				return false;
			}
		}

		this.log.info('\nMenunggu 2 detik untuk indexing semantik lokal...');
		await Bun.sleep(INDEX_WAIT_MS);

		this.log.info('\n[Simulasi 3] OpenCode membuka sesi baru dan merecall memori project:');
		const found = await this.client.searchMemories({
			q: `caching migration decisions note ${project.projectName}`,
			containerTags: [testTag],
			limit: 6,
		});
		this.log.info(`\n✓ Ditemukan ${found.results.length} memori relevan dari berbagai agent & session:`);
		for (const doc of found.results) for (const chunk of doc.chunks ?? []) this.log.info(`  • ${chunk.content}`);

		if (!found.results.length) {
			this.log.info(`✗ Tidak ada memori ditemukan${found.error ? `: ${found.error}` : ''}`);
			return false;
		}
		this.log.info(`\n${banner}\n✨ Sukses! Memori berhasil disharing lintas session & lintas agent CLI!\n${banner}`);
		return true;
	}
}
