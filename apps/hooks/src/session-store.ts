import fs from 'node:fs';
import path from 'node:path';
import { LOGGER, type Logger } from '@supermemory-local/shared/logger';
import { HOOKS_CONFIG, type HooksConfig } from '@/config.ts';
import type { DocumentSummary } from '@supermemory-local/client/types';

export class SessionStore {
	constructor(
		private readonly config: HooksConfig,
		private readonly logger: Logger,
	) {}

	readMarker(sessionId?: string): string | undefined {
		return sessionId ? this.read(this.file(sessionId)) : undefined;
	}

	writeMarker(sessionId: string | undefined, recent: DocumentSummary[]) {
		if (sessionId) this.write(this.file(sessionId), recent[0]?.createdAt ?? '', 'Marker');
	}

	seen(sessionId: string): Set<string> {
		return new Set(this.read(this.file(sessionId, '.seen'))?.split('\n'));
	}

	markSeen(sessionId: string, ids: string[]) {
		try {
			this.ensureDir();
			fs.appendFileSync(this.file(sessionId, '.seen'), ids.join('\n') + '\n');
		} catch (err) {
			this.logger.info(`Seen write failed: ${(err as Error).message}`);
		}
	}

	cached(sessionId: string, maxAgeMs: number): string | undefined {
		const file = this.file(sessionId, '.ctx');
		try {
			return Date.now() - fs.statSync(file).mtimeMs < maxAgeMs ? fs.readFileSync(file, 'utf-8') : undefined;
		} catch {
			return undefined;
		}
	}

	cache(sessionId: string, text: string) {
		this.write(this.file(sessionId, '.ctx'), text, 'Start cache');
	}

	// OpenCode 2.x delivers each event to every live plugin instance, so identical summaries must be stored once (atomic `wx` create)
	firstTime(sessionId: string | undefined, kind: string, text: string): boolean {
		if (!sessionId) return true;
		const hash = new Bun.CryptoHasher('sha1').update(text).digest('hex').slice(0, 12);
		try {
			this.ensureDir();
			fs.writeFileSync(this.file(sessionId, `.${kind}-${hash}`), '', { flag: 'wx' });
			return true;
		} catch (err) {
			return (err as NodeJS.ErrnoException).code !== 'EEXIST';
		}
	}

	private file(sessionId: string, suffix = ''): string {
		return path.join(this.config.syncDir, sessionId.replace(/[^\w-]/g, '_') + suffix);
	}

	private ensureDir() {
		fs.mkdirSync(this.config.syncDir, { recursive: true });
	}

	private read(file: string): string | undefined {
		try {
			return fs.readFileSync(file, 'utf-8');
		} catch {
			return undefined;
		}
	}

	private write(file: string, content: string, label: string) {
		try {
			this.ensureDir();
			fs.writeFileSync(file, content);
		} catch (err) {
			this.logger.info(`${label} write failed: ${(err as Error).message}`);
		}
	}
}
