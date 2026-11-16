import fs from 'node:fs';
import path from 'node:path';
import type { Logger } from '@supermemory-local/shared/logger';
import { SupermemoryClient } from '@supermemory-local/client/client';
import type { DocumentSummary } from '@supermemory-local/client/types';
import { selectForMigration, type SelectOptions } from '@/migrate/select.ts';

const PAGE_SIZE = 200;
const FETCH_BATCH = 10;
const POST_ATTEMPTS = 3;
const RETRY_MS = 2000;
const PROGRESS_EVERY = 50;
const CAPACITY_CHECK_EVERY = 10;
const SETTLED = ['done', 'failed'];
const MAX_CONSECUTIVE_FAILURES = 5;

export interface ExportedDocument {
	sourceId: string;
	createdAt: string;
	containerTags: string[];
	metadata: Record<string, unknown>;
	content: string;
}

export interface ImportOptions {
	dryRun?: boolean;
	reconcile?: boolean;
	resendStatuses?: string[];
	maxInflight?: number;
	pollMs?: number;
	stallMs?: number;
	maxConsecutiveFailures?: number;
	limit?: number;
	retryMs?: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export class MemoryMigrator {
	constructor(
		private readonly client: SupermemoryClient,
		private readonly log: Logger,
	) {}

	async export(file: string, options: SelectOptions): Promise<void> {
		const all = await this.listAll();
		const picked = selectForMigration(all, options);
		this.log.info(`${all.length} documents on ${this.client.baseUrl}, ${picked.length} selected (oldest first)`);

		const exported: ExportedDocument[] = [];
		let empty = 0;
		for (let i = 0; i < picked.length; i += FETCH_BATCH) {
			const docs = await Promise.all(picked.slice(i, i + FETCH_BATCH).map((doc) => this.client.getDocument(doc.id)));
			docs.forEach((doc, offset) => {
				const summary = picked[i + offset]!;
				if (!doc?.content?.trim()) return void empty++;
				exported.push({
					sourceId: summary.id,
					createdAt: summary.createdAt,
					containerTags: summary.containerTags ?? [],
					metadata: { ...summary.metadata, migratedFrom: summary.id },
					content: doc.content,
				});
			});
		}
		fs.mkdirSync(path.dirname(file), { recursive: true });
		fs.writeFileSync(
			file,
			JSON.stringify({ exportedAt: new Date().toISOString(), source: this.client.baseUrl, documents: exported }),
		);
		this.log.info(`wrote ${exported.length} documents to ${file} (${empty} skipped without content)`);
	}

	async import(
		file: string,
		{
			dryRun = false,
			reconcile = false,
			resendStatuses = [],
			limit,
			retryMs = RETRY_MS,
			maxInflight = 50,
			pollMs = 5000,
			stallMs = 600_000,
			maxConsecutiveFailures = MAX_CONSECUTIVE_FAILURES,
		}: ImportOptions = {},
	): Promise<boolean> {
		const { documents } = JSON.parse(fs.readFileSync(file, 'utf-8')) as { documents: ExportedDocument[] };
		const progressFile = `${file}.done`;
		const done = reconcile
			? await this.presentOnTarget(resendStatuses)
			: new Set(fs.existsSync(progressFile) ? fs.readFileSync(progressFile, 'utf-8').split('\n').filter(Boolean) : []);
		const pending = documents.filter((doc) => !done.has(doc.sourceId)).slice(0, limit);
		this.log.info(
			`${documents.length} in file, ${done.size} already imported, ${pending.length} to send to ${this.client.baseUrl}`,
		);
		if (dryRun) return true;

		const failed: string[] = [];
		let streak = 0;
		for (const [index, doc] of pending.entries()) {
			if (index % CAPACITY_CHECK_EVERY === 0 && !(await this.waitForCapacity(maxInflight, pollMs, stallMs))) return false;
			if (await this.send(doc, retryMs)) {
				streak = 0;
				if (!reconcile) fs.appendFileSync(progressFile, `${doc.sourceId}\n`);
			} else {
				failed.push(doc.sourceId);
				if (++streak >= maxConsecutiveFailures) {
					this.log.info(`${streak} documents in a row failed, stopping; rerun with --reconcile once the target is reachable`);
					return false;
				}
			}
			if ((index + 1) % PROGRESS_EVERY === 0) this.log.info(`${index + 1}/${pending.length} sent`);
		}
		this.log.info(
			`sent ${pending.length - failed.length}/${pending.length}${failed.length ? `, failed: ${failed.join(' ')}` : ''}`,
		);
		return failed.length === 0;
	}

	private async waitForCapacity(maxInflight: number, pollMs: number, stallMs: number): Promise<boolean> {
		let lastInflight = Infinity;
		let lastProgress = Date.now();
		for (;;) {
			const inflight = (await this.client.listDocuments({ limit: PAGE_SIZE })).filter(
				(doc) => !SETTLED.includes(doc.status ?? ''),
			).length;
			if (inflight < maxInflight) return true;
			if (inflight < lastInflight) lastProgress = Date.now();
			lastInflight = inflight;
			if (Date.now() - lastProgress > stallMs) {
				this.log.info(
					`target made no progress for ${stallMs / 1000}s with ${inflight} documents in flight, stopping; rerun with --reconcile after fixing it`,
				);
				return false;
			}
			await sleep(pollMs);
		}
	}

	private async send(doc: ExportedDocument, retryMs: number): Promise<boolean> {
		for (let attempt = 1; attempt <= POST_ATTEMPTS; attempt++) {
			const res = await this.client.addDocument({
				content: doc.content,
				containerTags: doc.containerTags,
				metadata: doc.metadata,
				customId: `migrated-${doc.sourceId}`,
			});
			if (res.success) return true;
			this.log.info(`${doc.sourceId} attempt ${attempt}: ${res.error}`);
			await sleep(retryMs * attempt);
		}
		return false;
	}

	private async presentOnTarget(resendStatuses: string[]): Promise<Set<string>> {
		const prefix = 'migrated-';
		const settled = (await this.listAll()).filter((doc) => !resendStatuses.includes(doc.status ?? ''));
		return new Set(settled.flatMap((doc) => (doc.customId?.startsWith(prefix) ? [doc.customId.slice(prefix.length)] : [])));
	}

	private async listAll(): Promise<DocumentSummary[]> {
		const all: DocumentSummary[] = [];
		for (let page = 1; ; page++) {
			const batch = await this.client.listDocuments({ limit: PAGE_SIZE, page });
			all.push(...batch);
			if (batch.length < PAGE_SIZE) return all;
		}
	}
}
