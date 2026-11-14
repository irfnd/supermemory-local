export interface Payload {
	raw?: string;
	cwd?: string;
	workspacePaths?: string[];
	directory?: string;
	session_id?: string;
	sessionID?: string;
	prompt?: string;
	tool_name?: string;
	tool_input?: { file_path?: string; notebook_path?: string; command?: string };
	last_assistant_message?: string;
	transcript_path?: string;
	conversationId?: string;
	transcriptPath?: string;
	toolCall?: { name?: string; args?: Record<string, string | undefined> };
	assistant_response?: string;
	message?: unknown;
	tool?: string;
	args?: { command?: string } & Record<string, unknown>;
	summary?: string;
}

export function parsePayload(raw: string): Payload {
	if (!raw) return {};
	try {
		return JSON.parse(raw) as Payload;
	} catch {
		return { raw };
	}
}

export const workingDirectory = (payload: Payload): string =>
	payload.cwd || payload.workspacePaths?.[0] || payload.directory || process.cwd();

export const sessionIdOf = (payload: Payload): string | undefined =>
	payload.session_id || payload.sessionID || payload.conversationId;
