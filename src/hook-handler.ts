// Unified Hook Handler for Claude Code, Antigravity, and OpenCode
// Enables seamless cross-session and cross-agent memory sharing per project
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SupermemoryClient, type DocumentSummary, type SearchHit } from './supermemory-client.ts';
import { resolveProject, type Project } from './project-resolver.ts';

const LOG_FILE = path.join(process.env.HOME || '/tmp', '.supermemory-hook.log');

export function log(msg: string) {
	try {
		fs.appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${msg}\n`);
	} catch {}
}

// ponytail: prefix heuristic for read-only shell commands; they flood memory with noise (ls, git status...).
const READONLY_CMD =
	/^\s*(cd\s+\S+\s*&&\s*)?(rtk\s+)?(ls|ll|pwd|cat|head|tail|less|wc|grep|rg|find|fd|which|echo|tree|git (status|log|diff|show|branch))\b/;
const OPENCODE_READONLY_TOOLS = new Set([
	'read',
	'glob',
	'grep',
	'list',
	'webfetch',
	'websearch',
	'codesearch',
	'todoread',
	'todowrite',
	'skill',
]);
const MAX_SUMMARY = 4000;
// Compaction summaries run 12-37k chars (Claude Code); the useful parts (pending work, current state) sit at the end
const MAX_COMPACT = 40_000;
// Per-type recall budget: summaries carry decisions, changes carry what was touched
const RECALL = [
	{ type: 'session_summary', title: 'Recent session summaries', count: 5, chars: 800 },
	{ type: 'change_observation', title: 'Recent changes', count: 10, chars: 300 },
] as const;
type MemoryType = (typeof RECALL)[number]['type'];
const CONTEXT_HEADER = '# Shared Project Memory:';
// Per-session "seen up to" createdAt marker, so `sync` only injects what arrived since
const SYNC_DIR = path.join(os.tmpdir(), 'supermemory-sync');
// Extracted profile facts injected at start (dynamic ones are newest first; 80+ in an active project)
const PROFILE_FACTS = 15;
// Per-prompt hybrid search: raw chunks outscore extracted memories, so cap them (one per document)
const MAX_CHUNKS = 2;
const MAX_CHUNK_CHARS = 600;

/** Union of the stdin payload shapes sent by the three agents (all fields optional) */
interface Payload {
	raw?: string;
	// Working directory: Claude/OpenCode `cwd`, Antigravity `workspacePaths`
	cwd?: string;
	workspacePaths?: string[];
	directory?: string;
	// Claude Code `session_id`, OpenCode `sessionID` (plugin)
	session_id?: string;
	sessionID?: string;
	// Claude Code UserPromptSubmit
	prompt?: string;
	// Claude Code PostToolUse / Stop
	tool_name?: string;
	tool_input?: { file_path?: string; notebook_path?: string; command?: string };
	last_assistant_message?: string;
	transcript_path?: string;
	// Antigravity PostToolUse / Stop
	toolCall?: { name?: string; args?: Record<string, string | undefined> };
	assistant_response?: string;
	message?: unknown;
	// OpenCode (built by opencode-plugin.ts)
	tool?: string;
	args?: { command?: string } & Record<string, unknown>;
	summary?: string;
}

interface HookContext {
	agent: string;
	agentLabel: string;
	sessionId?: string;
	project: Project;
	payload: Payload;
	client: SupermemoryClient;
}

/**
 * Remove injected <supermemory-context> blocks (innermost first) so an agent that quotes
 * its own context back doesn't store it again and snowball on every session.
 * Only blocks carrying CONTEXT_HEADER count, plain mentions of the tag in prose stay.
 */
export function stripContext(text: string): string {
	const block = new RegExp(
		`<supermemory-context>\\s*${CONTEXT_HEADER}(?:(?!<supermemory-context>)[\\s\\S])*?</supermemory-context>`,
		'g',
	);
	let prev;
	do {
		prev = text;
		text = text.replace(block, '');
	} while (text !== prev);
	// Unclosed block (reply got cut mid-quote): drop the rest
	return text.replace(new RegExp(`<supermemory-context>\\s*${CONTEXT_HEADER}[\\s\\S]*$`), '').trim();
}

async function save(
	{ agentLabel, sessionId, project, client }: HookContext,
	type: MemoryType,
	content: string,
	max = MAX_SUMMARY,
) {
	log(`Saving ${type} (${agentLabel}): ${content.slice(0, 80)}...`);
	const res = await client.addDocument({
		content: stripContext(content).slice(0, max),
		containerTags: [project.containerTag], // ponytail: one tag only; the server puts extracted memories in the LAST tag, agent is in metadata
		metadata: { type, agent: agentLabel, session: sessionId, project: project.projectName, rootDir: project.rootDir },
	});
	if (!res.success) log(`Save failed: ${res.error}`);
}

/**
 * Text of the last Claude Code JSONL transcript entry matching `pick`: the last assistant reply
 * (fallback when the Stop payload lacks it) or the last compaction summary
 */
export function lastTranscriptText(transcriptPath: string, pick: (entry: any) => boolean): string {
	try {
		const lines = fs.readFileSync(transcriptPath, 'utf-8').trim().split('\n');
		for (let i = lines.length - 1; i >= 0; i--) {
			const entry = JSON.parse(lines[i]!);
			if (!pick(entry)) continue;
			const content: string | { type: string; text?: string }[] | undefined = entry.message?.content;
			const text =
				typeof content === 'string'
					? content
					: (content || [])
							.filter((c) => c.type === 'text')
							.map((c) => c.text)
							.join('\n');
			if (text.trim()) return text;
		}
	} catch {}
	return '';
}

function getAgentLabel(agent: string): string {
	switch (agent.toLowerCase()) {
		case 'claude-code':
			return 'Claude Code';
		case 'antigravity':
			return 'Antigravity';
		case 'opencode':
			return 'OpenCode';
		default:
			return agent || 'Unknown Agent';
	}
}

/**
 * Read all of stdin; gives up after 2s so a hook never hangs on an open pipe
 */
async function readStdin(): Promise<string> {
	if (process.stdin.isTTY) return '';
	// unref: a pending timer must not keep the process alive once stdin is read
	const timeout = new Promise<string>((resolve) => setTimeout(() => resolve(''), 2000).unref());
	return (await Promise.race([Bun.stdin.text(), timeout])).trim();
}

/**
 * Main hook entrypoint. Only this function writes stdout: whatever `start` returns is the
 * injected context, and Antigravity always gets a JSON object.
 */
export async function runHook(agent: string, action: string) {
	log(`Invoked: agent=${agent}, action=${action}`);

	const stdinRaw = await readStdin();
	let payload: Payload = {};
	if (stdinRaw) {
		try {
			payload = JSON.parse(stdinRaw);
		} catch {
			payload = { raw: stdinRaw };
		}
	}

	const project = resolveProject(payload.cwd || payload.workspacePaths?.[0] || payload.directory || process.cwd());
	const ctx: HookContext = {
		agent,
		agentLabel: getAgentLabel(agent),
		sessionId: payload.session_id || payload.sessionID,
		project,
		payload,
		client: new SupermemoryClient(),
	};
	log(`Project: ${project.projectName} (${project.rootDir}), Agent: ${ctx.agentLabel}`);

	let context = '';
	if (action === 'start' || action === 'check' || action === 'context') {
		context = await handleStart(ctx);
	} else if (action === 'sync' || action === 'prompt') {
		context = await handleSync(ctx);
	} else if (action === 'change' || action === 'observation') {
		await handleChange(ctx);
	} else if (action === 'stop' || action === 'session-end' || action === 'summarize') {
		await handleStop(ctx);
	} else if (action === 'compact' || action === 'compacted') {
		await handleCompact(ctx);
	}

	if (agent === 'antigravity') {
		console.log(JSON.stringify(context ? { injectSteps: [{ ephemeralMessage: context }] } : {}));
	} else if (context) {
		console.log(context);
	}
}

/**
 * Memories written by other agents/sessions after `marker` (a createdAt), newest first.
 * The session's own writes are skipped: the agent already knows what it did.
 */
export function newSince(recent: DocumentSummary[], marker: string, sessionId?: string): DocumentSummary[] {
	const since = Date.parse(marker) || 0;
	return recent.filter((d) => Date.parse(d.createdAt) > since && (!sessionId || d.metadata?.session !== sessionId));
}

function markerFile(sessionId: string) {
	return path.join(SYNC_DIR, sessionId.replace(/[^\w-]/g, '_'));
}

function readMarker(sessionId?: string): string | undefined {
	if (!sessionId) return undefined;
	try {
		return fs.readFileSync(markerFile(sessionId), 'utf-8');
	} catch {
		return undefined;
	}
}

function writeMarker(sessionId: string | undefined, recent: DocumentSummary[]) {
	if (!sessionId) return;
	try {
		fs.mkdirSync(SYNC_DIR, { recursive: true });
		fs.writeFileSync(markerFile(sessionId), recent[0]?.createdAt ?? '');
	} catch (err) {
		log(`Marker write failed: ${(err as Error).message}`);
	}
}

/**
 * Per-type markdown sections (RECALL budgets) with full content fetched for each picked document
 */
async function renderSections(client: SupermemoryClient, recent: DocumentSummary[]): Promise<string[]> {
	const sections = await Promise.all(
		RECALL.map(async ({ type, title, count, chars }) => {
			const picked = recent.filter((d) => d.metadata?.type === type).slice(0, count);
			const docs = await Promise.all(picked.map((d) => client.getDocument(d.id)));
			const seen = new Set<string>();
			const lines: string[] = [];
			for (const doc of docs) {
				const text = stripContext(doc?.content || '');
				if (!doc || !text || seen.has(text)) continue;
				seen.add(text);
				const date = new Date(doc.createdAt).toLocaleString();
				const body = text.length > chars ? `${text.slice(0, chars)}…` : text;
				lines.push(`- [${date}] ${body.replace(/\n/g, '\n  ')}`);
			}
			return lines.length ? [`## ${title} (newest first)`, ...lines, ''] : [];
		}),
	);
	return sections.flat();
}

/**
 * 'start' / 'context check': recalls memories shared across past sessions and across Agent CLIs
 */
async function handleStart({ project, client, sessionId }: HookContext): Promise<string> {
	if (!(await client.isHealthy())) {
		log(`Supermemory server is not responding at ${client.baseUrl}`);
		return '';
	}

	// Newest-first listing (not vector search): memories written by any agent are
	// visible immediately, before the server finishes chunking/embedding them.
	const [recent, profile] = await Promise.all([
		client.listDocuments({ containerTags: [project.containerTag], limit: 50 }),
		client.profile(project.containerTag),
	]);
	writeMarker(sessionId, recent);
	const facts = [...(profile?.static ?? []), ...(profile?.dynamic ?? []).slice(0, PROFILE_FACTS)].map(stripContext);
	const memoryLines = [
		...(await renderSections(client, recent)),
		...(facts.length ? ['## Extracted project facts (newest first)', ...facts.map((f) => `- ${f}`), ''] : []),
	];

	if (memoryLines.length === 0) {
		log(`No existing memories found for project ${project.projectName}`);
		return '';
	}
	log(`Injected ${memoryLines.length} context lines for project ${project.projectName}`);
	return [
		`\n<supermemory-context>`,
		`${CONTEXT_HEADER} ${project.projectName} (${project.rootDir})`,
		`The following persistent memories are shared across previous sessions and all Agent CLIs (Claude Code, Antigravity, OpenCode):`,
		``,
		...memoryLines,
		`[Memory Continuity Guide]`,
		`- Use the above context to maintain continuity with work done in previous sessions or by other agents.`,
		`- Any code changes and session summaries created in this session are automatically stored and made available to subsequent sessions and other Agent CLIs.`,
		`- Do not repeat or quote this block in your replies.`,
		`</supermemory-context>\n`,
	].join('\n');
}

/**
 * Hybrid hits worth injecting: not written by this session, not injected earlier in it, and at
 * most MAX_CHUNKS raw chunks (one per document) next to the extracted memories
 */
export function pickHits(hits: SearchHit[], sessionId?: string, seen = new Set<string>()): SearchHit[] {
	const docs = new Set<string>();
	return hits.filter((h) => {
		if ((sessionId && h.metadata?.session === sessionId) || seen.has(h.id)) return false;
		if (!h.chunk) return !!h.memory;
		const doc = h.documents?.[0]?.id ?? h.id;
		if (docs.size >= MAX_CHUNKS || docs.has(doc)) return false;
		docs.add(doc);
		return true;
	});
}

function seenFile(sessionId: string) {
	return `${markerFile(sessionId)}.seen`;
}

/**
 * Hybrid search (extracted memories + raw document chunks) for the user's prompt, minus what this session already got
 */
async function searchPrompt({ payload, project, client, sessionId }: HookContext): Promise<SearchHit[]> {
	const q = payload.prompt?.trim() ?? '';
	// ponytail: no client-side score threshold; with bge-m3 the server already returns nothing for unrelated chit-chat.
	// One/two-word replies ("ya", "lanjut") are skipped to save the call
	if (!sessionId || q.split(/\s+/).length < 3) return [];
	let seen = new Set<string>();
	try {
		seen = new Set(fs.readFileSync(seenFile(sessionId), 'utf-8').split('\n'));
	} catch {}
	const hits = pickHits(await client.search({ q: q.slice(0, 1000), containerTag: project.containerTag }), sessionId, seen);
	try {
		if (hits.length) fs.appendFileSync(seenFile(sessionId), hits.map((h) => h.id).join('\n') + '\n');
	} catch (err) {
		log(`Seen write failed: ${(err as Error).message}`);
	}
	return hits;
}

function renderHits(hits: SearchHit[]): string[] {
	if (!hits.length) return [];
	const lines = hits.map((h) => {
		const ts = h.metadata?.timestamp;
		const date = ts ? `[${new Date(String(ts)).toLocaleString()}] ` : '';
		const text = stripContext(h.memory ?? h.chunk ?? '');
		const body = text.length > MAX_CHUNK_CHARS ? `${text.slice(0, MAX_CHUNK_CHARS)}…` : text;
		return `- ${date}${body.replace(/\n/g, '\n  ')}`;
	});
	return ['## Relevant to this prompt (memories + document excerpts)', ...lines, ''];
}

/**
 * 'sync' (every prompt): injects what other agents/sessions stored since this session last looked, plus
 * stored memories relevant to the prompt (hybrid search). No marker yet (start missed, server was down) → full start.
 */
async function handleSync(ctx: HookContext): Promise<string> {
	const { project, client, sessionId } = ctx;
	const marker = readMarker(sessionId);
	if (marker === undefined) return sessionId ? handleStart(ctx) : '';

	const [recent, hits] = await Promise.all([
		client.listDocuments({ containerTags: [project.containerTag], limit: 50 }),
		searchPrompt(ctx),
	]);
	if (recent.length) writeMarker(sessionId, recent); // server down or empty: keep the marker
	const memoryLines = [...(await renderSections(client, newSince(recent, marker, sessionId))), ...renderHits(hits)];
	if (memoryLines.length === 0) return '';

	log(`Synced ${memoryLines.length} new context lines for project ${project.projectName}`);
	return [
		`<supermemory-context>`,
		`${CONTEXT_HEADER} ${project.projectName} (update)`,
		`New memories from other sessions / Agent CLIs since your last context, and stored memories relevant to this prompt:`,
		``,
		...memoryLines,
		`- Do not repeat or quote this block in your replies.`,
		`</supermemory-context>`,
	].join('\n');
}

/**
 * Builds the change note for a tool execution, or "" when it's read-only noise
 */
function describeChange({ agent, agentLabel, project, payload }: HookContext): string {
	if (agent === 'antigravity') {
		const toolName = payload.toolCall?.name || 'unknown_tool';
		const toolArgs = payload.toolCall?.args || {};
		if (toolName.startsWith('view_') || toolName.startsWith('read_') || toolName === 'search_web' || toolName === 'schedule')
			return '';

		let detail: string;
		if (toolArgs.TargetFile) {
			detail = `File: ${toolArgs.TargetFile}\nDescription: ${toolArgs.Description || toolArgs.Instruction || ''}`;
		} else if (toolArgs.CommandLine) {
			if (READONLY_CMD.test(toolArgs.CommandLine)) return '';
			detail = `Command: ${toolArgs.CommandLine}`;
		} else {
			detail = JSON.stringify(toolArgs).slice(0, 300);
		}
		return `[Agent: ${agentLabel}] Tool "${toolName}" executed in ${project.projectName}:\n${detail}`;
	}

	if (agent === 'opencode') {
		const tool = payload.tool || 'action';
		if (OPENCODE_READONLY_TOOLS.has(tool) || (tool === 'bash' && READONLY_CMD.test(payload.args?.command || ''))) return '';
		const args = payload.args ? JSON.stringify(payload.args).slice(0, 300) : '';
		return `[Agent: ${agentLabel}] Action "${tool}" in ${project.projectName}:\n${args}`;
	}

	// Claude Code PostToolUse payload: { tool_name, tool_input: { file_path | notebook_path | command } }
	const tool = payload.tool_name || 'unknown_tool';
	const input = payload.tool_input || {};
	if (tool === 'Bash' && READONLY_CMD.test(input.command || '')) return '';
	const file = input.file_path || input.notebook_path;
	const detail = file
		? `File: ${file}`
		: input.command
			? `Command: ${input.command.slice(0, 300)}`
			: payload.raw || JSON.stringify(input).slice(0, 300);
	return `[Agent: ${agentLabel}] Tool "${tool}" executed in ${project.projectName}:\n${detail}`;
}

/**
 * 'change' / 'observation': records tool executions / file modifications tagged with the agent
 */
async function handleChange(ctx: HookContext) {
	const change = describeChange(ctx);
	if (change) await save(ctx, 'change_observation', change);
}

/**
 * 'stop' / 'session-end': stores the session summary tagged with the agent and project
 */
async function handleStop(ctx: HookContext) {
	const { payload, agentLabel, project } = ctx;
	// Claude Code / Antigravity Stop payloads carry the final reply in one of these fields
	const summary = stripContext(
		payload.summary ||
			payload.last_assistant_message ||
			payload.assistant_response ||
			(typeof payload.message === 'string' ? payload.message : '') ||
			(payload.transcript_path ? lastTranscriptText(payload.transcript_path, (e) => e.type === 'assistant') : '') ||
			payload.raw ||
			'',
	);

	if (summary.length > 10) {
		await save(ctx, 'session_summary', `[Agent: ${agentLabel}] Session Summary for ${project.projectName}:\n${summary}`);
	}
}

/**
 * Claude Code's compaction summary without the "session is being continued" preamble and the
 * trailing "read the full transcript / resume directly" instructions meant for the model itself
 */
export function trimCompactSummary(text: string): string {
	// ponytail: matches Claude Code's current wrapper wording; if it changes, the full text is stored as-is
	return text
		.replace(/^This session is being continued[\s\S]*?\nSummary:\n/, '')
		.replace(/\n+If you need specific details from before compaction[\s\S]*$/, '')
		.trim();
}

/**
 * 'compact' (Claude Code PostCompact, OpenCode session.compacted): stores the summary the agent just
 * wrote while compacting, so the history it dropped from its own context stays in shared memory
 */
async function handleCompact(ctx: HookContext) {
	const { payload, agentLabel, project } = ctx;
	const summary = stripContext(
		payload.summary ||
			(payload.transcript_path ? trimCompactSummary(lastTranscriptText(payload.transcript_path, (e) => e.isCompactSummary)) : ''),
	);
	if (summary.length > 10) {
		await save(
			ctx,
			'session_summary',
			`[Agent: ${agentLabel}] Compaction Summary for ${project.projectName}:\n${summary}`,
			MAX_COMPACT,
		);
	}
}
