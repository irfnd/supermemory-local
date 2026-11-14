import { beforeEach, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { DependencyContainer } from '@supermemory-local/shared/di';
import { SupermemoryClient } from '@supermemory-local/client/client';
import type { Document, NewDocument } from '@supermemory-local/client/types';
import { HOOKS_CONFIG } from '@/config.ts';
import { createContainer } from '@/container.ts';
import { HookRunner } from '@/hook-runner.ts';

class FakeClient {
	baseUrl = 'http://fake';
	healthy = true;
	saved: NewDocument[] = [];
	documents: Document[] = [];

	isHealthy = async () => this.healthy;
	addDocument = async (document: NewDocument) => {
		this.saved.push(document);
		return { success: true as const, data: { id: String(this.saved.length), status: 'queued' } };
	};
	listDocuments = async () => this.documents.map(({ content: _content, ...summary }) => summary);
	getDocument = async (id: string) => this.documents.find((doc) => doc.id === id) ?? null;
	profile = async () => ({ static: ['uses bun'], dynamic: [] });
	search = async () => [];
}

let client: FakeClient;
let runner: HookRunner;
let container: DependencyContainer;
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'sm-project-'));

beforeEach(() => {
	client = new FakeClient();
	container = createContainer({});
	container.register(HOOKS_CONFIG, {
		useValue: { logFile: '/dev/null', syncDir: fs.mkdtempSync(path.join(os.tmpdir(), 'sm-sync-')) },
	});
	container.register(SupermemoryClient, { useValue: client as unknown as SupermemoryClient });
	runner = container.resolve(HookRunner);
});

const payload = (extra: object) => JSON.stringify({ cwd, session_id: 's1', ...extra });

test('change stores file edits tagged with the agent and skips read-only shell commands', async () => {
	await runner.run('claude-code', 'change', payload({ tool_name: 'Edit', tool_input: { file_path: 'a.ts' } }));
	await runner.run('claude-code', 'change', payload({ tool_name: 'Bash', tool_input: { command: 'git status' } }));
	expect(client.saved).toHaveLength(1);
	expect(client.saved[0]!.content).toContain('File: a.ts');
	expect(client.saved[0]!.metadata).toMatchObject({ type: 'change_observation', agent: 'Claude Code', session: 's1' });
});

test('start injects stored memories and extracted facts, Antigravity gets them as injectSteps', async () => {
	client.documents = [
		{
			id: 'd1',
			createdAt: '2026-01-02T00:00:00Z',
			metadata: { type: 'session_summary' },
			content: 'Shipped the docker compose setup',
		},
	];
	const out = await runner.run('claude-code', 'start', payload({}));
	expect(out).toContain('# Shared Project Memory:');
	expect(out).toContain('Shipped the docker compose setup');
	expect(out).toContain('- uses bun');

	const agy = JSON.parse(await runner.run('antigravity', 'start', payload({ session_id: undefined })));
	expect(agy.injectSteps[0].ephemeralMessage).toContain('Shipped the docker compose setup');
});

test('start stays silent when the server is down, and Antigravity still gets a JSON object', async () => {
	client.healthy = false;
	expect(await runner.run('claude-code', 'start', payload({}))).toBe('');
	expect(await runner.run('antigravity', 'start', payload({}))).toBe('{}');
	expect(await runner.run('antigravity', 'nonsense', payload({}))).toBe('{}');
});

test('stop stores one summary per distinct reply, minus quoted memory blocks', async () => {
	const reply =
		'All done: refactored into per-service folders.\n<supermemory-context>\n# Shared Project Memory: p\nstale-memory\n</supermemory-context>';
	await runner.run('claude-code', 'stop', payload({ last_assistant_message: reply }));
	await runner.run('claude-code', 'stop', payload({ last_assistant_message: reply }));
	await runner.run('claude-code', 'stop', payload({ last_assistant_message: 'ok' }));
	expect(client.saved).toHaveLength(1);
	expect(client.saved[0]!.content).toContain('refactored into per-service folders');
	expect(client.saved[0]!.content).not.toContain('stale-memory');
	expect(client.saved[0]!.metadata).toMatchObject({ type: 'session_summary' });
});
