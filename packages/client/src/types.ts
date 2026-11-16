export type Result<T> = { success: true; data: T } | { success: false; error: string };

export type Metadata = Record<string, unknown> | null;

export interface DocumentSummary {
	id: string;
	createdAt: string;
	metadata?: Metadata;
	containerTags?: string[];
	status?: string;
	customId?: string | null;
}

export interface Document extends DocumentSummary {
	content: string | null;
}

export interface SearchResult {
	documentId: string;
	createdAt?: string;
	chunks?: { content: string }[];
}

export interface SearchHit {
	id: string;
	memory?: string;
	chunk?: string;
	similarity: number;
	metadata?: Metadata;
	documents?: { id: string }[];
}

export interface Profile {
	static: string[];
	dynamic: string[];
}

export interface NewDocument {
	content: string;
	containerTags?: string[];
	metadata?: Record<string, unknown>;
	customId?: string;
}
