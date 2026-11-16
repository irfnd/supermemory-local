import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, expect, test } from 'bun:test';
import type { SupermemoryClient } from '@supermemory-local/client/client';
import type { NewDocument } from '@supermemory-local/client/types';
import { MemoryMigrator } from '@/migrate/migrator.ts';

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-'));
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));
const log = { info() {} };

const source = {
	baseUrl: 'http://source',
	listDocuments: async ({ page = 1 }: { page?: number }) =>
		page > 1
			? []
			: [
					{
						id: 'new',
						createdAt: '2026-10-02T00:00:00Z',
						containerTags: ['p'],
						metadata: { type: 'session_summary', timestamp: 'T2' },
					},
					{
						id: 'old',
						createdAt: '2026-10-01T00:00:00Z',
						containerTags: ['p'],
						metadata: { type: 'session_summary', timestamp: 'T1' },
					},
					{ id: 'empty', createdAt: '2026-10-03T00:00:00Z', containerTags: ['p'], metadata: { type: 'session_summary' } },
				],
	getDocument: async (id: string) => ({ id, createdAt: '', content: id === 'empty' ? ' ' : `body of ${id}` }),
} as unknown as SupermemoryClient;

const fakeTarget = (failFirst = 0) => {
	const sent: NewDocument[] = [];
	let failures = failFirst;
	const client = {
		baseUrl: 'http://target',
		listDocuments: async () => [],
		addDocument: async (doc: NewDocument) => {
			if (failures-- > 0) return { success: false, error: 'HTTP 503' };
			sent.push(doc);
			return { success: true, data: { id: 'x', status: 'queued' } };
		},
	} as unknown as SupermemoryClient;
	return { client, sent };
};

test('export writes selected documents oldest first and drops empty content', async () => {
	const file = path.join(dir, 'export.json');
	await new MemoryMigrator(source, log).export(file, { observationsPerProject: 20 });
	const { documents } = JSON.parse(fs.readFileSync(file, 'utf-8'));
	expect(documents.map((d: { sourceId: string }) => d.sourceId)).toEqual(['old', 'new']);
	expect(documents[0].metadata).toMatchObject({ timestamp: 'T1', migratedFrom: 'old' });
});

test('import keeps the original timestamp, sets customId, retries, and resumes from the progress file', async () => {
	const file = path.join(dir, 'export.json');
	const flaky = fakeTarget(1);
	expect(await new MemoryMigrator(flaky.client, log).import(file, { limit: 1, retryMs: 1 })).toBe(true);
	expect(flaky.sent).toHaveLength(1);
	expect(flaky.sent[0]).toMatchObject({ customId: 'migrated-old', content: 'body of old', metadata: { timestamp: 'T1' } });

	const resumed = fakeTarget();
	await new MemoryMigrator(resumed.client, log).import(file, { retryMs: 1 });
	expect(resumed.sent.map((d) => d.customId)).toEqual(['migrated-new']);

	const dry = fakeTarget();
	await new MemoryMigrator(dry.client, log).import(file, { dryRun: true });
	expect(dry.sent).toHaveLength(0);
});

test('import reports failure when a document keeps failing', async () => {
	const file = path.join(dir, 'export2.json');
	await new MemoryMigrator(source, log).export(file, { observationsPerProject: 20 });
	expect(await new MemoryMigrator(fakeTarget(99).client, log).import(file, { retryMs: 1 })).toBe(false);
});

test('reconcile sends only documents whose customId is missing on the target', async () => {
	const file = path.join(dir, 'export3.json');
	await new MemoryMigrator(source, log).export(file, { observationsPerProject: 20 });
	const target = fakeTarget();
	const client = Object.assign(target.client, {
		listDocuments: async ({ page = 1 }: { page?: number }) =>
			page > 1 ? [] : [{ id: 'x', createdAt: '', customId: 'migrated-old' }],
	});
	await new MemoryMigrator(client, log).import(file, { reconcile: true, retryMs: 1 });
	expect(target.sent.map((d) => d.customId)).toEqual(['migrated-new']);
});

test('resendStatuses sends again the documents stuck in those statuses', async () => {
	const file = path.join(dir, 'export4.json');
	await new MemoryMigrator(source, log).export(file, { observationsPerProject: 20 });
	const target = fakeTarget();
	const client = Object.assign(target.client, {
		listDocuments: async ({ page = 1 }: { page?: number }) =>
			page > 1
				? []
				: [
						{ id: 'a', createdAt: '', customId: 'migrated-old', status: 'done' },
						{ id: 'b', createdAt: '', customId: 'migrated-new', status: 'embedding' },
					],
	});
	await new MemoryMigrator(client, log).import(file, { reconcile: true, resendStatuses: ['embedding'], retryMs: 1 });
	expect(target.sent.map((d) => d.customId)).toEqual(['migrated-new']);
});

test('import waits while too many documents are in flight and gives up when the target stalls', async () => {
	const file = path.join(dir, 'export5.json');
	await new MemoryMigrator(source, log).export(file, { observationsPerProject: 20 });

	const draining = fakeTarget();
	let polls = 0;
	Object.assign(draining.client, {
		listDocuments: async () => {
			const inflight = polls++ < 3 ? 5 : 0;
			return Array.from({ length: inflight }, (_, i) => ({ id: `i${i}`, createdAt: '', status: 'embedding' }));
		},
	});
	expect(await new MemoryMigrator(draining.client, log).import(file, { maxInflight: 2, pollMs: 1 })).toBe(true);
	expect(polls).toBeGreaterThan(3);
	expect(draining.sent).toHaveLength(2);

	const stuckFile = path.join(dir, 'export6.json');
	await new MemoryMigrator(source, log).export(stuckFile, { observationsPerProject: 20 });
	const stuck = fakeTarget();
	Object.assign(stuck.client, {
		listDocuments: async () => [
			{ id: 'i', createdAt: '', status: 'embedding' },
			{ id: 'j', createdAt: '', status: 'indexing' },
		],
	});
	expect(await new MemoryMigrator(stuck.client, log).import(stuckFile, { maxInflight: 2, pollMs: 1, stallMs: 20 })).toBe(false);
	expect(stuck.sent).toHaveLength(0);
});

test('import stops after consecutive failures instead of burning through the whole list', async () => {
	const file = path.join(dir, 'export7.json');
	await new MemoryMigrator(source, log).export(file, { observationsPerProject: 20 });
	const target = fakeTarget();
	let calls = 0;
	Object.assign(target.client, {
		addDocument: async () => {
			calls++;
			return { success: false, error: 'Unable to connect' };
		},
	});
	expect(await new MemoryMigrator(target.client, log).import(file, { maxConsecutiveFailures: 1, retryMs: 1 })).toBe(false);
	expect(calls).toBe(3);
});
