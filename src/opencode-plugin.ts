// supermemory-local: per-project persistent memory plugin for OpenCode
// Bridge to bin/supermemory-hook.ts. Template: installer.ts rewrites HOOK_CMD and copies this
// into ~/.config/opencode/plugins/supermemory-local.ts
import type { Plugin } from '@opencode-ai/plugin';

const HOOK_CMD = ['bun', 'bin/supermemory-hook.ts'];

export const SupermemoryLocal: Plugin = async ({ $, client, directory }) => {
	const run = (event: string, payload: Record<string, unknown>) =>
		$`${HOOK_CMD} opencode ${event} < ${new Response(JSON.stringify({ cwd: directory, ...payload }))}`.quiet().nothrow().text();

	// Full recall once per session, then each turn appends what other agents/sessions stored since
	const context = new Map<string, string>();

	return {
		'experimental.chat.system.transform': async (input, output) => {
			const id = input.sessionID ?? 'default';
			const delta = (await run(context.has(id) ? 'sync' : 'start', { sessionID: id })).trim();
			const mem = [context.get(id), delta].filter(Boolean).join('\n\n');
			context.set(id, mem);
			if (mem) output.system.push(mem);
		},
		'tool.execute.after': async (input) => {
			await run('change', {
				tool: input.tool,
				args: input.args,
				sessionID: input.sessionID,
			});
		},
		event: async ({ event }) => {
			if (event.type !== 'session.idle' && event.type !== 'session.compacted') return;
			const sessionID = event.properties.sessionID;
			const compacted = event.type === 'session.compacted';
			let summary = '';
			try {
				const res = await client.session.messages({
					path: { id: sessionID },
				});
				// The compaction summary is an assistant message flagged `summary`; an auto-continue reply may already follow it
				const replies = (res.data ?? []).filter((m) => m.info.role === 'assistant');
				const last = compacted ? replies.findLast((m) => m.info.summary) : replies.at(-1);
				// idle right after a compaction would store the summary a second time as a plain reply
				if (last && (compacted || !last.info.summary)) {
					summary = last.parts
						.map((p) => (p.type === 'text' ? p.text : ''))
						.filter(Boolean)
						.join('\n');
				}
			} catch {}
			await run(compacted ? 'compact' : 'stop', { sessionID, summary });
		},
	};
};
