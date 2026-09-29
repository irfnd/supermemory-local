// Test script for Supermemory Local cross-agent and cross-session verification
import { SupermemoryClient } from './supermemory-client.ts';
import { resolveProject } from './project-resolver.ts';

async function main() {
	console.log('========================================================');
	console.log(' Testing Supermemory Local: Cross-Session & Cross-Agent');
	console.log('========================================================');

	const client = new SupermemoryClient();
	const isHealthy = await client.isHealthy();
	console.log(`Server health: ${isHealthy ? 'ONLINE ✓' : 'OFFLINE ✗'} (${client.baseUrl})`);
	if (!isHealthy) {
		console.error('Supermemory server is not running! Run "bun run start" first.');
		process.exit(1);
	}

	const project = resolveProject();
	console.log(`Current Project: ${project.projectName}`);
	console.log(`Git/Root Path:   ${project.rootDir}`);
	// Isolated tag so fake test notes never leak into a real project's memory
	const testTag = `${project.containerTag}_selftest`;
	console.log(`Container Tag:   ${project.containerTag} (test uses ${testTag})`);

	// 1. Simulate saving from Claude Code
	console.log('\n[Simulasi 1] Claude Code menyimpan keputusan arsitektur...');
	const r1 = await client.addDocument({
		content: `[Agent: Claude Code] Architectural Note: Implemented caching layer with Redis and SQLite for ${project.projectName}.`,
		containerTags: [testTag],
		metadata: { agent: 'Claude Code', project: project.projectName },
	});

	// 2. Simulate saving from Antigravity
	console.log('[Simulasi 2] Antigravity merekam perubahan schema database...');
	const r2 = await client.addDocument({
		content: `[Agent: Antigravity] Migration: Added user_profiles table with indexes on email and uuid.`,
		containerTags: [testTag],
		metadata: { agent: 'Antigravity', project: project.projectName },
	});

	for (const r of [r1, r2]) {
		if (!r.success) {
			console.error(`✗ addDocument failed: ${r.error}`);
			process.exit(1);
		}
	}

	// Wait a moment for background chunking & embedding
	console.log('\nMenunggu 2 detik untuk indexing semantik lokal...');
	await Bun.sleep(2000);

	// 3. Simulate OpenCode opening a new session and retrieving ALL past memories
	console.log('\n[Simulasi 3] OpenCode membuka sesi baru dan merecall memori project:');
	const searchRes = await client.searchMemories({
		q: `caching migration decisions note ${project.projectName}`,
		containerTags: [testTag],
		limit: 6,
		chunkThreshold: 0.05,
	});

	console.log(`\n✓ Ditemukan ${searchRes.results.length} memori relevan dari berbagai agent & session:`);
	for (const doc of searchRes.results) {
		for (const chunk of doc.chunks || []) {
			console.log(`  • ${chunk.content}`);
		}
	}

	if (!searchRes.results.length) {
		console.error(`✗ Tidak ada memori ditemukan${searchRes.error ? `: ${searchRes.error}` : ''}`);
		process.exit(1);
	}

	console.log('\n========================================================');
	console.log('✨ Sukses! Memori berhasil disharing lintas session & lintas agent CLI!');
	console.log('========================================================');
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
