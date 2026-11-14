import { SUPERMEMORY_CONFIG, type SupermemoryConfig } from '@supermemory-local/client/config';
import type {
	Document,
	DocumentSummary,
	NewDocument,
	Profile,
	Result,
	SearchHit,
	SearchResult,
} from '@supermemory-local/client/types';

const REQUEST_TIMEOUT_MS = 5000;
const HEALTH_TIMEOUT_MS = 3000;

export class SupermemoryClient {
	constructor(private readonly config: SupermemoryConfig) {}

	get baseUrl(): string {
		return this.config.baseUrl;
	}

	async isHealthy(): Promise<boolean> {
		try {
			const res = await fetch(`${this.baseUrl}/v3/search/spaces`, {
				headers: this.headers(),
				signal: AbortSignal.timeout(HEALTH_TIMEOUT_MS),
			});
			return res.status === 200;
		} catch {
			return false;
		}
	}

	async request<T>(method: string, urlPath: string, body?: unknown): Promise<Result<T>> {
		try {
			const res = await fetch(`${this.baseUrl}${urlPath}`, {
				method,
				headers: this.headers(),
				body: body ? JSON.stringify(body) : undefined,
				signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
			});
			if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${await res.text()}` };
			return { success: true, data: (await res.json()) as T };
		} catch (err) {
			return { success: false, error: (err as Error).message };
		}
	}

	addDocument({ content, containerTags = [], metadata = {} }: NewDocument) {
		return this.request<{ id: string; status: string }>('POST', '/v3/documents', {
			content,
			containerTags,
			metadata: { ...metadata, timestamp: new Date().toISOString() },
		});
	}

	async listDocuments({
		containerTags = [],
		limit = 50,
	}: {
		containerTags?: string[];
		limit?: number;
	}): Promise<DocumentSummary[]> {
		const res = await this.request<{ memories?: DocumentSummary[] }>('POST', '/v3/documents/list', {
			containerTags,
			limit,
			sort: 'createdAt',
			order: 'desc',
		});
		return res.success ? (res.data.memories ?? []) : [];
	}

	async getDocument(id: string): Promise<Document | null> {
		const res = await this.request<Document>('GET', `/v3/documents/${encodeURIComponent(id)}`);
		return res.success ? res.data : null;
	}

	async search({
		q,
		containerTag,
		searchMode = 'hybrid',
		limit = 6,
	}: {
		q: string;
		containerTag: string;
		searchMode?: 'memories' | 'hybrid';
		limit?: number;
	}): Promise<SearchHit[]> {
		const res = await this.request<{ results?: SearchHit[] }>('POST', '/v4/search', { q, containerTag, searchMode, limit });
		return res.success ? (res.data.results ?? []) : [];
	}

	async profile(containerTag: string): Promise<Profile | null> {
		const res = await this.request<{ profile?: Profile }>('POST', '/v4/profile', { containerTag });
		return res.success ? (res.data.profile ?? null) : null;
	}

	async searchMemories({
		q,
		containerTags = [],
		limit = 10,
		chunkThreshold = 0.05,
	}: {
		q: string;
		containerTags?: string[];
		limit?: number;
		chunkThreshold?: number;
	}): Promise<{ results: SearchResult[]; error?: string }> {
		const res = await this.request<{ results?: SearchResult[] }>('POST', '/v3/search', {
			q,
			limit,
			chunkThreshold,
			containerTags,
		});
		return res.success ? { results: res.data.results ?? [] } : { results: [], error: res.error };
	}

	private headers(): Record<string, string> {
		const headers: Record<string, string> = { 'Content-Type': 'application/json' };
		if (this.config.apiKey) headers.Authorization = `Bearer ${this.config.apiKey}`;
		return headers;
	}
}
